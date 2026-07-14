"use client";

import { useState } from "react";
import type { ReferenceAsset, SavedReference } from "./referenceVaultModel";
import { useEnrichmentJobs } from "./useEnrichmentJobs";
import {
  runVisualAnalysis,
  useSimilarVisualReferences,
} from "./useVisualEnrichment";

export function ReferenceVisualEnrichmentPanel({
  reference,
  asset,
}: {
  reference: SavedReference;
  asset?: ReferenceAsset;
}) {
  const imageUrl =
    asset?.storedUrl ??
    asset?.originalUrl ??
    reference.sourceSnapshot?.previewImageUrl ??
    null;
  const [perceptualHash, setPerceptualHash] = useState(
    asset?.perceptualHash ?? "",
  );
  const [dominantColors, setDominantColors] = useState(
    asset?.dominantColors ?? [],
  );
  const [dimensions, setDimensions] = useState(
    asset?.width && asset?.height ? `${asset.width}×${asset.height}` : "",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { jobs, refresh: refreshJobs } = useEnrichmentJobs(reference._id);
  const visualJobs = jobs.filter(
    (job) => job.type === "dominant_colors" || job.type === "perceptual_hash",
  );
  const latestHashJob = visualJobs.find((job) => job.type === "perceptual_hash");
  const latestColorJob = visualJobs.find((job) => job.type === "dominant_colors");
  const active = visualJobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );
  const failed = visualJobs.some((job) => job.status === "failed");
  const similar = useSimilarVisualReferences(
    reference._id,
    Boolean(perceptualHash),
  );

  async function analyze() {
    if (!asset || !imageUrl) return;
    setBusy(true);
    setMessage("Analyzing the stored image in this browser…");
    try {
      const result = await runVisualAnalysis({
        referenceId: reference._id,
        assetId: asset._id,
        imageUrl,
      });
      setPerceptualHash(result.perceptualHash);
      setDominantColors(result.dominantColors);
      setDimensions(`${result.width}×${result.height}`);
      setMessage("Palette and perceptual hash stored.");
      await Promise.all([refreshJobs(), similar.refresh()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Visual analysis failed.");
      await refreshJobs();
    } finally {
      setBusy(false);
    }
  }

  if (!asset) return null;

  return (
    <section className="visual-enrichment-panel" aria-label="Visual enrichment">
      <div className="visual-enrichment-heading">
        <div>
          <strong>Visual analysis</strong>
          <span>Local palette, hash, and duplicate review</span>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => void analyze()}
          disabled={busy || active || !imageUrl}
        >
          {busy || active
            ? "Analyzing…"
            : failed
              ? "Retry analysis"
              : perceptualHash
                ? "Analyze again"
                : "Analyze image"}
        </button>
      </div>

      {!imageUrl ? (
        <p className="visual-enrichment-empty">
          This reference has no browser-readable image URL.
        </p>
      ) : perceptualHash || dominantColors.length > 0 ? (
        <div className="visual-analysis-summary">
          {dominantColors.length > 0 ? (
            <div className="dominant-palette" aria-label="Dominant colors">
              {dominantColors.map((color) => (
                <span key={color} title={color} style={{ backgroundColor: color }} />
              ))}
            </div>
          ) : null}
          <div>
            {perceptualHash ? (
              <span title={perceptualHash}>Hash {perceptualHash.slice(0, 8)}…</span>
            ) : null}
            {dimensions ? <span>{dimensions}</span> : null}
          </div>
        </div>
      ) : (
        <p className="visual-enrichment-empty">
          Analyze the image to enable palette and near-duplicate browsing.
        </p>
      )}

      {latestHashJob?.status === "failed" || latestColorJob?.status === "failed" ? (
        <p className="visual-enrichment-error">
          {latestHashJob?.error || latestColorJob?.error || "Visual analysis failed."}
        </p>
      ) : null}

      {perceptualHash ? (
        <div className="similar-image-section">
          <div className="similar-image-heading">
            <strong>Duplicates and similar images</strong>
            <button
              type="button"
              className="button ghost"
              onClick={() => void similar.refresh()}
              disabled={similar.loading}
            >
              {similar.loading ? "Comparing…" : "Refresh"}
            </button>
          </div>
          {similar.error ? (
            <p className="visual-enrichment-empty">{similar.error}</p>
          ) : similar.results.length > 0 ? (
            <div className="similar-image-list">
              {similar.results.map((result) => (
                <article key={result.reference._id}>
                  {result.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result.previewUrl} alt="" loading="lazy" />
                  ) : (
                    <span aria-hidden="true">◇</span>
                  )}
                  <div>
                    <strong>
                      {result.reference.title?.trim() ||
                        sourceDomain(result.reference.sourceUrl)}
                    </strong>
                    <p>{result.reasons.join(" · ")}</p>
                    {result.sharedColors.length > 0 ? (
                      <div className="similar-palette" aria-label="Shared colors">
                        {result.sharedColors.map((color) => (
                          <span
                            key={color}
                            title={color}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    ) : null}
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
            <p className="visual-enrichment-empty">
              {similar.loading
                ? "Comparing analyzed images…"
                : "No near duplicates were found in the analyzed candidate pool."}
            </p>
          )}
        </div>
      ) : null}

      {message ? (
        <p className="visual-enrichment-message" aria-live="polite">
          {message}
        </p>
      ) : null}
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
