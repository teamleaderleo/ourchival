"use client";

import { useState } from "react";
import { useBatchSelectionItem } from "./batchSelection";
import { ReferenceBoardAssignment } from "./BoardPanel";
import { ReferenceEnrichmentPanel } from "./ReferenceEnrichmentPanel";
import { ReferenceProjectAssignment } from "./ProjectPanel";
import { RelatedReferencesPanel } from "./RelatedReferencesPanel";
import { ReferenceSuggestedTagsPanel } from "./ReferenceSuggestedTagsPanel";
import {
  referenceDisplayTitle,
  referenceKindLabel,
  referenceMetadataLabel,
  referenceMode,
  type SavedReference,
} from "./referenceVaultModel";
import { useReferenceTags } from "./useReferenceTags";

export function ReferenceCard({
  reference,
  selected,
  onSelect,
  onToggleFavorite,
}: {
  reference: SavedReference;
  selected: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const asset = reference.assets[0];
  const mode = referenceMode(reference.kind);
  const snapshot = reference.sourceSnapshot;
  const [tags] = useReferenceTags(reference.tagIds, reference.tags);
  const batch = useBatchSelectionItem(reference._id);
  const imageUrl =
    asset?.thumbUrl ??
    asset?.previewUrl ??
    asset?.storedUrl ??
    asset?.originalUrl ??
    snapshot?.previewImageUrl;
  const domain = getDomain(reference.sourceUrl);
  const title = referenceDisplayTitle(reference);
  const sourceLabel =
    snapshot?.siteName || reference.authorHandle || reference.authorName || domain;
  const metadataFailed = snapshot?.metadataStatus === "failed";
  const visibleTags = tags.slice(0, 3);
  const hiddenTagCount = Math.max(0, tags.length - visibleTags.length);
  const visibleMatches = reference.searchMatches?.slice(0, 3) ?? [];
  const hiddenMatchCount = Math.max(
    0,
    (reference.searchMatches?.length ?? 0) - visibleMatches.length,
  );

  return (
    <article
      className={`reference-card ${mode === "links" ? "link-card" : ""} ${selected ? "selected" : ""} ${batch.selected ? "batch-selected" : ""}`}
    >
      <button
        type="button"
        className="card-select"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <div className="thumb-wrap">
          <ThumbImage imageUrl={imageUrl} title={title} kind={reference.kind} />
          <span className="kind-badge">
            {referenceKindLabel(reference.kind)}
          </span>
        </div>
        <div className="card-copy">
          {mode === "links" ? (
            <p className="link-source-row">
              <Favicon imageUrl={snapshot?.faviconUrl} label={sourceLabel} />
              <span>{sourceLabel}</span>
              <span
                className={`metadata-dot ${metadataFailed ? "failed" : snapshot?.metadataStatus ?? "pending"}`}
                title={referenceMetadataLabel(reference)}
                aria-label={referenceMetadataLabel(reference)}
              />
            </p>
          ) : null}
          <h2>{title}</h2>
          {mode === "links" && snapshot?.description ? (
            <p className="card-description">{snapshot.description}</p>
          ) : mode !== "links" ? (
            <p className="card-domain">{sourceLabel}</p>
          ) : null}
          {visibleTags.length > 0 ? (
            <div className="card-tags" aria-label="Reference tags">
              {visibleTags.map((tag) => (
                <span key={tag._id}>#{tag.name}</span>
              ))}
              {hiddenTagCount > 0 ? <span>+{hiddenTagCount}</span> : null}
            </div>
          ) : null}
          {visibleMatches.length > 0 ? (
            <div className="search-match-reasons" aria-label="Search match reasons">
              <strong>Matched</strong>
              {visibleMatches.map((match) => (
                <span key={`${match.field}:${match.excerpt}`} title={match.excerpt}>
                  {match.label}
                </span>
              ))}
              {hiddenMatchCount > 0 ? <span>+{hiddenMatchCount}</span> : null}
            </div>
          ) : null}
          <p className="card-meta">
            <span>
              {mode === "links"
                ? reference.lastOpenedAt
                  ? "Opened"
                  : "Unread"
                : reference.platform}
            </span>
            <span>{formatCaptureDate(reference.capturedAt)}</span>
          </p>
        </div>
      </button>
      <button
        type="button"
        className={`batch-select-toggle ${batch.selected ? "active" : ""}`}
        aria-label={batch.selected ? "Remove from batch selection" : "Add to batch selection"}
        aria-pressed={batch.selected}
        onClick={batch.toggle}
      >
        {batch.selected ? "✓" : ""}
      </button>
      <button
        type="button"
        className={`favorite-toggle ${reference.favorite ? "active" : ""}`}
        aria-label={
          reference.favorite ? "Remove from favorites" : "Add to favorites"
        }
        aria-pressed={Boolean(reference.favorite)}
        onClick={onToggleFavorite}
      >
        {reference.favorite ? "★" : "☆"}
      </button>
      {selected ? (
        <div className="selected-card-organization">
          <ReferenceBoardAssignment reference={reference} />
          <ReferenceProjectAssignment reference={reference} />
          <ReferenceSuggestedTagsPanel referenceId={reference._id} />
          <RelatedReferencesPanel referenceId={reference._id} />
          <ReferenceEnrichmentPanel
            referenceId={reference._id}
            enabled={mode === "links"}
          />
        </div>
      ) : null}
    </article>
  );
}

export function ThumbImage({
  imageUrl,
  title,
  kind,
}: {
  imageUrl?: string | null;
  title?: string;
  kind: string;
}) {
  const [failed, setFailed] = useState(false);
  const linkLike = kind === "link" || kind === "article" || kind === "page";
  if (!imageUrl || failed) {
    return (
      <div
        className={`thumb placeholder ${linkLike ? "link-placeholder" : ""}`}
        aria-hidden={!title}
      >
        {linkLike ? <span>{getInitial(title)}</span> : null}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="thumb"
      src={imageUrl}
      alt={title ?? "Saved reference"}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function Favicon({
  imageUrl,
  label,
}: {
  imageUrl?: string;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) {
    return <span className="favicon-placeholder">{getInitial(label)}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="favicon"
      src={imageUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function getInitial(value?: string) {
  return value?.trim().charAt(0).toUpperCase() || "↗";
}

function formatCaptureDate(value: number) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
