import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  cleanConversationIdentity,
  cleanConversationTitle,
  cleanConversationUrl,
  conversationRevisionCounts,
  importedConversationUrl,
  validCapturedAt,
  validateMessageFingerprints,
} from "./lib/conversationImport";
import { requireOwnerAccess } from "./lib/privateAccess";
import { applyReferenceStatsDelta } from "./lib/referenceCatalog";

const provider = v.union(
  v.literal("generic"),
  v.literal("chatgpt"),
  v.literal("claude"),
  v.literal("gemini"),
);
const format = v.union(
  v.literal("json"),
  v.literal("markdown"),
  v.literal("provider"),
);

export const createImportUpload = mutation({
  args: { accessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const commitImport = mutation({
  args: {
    accessKey: v.string(),
    storageId: v.id("_storage"),
    provider,
    providerConversationId: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    title: v.string(),
    format,
    adapter: v.string(),
    messageCount: v.number(),
    messageFingerprints: v.array(v.string()),
    capturedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("Uploaded conversation file was not found.");
    if (!metadata.contentType?.toLowerCase().startsWith("application/json")) {
      throw new Error("Conversation imports must be normalized JSON.");
    }
    if (metadata.size < 20 || metadata.size > 5_000_000) {
      throw new Error("Conversation import size is invalid.");
    }

    const title = cleanConversationTitle(args.title);
    const providerConversationId = cleanConversationIdentity(
      args.providerConversationId,
    );
    const canonicalUrl = cleanConversationUrl(args.sourceUrl);
    const fingerprints = validateMessageFingerprints(
      args.messageFingerprints,
      args.messageCount,
    );
    const adapter = cleanAdapter(args.adapter);
    const now = Date.now();
    const capturedAt = validCapturedAt(args.capturedAt, now);
    const fallbackUrl = importedConversationUrl(metadata.sha256);
    const sourceUrl = canonicalUrl ?? fallbackUrl;
    const existing = await findExistingConversation(ctx, {
      provider: args.provider,
      providerConversationId,
      canonicalUrl,
      fallbackUrl,
    });

    if (existing) {
      const previousSnapshot = existing.latestSnapshotId
        ? await ctx.db.get(existing.latestSnapshotId)
        : null;
      if (previousSnapshot?.contentHash === metadata.sha256) {
        await ctx.storage.delete(args.storageId);
        await ctx.db.patch(existing._id, {
          title,
          lastCapturedAt: capturedAt,
          updatedAt: now,
        });
        const reference = await ctx.db.get(existing.referenceId);
        if (reference && reference.title !== title) {
          await ctx.db.patch(reference._id, { title });
        }
        return {
          conversationId: existing._id,
          referenceId: existing.referenceId,
          snapshotId: previousSnapshot._id,
          duplicate: true,
          addedCount: 0,
          changedCount: 0,
          removedCount: 0,
        };
      }

      const counts = conversationRevisionCounts(
        previousSnapshot?.messageFingerprints ?? [],
        fingerprints,
      );
      const snapshotId = await ctx.db.insert("conversationSnapshots", {
        conversationId: existing._id,
        storageId: args.storageId,
        contentHash: metadata.sha256,
        messageCount: args.messageCount,
        messageFingerprints: fingerprints,
        captureMethod: "import",
        format: args.format,
        adapter,
        ...(previousSnapshot ? { previousSnapshotId: previousSnapshot._id } : {}),
        ...counts,
        capturedAt,
        createdAt: now,
      });
      await ctx.db.patch(existing._id, {
        title,
        ...(providerConversationId ? { providerConversationId } : {}),
        ...(canonicalUrl ? { canonicalUrl } : {}),
        latestSnapshotId: snapshotId,
        snapshotCount: existing.snapshotCount + 1,
        lastCapturedAt: capturedAt,
        updatedAt: now,
      });
      const reference = await ctx.db.get(existing.referenceId);
      if (reference) {
        await ctx.db.patch(reference._id, {
          title,
          ...(canonicalUrl
            ? { sourceUrl: canonicalUrl, canonicalUrl }
            : {}),
        });
      }
      return {
        conversationId: existing._id,
        referenceId: existing.referenceId,
        snapshotId,
        duplicate: false,
        ...counts,
      };
    }

    const referenceId = await ctx.db.insert("references", {
      kind: "page",
      title,
      sourceUrl,
      ...(canonicalUrl ? { canonicalUrl } : {}),
      platform: "manual",
      capturedAt,
      triageState: "inbox",
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });
    const insertedReference = await ctx.db.get(referenceId);
    await applyReferenceStatsDelta(ctx, null, insertedReference);
    await ctx.db.insert("sourceSnapshots", {
      referenceId,
      pageTitle: title,
      description: `Imported ${args.provider} conversation with ${args.messageCount} messages.`,
      siteName: providerLabel(args.provider),
      ...(canonicalUrl ? { canonicalUrl } : {}),
      contentType: "application/json",
      metadataStatus: "ready",
      metadataFetchedAt: capturedAt,
      jsonMetadata: JSON.stringify({
        conversationProvider: args.provider,
        providerConversationId,
        adapter,
        importFormat: args.format,
      }),
      createdAt: now,
    });

    const conversationId = await ctx.db.insert("conversations", {
      referenceId,
      provider: args.provider,
      ...(providerConversationId ? { providerConversationId } : {}),
      ...(canonicalUrl ? { canonicalUrl } : {}),
      title,
      snapshotCount: 0,
      firstCapturedAt: capturedAt,
      lastCapturedAt: capturedAt,
      createdAt: now,
      updatedAt: now,
    });
    const snapshotId = await ctx.db.insert("conversationSnapshots", {
      conversationId,
      storageId: args.storageId,
      contentHash: metadata.sha256,
      messageCount: args.messageCount,
      messageFingerprints: fingerprints,
      captureMethod: "import",
      format: args.format,
      adapter,
      addedCount: args.messageCount,
      changedCount: 0,
      removedCount: 0,
      capturedAt,
      createdAt: now,
    });
    await ctx.db.patch(conversationId, {
      latestSnapshotId: snapshotId,
      snapshotCount: 1,
      updatedAt: now,
    });
    return {
      conversationId,
      referenceId,
      snapshotId,
      duplicate: false,
      addedCount: args.messageCount,
      changedCount: 0,
      removedCount: 0,
    };
  },
});

export const listRecent = query({
  args: {
    accessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 30)));
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_updated_at")
      .order("desc")
      .take(limit);
    const rows = await Promise.all(
      conversations.map(async (conversation) => {
        const [reference, snapshot] = await Promise.all([
          ctx.db.get(conversation.referenceId),
          conversation.latestSnapshotId
            ? ctx.db.get(conversation.latestSnapshotId)
            : null,
        ]);
        if (!reference || reference.deleted || !snapshot) return null;
        return {
          ...conversation,
          reference: {
            _id: reference._id,
            title: reference.title,
            sourceUrl: reference.sourceUrl,
            triageState: reference.triageState,
            favorite: reference.favorite,
            archived: reference.archived,
          },
          latestSnapshot: {
            _id: snapshot._id,
            messageCount: snapshot.messageCount,
            addedCount: snapshot.addedCount,
            changedCount: snapshot.changedCount,
            removedCount: snapshot.removedCount,
            capturedAt: snapshot.capturedAt,
          },
        };
      }),
    );
    return rows.filter(Boolean);
  },
});

