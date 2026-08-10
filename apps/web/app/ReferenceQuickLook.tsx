"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  referenceDisplayTitle,
  referenceMode,
  type SavedReference,
} from "./referenceVaultModel";
import { getDomain, getInitial } from "./ReferenceCards";
import { isProtectedDriveUrl, usePrivateImageUrl } from "./usePrivateImageUrl";

export function ReferenceQuickLook({
  reference,
  references,
  onSelect,
  onClose,
  onOpen,
  onToggleFavorite,
}: {
  reference: SavedReference;
  references: SavedReference[];
  onSelect: (referenceId: string) => void;
  onClose: () => void;
  onOpen: (reference: SavedReference) => Promise<void>;
  onToggleFavorite: (reference: SavedReference) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const index = useMemo(
    () => references.findIndex((item) => item._id === reference._id),
    [reference._id, references],
  );
  const imageSource = referencePreviewSource(reference);
  const {
    resolvedUrl: imageUrl,
    loading: imageLoading,
    error: imageError,
  } = usePrivateImageUrl(imageSource);
  const title = referenceDisplayTitle(reference);
  const sourceLabel =
    reference.sourceSnapshot?.siteName ||
    reference.authorHandle ||
    reference.authorName ||
    getDomain(reference.sourceUrl);
  const previous = index > 0 ? references[index - 1] : undefined;
  const next = index >= 0 && index < references.length - 1 ? references[index + 1] : undefined;

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.documentElement.classList.add("quick-look-open");
    closeButtonRef.current?.focus();
    return () => {
      document.documentElement.classList.remove("quick-look-open");
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    for (const adjacent of [previous, next]) {
      const source = adjacent ? referencePreviewSource(adjacent) : undefined;
      if (!source || isProtectedDriveUrl(source)) continue;
      const image = new Image();
      image.decoding = "async";
      image.src = source;
    }
  }, [previous, next]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const focusable = Array.from(
          panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && previous) {
        event.preventDefault();
        event.stopPropagation();
        onSelect(previous._id);
        return;
      }
      if (event.key === "ArrowRight" && next) {
        event.preventDefault();
        event.stopPropagation();
        onSelect(next._id);
        return;
      }
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        event.stopPropagation();
        window.open(reference.sourceUrl, "_blank", "noopener,noreferrer");
        void onOpen(reference);
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        onToggleFavorite(reference);
      }
    }

    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [next, onClose, onOpen, onSelect, onToggleFavorite, previous, reference]);

  return (
    <div
      className="quick-look-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="quick-look-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Quick look: ${title}`}
      >
        <header className="quick-look-header">
          <div className="quick-look-heading">
            <span>{sourceLabel}</span>
            <strong>{title}</strong>
          </div>
          <div className="quick-look-header-actions">
            <span className="quick-look-count">
              {index >= 0 ? index + 1 : 1} / {references.length}
            </span>
            <button
              type="button"
              className={`favorite-toggle inline ${reference.favorite ? "active" : ""}`}
              aria-label={reference.favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={Boolean(reference.favorite)}
              onClick={() => onToggleFavorite(reference)}
              title="Favorite (F)"
            >
              {reference.favorite ? "★" : "☆"}
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="button ghost quick-look-close"
              onClick={onClose}
              aria-label="Close quick look"
              title="Close (Esc)"
            >
              ×
            </button>
          </div>
        </header>

        <div className="quick-look-stage">
          {imageUrl && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="quick-look-image"
              src={imageUrl}
              alt={title}
              decoding="async"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div
              className={`quick-look-placeholder ${referenceMode(reference.kind) === "links" ? "link-placeholder" : ""}`}
              aria-busy={imageLoading}
              title={imageError || undefined}
            >
              {referenceMode(reference.kind) === "links" ? (
                <span>{getInitial(title)}</span>
              ) : (
                <span aria-hidden="true">◇</span>
              )}
            </div>
          )}

          <button
            type="button"
            className="quick-look-nav previous"
            onClick={() => previous && onSelect(previous._id)}
            disabled={!previous}
            aria-label="Previous reference"
            title="Previous (←)"
          >
            ‹
          </button>
          <button
            type="button"
            className="quick-look-nav next"
            onClick={() => next && onSelect(next._id)}
            disabled={!next}
            aria-label="Next reference"
            title="Next (→)"
          >
            ›
          </button>
        </div>

        <footer className="quick-look-footer">
          <div className="quick-look-shortcuts" aria-label="Quick look shortcuts">
            <span><kbd>←</kbd><kbd>→</kbd> browse</span>
            <span><kbd>F</kbd> favorite</span>
            <span><kbd>O</kbd> source</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
          <a
            className="button secondary"
            href={reference.sourceUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => void onOpen(reference)}
          >
            Open source ↗
          </a>
        </footer>
      </section>
    </div>
  );
}

function referencePreviewSource(reference: SavedReference) {
  const asset = reference.assets[0];
  return (
    asset?.previewUrl ??
    asset?.thumbUrl ??
    asset?.storedUrl ??
    asset?.originalUrl ??
    reference.sourceSnapshot?.previewImageUrl
  );
}
