"use client";

import { useCallback, useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { ReferenceTag } from "./referenceVaultModel";
import type { EnrichmentJob } from "./useEnrichmentJobs";
import { withOwnerAccess } from "./privateAccess";

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

type AccessArgs = { accessKey: string };
type ReferenceIdArgs = AccessArgs & { referenceId: string };
type ReferenceIdsArgs = AccessArgs & { referenceIds: string[] };
type SuggestionIdArgs = AccessArgs & { suggestionId: string };
type AcceptSuggestionArgs = SuggestionIdArgs & { value?: string };

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
const dismissOne = makeFunctionReference<
  "mutation",
  SuggestionIdArgs,
  boolean
>("suggestedTags:dismiss");

let client: ConvexHttpClient | undefined;

export function useSuggestedTags(referenceId: string, poll = false) {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await getClient().query(
      listForReference,
      withOwnerAccess({ referenceId }),
    );
    setSuggestions(next);
    setLoading(false);
    return next;
  }, [referenceId]);

  useEffect(() => {
    setLoading(true);
    void refresh().catch(() => setLoading(false));
  }, [poll, refresh]);

  useEffect(() => {
    if (!poll) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 3000);
    return () => window.clearInterval(timer);
  }, [poll, refresh]);

  return { suggestions, loading, refresh };
}

export async function enqueueSuggestedTags(referenceId: string) {
  return await getClient().mutation(
    enqueueOne,
    withOwnerAccess({ referenceId }),
  );
}

export async function enqueueSuggestedTagsMany(referenceIds: string[]) {
  return await getClient().mutation(
    enqueueMany,
    withOwnerAccess({ referenceIds }),
  );
}

export async function acceptSuggestedTag(suggestionId: string, value?: string) {
  return await getClient().mutation(
    acceptOne,
    withOwnerAccess({ suggestionId, value }),
  );
}

export async function acceptAllSuggestedTags(referenceId: string) {
  return await getClient().mutation(
    acceptEvery,
    withOwnerAccess({ referenceId }),
  );
}

export async function dismissSuggestedTag(suggestionId: string) {
  return await getClient().mutation(
    dismissOne,
    withOwnerAccess({ suggestionId }),
  );
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before suggesting tags.");
  client = new ConvexHttpClient(url);
  return client;
}