export const getOne = query({
  args: {
    accessKey: v.string(),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return null;
    const reference = await ctx.db.get(conversation.referenceId);
    const snapshot = conversation.latestSnapshotId
      ? await ctx.db.get(conversation.latestSnapshotId)
      : null;
    if (!reference || reference.deleted || !snapshot) return null;
    const storageUrl = await ctx.storage.getUrl(snapshot.storageId);
    return {
      ...conversation,
      reference: {
        _id: reference._id,
        title: reference.title,
        sourceUrl: reference.sourceUrl,
        notes: reference.notes,
        triageState: reference.triageState,
        favorite: reference.favorite,
        archived: reference.archived,
      },
      latestSnapshot: {
        ...snapshot,
        storageUrl,
      },
    };
  },
});

async function findExistingConversation(
  ctx: any,
  identity: {
    provider: "generic" | "chatgpt" | "claude" | "gemini";
    providerConversationId?: string;
    canonicalUrl?: string;
    fallbackUrl: string;
  },
) {
  if (identity.providerConversationId) {
    const match = await ctx.db
      .query("conversations")
      .withIndex("by_provider_external", (q: any) =>
        q
          .eq("provider", identity.provider)
          .eq("providerConversationId", identity.providerConversationId),
      )
      .first();
    if (match) return match;
  }
  if (identity.canonicalUrl) {
    const match = await ctx.db
      .query("conversations")
      .withIndex("by_canonical_url", (q: any) =>
        q.eq("canonicalUrl", identity.canonicalUrl),
      )
      .first();
    if (match) return match;
  }
  const reference = await ctx.db
    .query("references")
    .withIndex("by_source_url", (q: any) => q.eq("sourceUrl", identity.fallbackUrl))
    .first();
  if (!reference) return null;
  return await ctx.db
    .query("conversations")
    .withIndex("by_reference", (q: any) => q.eq("referenceId", reference._id))
    .first();
}

function cleanAdapter(value: string) {
  const adapter = value.trim();
  if (!adapter || adapter.length > 120) {
    throw new Error("Conversation adapter is invalid.");
  }
  return adapter;
}

function providerLabel(value: "generic" | "chatgpt" | "claude" | "gemini") {
  if (value === "chatgpt") return "ChatGPT";
  if (value === "claude") return "Claude";
  if (value === "gemini") return "Gemini";
  return "Imported conversation";
}
