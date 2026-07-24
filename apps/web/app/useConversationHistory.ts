"use client";

import { useCallback, useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { ConversationArchive } from "./conversationImport";
import { withOwnerAccess } from "./privateAccess";

export type ConversationSnapshotSummary = {
  _id: string;
  conversationId: string;
  storageId: string;
  contentHash: string;
  messageCount: number;
  messageFingerprints: string[];
  captureMethod: "import" | "browser";
  format: "json" | "markdown" | "provider";
  adapter: string;
  previousSnapshotId?: string;
  addedCount: number;
  changedCount: number;
  removedCount: number;
  capturedAt: number;
  createdAt: number;
  storageUrl: string | null;
};

type AccessArgs = { accessKey: string };
type ListArgs = AccessArgs & {
  conversationId: string;
  limit?: number;
};

const listSnapshotsReference = makeFunctionReference<
  "query",
  ListArgs,
  ConversationSnapshotSummary[]
>("conversationHistory:listSnapshots");

let client: ConvexHttpClient | undefined;

export function useConversationHistory(
  conversationId: string | undefined,
  limit = 50,
) {
  const [snapshots, setSnapshots] = useState<ConversationSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setSnapshots([]);
      return [];
    }
    setLoading(true);
    setError("");
    try {
      const next = await getClient().query(
        listSnapshotsReference,
        withOwnerAccess({ conversationId, limit }),
      );
      setSnapshots(next);
      return next;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load conversation history.",
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, [conversationId, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { snapshots, loading, error, refresh };
}

export async function fetchConversationSnapshot(
  snapshot: ConversationSnapshotSummary | undefined,
) {
  if (!snapshot?.storageUrl) {
    throw new Error("Conversation snapshot file is unavailable.");
  }
  const response = await fetch(snapshot.storageUrl);
  if (!response.ok) {
    throw new Error(response.statusText || "Could not load conversation snapshot.");
  }
  return (await response.json()) as ConversationArchive;
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) {
    throw new Error("Add NEXT_PUBLIC_CONVEX_URL before browsing revisions.");
  }
  client = new ConvexHttpClient(url);
  return client;
}
