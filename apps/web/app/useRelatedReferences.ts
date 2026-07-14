"use client";

import { useCallback, useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export type RelatedReason = {
  type:
    | "project"
    | "tag"
    | "board"
    | "author"
    | "domain"
    | "keyword"
    | "platform"
    | "kind";
  label: string;
  detail: string;
  weight: number;
};

export type RelatedReferenceResult = {
  reference: {
    _id: string;
    kind: string;
    title?: string;
    notes?: string;
    sourceUrl: string;
    platform: string;
    authorName?: string;
    authorHandle?: string;
    capturedAt: number;
  };
  previewUrl?: string | null;
  description?: string | null;
  siteName?: string | null;
  score: number;
  reasons: RelatedReason[];
};

type FindRelatedArgs = { referenceId: string; limit?: number };

const findRelated = makeFunctionReference<
  "query",
  FindRelatedArgs,
  RelatedReferenceResult[]
>("relatedReferences:find");

let client: ConvexHttpClient | undefined;

export function useRelatedReferences(referenceId: string, limit = 8) {
  const [results, setResults] = useState<RelatedReferenceResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getClient().query(findRelated, { referenceId, limit });
      setResults(next);
      return next;
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not find related references.";
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [referenceId, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { results, loading, error, refresh };
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before finding related references.");
  client = new ConvexHttpClient(url);
  return client;
}
