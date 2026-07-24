import { mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  cleanConversationIdentity,
  cleanConversationTitle,
  cleanConversationUrl,
  conversationRevisionCounts,
  validCapturedAt,
  validateMessageFingerprints,
} from "./lib/conversationImport";
import { hashSecret } from "./lib/privateAccess";
import { applyReferenceStatsDelta } from "./lib/referenceCatalog";

export const createChatGptUpload = mutation({
  args: { deviceToken: v.string() },
  handler: async (ctx, args) => {
    await requireClipperDevice(ctx, args.deviceToken);
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const commitChatGptCapture = mutation({
  args: {
    deviceToken: v.string(),
    storageId: v.id("_storage"),
    providerConversationId: v.string(),
    sourceUrl: v.string(),
    title: v.string(),
    adapter: v.string(),
    messageCount: v.number(),
    messageFingerprints: v.array(v.string()),
    capturedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const device = await requireClipperDevice(ctx, args.deviceToken);
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("Uploaded conversation file was not found.");
    if (!metadata.contentType?.toLowerCase().startsWith("application/json")) {
      throw new Error("Conversation captures must be normalized JSON.");
    }
    if (metadata.size < 20 || metadata.size > 5_000_000) {
      throw new Error("Conversation capture size is invalid.");
    }

    const title = cleanConversationTitle(args.title);
    const providerConversationId = cleanConversationIdentity(
      args.providerConversationId,
    );
    const canonicalUrl = cleanConversationUrl(args.sourceUrl);
    if (!providerConversationId || !canonicalUrl) {
      throw new Error("ChatGPT conversation identity is incomplete.");
    }
    const fingerprints = validateMessageFingerprints(
      args.messageFingerprints,
      args.messageCount,
    );
    const adapter = cleanAdapter(args.adapter);
    const now = Date.now();
    const capturedAt = validCapturedAt(args.capturedAt, now);
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_provider_external", (q) =>
        q
          .eq("provider", "chatgpt")
          .eq("providerConversationId", providerConversationId),
      )
      .first();

    if (existing) {
      const previousSnapshot = existing.latestSnapshotId
        ? await ctx.db.get(existing.latestSnapshotId)
        : null;
      if (previousSnapshot?.contentHash === metadata.sha256) {
        await ctx.storage.delete(args.storageId);
        await ctx.db.patch(existing._id, {
          title,
          canonicalUrl,
          lastCapturedAt: capturedAt,
          updatedAt: now,
        });
        const reference = await ctx.db.get(existing.referenceId);
        if (reference) {
          await ctx.db.patch(reference._id, {
            title,
            sourceUrl: canonicalUrl,
            canonicalUrl,
          });
        }
        await ctx.db.patch(device._id, { lastUsedAt: now });
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
        captureMethod: "browser",
        format: "provider",
        adapter,
        ...(previousSnapshot ? { previousSnapshotId: previousSnapshot._id } : {}),
        ...counts,
        capturedAt,
        createdAt: now,
      });
      await ctx.db.patch(existing._id, {
        title,
        canonicalUrl,
        latestSnapshotId: snapshotId,
        snapshotCount: existing.snapshotCount + 1,
        lastCapturedAt: capturedAt,
        updatedAt: now,
      });
      const reference = await ctx.db.get(existing.referenceId);
      if (reference) {
        await ctx.db.patch(reference._id, {
          title,
          sourceUrl: canonicalUrl,
          canonicalUrl,
        });
      }
      await ctx.db.patch(device._id, { lastUsedAt: now });
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
      sourceUrl: canonicalUrl,
      canonicalUrl,
      platform: "manual",
      capturedAt,
      triageState: "inbox",
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });
    const reference = await ctx.db.get(referenceId);
    await applyReferenceStatsDelta(ctx, null, reference);
    await ctx.db.insert("sourceSnapshots", {
      referenceId,
      pageTitle: title,
      description: `Captured ChatGPT conversation with ${args.messageCount} messages.`,
      siteName: "ChatGPT",
      canonicalUrl,
      contentType: "application/json",
      metadataStatus: "ready",
      metadataFetchedAt: capturedAt,
      jsonMetadata: JSON.stringify({
        conversationProvider: "chatgpt",
        providerConversationId,
        adapter,
        captureMethod: "browser",
      }),
      createdAt: now,
    });
    const conversationId = await ctx.db.insert("conversations", {
      referenceId,
      provider: "chatgpt",
      providerConversationId,
      canonicalUrl,
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
      captureMethod: "browser",
      format: "provider",
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
    await ctx.db.patch(device._id, { lastUsedAt: now });
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

async function requireClipperDevice(ctx: any, rawToken: string) {
  const deviceToken = rawToken.trim();
  if (!deviceToken) throw new Error("Clipper device token is required.");
  const tokenHash = await hashSecret(deviceToken);
  const device = await ctx.db
    .query("clipperDevices")
    .withIndex("by_token_hash", (q: any) => q.eq("tokenHash", tokenHash))
    .first();
  if (!device) throw new Error("This Clipper credential is invalid.");
  if (device.revokedAt) throw new Error("This Clipper was revoked.");
  return device;
}

function cleanAdapter(value: string) {
  const adapter = value.trim();
  if (!adapter || adapter.length > 120) {
    throw new Error("Conversation adapter is invalid.");
  }
  return adapter;
}
