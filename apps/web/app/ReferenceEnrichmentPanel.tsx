"use client";

import { useState } from "react";
import {
  dismissEnrichmentJob,
  enqueueMetadataJob,
  retryEnrichmentJob,
  useEnrichmentJobs,
  type EnrichmentJob,
} from "./useEnrichmentJobs";

export function ReferenceEnrichmentPanel({
  referenceId,
  enabled,
}: {
  referenceId: string;
  enabled: boolean;
}) {
  const { jobs, loading, refresh } = useEnrichmentJobs(referenceId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const metadataJobs = jobs.filter((job) => job.type === "source_metadata");
  const latest = metadataJobs[0];
  const active = latest?.status === "queued" || latest?.status === "running";

  async function queueMetadata() {
    setBusy(true);
    setMessage("Queueing source metadata…");
    try {
      const job = await enqueueMetadataJob(referenceId);
      setMessage(
        job.status === "running"
          ? "Metadata refresh is running."
          : "Metadata refresh queued.",
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not queue enrichment.");
    } finally {
      setBusy(false);
    }
  }

  async function retry(job: EnrichmentJob) {
    setBusy(true);
    setMessage("Queueing another attempt…");
    try {
      await retryEnrichmentJob(job._id);
      setMessage("Retry queued.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not retry enrichment.");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(job: EnrichmentJob) {
    setBusy(true);
    try {
      await dismissEnrichmentJob(job._id);
      setMessage("Job dismissed.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not dismiss job.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <section className="reference-enrichment" aria-label="Reference enrichment jobs">
      <div className="reference-enrichment-heading">
        <div>
          <strong>Enrichment</strong>
          <span>Observable source processing</span>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => void queueMetadata()}
          disabled={busy || active || loading}
        >
          {active
            ? latest?.status === "running"
              ? "Running…"
              : "Queued…"
            : "Queue metadata"}
        </button>
      </div>

      {latest ? (
        <div className={`enrichment-job status-${latest.status}`}>
          <div>
            <span className="enrichment-status-dot" aria-hidden="true" />
            <strong>{jobStatusLabel(latest)}</strong>
            <span>Attempt {latest.attempts}</span>
          </div>
          <p>{latest.resultSummary || latest.error || jobProgressLabel(latest)}</p>
          <div className="enrichment-job-actions">
            {latest.status === "failed" || latest.status === "dismissed" ? (
              <button
                type="button"
                className="button ghost"
                onClick={() => void retry(latest)}
                disabled={busy}
              >
                Retry
              </button>
            ) : null}
            {latest.status === "succeeded" ? (
              <button
                type="button"
                className="button ghost"
                onClick={() => window.location.reload()}
                disabled={busy}
              >
                Reload metadata
              </button>
            ) : null}
            {latest.status !== "running" && latest.status !== "dismissed" ? (
              <button
                type="button"
                className="button ghost danger"
                onClick={() => void dismiss(latest)}
                disabled={busy}
              >
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="enrichment-empty">
          Queue a metadata job to refresh the source title, preview, author, and canonical URL.
        </p>
      )}

      {metadataJobs.length > 1 ? (
        <details className="enrichment-history">
          <summary>{metadataJobs.length - 1} earlier jobs</summary>
          <div>
            {metadataJobs.slice(1, 6).map((job) => (
              <p key={job._id}>
                <span>{jobStatusLabel(job)}</span>
                <span>{new Date(job.updatedAt).toLocaleString()}</span>
              </p>
            ))}
          </div>
        </details>
      ) : null}

      {message ? (
        <p className="enrichment-message" aria-live="polite">
          {message}
        </p>
      ) : null}
    </section>
  );
}

export function jobStatusLabel(job: Pick<EnrichmentJob, "status">) {
  if (job.status === "queued") return "Queued";
  if (job.status === "running") return "Running";
  if (job.status === "succeeded") return "Succeeded";
  if (job.status === "failed") return "Failed";
  return "Dismissed";
}

function jobProgressLabel(job: EnrichmentJob) {
  if (job.status === "queued") return "Waiting for a processor.";
  if (job.status === "running") return "Fetching and storing source metadata.";
  if (job.status === "succeeded") return "Source metadata stored.";
  if (job.status === "failed") return "The processor recorded a failure.";
  return "Hidden from the active queue.";
}
