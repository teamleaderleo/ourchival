import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwnerAccess } from "./lib/privateAccess";

const maxObservations = 100;
const maxCandidates = 10;
const maxKeyLength = 120;
const maxIdentityLength = 512;
const maxHashLength = 160;

const driveFileObservation = v.object({
  key: v.string(),
  kind: v.literal("drive_file"),
  driveFileId: v.string(),
  contentHash: v.optional(v.string()),
});

const linkedFileObservation = v.object({
  key: v.string(),
  kind: v.literal("linked_file"),
  linkedUrl: v.string(),
  contentHash: v.optional(v.string()),
});

const publicationObservation = v.object({
  key: v.string(),
  kind: v.literal("publication"),
  referenceId: v.id("references"),
});

export const resolve = query({
  args: {
    accessKey: v.string(),
    observations: v.array(
      v.union(driveFileObservation, linkedFileObservation, publicationObservation),
    ),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (args.observations.length > maxObservations) {
      throw new Error(`Resolve at most ${maxObservations} observations per request.`);
    }

    const keys = new Set<string>();
    const normalized = args.observations.map((observation) => {
      const key = cleanRequired(observation.key, maxKeyLength, "Observation key is required.");
      if (keys.has(key)) throw new Error(`Duplicate observation key: ${key}`);
      keys.add(key);

      if (observation.kind === "drive_file") {
        return {
          ...observation,
          key,
          driveFileId: cleanRequired(
            observation.driveFileId,
            maxIdentityLength,
            "Drive file ID is required.",
          ),
          contentHash: cleanOptional(observation.contentHash, maxHashLength),
        } as const;
      }
      if (observation.kind === "linked_file") {
        return {
          ...observation,
          key,
          linkedUrl: cleanAbsoluteUrl(observation.linkedUrl),
          contentHash: cleanOptional(observation.contentHash, maxHashLength),
        } as const;
      }
      return { ...observation, key } as const;
    });

    return await Promise.all(
      normalized.map(async (observation) => {
        if (observation.kind === "drive_file") {
          return await resolveFileObservation(ctx, observation, "drive_file_id");
        }
        if (observation.kind === "linked_file") {
          return await resolveFileObservation(ctx, observation, "linked_url");
        }
        return await resolvePublicationObservation(ctx, observation);
      }),
    );
  },
});

type FileObservation =
  | {
      key: string;
      kind: "drive_file";
      driveFileId: string;
      contentHash?: string;
    }
  | {
      key: string;
      kind: "linked_file";
      linkedUrl: string;
      contentHash?: string;
    };

type FileEvidence = "drive_file_id" | "linked_url";

async function resolveFileObservation(
  ctx: QueryCtx,
  observation: FileObservation,
  evidence: FileEvidence,
) {
  const exact =
    observation.kind === "drive_file"
      ? await ctx.db
          .query("artworkRepresentations")
          .withIndex("by_drive_file_id", (q) =>
            q.eq("driveFileId", observation.driveFileId),
          )
          .unique()
      : await ctx.db
          .query("artworkRepresentations")
          .withIndex("by_linked_url", (q) => q.eq("linkedUrl", observation.linkedUrl))
          .unique();

  if (exact) {
    const candidate = await hydrateRepresentationCandidate(ctx, exact);
    return {
      key: observation.key,
      kind: observation.kind,
      resolution: "exact" as const,
      evidence,
      candidates: candidate ? [candidate] : [],
      truncated: false,
    };
  }

  if (!observation.contentHash) {
    return {
      key: observation.key,
      kind: observation.kind,
      resolution: "unresolved" as const,
      evidence: null,
      candidates: [],
      truncated: false,
    };
  }

  const rows = await ctx.db
    .query("artworkRepresentations")
    .withIndex("by_content_hash", (q) => q.eq("contentHash", observation.contentHash))
    .take(maxCandidates + 1);
  const hydrated = await Promise.all(
    rows.slice(0, maxCandidates).map((row) => hydrateRepresentationCandidate(ctx, row)),
  );
  const candidates = uniqueArtworkCandidates(hydrated.filter(isDefined));

  return {
    key: observation.key,
    kind: observation.kind,
    resolution:
      candidates.length === 0
        ? ("unresolved" as const)
        : candidates.length === 1
          ? ("review" as const)
          : ("ambiguous" as const),
    evidence: candidates.length > 0 ? ("content_hash" as const) : null,
    candidates,
    truncated: rows.length > maxCandidates,
  };
}

