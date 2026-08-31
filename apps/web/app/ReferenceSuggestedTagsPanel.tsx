"use client";

import { useMemo, useState } from "react";
import { refreshReferenceTagCatalog } from "./useReferenceTags";
import { useEnrichmentJobs } from "./useEnrichmentJobs";
import {
  acceptAllSuggestedTags,
  acceptSuggestedTag,
  dismissSuggestedTag,
  enqueueSuggestedTags,
  useSuggestedTags,
  type TagSuggestion,
} from "./useSuggestedTags";

export function ReferenceSuggestedTagsPanel({ referenceId }: { referenceId: string }) {
  const { jobs, refresh: refreshJobs } = useEnrichmentJobs(referenceId);
  const latestJob = jobs.find((job) => job.type === "suggested_tags");
  const active = latestJob?.status === "queued" || latestJob?.status === "running";
  const { suggestions, loading, refresh } = useSuggestedTags(referenceId, active);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const pending = suggestions.filter((suggestion) => suggestion.status === "pending");
  const resolved = suggestions.filter((suggestion) => suggestion.status !== "pending");
  const suggestionValues = useMemo(
    () => Object.fromEntries(suggestions.map((suggestion) => [suggestion._id, suggestion.value])),
    [suggestions],
  );

  async function queue() {
    setBusyId("queue");
    setMessage("Queueing tag suggestions…");
    try {
      await enqueueSuggestedTags(referenceId);
      setMessage("Tag suggestion job queued.");
      await refreshJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not queue suggestions.");
    } finally {
      setBusyId(null);
    }
  }

  async function accept(suggestion: TagSuggestion) {
    setBusyId(suggestion._id);
    const value = (edits[suggestion._id] ?? suggestion.value).trim();
    try {
      await acceptSuggestedTag(suggestion._id, value);
      await Promise.all([refresh(), refreshReferenceTagCatalog()]);
      setMessage(`Added #${value}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not accept suggestion.");
    } finally {
      setBusyId(null);
    }
  }

  async function acceptAll() {
    setBusyId("all");
    try {
      const result = await acceptAllSuggestedTags(referenceId);
      await Promise.all([refresh(), refreshReferenceTagCatalog()]);
      setMessage(
        `Added ${result.accepted} ${result.accepted === 1 ? "tag" : "tags"}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not accept suggestions.");
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(suggestion: TagSuggestion) {
    setBusyId(suggestion._id);
    try {
      await dismissSuggestedTag(suggestion._id);
      await refresh();
      setMessage(`Dismissed #${suggestion.value}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not dismiss suggestion.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="suggested-tags-panel" aria-label="Suggested tags">
      <div className="suggested-tags-heading">
        <div>
          <strong>Suggested tags</strong>
          <span>Derived from saved source context</span>
        </div>
        <div>
          {pending.length > 1 ? (
            <button
              type="button"
              className="button ghost"
              onClick={() => void acceptAll()}
              disabled={Boolean(busyId)}
            >
              {busyId === "all" ? "Adding…" : `Accept all ${pending.length}`}
            </button>
          ) : null}
          <button
            type="button"
            className="button secondary"
            onClick={() => void queue()}
            disabled={Boolean(busyId) || active || loading}
          >
            {active
              ? latestJob?.status === "running"
                ? "Generating…"
                : "Queued…"
              : "Generate"}
          </button>
        </div>
      </div>

      {pending.length > 0 ? (
        <div className="suggested-tag-list">
          {pending.map((suggestion) => {
            const value = edits[suggestion._id] ?? suggestionValues[suggestion._id] ?? "";
            return (
              <div key={suggestion._id}>
                <input
                  value={value}
                  onChange={(event) =>
                    setEdits((current) => ({
                      ...current,
                      [suggestion._id]: event.target.value,
                    }))
                  }
                  maxLength={48}
                  aria-label="Edit suggested tag"
                  disabled={Boolean(busyId)}
                />
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void accept(suggestion)}
                  disabled={Boolean(busyId) || !value.trim()}
                >
                  {busyId === suggestion._id ? "Saving…" : "Accept"}
                </button>
                <button
                  type="button"
                  className="button ghost danger"
                  onClick={() => void dismiss(suggestion)}
                  disabled={Boolean(busyId)}
                >
                  Dismiss
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="suggested-tags-empty">
          {latestJob?.status === "succeeded"
            ? latestJob.resultSummary ?? "No pending suggestions."
            : "Generate tag candidates from the reference’s saved context."}
        </p>
      )}

      {resolved.length > 0 ? (
        <details className="suggested-tags-history">
          <summary>{resolved.length} resolved suggestions</summary>
          <div>
            {resolved.slice(0, 12).map((suggestion) => (
              <span key={suggestion._id} className={`status-${suggestion.status}`}>
                #{suggestion.value} · {suggestion.status}
              </span>
            ))}
          </div>
        </details>
      ) : null}

      {message ? (
        <p className="suggested-tags-message" aria-live="polite">
          {message}
        </p>
      ) : null}
    </section>
  );
}
