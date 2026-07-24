import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { hashSecret } from "./lib/privateAccess";

const readableSource = v.union(
  v.literal("article"),
  v.literal("main"),
  v.literal("body"),
);

export const createBrowserReadableTextUpload = mutation({
  args: {
    deviceToken: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireClipperDevice(ctx, args.deviceToken);
    const reference = await requirePageReference(ctx, args.referenceId);
    return {
      referenceId: reference._id,
      uploadUrl: await ctx.storage.generateUploadUrl(),
    };
  },
});

export const commitBrowserReadableText = mutation({
  args: {
    deviceToken: v.string(),
    referenceId: v.id("references"),
    storageId: v.id("_storage"),
    source: readableSource,
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const device = await requireClipperDevice(ctx, args.deviceToken);
    const reference = await requirePageReference(ctx, args.referenceId);
    const uploadedMetadata = await ctx.db.system.get("_storage", args.storageId);
    if (!uploadedMetadata) throw new Error("Uploaded readable text file was not found.");
    const mimeType = cleanTextMimeType(uploadedMetadata.contentType);
    const byteSize = boundedTextSize(uploadedMetadata.size);
    const contentHash = uploadedMetadata.sha256;
    const now = Date.now();
    const capturedAt = validTimestamp(args.capturedAt) ?? now;
    const provider = `browser.${args.source}`;

    const existingArtifact = await ctx.db
      .query("referenceArtifacts")
      .withIndex("by_reference_kind", (q) =>
        q.eq("referenceId", reference._id).eq("kind", "readable_text"),
      )
      .order("desc")
      .first();

    if (
      existingArtifact?.status === "ready" &&
      existingArtifact.contentHash === contentHash &&
      existingArtifact.storageId
    ) {
      await ctx.storage.delete(args.storageId);
      await ctx.db.patch(existingArtifact._id, {
        provider,
        capturedAt,
        updatedAt: now,
      });
      await ctx.db.patch(device._id, { lastUsedAt: now });
      return {
        artifactId: existingArtifact._id,
        storageId: existingArtifact.storageId,
        duplicate: true,
      };
    }

    let artifactId = existingArtifact?._id;
    if (existingArtifact) {
      await ctx.db.patch(existingArtifact._id, {
        captureMethod: "browser",
        provider,
        version: "1",
        storageId: args.storageId,
        mimeType,
        width: undefined,
        height: undefined,
        byteSize,
        contentHash,
        status: "ready",
        error: undefined,
        retention: "archival",
        capturedAt,
        updatedAt: now,
      });
    } else {
      artifactId = await ctx.db.insert("referenceArtifacts", {
        referenceId: reference._id,
        kind: "readable_text",
        captureMethod: "browser",
        provider,
        version: "1",
        storageId: args.storageId,
        mimeType,
        byteSize,
        contentHash,
        status: "ready",
        retention: "archival",
        capturedAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (
      existingArtifact?.storageId &&
      existingArtifact.storageId !== args.storageId
    ) {
      await ctx.storage.delete(existingArtifact.storageId);
    }
    await ctx.db.patch(device._id, { lastUsedAt: now });

    return {
      artifactId: artifactId!,
      storageId: args.storageId,
      duplicate: false,
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

async function requirePageReference(ctx: any, referenceId: any) {
  const reference = await ctx.db.get(referenceId);
  if (!reference) throw new Error("Reference not found.");
  if (!isPageLike(reference.kind)) {
    throw new Error("Readable text can only be attached to page-like references.");
  }
  return reference;
}

function cleanTextMimeType(value: string | undefined) {
  const mimeType = value?.trim().toLowerCase();
  if (!mimeType?.startsWith("text/plain")) {
    throw new Error("Readable page content must be plain text.");
  }
  return mimeType;
}

function boundedTextSize(value: number) {
  if (!Number.isFinite(value) || value < 80 || value > 500_000) {
    throw new Error("Readable page content size is invalid.");
  }
  return Math.floor(value);
}

function validTimestamp(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function isPageLike(kind: string) {
  return kind === "page" || kind === "link" || kind === "article";
}
