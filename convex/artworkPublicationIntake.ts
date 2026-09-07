import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwnerAccess } from "./lib/privateAccess";

const maxUrlLength = 2048;

export const linkByUrl = mutation({
  args: {
    accessKey: v.string(),
    artworkId: v.id("artworks"),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (!(await ctx.db.get(args.artworkId))) throw new Error("Artwork not found.");

    const reference = await resolveReferenceByUrl(ctx, args.url);
    if (!reference) {
      throw new Error("Capture this publication in Ourchival before linking it to an artwork.");
    }
    if (reference.deleted) {
      throw new Error("Restore this publication from Trash before linking it to an artwork.");
    }

    const existing = await ctx.db
      .query("artworkPublications")
      .withIndex("by_artwork_id_and_reference_id", (q) =>
        q.eq("artworkId", args.artworkId).eq("referenceId", reference._id),
      )
      .unique();
    if (existing) {
      return { publication: existing, reference: referenceProjection(reference) };
    }

    const now = Date.now();
    const publicationId = await ctx.db.insert("artworkPublications", {
      artworkId: args.artworkId,
      referenceId: reference._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.artworkId, { updatedAt: now });
    return {
      publication: await ctx.db.get(publicationId),
      reference: referenceProjection(reference),
    };
  },
});

async function resolveReferenceByUrl(ctx: MutationCtx, value: string) {
  const raw = value.trim().slice(0, maxUrlLength);
  if (!raw) throw new Error("Publication URL is required.");
  const normalized = normalizeHttpUrl(raw);
  const urls = normalized === raw ? [raw] : [raw, normalized];

  const matches = new Map<string, Doc<"references">>();
  for (const url of urls) {
    const [canonical, source] = await Promise.all([
      ctx.db
        .query("references")
        .withIndex("by_canonical_url", (q) => q.eq("canonicalUrl", url))
        .take(3),
      ctx.db
        .query("references")
        .withIndex("by_source_url", (q) => q.eq("sourceUrl", url))
        .take(3),
    ]);
    for (const reference of [...canonical, ...source]) {
      matches.set(String(reference._id), reference);
    }
    if (matches.size > 1) break;
  }

  if (matches.size > 1) {
    throw new Error(
      "More than one captured reference matches this URL. Review the archive before linking it.",
    );
  }
  return matches.values().next().value as Doc<"references"> | undefined;
}

function normalizeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    url.hash = "";
    return url.toString();
  } catch {
    throw new Error("Publication URL must be an absolute http(s) URL.");
  }
}

function referenceProjection(reference: Doc<"references">) {
  return {
    id: reference._id as Id<"references">,
    title: reference.title ?? null,
    platform: reference.platform,
    sourceUrl: reference.sourceUrl,
    canonicalUrl: reference.canonicalUrl ?? null,
    postId: reference.postId ?? null,
    publishedAt: reference.publishedAt ?? null,
  };
}
