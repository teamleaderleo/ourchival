import type { CapturePayload } from "@ourchival/shared";
import {
  buildXOwnedProfilePayloads,
  classifyXOwnedProfileSnapshot,
  type XOwnedProfileClassification,
  type XOwnedProfileSnapshot,
} from "./xOwnedProfile";

export const xOwnedProfileHandle = "TeamLeaderLeo";
export const xOwnedKnownBoundary = 12;
export const xOwnedRecentWindow = 200;

export type XOwnedSyncState = {
  seenPostIds: Set<string>;
  consecutiveKnown: number;
  authoredMediaObserved: number;
  newPosts: number;
  existingPosts: number;
  repostsSkipped: number;
  textOnlySkipped: number;
  quotedMediaOnlySkipped: number;
  ambiguousPosts: number;
};

export type XOwnedRoundResult = {
  state: XOwnedSyncState;
  payloads: CapturePayload[];
  capturedPostIds: string[];
  knownBoundaryReached: boolean;
  recentWindowReached: boolean;
};

export function detectXOwnedProfilePage(
  value: string | undefined,
  expectedHandle = xOwnedProfileHandle,
) {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "x.com" && host !== "twitter.com") return undefined;
  const owner = normalizeHandle(expectedHandle);
  if (!owner) throw new Error("X owned-profile handle is invalid.");
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})(?:\/(media))?\/?$/i);
  if (!match?.[1] || match[1].toLowerCase() !== owner.toLowerCase()) {
    return undefined;
  }
  return {
    handle: owner,
    route: match[2] ? ("media" as const) : ("profile" as const),
    sourceUrl: `https://x.com/${owner}`,
    mediaUrl: `https://x.com/${owner}/media`,
  };
}

export function emptyXOwnedSyncState(): XOwnedSyncState {
  return {
    seenPostIds: new Set<string>(),
    consecutiveKnown: 0,
    authoredMediaObserved: 0,
    newPosts: 0,
    existingPosts: 0,
    repostsSkipped: 0,
    textOnlySkipped: 0,
    quotedMediaOnlySkipped: 0,
    ambiguousPosts: 0,
  };
}

export function processXOwnedRound(args: {
  snapshots: XOwnedProfileSnapshot[];
  knownSourceUrls: Set<string>;
  state: XOwnedSyncState;
  expectedHandle?: string;
  capturedAt?: string;
}) {
  const expectedHandle = args.expectedHandle ?? xOwnedProfileHandle;
  const payloads: CapturePayload[] = [];
  const capturedPostIds: string[] = [];
  const state = args.state;

  for (const snapshot of args.snapshots) {
    const classification = classifyXOwnedProfileSnapshot(snapshot, expectedHandle);
    const postId = stablePostId(classification);
    if (postId && state.seenPostIds.has(postId)) continue;
    if (postId) state.seenPostIds.add(postId);

    if (classification.disposition === "not_authored") {
      state.repostsSkipped += 1;
      continue;
    }
    if (classification.disposition === "text_only") {
      state.textOnlySkipped += 1;
      continue;
    }
    if (classification.disposition === "quoted_media_only") {
      state.quotedMediaOnlySkipped += 1;
      continue;
    }
    if (
      classification.disposition === "ambiguous_media" ||
      classification.disposition === "unresolved_status"
    ) {
      state.ambiguousPosts += 1;
      state.consecutiveKnown = 0;
      continue;
    }
    if (
      classification.disposition !== "authored_media" ||
      !classification.source ||
      !classification.outerStatus
    ) {
      continue;
    }

    state.authoredMediaObserved += 1;
    const sourceUrl = classification.outerStatus.sourceUrl;
    if (args.knownSourceUrls.has(sourceUrl)) {
      state.existingPosts += 1;
      state.consecutiveKnown += 1;
      if (state.consecutiveKnown >= xOwnedKnownBoundary) break;
      continue;
    }

    state.consecutiveKnown = 0;
    const built = buildXOwnedProfilePayloads(
      snapshot,
      expectedHandle,
      args.capturedAt,
    );
    if (built.payloads.length === 0) {
      state.ambiguousPosts += 1;
      continue;
    }
    payloads.push(...built.payloads);
    capturedPostIds.push(classification.outerStatus.postId);
    state.newPosts += 1;

    if (state.authoredMediaObserved >= xOwnedRecentWindow) break;
  }

  return {
    state,
    payloads,
    capturedPostIds,
    knownBoundaryReached: state.consecutiveKnown >= xOwnedKnownBoundary,
    recentWindowReached: state.authoredMediaObserved >= xOwnedRecentWindow,
  } satisfies XOwnedRoundResult;
}

export function classifiedAuthoredMediaSourceUrls(
  snapshots: XOwnedProfileSnapshot[],
  expectedHandle = xOwnedProfileHandle,
) {
  const urls = new Set<string>();
  for (const snapshot of snapshots) {
    const classification = classifyXOwnedProfileSnapshot(snapshot, expectedHandle);
    if (
      classification.disposition === "authored_media" &&
      classification.outerStatus
    ) {
      urls.add(classification.outerStatus.sourceUrl);
    }
  }
  return Array.from(urls);
}

function stablePostId(classification: XOwnedProfileClassification) {
  return classification.outerStatus?.postId ?? classification.source?.postId;
}

function normalizeHandle(value: string) {
  const normalized = value.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(normalized) ? normalized : undefined;
}
