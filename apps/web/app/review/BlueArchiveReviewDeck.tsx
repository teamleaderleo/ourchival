"use client";

import { useEffect, useMemo, useState } from "react";
import { getDomain } from "../ReferenceCards";
import { referenceDisplayTitle } from "../referenceVaultModel";
import { usePrivateImageUrl } from "../usePrivateImageUrl";
import { useReferenceVault } from "../useReferenceVault";
import styles from "./ReviewDeck.module.css";
import { blueArchiveReviewCandidates } from "./blueArchiveReviewCandidates";

const reviewMarker = "BAReview";
const reviewQuery = `${reviewMarker} type:image`;

type ImportProgress = {
  done: number;
  total: number;
  saved: number;
  existing: number;
  failed: number;
};

export function BlueArchiveReviewDeck() {
  const vault = useReferenceVault(96);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importMessage, setImportMessage] = useState("");

  useEffect(() => {
    const lane = new URLSearchParams(window.location.search).get("lane");
    vault.changeView(lane === "later" ? "later" : "inbox");
    vault.setQuery(reviewQuery);
    // This route owns its initial filter/lane.
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
    return (
      asset?.previewUrl ??
      asset?.storedUrl ??
      asset?.originalUrl ??
      asset?.thumbUrl ??
      reference.sourceSnapshot?.previewImageUrl
    );
  }, [reference]);
  const privateImage = usePrivateImageUrl(imageUrl);

  const currentIndex = reference
    ? vault.filteredReferences.findIndex((item) => item._id === reference._id)
    : -1;

  function switchLane(lane: "inbox" | "later") {
    vault.changeView(lane);
    vault.setQuery(reviewQuery);
    const url = lane === "later" ? "/review/blue-archive?lane=later" : "/review/blue-archive";
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

  async function importSeed() {
    if (!vault.siteUrl || importing) return;
    const candidates = blueArchiveReviewCandidates.filter((candidate) =>
      Boolean(candidate.originalImageUrl ?? candidate.previewImageUrl),
    );
    const progress: ImportProgress = {
      done: 0,
      total: candidates.length,
      saved: 0,
      existing: 0,
      failed: 0,
    };
    setImporting(true);
    setImportProgress({ ...progress });
    setImportMessage("Importing Blue Archive candidates and previews…");

    let nextIndex = 0;
    async function worker() {
      while (nextIndex < candidates.length) {
        const index = nextIndex++;
        const candidate = candidates[index]!;
        const assetUrl = candidate.originalImageUrl ?? candidate.previewImageUrl;
        try {
          const response = await fetch(`${vault.siteUrl}/capture`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: assetUrl ? "image" : "link",
              sourceUrl: candidate.sourceUrl,
              assetUrl,
              previewImageUrl: candidate.previewImageUrl ?? assetUrl,
              pageTitle: `${reviewMarker} · ${candidate.character} · ${candidate.title}`,
              authorName: candidate.artist,
              rawMetadata: JSON.stringify({
                seed: "blue-archive-review-2026-08-30",
                character: candidate.character,
                sourceKind: candidate.sourceKind,
                artist: candidate.artist,
                previewImageUrl: candidate.previewImageUrl,
                originalImageUrl: candidate.originalImageUrl,
              }),
              capturedAt: new Date().toISOString(),
            }),
          });
          const body = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            alreadySaved?: boolean;
          };
          if (!response.ok || body.ok === false) progress.failed += 1;
          else if (body.alreadySaved) progress.existing += 1;
          else progress.saved += 1;
        } catch {
          progress.failed += 1;
        } finally {
          progress.done += 1;
          setImportProgress({ ...progress });
        }
      }
    }

    await Promise.all(Array.from({ length: 4 }, () => worker()));
    setImporting(false);
    setImportMessage(
      `Import finished: ${progress.saved} new, ${progress.existing} already present, ${progress.failed} failed.`,
    );
    window.location.assign("/review/blue-archive");
  }

  async function decide(destination: "keep" | "later" | "archive") {
    if (!reference) return;
    await vault.moveReference(reference._id, destination);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <strong>Blue Archive review</strong>
          <span>No / Maybe / Yes · official, key-art and private visual lane</span>
        </div>
        <div className={styles.lanes}>
          <a href="/review">ZZZ</a>
          <button
            type="button"
            className={vault.activeView === "inbox" ? styles.active : undefined}
            onClick={() => switchLane("inbox")}
          >
            New
          </button>
          <button
            type="button"
            className={vault.activeView === "later" ? styles.active : undefined}
            onClick={() => switchLane("later")}
          >
            Maybe
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
                  <p>Open the source below for the original material.</p>
                </div>
              </div>
            )}
          </div>

          <div className={styles.meta}>
            <h1>{cleanReviewTitle(referenceDisplayTitle(reference))}</h1>
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
            <h1>{vault.isLoading ? "Loading Blue Archive candidates…" : "Blue Archive queue is empty"}</h1>
            <p>
              {vault.activeView === "later"
                ? "Nothing is waiting in Maybe. Switch to New to keep reviewing."
                : "Seed the visual-first batch here. Previews are attached where available; official digital-goods pages stay linked for later high-resolution extraction."}
            </p>
            {vault.activeView === "inbox" && !vault.isLoading ? (
              <button
                type="button"
                className={styles.importButton}
                onClick={() => void importSeed()}
                disabled={importing}
              >
                {importing ? "Importing…" : `Import ${blueArchiveReviewCandidates.length} Blue Archive candidates`}
              </button>
            ) : null}
            {importProgress ? (
              <p className={styles.progress}>
                {importProgress.done}/{importProgress.total} · {importProgress.saved} new ·{" "}
                {importProgress.existing} existing · {importProgress.failed} failed
              </p>
            ) : null}
            {importMessage ? <p className={styles.progress}>{importMessage}</p> : null}
          </div>
        </section>
      )}

      <div className={styles.decisions} aria-label="Review decision">
        <div className={styles.decisionInner}>
          <button type="button" className={styles.no} disabled={!reference} onClick={() => void decide("archive")}>No</button>
          <button type="button" className={styles.maybe} disabled={!reference} onClick={() => void decide("later")}>Maybe</button>
          <button type="button" className={styles.yes} disabled={!reference} onClick={() => void decide("keep")}>Yes</button>
        </div>
      </div>
    </main>
  );
}

function cleanReviewTitle(value: string) {
  return value.replace(/^BAReview\s*[·:-]\s*/i, "");
}
