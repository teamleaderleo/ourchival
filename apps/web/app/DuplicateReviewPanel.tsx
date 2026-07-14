"use client";

import { useState } from "react";
import {
  dismissDuplicateGroup,
  mergeDuplicateGroup,
  useDuplicateReview,
  type DuplicateGroup,
} from "./useDuplicateReview";

export function DuplicateReviewPanel() {
  const { groups, scanned, truncated, loading, error, refresh } =
    useDuplicateReview(12);
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function merge(group: DuplicateGroup) {
    const keepReferenceId =
      keepers[group.perceptualHash] ?? group.references[0]?._id;
    if (!keepReferenceId) return;
    const duplicateCount = group.references.length - 1;
    if (
      !window.confirm(
        `Keep the selected reference and move ${duplicateCount} exact ${duplicateCount === 1 ? "duplicate" : "duplicates"} to Trash? Boards, tags, favorite state, and project reuse will transfer to the keeper.`,
      )
    ) {
      return;
    }

    setBusyHash(group.perceptualHash);
    setMessage("Merging exact duplicates…");
    try {
      const result = await mergeDuplicateGroup(group, keepReferenceId);
      setMessage(
        `Merged ${result.merged} ${result.merged === 1 ? "duplicate" : "duplicates"}; ${result.projectsTransferred} project ${result.projectsTransferred === 1 ? "use" : "uses"} transferred.`,
      );
      await refresh();
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not merge duplicates.",
      );
    } finally {
      setBusyHash(null);
    }
  }

  async function dismiss(group: DuplicateGroup) {
    setBusyHash(group.perceptualHash);
    setMessage("Recording a false-positive decision…");
    try {
      const result = await dismissDuplicateGroup(group);
      setMessage(
        `Dismissed ${result.recorded} ${result.recorded === 1 ? "duplicate pair" : "duplicate pairs"}.`,
      );
      await refresh();
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Could not dismiss duplicate group.",
      );
    } finally {
      setBusyHash(null);
    }
  }

  return (
    <details className="duplicate-review-panel">
      <summary>
        <span>Exact duplicate review</span>
        <span>{groups.length} groups</span>
      </summary>
      <div className="duplicate-review-heading">
        <div>
          <strong>Perceptual-hash matches</strong>
          <span>
            {scanned > 0
              ? `${scanned.toLocaleString()} assets scanned${truncated ? " · scan capped" : ""}`
              : "Analyze images to populate exact duplicate groups."}
          </span>
        </div>
        <button
          type="button"
          className="button ghost"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? "Scanning…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="duplicate-review-empty">{error}</p>
      ) : groups.length > 0 ? (
        <div className="duplicate-group-list">
          {groups.map((group) => {
            const keeper =
              keepers[group.perceptualHash] ?? group.references[0]?._id ?? "";
            const busy = busyHash === group.perceptualHash;
            return (
              <article key={group.perceptualHash}>
                <div className="duplicate-group-heading">
                  <div>
                    <strong>{group.references.length} exact matches</strong>
                    <span title={group.perceptualHash}>
                      Hash {group.perceptualHash.slice(0, 8)}…
                    </span>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => void dismiss(group)}
                      disabled={Boolean(busyHash)}
                    >
                      {busy ? "Working…" : "Not duplicates"}
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => void merge(group)}
                      disabled={Boolean(busyHash) || !keeper}
                    >
                      {busy ? "Merging…" : "Merge into keeper"}
                    </button>
                  </div>
                </div>
                <div className="duplicate-reference-list">
                  {group.references.map((reference) => (
                    <label
                      key={reference._id}
                      className={keeper === reference._id ? "keeper" : ""}
                    >
                      <input
                        type="radio"
                        name={`keeper-${group.perceptualHash}`}
                        value={reference._id}
                        checked={keeper === reference._id}
                        onChange={() =>
                          setKeepers((current) => ({
                            ...current,
                            [group.perceptualHash]: reference._id,
                          }))
                        }
                        disabled={Boolean(busyHash)}
                      />
                      {reference.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={reference.previewUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="duplicate-preview-placeholder" aria-hidden="true">
                          ◇
                        </span>
                      )}
                      <div>
                        <strong>
                          {reference.title?.trim() || sourceDomain(reference.sourceUrl)}
                        </strong>
                        <span>
                          {reference.platform} · {reference.tagCount} tags · {reference.boardCount} boards
                          {reference.favorite ? " · favorite" : ""}
                        </span>
                        <time dateTime={new Date(reference.capturedAt).toISOString()}>
                          Saved {formatDate(reference.capturedAt)}
                        </time>
                      </div>
                      <a
                        href={reference.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="button ghost"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Open
                      </a>
                    </label>
                  ))}
                </div>
                {group.hiddenCount > 0 ? (
                  <p className="duplicate-group-note">
                    {group.hiddenCount} additional references were outside this review page.
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="duplicate-review-empty">
          {loading
            ? "Scanning analyzed assets for exact hashes…"
            : "No unresolved exact duplicate groups were found."}
        </p>
      )}

      {message ? (
        <p className="duplicate-review-message" aria-live="polite">
          {message}
        </p>
      ) : null}
    </details>
  );
}

function sourceDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function formatDate(value: number) {
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
