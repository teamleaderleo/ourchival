"use client";

import { useState } from "react";
import { useBatchSelection } from "./batchSelection";
import { jobStatusLabel } from "./ReferenceEnrichmentPanel";
import {
  dismissEnrichmentJob,
  enqueueMetadataJobs,
  retryEnrichmentJob,
  useRecentEnrichmentJobs,
  type RecentEnrichmentJob,
} from "./useEnrichmentJobs";

export function EnrichmentQueuePanel() {
  const { selectedIds } = useBatchSelection();
  const { jobs, loading, refresh } = useRecentEnrichmentJobs(40);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [message, setMessage] = useState("");
  const visibleJobs = jobs.filter((job) => job.status !== "dismissed").slice(0, 10);
  const activeCount = jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  ).length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;

  async function queueSelected() {
    if (selectedIds.length === 0) return;
    setQueueing(true);
    setMessage("Queueing selected links…");
    try {
      const result = await enqueueMetadataJobs(selectedIds);
      setMessage(
        [
          `${result.queued} queued`,
          result.existing ? `${result.existing} already active` : "",
          result.skipped ? `${result.skipped} skipped` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not queue metadata jobs.");
    } finally {
      setQueueing(false);
    }
  }

  async function retry(job: RecentEnrichmentJob) {
    setBusyJobId(job._id);
    setMessage("Queueing retry…");
    try {
      await retryEnrichmentJob(job._id);
      setMessage("Retry queued.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not retry job.");
    } finally {
      setBusyJobId(null);
    }
  }

  async function dismiss(job: RecentEnrichmentJob) {
    setBusyJobId(job._id);
    try {
      await dismissEnrichmentJob(job._id);
      setMessage("Job dismissed.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not dismiss job.");
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <details className="enrichment-queue-panel">
      <summary>
        <span>Enrichment queue</span>
        <span>{activeCount} active · {failedCount} failed</span>
      </summary>
      <div className="enrichment-queue-actions">
        <div>
          <strong>Source metadata</strong>
          <span>Queue selected link, page, and article references.</span>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => void queueSelected()}
          disabled={queueing || selectedIds.length === 0}
        >
          {queueing
            ? "Queueing…"
            : selectedIds.length > 0
              ? `Queue ${selectedIds.length} selected`
              : "Select cards first"}
        </button>
      </div>

      {loading && visibleJobs.length === 0 ? (
        <p className="enrichment-queue-empty">Loading recent jobs…</p>
      ) : visibleJobs.length > 0 ? (
        <div className="enrichment-queue-list">
          {visibleJobs.map((job) => (
            <article key={job._id} className={`status-${job.status}`}>
              <div className="enrichment-queue-job-heading">
                <span className="enrichment-status-dot" aria-hidden="true" />
                <div>
                  <strong>{referenceTitle(job)}</strong>
                  <span>{jobStatusLabel(job)} · attempt {job.attempts}</span>
                </div>
                <time dateTime={new Date(job.updatedAt).toISOString()}>
                  {formatJobTime(job.updatedAt)}
                </time>
              </div>
              <p>{job.resultSummary || job.error || progressLabel(job)}</p>
              <div className="enrichment-queue-job-actions">
                {job.status === "failed" ? (
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => void retry(job)}
                    disabled={Boolean(busyJobId)}
                  >
                    {busyJobId === job._id ? "Retrying…" : "Retry"}
                  </button>
                ) : null}
                {job.status !== "running" ? (
                  <button
                    type="button"
                    className="button ghost danger"
                    onClick={() => void dismiss(job)}
                    disabled={Boolean(busyJobId)}
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="enrichment-queue-empty">No enrichment jobs yet.</p>
      )}

      {message ? (
        <p className="enrichment-queue-message" aria-live="polite">
          {message}
        </p>
      ) : null}
    </details>
  );
}

function referenceTitle(job: RecentEnrichmentJob) {
  return job.reference?.title?.trim() || job.reference?.sourceUrl || "Deleted reference";
}

function progressLabel(job: RecentEnrichmentJob) {
  if (job.status === "queued") return "Waiting for a processor.";
  if (job.status === "running") return "Fetching and storing source metadata.";
  if (job.status === "succeeded") return "Source metadata stored.";
  return "The processor recorded a failure.";
}

function formatJobTime(value: number) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
