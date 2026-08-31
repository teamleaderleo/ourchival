"use client";

import { useCallback, useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "./privateAccess";

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

export type RecentEnrichmentJob = EnrichmentJob & {
  reference?: {
    _id: string;
    title?: string;
    sourceUrl: string;
    kind: string;
    deleted?: boolean;
  } | null;
};

type AccessArgs = { accessKey: string };
type ReferenceIdArgs = AccessArgs & { referenceId: string };
type ReferenceIdsArgs = AccessArgs & { referenceIds: string[] };
type JobIdArgs = AccessArgs & { jobId: string };
type RecentArgs = AccessArgs & { limit?: number };

const listForReference = makeFunctionReference<
  "query",
  ReferenceIdArgs,
  EnrichmentJob[]
>("enrichmentJobs:listForReference");
const listRecent = makeFunctionReference<
  "query",
  RecentArgs,
  RecentEnrichmentJob[]
>("enrichmentJobs:listRecent");
const enqueueSourceMetadata = makeFunctionReference<
  "mutation",
  ReferenceIdArgs,
  EnrichmentJob
>("enrichmentJobs:enqueueSourceMetadata");
const enqueueSourceMetadataMany = makeFunctionReference<
  "mutation",
  ReferenceIdsArgs,
  { queued: number; existing: number; skipped: number }
>("enrichmentBatch:enqueueSourceMetadataMany");
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
    const nextJobs = await getClient().query(
      listForReference,
      withOwnerAccess({ referenceId }),
    );
    setJobs(nextJobs);
    setLoading(false);
    return nextJobs;
  }, [referenceId]);

  useEffect(() => {
    setLoading(true);
    void refresh().catch(() => setLoading(false));
  }, [refresh]);

  const hasActiveJobs = jobs.some(isActiveJob);
  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, refresh]);

  return { jobs, loading, refresh };
}

export function useRecentEnrichmentJobs(limit = 30) {
  const [jobs, setJobs] = useState<RecentEnrichmentJob[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const nextJobs = await getClient().query(
      listRecent,
      withOwnerAccess({ limit }),
    );
    setJobs(nextJobs);
    setLoading(false);
    return nextJobs;
  }, [limit]);

  useEffect(() => {
    setLoading(true);
    void refresh().catch(() => setLoading(false));
  }, [refresh]);

  const hasActiveJobs = jobs.some(isActiveJob);
  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, refresh]);

  return { jobs, loading, refresh };
}

export async function enqueueMetadataJob(referenceId: string) {
  return await getClient().mutation(
    enqueueSourceMetadata,
    withOwnerAccess({ referenceId }),
  );
}

export async function enqueueMetadataJobs(referenceIds: string[]) {
  return await getClient().mutation(
    enqueueSourceMetadataMany,
    withOwnerAccess({ referenceIds }),
  );
}

export async function retryEnrichmentJob(jobId: string) {
  return await getClient().mutation(retryJob, withOwnerAccess({ jobId }));
}

export async function dismissEnrichmentJob(jobId: string) {
  return await getClient().mutation(dismissJob, withOwnerAccess({ jobId }));
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before running enrichment.");
  client = new ConvexHttpClient(url);
  return client;
}

function isActiveJob(job: Pick<EnrichmentJob, "status">) {
  return job.status === "queued" || job.status === "running";
}
