"use client";

import { compactPreviewSources } from "../compactPreviewSources";
import { useEnsurePreview } from "../useEnsurePreview";
import { KeyboardHelp, reviewKeys } from "../KeyboardHelp";

import { useEffect, useMemo } from "react";
import { getDomain } from "../ReferenceCards";
import { referenceDisplayTitle } from "../referenceVaultModel";
import { usePrivateImageUrl } from "../usePrivateImageUrl";
import { useReferenceVault } from "../useReferenceVault";
import styles from "./ReviewDeck.module.css";

export function ReviewDeck() {
  const vault = useReferenceVault(96);

  useEffect(() => {
    const lane = new URLSearchParams(window.location.search).get("lane");
    vault.changeView(lane === "later" ? "later" : "inbox");
    vault.setQuery("");
    // This route owns its initial lane; running once avoids resetting user choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!vault.selectedId && vault.filteredReferences[0]) {
      vault.setSelectedId(vault.filteredReferences[0]._id);
    }
  }, [vault.filteredReferences, vault.selectedId, vault.setSelectedId]);

  const reference = vault.selectedReference;
  const imageUrl = useMemo(() => {
    if (!reference) return undefined;
    const asset = reference.assets[0];
    return compactPreviewSources(asset)[0];
  }, [reference]);
  useEnsurePreview(reference?.assets[0], Boolean(reference && !(reference.sealed && !reference.previewsRevealed)));
  const privateImage = usePrivateImageUrl(imageUrl);

  const currentIndex = reference
    ? vault.filteredReferences.findIndex((item) => item._id === reference._id)
    : -1;

  function switchLane(lane: "inbox" | "later") {
    vault.changeView(lane);
    const url = lane === "later" ? "/review?lane=later" : "/review";
    window.history.replaceState(null, "", url);
  }

  function selectRelative(offset: number) {
    if (!vault.filteredReferences.length) return;
    const start = currentIndex >= 0 ? currentIndex : 0;
    const next = Math.min(
      vault.filteredReferences.length - 1,
      Math.max(0, start + offset),
    );
    vault.setSelectedId(vault.filteredReferences[next]?._id ?? null);
  }

  async function decide(destination: "keep" | "later" | "archive") {
    if (!reference) return;
    await vault.moveReference(reference._id, destination);
  }

  // Triage keys: n No, m Maybe, y Yes, arrows walk the queue. Same guard
  // shape as the gallery and Quick Look handlers (never while typing).
  useEffect(() => {
    function handleReviewKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "arrowleft") {
        event.preventDefault();
        selectRelative(-1);
        return;
      }
      if (key === "arrowright") {
        event.preventDefault();
        selectRelative(1);
        return;
      }
      if (!reference) return;
      if (key === "n" || key === "m" || key === "y") {
        event.preventDefault();
        event.stopPropagation();
        void decide(key === "n" ? "archive" : key === "m" ? "later" : "keep");
      }
    }
    window.addEventListener("keydown", handleReviewKey);
    return () => window.removeEventListener("keydown", handleReviewKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <strong>Review</strong>
          <span>No / Maybe / Yes · decisions save immediately</span>
          <KeyboardHelp items={reviewKeys} />
        </div>
        <div className={styles.lanes}>
          <button
            type="button"
            className={vault.activeView === "inbox" ? styles.active : undefined}
            onClick={() => switchLane("inbox")}
          >
            New · {vault.inboxCount}
          </button>
          <button
            type="button"
            className={vault.activeView === "later" ? styles.active : undefined}
            onClick={() => switchLane("later")}
          >
            Maybe · {vault.laterCount}
          </button>
        </div>
      </header>

      {reference ? (
        <section className={styles.stage}>
          <div className={styles.imageFrame}>
            {privateImage.resolvedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className={styles.image}
                src={privateImage.resolvedUrl}
                alt={referenceDisplayTitle(reference)}
              />
            ) : (
              <div className={styles.placeholder}>
                <div>
                  <strong>{privateImage.loading ? "Loading preview…" : "Preview unavailable"}</strong>
                  <p>Open the source below for the original post or artwork.</p>
                </div>
              </div>
            )}
          </div>

          <div className={styles.meta}>
            <h1>{referenceDisplayTitle(reference)}</h1>
            <p>
              {reference.authorHandle ||
                reference.authorName ||
                reference.sourceSnapshot?.pageAuthor ||
                getDomain(reference.sourceUrl)}
            </p>
            <div className={styles.metaActions}>
              <a
                className={styles.sourceButton}
                href={reference.sourceUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => void vault.markReferenceOpened(reference)}
              >
                Open source ↗
              </a>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => selectRelative(-1)}
                disabled={currentIndex <= 0}
              >
                ←
              </button>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => selectRelative(1)}
                disabled={currentIndex < 0 || currentIndex >= vault.filteredReferences.length - 1}
              >
                →
              </button>
              {vault.undoMove ? (
                <button
                  type="button"
                  className={styles.undoButton}
                  onClick={() => void vault.undoLastMove()}
                >
                  Undo
                </button>
              ) : null}
              <span className={styles.counter}>
                {currentIndex + 1} / {vault.filteredReferences.length}
              </span>
            </div>
          </div>
        </section>
      ) : (
        <section className={styles.empty}>
          <div className={styles.emptyInner}>
            {vault.loadFailed ? (
              <>
                <h1>Couldn&apos;t load the review queue</h1>
                <p>The archive is busy. Your place in the queue is kept.</p>
                <button
                  type="button"
                  className={styles.importButton}
                  onClick={() => vault.retryLoad()}
                >
                  Try again
                </button>
              </>
            ) : (
              <>
                <h1>{vault.isLoading ? "Loading review queue…" : vault.activeView === "later" ? "Maybe is empty" : "Inbox is clear"}</h1>
                <p>
                  {vault.activeView === "later"
                    ? "Nothing is waiting in Maybe. Switch to New to keep reviewing."
                    : "Everything triaged. New captures land here for No / Maybe / Yes decisions."}
                </p>
              </>
            )}
          </div>
        </section>
      )}

      <div className={styles.decisions} aria-label="Review decision">
        <div className={styles.decisionInner}>
          <button
            type="button"
            className={styles.no}
            disabled={!reference}
            onClick={() => void decide("archive")}
          >
            No
          </button>
          <button
            type="button"
            className={styles.maybe}
            disabled={!reference}
            onClick={() => void decide("later")}
          >
            Maybe
          </button>
          <button
            type="button"
            className={styles.yes}
            disabled={!reference}
            onClick={() => void decide("keep")}
          >
            Yes
          </button>
        </div>
      </div>
    </main>
  );
}
