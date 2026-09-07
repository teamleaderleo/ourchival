import {
  detectHoYoLabArticle,
  type HoYoLabArticleIdentity,
} from "./hoyolabOwnedPost";

const defaultMaximumArticles = 120;

export function discoverHoYoLabArticleIdentities(
  hrefs: Iterable<string>,
  maximum = defaultMaximumArticles,
) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 500) {
    throw new Error("HoYoLAB discovery limit must be between 1 and 500 articles.");
  }
  const discovered = new Map<string, HoYoLabArticleIdentity>();
  for (const href of hrefs) {
    const identity = detectHoYoLabArticle(href);
    if (!identity || discovered.has(identity.postId)) continue;
    discovered.set(identity.postId, identity);
    if (discovered.size >= maximum) break;
  }
  return Array.from(discovered.values());
}

export function mergeHoYoLabDiscoveryQueue(args: {
  currentPostId?: string;
  seenPostIds?: Iterable<string>;
  pendingPostIds?: Iterable<string>;
  discovered: HoYoLabArticleIdentity[];
  maximum?: number;
}) {
  const maximum = args.maximum ?? defaultMaximumArticles;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 500) {
    throw new Error("HoYoLAB discovery limit must be between 1 and 500 articles.");
  }
  const seen = new Set(args.seenPostIds ?? []);
  if (args.currentPostId) seen.add(args.currentPostId);
  const queue: string[] = [];
  const queued = new Set<string>();

  const add = (postId: string) => {
    if (!/^\d+$/.test(postId) || seen.has(postId) || queued.has(postId)) return;
    queued.add(postId);
    queue.push(postId);
  };

  for (const postId of args.pendingPostIds ?? []) add(postId);
  for (const identity of args.discovered) add(identity.postId);

  return queue.slice(0, maximum);
}

export function hoyolabDiscoveryReceipt(args: {
  observedLinks: number;
  articleCandidates: number;
  ownedAccepted: number;
  foreignRejected: number;
  failedMetadata: number;
  pending: number;
}) {
  for (const [label, value] of Object.entries(args)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`HoYoLAB discovery receipt ${label} must be a non-negative integer.`);
    }
  }
  return {
    version: 1,
    strategy: "dom_article_links_with_uid_verified_full_post" as const,
    ...args,
  };
}
