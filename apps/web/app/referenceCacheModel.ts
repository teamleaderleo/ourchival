import type { SavedReference } from "./referenceVaultModel";
import type { VaultView } from "./VaultNavigation";

export const referenceCacheVersion = 1;
export const referenceCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000;

export type CachedVaultCounts = Record<VaultView, number>;

export type CachedReferencePage = {
  version: typeof referenceCacheVersion;
  key: string;
  view: VaultView;
  query: string;
  savedAt: number;
  references: SavedReference[];
  counts: CachedVaultCounts;
  continueCursor: string | null;
  hasMore: boolean;
};

export function referenceCacheKey(view: VaultView, query: string) {
  return `${view}:${normalizeCacheQuery(query)}`;
}

export function createCachedReferencePage(args: {
  view: VaultView;
  query: string;
  savedAt?: number;
  references: SavedReference[];
  counts: CachedVaultCounts;
  continueCursor?: string | null;
  hasMore?: boolean;
}): CachedReferencePage {
  const query = normalizeCacheQuery(args.query);
  return {
    version: referenceCacheVersion,
    key: referenceCacheKey(args.view, query),
    view: args.view,
    query,
    savedAt: args.savedAt ?? Date.now(),
    references: args.references,
    counts: args.counts,
    continueCursor: args.continueCursor ?? null,
    hasMore: Boolean(args.hasMore),
  };
}

export function isUsableCachedReferencePage(
  value: unknown,
  args: {
    view: VaultView;
    query: string;
    now?: number;
    maxAgeMs?: number;
  },
): value is CachedReferencePage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CachedReferencePage>;
  const now = args.now ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? referenceCacheMaxAgeMs;
  const query = normalizeCacheQuery(args.query);

  return (
    candidate.version === referenceCacheVersion &&
    candidate.key === referenceCacheKey(args.view, query) &&
    candidate.view === args.view &&
    candidate.query === query &&
    typeof candidate.savedAt === "number" &&
    Number.isFinite(candidate.savedAt) &&
    candidate.savedAt <= now &&
    now - candidate.savedAt <= maxAgeMs &&
    Array.isArray(candidate.references) &&
    Boolean(candidate.counts && typeof candidate.counts === "object") &&
    (candidate.continueCursor === null ||
      typeof candidate.continueCursor === "string" ||
      candidate.continueCursor === undefined) &&
    typeof candidate.hasMore === "boolean"
  );
}

export function normalizeCacheQuery(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
