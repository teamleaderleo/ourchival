"use client";

import { useCallback, useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { ReferenceTag } from "./referenceVaultModel";
import type { EnrichmentJob } from "./useEnrichmentJobs";

export type TagSuggestionStatus = "pending" | "accepted" | "dismissed";

export type TagSuggestion = {
  _id: string;
  referenceId: string;
  jobId: string;
  type: "tag";
  value: string;
  normalizedValue: string;
  status: TagSuggestionStatus;
  createdAt: number;
  updatedAt: number;
};

type ReferenceIdArgs = { referenceId: string };
type ReferenceIdsArgs = { referenceIds: string[] };
type SuggestionIdArgs = { suggestionId: string };
type AcceptSuggestionArgs = { suggestionId: string; value?: string };

const listForReference = makeFunctionReference<
  "query",
  ReferenceIdArgs,
  TagSuggestion[]
>("suggestedTags:listForReference");
const enqueueOne = makeFunctionReference<
  "mutation",
  ReferenceIdArgs,
  EnrichmentJob
>("suggestedTags:enqueue");
const enqueueMany = makeFunctionReference<
  "mutation",
  ReferenceIdsArgs,
  { queued: number; existing: number; skipped: number }
>("suggestedTags:enqueueMany");
const acceptOne = makeFunctionReference<
  "mutation",
  AcceptSuggestionArgs,
  { suggestion: TagSuggestion; tags: ReferenceTag[] }
>("suggestedTags:accept");
const acceptEvery = makeFunctionReference<
  "mutation",
  ReferenceIdArgs,
  { accepted: number; tags: ReferenceTag[] }
>("suggestedTags:acceptAll");
const dismissOne = makeFunctionReference<"mutation", SuggestionIdArgs, boolean>(
  "suggestedTags:dismiss",
);

let client: ConvexHttpClient | undefined;

export function useSuggestedTags(referenceId: string) {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await getClient().query(listForReference, { referenceId });
    setSuggestions(next);
    setLoading(false);
    return next;
  }, [referenceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const next = await getClient().query(listForReference, { referenceId });
        if (!cancelled) {
          setSuggestions(next);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 2200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [referenceId]);

  return { suggestions, loading, refresh };
}

export async function enqueueSuggestedTags(referenceId: string) {
  return await getClient().mutation(enqueueOne, { referenceId });
}

export async function enqueueSuggestedTagsMany(referenceIds: string[]) {
  return await getClient().mutation(enqueueMany, { referenceIds });
}

export async function acceptSuggestedTag(suggestionId: string, value?: string) {
  return await getClient().mutation(acceptOne, { suggestionId, value });
}

export async function acceptAllSuggestedTags(referenceId: string) {
  return await getClient().mutation(acceptEvery, { referenceId });
}

export async function dismissSuggestedTag(suggestionId: string) {
  return await getClient().mutation(dismissOne, { suggestionId });
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before suggesting tags.");
  client = new ConvexHttpClient(url);
  return client;
}
