import type { LinkMetadata } from "./linkMetadata";
import { normalizeSourceUrl } from "./urls";

export async function applySourceMetadata(
  ctx: any,
  args: {
    reference: any;
    metadata: LinkMetadata;
    reason: "manual_refresh" | "enrichment_job";
    jobId?: any;
  },
) {
  const snapshotId = await ctx.db.insert("sourceSnapshots", {
    referenceId: args.reference._id,
    ...(args.metadata.title ? { pageTitle: args.metadata.title } : {}),
    ...(args.metadata.description ? { description: args.metadata.description } : {}),
    ...(args.metadata.siteName ? { siteName: args.metadata.siteName } : {}),
    ...(args.metadata.faviconUrl ? { faviconUrl: args.metadata.faviconUrl } : {}),
    ...(args.metadata.previewImageUrl
      ? { previewImageUrl: args.metadata.previewImageUrl }
      : {}),
    ...(args.metadata.author ? { pageAuthor: args.metadata.author } : {}),
    ...(args.metadata.canonicalUrl
      ? { canonicalUrl: args.metadata.canonicalUrl }
      : {}),
    ...(args.metadata.contentType ? { contentType: args.metadata.contentType } : {}),
    metadataStatus: args.metadata.metadataStatus,
    ...(typeof args.metadata.httpStatus === "number"
      ? { httpStatus: args.metadata.httpStatus }
      : {}),
    metadataFetchedAt: args.metadata.metadataFetchedAt,
    jsonMetadata: JSON.stringify({
      reason: args.reason,
      ...(args.jobId ? { jobId: String(args.jobId) } : {}),
      ...(args.metadata.error ? { error: args.metadata.error } : {}),
    }),
    createdAt: Date.now(),
  });

  const patch: Record<string, unknown> = {};
  if (!args.reference.title && args.metadata.title) patch.title = args.metadata.title;
  if (!args.reference.authorName && args.metadata.author) {
    patch.authorName = args.metadata.author;
  }

  const refreshedCanonical = cleanPublicUrl(args.metadata.canonicalUrl);
  if (refreshedCanonical) {
    const normalizedCanonical = normalizeSourceUrl(refreshedCanonical);
    if (normalizedCanonical !== args.reference.canonicalUrl) {
      const matches = await ctx.db
        .query("references")
        .withIndex("by_canonical_url", (q: any) =>
          q.eq("canonicalUrl", normalizedCanonical),
        )
        .collect();
      if (
        !matches.some(
          (item: any) => item._id !== args.reference._id && !item.deleted,
        )
      ) {
        patch.canonicalUrl = normalizedCanonical;
      }
    }
  }

  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(args.reference._id, patch);
  }

  return {
    patch,
    snapshotId,
    status: args.metadata.metadataStatus,
    summary: metadataSummary(args.metadata),
  };
}

export function metadataSummary(metadata: LinkMetadata) {
  const fields = [
    metadata.title ? "title" : "",
    metadata.description ? "description" : "",
    metadata.siteName ? "site" : "",
    metadata.author ? "author" : "",
    metadata.previewImageUrl ? "preview" : "",
    metadata.faviconUrl ? "favicon" : "",
    metadata.canonicalUrl ? "canonical URL" : "",
  ].filter(Boolean);

  if (metadata.metadataStatus === "failed") {
    return metadata.error ?? "Metadata refresh failed.";
  }
  if (fields.length === 0) return "Source returned sparse metadata.";
  return `Updated ${fields.join(", ")}.`;
}

function cleanPublicUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
