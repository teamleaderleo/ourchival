import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { timestampBumpDue } from "./timestampOnlyWrites";

/**
 * Adding or removing a representation or publication bumps the parent
 * artwork's updatedAt so artworks.list (ordered by updatedAt) surfaces it.
 * Auto-link bursts did this once per linked publication, leaving most artwork
 * revisions timestamp-only. Ten-minute resolution keeps the recency ordering
 * while collapsing a burst into a single revision.
 */
export const ARTWORK_TOUCH_RESOLUTION_MS = 10 * 60 * 1000;

export async function touchArtwork(
  ctx: MutationCtx,
  artworkId: Id<"artworks">,
  now: number,
): Promise<void> {
  const artwork = await ctx.db.get(artworkId);
  if (!artwork) return;
  if (!timestampBumpDue(artwork.updatedAt, now, ARTWORK_TOUCH_RESOLUTION_MS))
    return;
  await ctx.db.patch(artworkId, { updatedAt: now });
}
