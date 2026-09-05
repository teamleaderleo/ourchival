"use client";

import { useEffect, useRef, useState } from "react";
import { useBatchSelectionItem } from "./batchSelection";
import {
  referenceDisplayTitle,
  referenceMetadataLabel,
  referenceMode,
  type SavedReference,
} from "./referenceVaultModel";
import { usePrivateImageUrl } from "./usePrivateImageUrl";
import { useReferenceTags } from "./useReferenceTags";
import { rememberedDimensions, rememberDimensions } from "./imageDimensions";

export function ReferenceCard({
  reference,
  selected,
  onSelect,
  onQuickLook,
  onToggleFavorite,
  priority = false,
}: {
  reference: SavedReference;
  selected: boolean;
  onSelect: () => void;
  onQuickLook?: () => void;
  onToggleFavorite: () => void;
  priority?: boolean;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(priority);
  useEffect(() => {
    if (nearViewport || !cardRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setNearViewport(true); observer.disconnect(); }
    }, { rootMargin: "500px" });
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [nearViewport]);
  const asset = reference.assets[0];
  const [learned, setLearned] = useState(() => asset ? rememberedDimensions(asset._id) : undefined);
  const dimensions = learned ?? (asset?.width && asset.height ? { width: asset.width, height: asset.height } : undefined);
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
      ref={cardRef}
      className={`reference-card ${mode === "links" ? "link-card" : ""} ${selected ? "selected" : ""} ${batch.selected ? "batch-selected" : ""}`}
    >
      <button
        type="button"
        className="card-select"
        aria-pressed={selected}
        onClick={onQuickLook ?? onSelect}
        title={onQuickLook ? "Open image" : undefined}
      >
        <div className="thumb-wrap" style={dimensions ? { aspectRatio: `${dimensions.width} / ${dimensions.height}` } : undefined}>
          <ThumbImage
            imageUrl={nearViewport ? imageUrl : undefined}
            title={title}
            kind={reference.kind}
            priority={priority}
            width={dimensions?.width}
            height={dimensions?.height}
            onDimensions={(width, height) => {
              if (!asset) return;
              rememberDimensions(asset._id, width, height);
              if (dimensions?.width !== width || dimensions?.height !== height) setLearned({ width, height });
            }}
          />
          {reference.assets.length > 1 ? (
            <span className="kind-badge" aria-label={`${reference.assets.length} images`}>
              {reference.assets.length}
            </span>
          ) : null}
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
          ) : mode !== "links" && !title.includes(sourceLabel) ? (
            <p className="card-domain">{sourceLabel}</p>
          ) : null}
          {mode === "links" && visibleTags.length > 0 ? (
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
          {mode === "links" ? (
            <p className="card-meta">
              <span>{reference.lastOpenedAt ? "Opened" : "Unread"}</span>
              <span>{formatCaptureDate(reference.capturedAt)}</span>
            </p>
          ) : null}
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
      {onQuickLook ? (
        <button
          type="button"
          className="quick-look-toggle"
          aria-label={`Details and organization for ${title}`}
          title="Details and organization"
          onClick={onSelect}
        >
          ⋯
        </button>
      ) : null}
    </article>
  );
}

export function ThumbImage({
  imageUrl,
  title,
  kind,
  priority = false,
  width,
  height,
  onDimensions,
}: {
  imageUrl?: string | null;
  title?: string;
  kind: string;
  priority?: boolean;
  width?: number;
  height?: number;
  onDimensions?: (width: number, height: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const { resolvedUrl, loading } = usePrivateImageUrl(imageUrl);
  const linkLike = kind === "link" || kind === "article" || kind === "page";

  useEffect(() => {
    setFailed(false);
  }, [resolvedUrl]);

  if (!resolvedUrl || failed) {
    return (
      <div
        className={`thumb placeholder ${linkLike ? "link-placeholder" : ""}`}
        aria-hidden={!title}
        aria-busy={loading}
      >
        {linkLike ? <span>{getInitial(title)}</span> : null}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="thumb"
      src={resolvedUrl}
      width={width}
      height={height}
      alt={title ?? "Saved reference"}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      onError={() => setFailed(true)}
      onLoad={(event) => onDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
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
      decoding="async"
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
