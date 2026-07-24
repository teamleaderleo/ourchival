import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { hashSecret } from "./lib/privateAccess";

const provider = v.literal("reddit.dom");

export const createBrowserSnapshotUpload = mutation({
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

export const commitBrowserSnapshot = mutation({
  args: {
    deviceToken: v.string(),
    referenceId: v.id("references"),
    storageId: v.id("_storage"),
    provider,
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const device = await requireClipperDevice(ctx, args.deviceToken);
    const reference = await requirePageReference(ctx, args.referenceId);
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("Uploaded page snapshot was not found.");
    const mimeType = cleanJsonMimeType(metadata.contentType);
    const byteSize = boundedSnapshotSize(metadata.size);
    const contentHash = metadata.sha256;
    const now = Date.now();
    const capturedAt = validTimestamp(args.capturedAt) ?? now;

    const existing = await ctx.db
      .query("referenceArtifacts")
      .withIndex("by_reference_kind", (q) =>
        q.eq("referenceId", reference._id).eq("kind", "page_snapshot"),
      )
      .order("desc")
      .first();

    if (
      existing?.status === "ready" &&
      existing.contentHash === contentHash &&
      existing.storageId
    ) {
      if (existing.storageId !== args.storageId) {
        await ctx.storage.delete(args.storageId);
      }
      await ctx.db.patch(existing._id, {
        provider: args.provider,
        capturedAt,
        updatedAt: now,
      });
      await ctx.db.patch(device._id, { lastUsedAt: now });
      return {
        artifactId: existing._id,
        storageId: existing.storageId,
        duplicate: true,
      };
    }

    let artifactId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, {
        captureMethod: "browser",
        provider: args.provider,
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
        kind: "page_snapshot",
        captureMethod: "browser",
        provider: args.provider,
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

    if (existing?.storageId && existing.storageId !== args.storageId) {
      await ctx.storage.delete(existing.storageId);
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
    throw new Error("Page snapshots can only be attached to page-like references.");
  }
  return reference;
}

function cleanJsonMimeType(value: string | undefined) {
  const mimeType = value?.trim().toLowerCase();
  if (!mimeType?.startsWith("application/json")) {
    throw new Error("Structured page snapshots must be JSON.");
  }
  return mimeType;
}

function boundedSnapshotSize(value: number) {
  if (!Number.isFinite(value) || value < 40 || value > 1_500_000) {
    throw new Error("Structured page snapshot size is invalid.");
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
