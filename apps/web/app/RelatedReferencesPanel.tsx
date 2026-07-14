"use client";

import { useRelatedReferences } from "./useRelatedReferences";

export function RelatedReferencesPanel({ referenceId }: { referenceId: string }) {
  const { results, loading, error, refresh } = useRelatedReferences(referenceId, 8);

  return (
    <section className="related-references-panel" aria-label="Related references">
      <div className="related-references-heading">
        <div>
          <strong>Related references</strong>
          <span>Shared organization and source context</span>
        </div>
        <button
          type="button"
          className="button ghost"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? "Finding…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="related-references-empty">{error}</p>
      ) : results.length > 0 ? (
        <div className="related-reference-list">
          {results.map((result) => (
            <article key={result.reference._id}>
              {result.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.previewUrl}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <span className="related-reference-placeholder" aria-hidden="true">
                  {initialFor(result.reference.title || result.siteName)}
                </span>
              )}
              <div>
                <strong>
                  {result.reference.title?.trim() ||
                    result.siteName ||
                    sourceDomain(result.reference.sourceUrl)}
                </strong>
                {result.description ? <p>{result.description}</p> : null}
                <div className="related-reasons" aria-label="Why this is related">
                  {result.reasons.slice(0, 4).map((reason) => (
                    <span
                      key={`${reason.type}:${reason.detail}`}
                      title={reason.label}
                    >
                      {reason.detail}
                    </span>
                  ))}
                </div>
              </div>
              <a
                href={result.reference.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="button ghost"
              >
                Open
              </a>
            </article>
          ))}
        </div>
      ) : (
        <p className="related-references-empty">
          {loading
            ? "Comparing tags, boards, projects, authors, and source context…"
            : "No strong related references were found in the recent candidate pool."}
        </p>
      )}
    </section>
  );
}

function sourceDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function initialFor(value?: string | null) {
  return value?.trim().charAt(0).toLocaleUpperCase() || "↗";
}
