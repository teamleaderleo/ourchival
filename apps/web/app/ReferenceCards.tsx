"use client";

import { useState } from "react";
import {
  referenceKindLabel,
  referenceMode,
  type SavedReference,
} from "./referenceVaultModel";

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
  const imageUrl = asset?.storedUrl ?? asset?.originalUrl;
  const mode = referenceMode(reference.kind);
  const domain = getDomain(reference.sourceUrl);
  const sourceLabel = reference.authorHandle || reference.authorName || domain;

  return (
    <article
      className={`reference-card ${mode === "links" ? "link-card" : ""} ${selected ? "selected" : ""}`}
    >
      <button
        type="button"
        className="card-select"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <div className="thumb-wrap">
          <ThumbImage
            imageUrl={imageUrl}
            title={reference.title}
            kind={reference.kind}
          />
          <span className="kind-badge">
            {referenceKindLabel(reference.kind)}
          </span>
        </div>
        <div className="card-copy">
          <h2>{reference.title || sourceLabel || reference.sourceUrl}</h2>
          <p className="card-domain">{sourceLabel}</p>
          <p className="card-meta">
            <span>{reference.platform}</span>
            <span>{formatCaptureDate(reference.capturedAt)}</span>
          </p>
        </div>
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
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
