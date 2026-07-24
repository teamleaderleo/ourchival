import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { hashSecret } from "./lib/privateAccess";

export const discardUnclaimed = mutation({
  args: {
    deviceToken: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const device = await requireClipperDevice(ctx, args.deviceToken);
    const adoptedArtifact = await ctx.db
      .query("referenceArtifacts")
      .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId))
      .first();
    if (adoptedArtifact) {
      await ctx.db.patch(device._id, { lastUsedAt: Date.now() });
      return {
        discarded: false,
        retained: true,
        artifactId: adoptedArtifact._id,
      };
    }

    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (metadata) await ctx.storage.delete(args.storageId);
    await ctx.db.patch(device._id, { lastUsedAt: Date.now() });
    return {
      discarded: Boolean(metadata),
      retained: false,
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
