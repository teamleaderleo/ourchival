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
  archived: boolean;
  favorite: boolean;
  previewUrl?: string | null;
  description?: string | null;
  siteName?: string | null;
};

type AccessArgs = { accessKey: string };
type ListArgs = AccessArgs & { limit?: number };
type SyncArgs = AccessArgs & { referenceLimit?: number };
type DetailArgs = AccessArgs & { sessionKey: string; limit?: number };
type ReviewArgs = AccessArgs & {
  sessionId: string;
  reviewState: CaptureSessionReviewState;
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
  CaptureSessionReference[]
>("captureSessions:getReferences");
const setReviewStateReference = makeFunctionReference<
  "mutation",
  ReviewArgs,
  CaptureSession
>("captureSessions:setReviewState");

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!sessionKey) {
      setReferences([]);
      return [];
    }
    setLoading(true);
    setError("");
    try {
      const next = await getClient().query(
        getReferencesReference,
        withOwnerAccess({ sessionKey, limit: 300 }),
      );
      setReferences(next);
      return next;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load session references.",
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { references, loading, error, refresh };
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

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before browsing sessions.");
  client = new ConvexHttpClient(url);
  return client;
}
