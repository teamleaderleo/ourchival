"use client";

import { useCallback, useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export type EnrichmentJobType =
  | "source_metadata"
  | "ocr"
  | "description"
  | "suggested_tags"
  | "dominant_colors"
  | "perceptual_hash";

export type EnrichmentJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "dismissed";

export type EnrichmentJob = {
  _id: string;
  referenceId: string;
  type: EnrichmentJobType;
  status: EnrichmentJobStatus;
  attempts: number;
  requestedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  resultSummary?: string;
  createdAt: number;
  updatedAt: number;
};

type ReferenceIdArgs = { referenceId: string };
type JobIdArgs = { jobId: string };

const listForReference = makeFunctionReference<
  "query",
  ReferenceIdArgs,
  EnrichmentJob[]
>("enrichmentJobs:listForReference");
const enqueueSourceMetadata = makeFunctionReference<
  "mutation",
  ReferenceIdArgs,
  EnrichmentJob
>("enrichmentJobs:enqueueSourceMetadata");
const retryJob = makeFunctionReference<"mutation", JobIdArgs, EnrichmentJob>(
  "enrichmentJobs:retry",
);
const dismissJob = makeFunctionReference<"mutation", JobIdArgs, boolean>(
  "enrichmentJobs:dismiss",
);

let client: ConvexHttpClient | undefined;

export function useEnrichmentJobs(referenceId: string) {
  const [jobs, setJobs] = useState<EnrichmentJob[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const nextJobs = await getClient().query(listForReference, { referenceId });
    setJobs(nextJobs);
    setLoading(false);
    return nextJobs;
  }, [referenceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const nextJobs = await getClient().query(listForReference, { referenceId });
        if (!cancelled) {
          setJobs(nextJobs);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [referenceId]);

  return { jobs, loading, refresh };
}

export async function enqueueMetadataJob(referenceId: string) {
  return await getClient().mutation(enqueueSourceMetadata, { referenceId });
}

export async function retryEnrichmentJob(jobId: string) {
  return await getClient().mutation(retryJob, { jobId });
}

export async function dismissEnrichmentJob(jobId: string) {
  return await getClient().mutation(dismissJob, { jobId });
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before running enrichment.");
  client = new ConvexHttpClient(url);
  return client;
}