async function resolvePublicationObservation(
  ctx: QueryCtx,
  observation: { key: string; kind: "publication"; referenceId: Id<"references"> },
) {
  const reference = await ctx.db.get(observation.referenceId);
  if (!reference) {
    return {
      key: observation.key,
      kind: observation.kind,
      resolution: "missing_reference" as const,
      evidence: null,
      reference: null,
      candidates: [],
      truncated: false,
    };
  }

  const links = await ctx.db
    .query("artworkPublications")
    .withIndex("by_reference_id", (q) => q.eq("referenceId", observation.referenceId))
    .take(maxObservations + 1);
  const hydrated = await Promise.all(
    links.slice(0, maxObservations).map(async (link) => {
      const artwork = await ctx.db.get(link.artworkId);
      return artwork ? artworkProjection(artwork) : null;
    }),
  );
  const candidates = uniqueArtworkProjections(hydrated.filter(isDefined));

  return {
    key: observation.key,
    kind: observation.kind,
    resolution: candidates.length > 0 ? ("exact" as const) : ("unresolved" as const),
    evidence: candidates.length > 0 ? ("publication_link" as const) : null,
    reference: {
      id: reference._id,
      title: reference.title ?? null,
      platform: reference.platform,
      sourceUrl: reference.sourceUrl,
      canonicalUrl: reference.canonicalUrl ?? null,
      postId: reference.postId ?? null,
      publishedAt: reference.publishedAt ?? null,
      deleted: reference.deleted,
    },
    candidates,
    truncated: links.length > maxObservations,
  };
}

async function hydrateRepresentationCandidate(
  ctx: QueryCtx,
  representation: Doc<"artworkRepresentations">,
) {
  const artwork = await ctx.db.get(representation.artworkId);
  if (!artwork) return null;
  return {
    artwork: artworkProjection(artwork),
    representation: {
      id: representation._id,
      kind: representation.kind,
      storageProvider: representation.storageProvider,
      fileName: representation.fileName ?? null,
      mimeType: representation.mimeType ?? null,
      sourceApplication: representation.sourceApplication ?? null,
    },
  };
}

function artworkProjection(artwork: Doc<"artworks">) {
  return {
    id: artwork._id,
    title: artwork.title,
    status: artwork.status,
    startedAt: artwork.startedAt ?? null,
    completedAt: artwork.completedAt ?? null,
    updatedAt: artwork.updatedAt,
  };
}

function uniqueArtworkCandidates(
  candidates: Array<{
    artwork: ReturnType<typeof artworkProjection>;
    representation: {
      id: Id<"artworkRepresentations">;
      kind: Doc<"artworkRepresentations">["kind"];
      storageProvider: Doc<"artworkRepresentations">["storageProvider"];
      fileName: string | null;
      mimeType: string | null;
      sourceApplication: Doc<"artworkRepresentations">["sourceApplication"] | null;
    };
  }>,
) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const id = String(candidate.artwork.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function uniqueArtworkProjections(candidates: Array<ReturnType<typeof artworkProjection>>) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const id = String(candidate.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function cleanRequired(value: string, maxLength: number, error: string) {
  const cleaned = cleanOptional(value, maxLength);
  if (!cleaned) throw new Error(error);
  return cleaned;
}

function cleanOptional(value: string | undefined, maxLength: number) {
  const cleaned = value?.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return cleaned || undefined;
}

function cleanAbsoluteUrl(value: string) {
  const cleaned = cleanRequired(value, maxIdentityLength, "Linked URL is required.");
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new Error("Linked URL must be an absolute http(s) URL.");
  }
}
