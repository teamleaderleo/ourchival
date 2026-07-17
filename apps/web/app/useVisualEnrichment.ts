"use client";

import { useCallback, useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "./privateAccess";
import { analyzeImageUrl, type VisualAnalysisResult } from "./visualAnalysis";
import type { EnrichmentJob } from "./useEnrichmentJobs";

type AccessArgs = { accessKey: string };
type StartArgs = AccessArgs & { referenceId: string; assetId: string };
type JobIdsArgs = AccessArgs & { jobIds: string[] };
type CompleteArgs = StartArgs & JobIdsArgs & VisualAnalysisResult;
type FailArgs = JobIdsArgs & { error: string };
type SimilarArgs = AccessArgs & { referenceId: string; limit?: number };

export type SimilarVisualReference = {
  reference: {
    _id: string;
    title?: string;
    sourceUrl: string;
    kind: string;
    platform: string;
    capturedAt: number;
  };
  previewUrl?: string | null;
  distance: number;
  sharedColors: string[];
  score: number;
  reasons: string[];
};

const startVisual = makeFunctionReference<
  "mutation",
  StartArgs,
  { assetId: string; jobs: EnrichmentJob[] }
>("visualEnrichment:start");
const beginVisual = makeFunctionReference<"mutation", JobIdsArgs, string[]>(
  "visualEnrichment:begin",
);
const completeVisual = makeFunctionReference<
  "mutation",
  CompleteArgs,
  VisualAnalysisResult
>("visualEnrichment:complete");
const failVisual = makeFunctionReference<
  "mutation",
  FailArgs,
  { updated: number }
>("visualEnrichment:fail");
const findSimilar = makeFunctionReference<
  "query",
  SimilarArgs,
  SimilarVisualReference[]
>("visualEnrichment:findSimilar");

let client: ConvexHttpClient | undefined;

export async function runVisualAnalysis(
  args: Omit<StartArgs, "accessKey"> & { imageUrl: string },
) {
  const started = await getClient().mutation(
    startVisual,
    withOwnerAccess({ referenceId: args.referenceId, assetId: args.assetId }),
  );
  const jobIds = started.jobs.map((job) => job._id);
  await getClient().mutation(beginVisual, withOwnerAccess({ jobIds }));

  try {
    const analysis = await analyzeImageUrl(args.imageUrl);
    return await getClient().mutation(
      completeVisual,
      withOwnerAccess({
        referenceId: args.referenceId,
        assetId: args.assetId,
        jobIds,
        ...analysis,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Visual analysis failed.";
    await getClient().mutation(
      failVisual,
      withOwnerAccess({ jobIds, error: message }),
    );
    throw new Error(message);
  }
}

export function useSimilarVisualReferences(referenceId: string, enabled: boolean) {
  const [results, setResults] = useState<SimilarVisualReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled) {
      setResults([]);
      setLoading(false);
      setError("");
      return [];
    }
    setLoading(true);
    setError("");
    try {
      const next = await getClient().query(
        findSimilar,
        withOwnerAccess({ referenceId, limit: 8 }),
      );
      setResults(next);
      return next;
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Could not find similar images.";
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [referenceId, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { results, loading, error, refresh };
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before analyzing images.");
  client = new ConvexHttpClient(url);
  return client;
}
