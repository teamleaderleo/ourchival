"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  referenceDisplayTitle,
  referenceMode,
  type SavedReference,
} from "./referenceVaultModel";
import { getDomain, getInitial } from "./ReferenceCards";
import { isProtectedDriveUrl, usePrivateImageUrl } from "./usePrivateImageUrl";
import { ReferenceVisualMetadata } from "./ReferenceVisualMetadata";
import { ReferenceCommunityTags } from "./ReferenceCommunityTags";

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
  const [showTags, setShowTags] = useState(true);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const tagPanelId = useId();
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
    retry: retryImage,
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
      if (event.key === "Escape" && target instanceof HTMLElement) {
        const disclosure = target.closest<HTMLDetailsElement>("details[open]");
        if (disclosure) {
          event.preventDefault();
          event.stopPropagation();
          disclosure.open = false;
          disclosure.querySelector("summary")?.focus();
          return;
        }
      }
      if (!["Tab", "Escape"].includes(event.key) && target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest(".quick-look-tag-panel, .viewer-more"))) return;
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
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter(element => element.getClientRects().length > 0 && element.tabIndex >= 0);
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
        className={`quick-look-panel ${showTags ? "" : "tags-hidden"}`}
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
            <button type="button" className="button ghost viewer-tags-toggle" aria-expanded={showTags} aria-controls={tagPanelId} onClick={() => setShowTags(value => !value)}>Tags</button>
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
              key={`${imageSource}:${previewAttempt}`}
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
                <div className="viewer-preview-status">
                  <span>{imageError || imageFailed ? "Preview couldn’t load" : reference.sealed ? "Sensitive or private content — preview hidden by default" : imageLoading ? "Loading preview…" : "No preview available"}</span>
                  {imageSource && (imageError || imageFailed) ? <><p>Your saved reference is still here.</p><button type="button" className="button secondary" onClick={() => { setImageFailed(false); setPreviewAttempt(value => value + 1); retryImage(); }}>Retry preview</button></> : null}
                </div>
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

        <aside id={tagPanelId} hidden={!showTags} className="quick-look-tag-panel" aria-label="Image tags">
          <h2>Tags</h2>
          {reference.tags?.length ? <div className="viewer-saved-tags">{reference.tags.map(tag => <span key={tag._id}>{tag.name}</span>)}</div> : null}
          {reference.assets[assetIndex] ? <ReferenceCommunityTags key={reference.assets[assetIndex]._id} assetId={reference.assets[assetIndex]._id} sealed={reference.sealed} /> : null}
          {reference.assets.length > 0 ? <ReferenceVisualMetadata key={reference.assets[assetIndex]?._id ?? reference._id} reference={reference} assetId={reference.assets[assetIndex]?._id} compact /> : <p className="menu-hint">Model tags need a captured image. This item currently has none.</p>}
        </aside>
        <footer className="quick-look-footer">
          <div className="viewer-actions">
            <button type="button" className="button primary" disabled={moving} onClick={() => void move("keep")} title="Move from New to your library (K)">Mark reviewed</button>
            <details className="viewer-more" key={reference._id}>
              <summary className="button ghost">More <span aria-hidden="true">⌄</span></summary>
              <div className="viewer-more-content">
            <button type="button" className="button ghost" disabled={moving} onClick={() => void move("later")} title="Set aside for another review (L)">Review later</button>
            <button type="button" className="button ghost" disabled={moving} onClick={onInspect}>Edit details</button>
            <button type="button" className="button ghost" disabled={moving} onClick={() => void move("trash")} title="Trash and block recapture (Delete)">Move to trash</button>
            <button type="button" className="button ghost copy-source" title={copyStatus || "Copy source link"} onClick={() => void copySource()}>{copyStatus === "Copied" ? "Copied" : copyStatus ? "Retry copy" : "Copy link"}</button>
              </div>
            </details>
          </div>
          {reference.assets.length > 1 ? <div className="viewer-assets" aria-label="Images in this reference">
            <button type="button" className="button ghost" disabled={assetIndex === 0} onClick={() => setAssetIndex((value) => value - 1)} aria-label="Previous image" title="Previous image (↑)">‹</button>
            <span>{assetIndex + 1} / {reference.assets.length} images</span>
            <button type="button" className="button ghost" disabled={assetIndex >= reference.assets.length - 1} onClick={() => setAssetIndex((value) => value + 1)} aria-label="Next image" title="Next image (↓)">›</button>
          </div> : null}
          {moveError ? <p role="alert">{moveError}</p> : null}
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
