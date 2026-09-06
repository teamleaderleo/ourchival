"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  onInspect,
  onMove,
}: {
  reference: SavedReference;
  references: SavedReference[];
  onSelect: (referenceId: string) => void;
  onClose: () => void;
  onOpen: (reference: SavedReference) => Promise<void>;
  onToggleFavorite: (reference: SavedReference) => void;
  onInspect: () => void;
  onMove: (action: "keep" | "later" | "trash") => Promise<boolean>;
}) {
  const [assetIndex, setAssetIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const imageViewport = useRef<HTMLDivElement>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const copyGeneration = useRef(0);
  useEffect(() => { copyGeneration.current += 1; setCopyStatus(""); }, [reference._id]);
  async function copySource() {
    const generation = copyGeneration.current;
    try {
      await navigator.clipboard.writeText(reference.sourceUrl);
      if (generation === copyGeneration.current) setCopyStatus("Copied");
    } catch {
      if (generation === copyGeneration.current) setCopyStatus("Copy failed — use the source link");
    }
  }
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState("");
  const movePending = useRef(false);
  useEffect(() => { setAssetIndex(0); setMoveError(""); }, [reference._id]);
  const move = useCallback(async (action: "keep" | "later" | "trash") => {
    if (movePending.current) return;
    movePending.current = true;
    setMoving(true);
    setMoveError("");
    try { if (!await onMove(action)) setMoveError("Could not move this reference. Try again."); }
    finally { movePending.current = false; setMoving(false); }
  }, [onMove]);
  const [imageFailed, setImageFailed] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const index = useMemo(
    () => references.findIndex((item) => item._id === reference._id),
    [reference._id, references],
  );
  const imageSource = referencePreviewSource(reference, assetIndex);
  useEffect(() => {
    setZoomed(false);
    imageViewport.current?.scrollTo(0, 0);
  }, [imageSource]);
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
      previousFocus?.focus({ preventScroll: true });
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
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.repeat && ["k", "l", "f", "o", "z", "delete"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key.toLowerCase() === "z" && imageUrl && !imageFailed) {
        event.preventDefault();
        event.stopPropagation();
        setZoomed((value) => !value);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setAssetIndex((value) => Math.max(0, Math.min(reference.assets.length - 1, value + (event.key === "ArrowDown" ? 1 : -1))));
        return;
      }
      if (event.key.toLowerCase() === "k" || event.key.toLowerCase() === "l" || event.key === "Delete") {
        event.preventDefault();
        event.stopPropagation();
        void move(event.key === "Delete" ? "trash" : event.key.toLowerCase() === "k" ? "keep" : "later");
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first && last) {
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
        if (zoomed) setZoomed(false); else onClose();
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
  }, [next, onClose, onOpen, onSelect, onToggleFavorite, previous, reference, move, zoomed, imageUrl, imageFailed]);

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
            <button type="button" className="button ghost viewer-zoom" aria-label={zoomed ? "Fit preview to viewer" : "Show preview at actual size"} aria-pressed={zoomed} disabled={!imageUrl || imageFailed} title="Actual preview size / fit (Z or double-click image)" onClick={() => setZoomed((value) => !value)}>{zoomed ? "Fit" : "100%"}</button>
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
          <div ref={imageViewport} className={`quick-look-image-viewport ${zoomed ? "actual-size" : ""}`}>
          {imageUrl && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="quick-look-image"
              src={imageUrl}
              alt={title}
              decoding="async"
              onDoubleClick={() => setZoomed((value) => !value)}
              title={zoomed ? "Double-click to fit" : "Double-click for actual preview size"}
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

          </div>
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
          <div className="viewer-actions">
            <button type="button" className="button primary" disabled={moving} onClick={() => void move("keep")} title="Move from New to your library (K)">Add to library</button>
            <button type="button" className="button ghost" disabled={moving} onClick={() => void move("later")} title="Set aside for another review (L)">Review later</button>
            <button type="button" className="button ghost" disabled={moving} onClick={onInspect}>Tags & boards</button>
            <button type="button" className="button ghost" disabled={moving} onClick={() => void move("trash")} title="Trash and block recapture (Delete)">Move to trash</button>
          </div>
          {reference.assets.length > 1 ? <div className="viewer-assets" aria-label="Images in this reference">
            <button type="button" className="button ghost" disabled={assetIndex === 0} onClick={() => setAssetIndex((value) => value - 1)} aria-label="Previous image" title="Previous image (↑)">‹</button>
            <span>{assetIndex + 1} / {reference.assets.length} images</span>
            <button type="button" className="button ghost" disabled={assetIndex >= reference.assets.length - 1} onClick={() => setAssetIndex((value) => value + 1)} aria-label="Next image" title="Next image (↓)">›</button>
          </div> : null}
          {moveError ? <p role="alert">{moveError}</p> : null}
          <button type="button" className="button ghost copy-source" title={copyStatus || "Copy source link"} onClick={() => void copySource()}>{copyStatus === "Copied" ? "Copied" : copyStatus ? "Retry copy" : "Copy link"}</button>
          <span className="sr-only" role="status">{copyStatus}</span>
          <a
            className="button secondary"
            href={reference.sourceUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => void onOpen(reference)}
          >
            Source ↗
          </a>
        </footer>
      </section>
    </div>
  );
}

function referencePreviewSource(reference: SavedReference, assetIndex = 0) {
  const asset = reference.assets[assetIndex] ?? reference.assets[0];
  return (
    asset?.previewUrl ??
    asset?.thumbUrl ??
    asset?.storedUrl ??
    asset?.originalUrl ??
    reference.sourceSnapshot?.previewImageUrl
  );
}
