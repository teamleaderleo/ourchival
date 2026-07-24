import { mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  decodeScreenshotDataUrl,
  isPageLike,
  positiveInteger,
  sha256Hex,
  validTimestamp,
} from "./lib/pageScreenshotData";
import { hashSecret } from "./lib/privateAccess";

export const saveBrowserScreenshot = mutation({
  args: {
    deviceToken: v.string(),
    referenceId: v.id("references"),
    dataUrl: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const deviceToken = args.deviceToken.trim();
    if (!deviceToken) throw new Error("Clipper device token is required.");
    const tokenHash = await hashSecret(deviceToken);
    const device = await ctx.db
      .query("clipperDevices")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!device) throw new Error("This Clipper credential is invalid.");
    if (device.revokedAt) throw new Error("This Clipper was revoked.");

    const reference = await ctx.db.get(args.referenceId);
    if (!reference) throw new Error("Reference not found.");
    if (!isPageLike(reference.kind)) {
      throw new Error("Screenshots can only be attached to page-like references.");
    }

    const decoded = decodeScreenshotDataUrl(args.dataUrl);
    const contentHash = await sha256Hex(decoded.bytes);
    const existingArtifact = await ctx.db
      .query("referenceArtifacts")
      .withIndex("by_reference_kind", (q) =>
        q.eq("referenceId", reference._id).eq("kind", "page_screenshot"),
      )
      .order("desc")
      .first();
    const now = Date.now();
    const capturedAt = validTimestamp(args.capturedAt) ?? now;
    const width = positiveInteger(args.width);
    const height = positiveInteger(args.height);

    if (
      existingArtifact?.status === "ready" &&
      existingArtifact.contentHash === contentHash &&
      existingArtifact.storageId
    ) {
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

    const blob = new Blob([decoded.bytes], { type: decoded.mimeType });
    const storageId = await ctx.storage.store(blob);
    let artifactId = existingArtifact?._id;
    if (existingArtifact) {
      await ctx.db.patch(existingArtifact._id, {
        captureMethod: "browser",
        provider: "chrome.tabs.captureVisibleTab",
        version: "1",
        storageId,
        mimeType: decoded.mimeType,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        byteSize: decoded.bytes.byteLength,
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
        storageId,
        mimeType: decoded.mimeType,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        byteSize: decoded.bytes.byteLength,
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
        storageProvider: "convex",
        previewStorageId: storageId,
        thumbStorageId: storageId,
        mimeType: decoded.mimeType,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        fileSize: decoded.bytes.byteLength,
        contentHash,
        derivativeStatus: "ready",
      });
    } else {
      await ctx.db.insert("assets", {
        referenceId: reference._id,
        storageProvider: "convex",
        previewStorageId: storageId,
        thumbStorageId: storageId,
        mimeType: decoded.mimeType,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        fileSize: decoded.bytes.byteLength,
        contentHash,
        dominantColors: [],
        derivativeStatus: "ready",
      });
    }

    if (existingArtifact?.storageId && existingArtifact.storageId !== storageId) {
      await ctx.storage.delete(existingArtifact.storageId);
    }
    await ctx.db.patch(device._id, { lastUsedAt: now });

    return {
      artifactId: artifactId!,
      storageId,
      duplicate: false,
    };
  },
});
