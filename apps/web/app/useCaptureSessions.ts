"use client";

import { useCallback, useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "./privateAccess";

export type CaptureSessionReviewState =
  | "unreviewed"
  | "reviewing"
  | "completed"
  | "deferred";

export type CaptureSessionReviewDestination =
  | "inbox"
  | "keep"
  | "later"
  | "archive"
  | "trash";

export type CaptureSessionBatchDestination = Exclude<
  CaptureSessionReviewDestination,
  "inbox"
>;

export type CaptureSession = {
  _id: string;
  sessionKey: string;
  source: string;
  kind: "bundle" | "import";
  label?: string;
  sourceUrl?: string;
  expectedCount: number;
  completedCount: number;
  savedCount: number;
  duplicateCount: number;
  skippedCount: number;
  failedCount: number;
  status: "running" | "completed" | "interrupted";
  reviewState: CaptureSessionReviewState;
  startedAt: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type CaptureSessionReference = {
  _id: string;
  kind: string;
  title?: string;
  sourceUrl: string;
  authorName?: string;
  authorHandle?: string;
  capturedAt: number;
  triageState?: "inbox" | "kept" | "later";
  reviewedAt?: number;
  archived: boolean;
  deleted: boolean;
  favorite: boolean;
  previewUrl?: string | null;
  description?: string | null;
  siteName?: string | null;
};

export type CaptureSessionReviewResult = {
  reference: Pick<
    CaptureSessionReference,
    "_id" | "triageState" | "reviewedAt" | "archived" | "deleted" | "favorite"
  >;
  hasRemaining: boolean;
  reviewState: CaptureSessionReviewState;
};

export type CaptureSessionBatchResult = {
  updated: number;
  hasRemaining: boolean;
  reviewState: CaptureSessionReviewState;
};

type CaptureSessionReferencePage = {
  references: CaptureSessionReference[];
  continueCursor: string;
  isDone: boolean;
};

type AccessArgs = { accessKey: string };
type ListArgs = AccessArgs & { limit?: number };
type SyncArgs = AccessArgs & { referenceLimit?: number };
type DetailArgs = AccessArgs & {
  sessionKey: string;
  limit?: number;
  cursor?: string;
};
type ReviewArgs = AccessArgs & {
  sessionId: string;
  reviewState: CaptureSessionReviewState;
};
type ReviewReferenceArgs = AccessArgs & {
  sessionKey: string;
  referenceId: string;
  destination?: CaptureSessionReviewDestination;
  favorite?: boolean;
};
type FavoriteReferenceArgs = AccessArgs & {
  sessionKey: string;
  referenceId: string;
  favorite: boolean;
};
type ReviewPendingBatchArgs = AccessArgs & {
  sessionKey: string;
  destination: CaptureSessionBatchDestination;
  limit?: number;
};

const listRecentReference = makeFunctionReference<
  "query",
  ListArgs,
  CaptureSession[]
>("captureSessions:listRecent");
const syncRecentReference = makeFunctionReference<
  "mutation",
  SyncArgs,
  { created: number; updated: number; scanned: number }
>("captureSessions:syncRecent");
const getReferencesReference = makeFunctionReference<
  "query",
  DetailArgs,
  CaptureSessionReferencePage
>("captureSessions:getReferences");
const setReviewStateReference = makeFunctionReference<
  "mutation",
  ReviewArgs,
  CaptureSession
>("captureSessions:setReviewState");
const reviewReferenceReference = makeFunctionReference<
  "mutation",
  ReviewReferenceArgs,
  CaptureSessionReviewResult
>("captureSessions:reviewReference");
const favoriteReferenceReference = makeFunctionReference<
  "mutation",
  FavoriteReferenceArgs,
  CaptureSessionReviewResult
>("captureSessionFavorites:setFavorite");
const reviewPendingBatchReference = makeFunctionReference<
  "mutation",
  ReviewPendingBatchArgs,
  CaptureSessionBatchResult
>("captureSessionBatch:reviewPending");

let client: ConvexHttpClient | undefined;

export function useCaptureSessions(limit = 24) {
  const [sessions, setSessions] = useState<CaptureSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getClient().query(
        listRecentReference,
        withOwnerAccess({ limit }),
      );
      setSessions(next);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load sessions.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const sync = useCallback(async () => {
    await getClient().mutation(
      syncRecentReference,
      withOwnerAccess({ referenceLimit: 4096 }),
    );
    return await refresh();
  }, [refresh]);

  useEffect(() => {
    void sync();
  }, [sync]);

  return { sessions, loading, error, refresh, sync };
}

export function useCaptureSessionReferences(sessionKey?: string) {
  const [references, setReferences] = useState<CaptureSessionReference[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!sessionKey) {
      setReferences([]);
      setCursor(undefined);
      setHasMore(false);
      return [];
    }
    setLoading(true);
    setError("");
    try {
      const next = await getClient().query(
        getReferencesReference,
        withOwnerAccess({ sessionKey, limit: 96 }),
      );
      setReferences(next.references);
      setCursor(next.isDone ? undefined : next.continueCursor);
      setHasMore(!next.isDone);
      return next.references;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load session references.",
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  const loadMore = useCallback(async () => {
    if (!sessionKey || !cursor || loadingMore) return [];
    setLoadingMore(true);
    setError("");
    try {
      const next = await getClient().query(
        getReferencesReference,
        withOwnerAccess({ sessionKey, limit: 96, cursor }),
      );
      setReferences((current) => mergeReferences(current, next.references));
      setCursor(next.isDone ? undefined : next.continueCursor);
      setHasMore(!next.isDone);
      return next.references;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load older session references.",
      );
      return [];
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, sessionKey]);

  const applyReferencePatch = useCallback(
    (patch: CaptureSessionReviewResult["reference"]) => {
      setReferences((current) =>
        current.map((reference) =>
          reference._id === patch._id ? { ...reference, ...patch } : reference,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    references,
    loading,
    loadingMore,
    error,
    refresh,
    loadMore,
    hasMore,
    applyReferencePatch,
  };
}

export async function reviewCaptureSessionReference(args: {
  sessionKey: string;
  referenceId: string;
  destination?: CaptureSessionReviewDestination;
  favorite?: boolean;
}) {
  if (!args.destination && typeof args.favorite === "boolean") {
    return await getClient().mutation(
      favoriteReferenceReference,
      withOwnerAccess({
        sessionKey: args.sessionKey,
        referenceId: args.referenceId,
        favorite: args.favorite,
      }),
    );
  }
  return await getClient().mutation(
    reviewReferenceReference,
    withOwnerAccess(args),
  );
}

export async function reviewCaptureSessionPendingBatch(args: {
  sessionKey: string;
  destination: CaptureSessionBatchDestination;
  limit?: number;
}) {
  return await getClient().mutation(
    reviewPendingBatchReference,
    withOwnerAccess(args),
  );
}

export async function setCaptureSessionReviewState(
  sessionId: string,
  reviewState: CaptureSessionReviewState,
) {
  return await getClient().mutation(
    setReviewStateReference,
    withOwnerAccess({ sessionId, reviewState }),
  );
}

function mergeReferences(
  current: CaptureSessionReference[],
  incoming: CaptureSessionReference[],
) {
  const seen = new Set(current.map((reference) => reference._id));
  return [
    ...current,
    ...incoming.filter((reference) => !seen.has(reference._id)),
  ];
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before browsing sessions.");
  client = new ConvexHttpClient(url);
  return client;
}
