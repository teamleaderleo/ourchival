import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { hashSecret } from "./lib/privateAccess";

export const createBrowserScreenshotUpload = mutation({
  args: {
    deviceToken: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireScreenshotDevice(ctx, args.deviceToken);
    const reference = await requirePageReference(ctx, args.referenceId);
    return {
      referenceId: reference._id,
      uploadUrl: await ctx.storage.generateUploadUrl(),
    };
  },
});

export const commitBrowserScreenshot = mutation({
  args: {
    deviceToken: v.string(),
    referenceId: v.id("references"),
    storageId: v.id("_storage"),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const device = await requireScreenshotDevice(ctx, args.deviceToken);
    const reference = await requirePageReference(ctx, args.referenceId);
    const uploadedMetadata = await ctx.db.system.get("_storage", args.storageId);
    if (!uploadedMetadata) throw new Error("Uploaded screenshot file was not found.");
    const mimeType = cleanMimeType(uploadedMetadata.contentType);
    const byteSize = boundedByteSize(uploadedMetadata.size);
    const contentHash = uploadedMetadata.sha256;
    const width = positiveInteger(args.width);
    const height = positiveInteger(args.height);
    const now = Date.now();
    const capturedAt = validTimestamp(args.capturedAt) ?? now;

    const existingArtifact = await ctx.db
      .query("referenceArtifacts")
      .withIndex("by_reference_kind", (q) =>
        q.eq("referenceId", reference._id).eq("kind", "page_screenshot"),
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
        provider: "chrome.tabs.captureVisibleTab",
        version: "1",
        storageId: args.storageId,
        mimeType,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        byteSize,
        contentHash,
        status: "ready",
        retention: existingArtifact.retention,
        capturedAt,
        updatedAt: now,
      });
    } else {
      artifactId = await ctx.db.insert("referenceArtifacts", {
        referenceId: reference._id,
        kind: "page_screenshot",
        captureMethod: "browser",
        provider: "chrome.tabs.captureVisibleTab",
        version: "1",
        storageId: args.storageId,
        mimeType,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        byteSize,
        contentHash,
        status: "ready",
        retention: "review",
        capturedAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    const asset = await ctx.db
      .query("assets")
      .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
      .first();
    if (asset) {
      await ctx.db.patch(asset._id, {
        previewStorageId: args.storageId,
        thumbStorageId: args.storageId,
        derivativeStatus: "ready",
      });
    } else {
      await ctx.db.insert("assets", {
        referenceId: reference._id,
        storageProvider: "convex",
        previewStorageId: args.storageId,
        thumbStorageId: args.storageId,
        mimeType,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        fileSize: byteSize,
        contentHash,
        dominantColors: [],
        derivativeStatus: "ready",
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

async function requireScreenshotDevice(ctx: any, rawToken: string) {
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
    throw new Error("Screenshots can only be attached to page-like references.");
  }
  return reference;
}

function cleanMimeType(value: string | undefined) {
  const mimeType = value?.trim().toLowerCase();
  if (
    mimeType !== "image/jpeg" &&
    mimeType !== "image/png" &&
    mimeType !== "image/webp"
  ) {
    throw new Error("Screenshot must be a JPEG, PNG, or WebP image.");
  }
  return mimeType;
}

function boundedByteSize(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 12_000_000) {
    throw new Error("Screenshot file size is invalid.");
  }
  return Math.floor(value);
}

function positiveInteger(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function validTimestamp(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function isPageLike(kind: string) {
  return kind === "page" || kind === "link" || kind === "article";
}
