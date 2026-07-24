"use client";

import { useEffect, useMemo, useState } from "react";
import { ThumbImage, getDomain } from "./ReferenceCards";
import {
  reviewCaptureSessionPendingBatch,
  reviewCaptureSessionReference,
  setCaptureSessionReviewState,
  useCaptureSessionReferences,
  useCaptureSessions,
  type CaptureSession,
  type CaptureSessionBatchDestination,
  type CaptureSessionReference,
  type CaptureSessionReviewDestination,
  type CaptureSessionReviewState,
} from "./useCaptureSessions";

export function CaptureSessionPanel() {
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { sessions, loading, error, sync, refresh } = useCaptureSessions(30);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionKey === selectedKey),
    [sessions, selectedKey],
  );
  const detail = useCaptureSessionReferences(selectedSession?.sessionKey);
  const unreviewedCount = sessions.filter(
    (session) => session.reviewState === "unreviewed",
  ).length;

  async function updateReviewState(reviewState: CaptureSessionReviewState) {
    if (!selectedSession) return false;
    setBusy(true);
    setMessage("Saving session review state…");
    try {
      await setCaptureSessionReviewState(selectedSession._id, reviewState);
      setMessage(reviewStateMessage(reviewState));
      await refresh();
      return true;
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not update the session.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reviewReference(args: {
    referenceId: string;
    destination?: CaptureSessionReviewDestination;
    favorite?: boolean;
  }) {
    if (!selectedSession) return false;
    setBusy(true);
    setMessage(reviewActionMessage(args.destination, args.favorite));
    try {
      const result = await reviewCaptureSessionReference({
        sessionKey: selectedSession.sessionKey,
        ...args,
      });
      detail.applyReferencePatch(result.reference);
      await refresh();
      setMessage(reviewResultMessage(args.destination, args.favorite, result.hasRemaining));
      return true;
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not review that reference.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reviewPending(destination: CaptureSessionBatchDestination) {
    if (!selectedSession) return false;
    if (
      destination === "trash" &&
      !window.confirm("Move every remaining Inbox item in this session to Trash?")
    ) {
      return false;
    }

    setBusy(true);
    setMessage(`${batchVerb(destination)} remaining session items…`);
    try {
      let updated = 0;
      let hasRemaining = true;
      let batches = 0;
      while (hasRemaining && batches < 200) {
        const result = await reviewCaptureSessionPendingBatch({
          sessionKey: selectedSession.sessionKey,
          destination,
          limit: 48,
        });
        updated += result.updated;
        hasRemaining = result.hasRemaining;
        batches += 1;
        if (result.updated === 0) break;
      }
      await Promise.all([detail.refresh(), refresh()]);
      setMessage(
        hasRemaining
          ? `${batchPastTense(destination)} ${updated} items. More remain; run the action again.`
          : `${batchPastTense(destination)} ${updated} ${updated === 1 ? "item" : "items"}. Session review complete.`,
      );
      return !hasRemaining;
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not review the remaining session.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="capture-session-launcher button ghost"
        onClick={() => setOpen((current) => !current)}
      >
        Capture sessions
        {unreviewedCount > 0 ? <span>{unreviewedCount}</span> : null}
      </button>

      {open ? (
        <aside className="capture-session-drawer" aria-label="Capture sessions">
          <header>
            <div>
              <p className="eyebrow">Bundles and imports</p>
              <h2>{selectedSession ? sessionTitle(selectedSession) : "Capture sessions"}</h2>
            </div>
            <div>
              {selectedSession ? (
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => {
                    setSelectedKey(undefined);
                    setMessage("");
                  }}
                >
                  Back
                </button>
              ) : null}
              <button type="button" className="button ghost" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </header>

          {selectedSession ? (
            <SessionDetail
              key={selectedSession.sessionKey}
              session={selectedSession}
              references={detail.references}
              loading={detail.loading}
              loadingMore={detail.loadingMore}
              hasMore={detail.hasMore}
              error={detail.error}
              busy={busy}
              message={message}
              onLoadMore={detail.loadMore}
              onReviewState={updateReviewState}
              onReviewReference={reviewReference}
              onReviewPending={reviewPending}
            />
          ) : (
            <SessionList
              sessions={sessions}
              loading={loading}
              error={error}
              onSelect={(session) => {
                setSelectedKey(session.sessionKey);
                setMessage("");
              }}
              onSync={() => void sync()}
            />
          )}
        </aside>
      ) : null}
    </>
  );
}

function SessionList({
  sessions,
  loading,
  error,
  onSelect,
  onSync,
}: {
  sessions: CaptureSession[];
  loading: boolean;
  error: string;
  onSelect: (session: CaptureSession) => void;
  onSync: () => void;
}) {
  return (
    <div className="capture-session-list">
      <div className="capture-session-list-heading">
        <p>
          Multi-image posts and browser imports stay together after the Clipper popup
          closes.
        </p>
        <button type="button" className="button secondary" onClick={onSync} disabled={loading}>
          {loading ? "Syncing…" : "Sync recent"}
        </button>
      </div>
      {error ? <p className="capture-session-message error">{error}</p> : null}
      {sessions.length > 0 ? (
        sessions.map((session) => (
          <button
            type="button"
            className="capture-session-row"
            key={session._id}
            onClick={() => onSelect(session)}
          >
            <span className={`capture-session-kind ${session.kind}`} aria-hidden="true">
              {session.kind === "bundle" ? "▦" : "⇣"}
            </span>
            <span className="capture-session-row-copy">
              <strong>{sessionTitle(session)}</strong>
              <small>
                {session.kind === "bundle" ? "Creative bundle" : "Bulk import"} ·{" "}
                {formatSessionDate(session.startedAt)}
              </small>
              <span>
                {session.savedCount} saved
                {session.duplicateCount ? ` · ${session.duplicateCount} existing` : ""}
                {session.failedCount ? ` · ${session.failedCount} failed` : ""}
              </span>
            </span>
            <span className={`capture-session-review ${session.reviewState}`}>
              {reviewStateLabel(session.reviewState)}
            </span>
          </button>
        ))
      ) : (
        <p className="capture-session-empty">
          {loading
            ? "Looking for recent capture groups…"
            : "Future multi-item captures will appear here."}
        </p>
      )}
    </div>
  );
}

type UndoReview = {
  referenceId: string;
  title: string;
  destination: CaptureSessionReviewDestination;
  favorite: boolean;
};

function SessionDetail({
  session,
  references,
  loading,
  loadingMore,
  hasMore,
  error,
  busy,
  message,
  onLoadMore,
  onReviewState,
  onReviewReference,
  onReviewPending,
}: {
  session: CaptureSession;
  references: CaptureSessionReference[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  busy: boolean;
  message: string;
  onLoadMore: () => Promise<CaptureSessionReference[]>;
  onReviewState: (state: CaptureSessionReviewState) => Promise<boolean>;
  onReviewReference: (args: {
    referenceId: string;
    destination?: CaptureSessionReviewDestination;
    favorite?: boolean;
  }) => Promise<boolean>;
  onReviewPending: (destination: CaptureSessionBatchDestination) => Promise<boolean>;
}) {
  const [activeId, setActiveId] = useState<string | undefined>();
  const [undoReview, setUndoReview] = useState<UndoReview | null>(null);
  const pendingReferences = useMemo(
    () => references.filter(isPendingReference),
    [references],
  );
  const reviewQueue = pendingReferences.length > 0
    ? pendingReferences
    : references.filter((reference) => !reference.deleted);
  const activeReference =
    reviewQueue.find((reference) => reference._id === activeId) ?? reviewQueue[0];
  const activeIndex = activeReference
    ? reviewQueue.findIndex((reference) => reference._id === activeReference._id)
    : -1;
  const reviewedCount = Math.max(0, references.length - pendingReferences.length);
  const progress = references.length > 0 ? reviewedCount / references.length : 0;

  useEffect(() => {
    if (reviewQueue.length === 0) {
      setActiveId(undefined);
      return;
    }
    if (!reviewQueue.some((reference) => reference._id === activeId)) {
      setActiveId(reviewQueue[0]?._id);
    }
  }, [activeId, reviewQueue]);

  useEffect(() => {
    if (
      !busy &&
      !loading &&
      !loadingMore &&
      hasMore &&
      pendingReferences.length === 0 &&
      session.reviewState !== "completed"
    ) {
      void onLoadMore();
    }
  }, [busy, hasMore, loading, loadingMore, onLoadMore, pendingReferences.length, session.reviewState]);

  function selectRelative(offset: number) {
    if (!reviewQueue.length) return;
    const nextIndex = Math.min(
      reviewQueue.length - 1,
      Math.max(0, (activeIndex < 0 ? 0 : activeIndex) + offset),
    );
    setActiveId(reviewQueue[nextIndex]?._id);
  }

  async function applyDestination(destination: CaptureSessionReviewDestination) {
    if (!activeReference || busy) return;
    const next =
      reviewQueue[activeIndex + 1] ?? reviewQueue[activeIndex - 1] ?? undefined;
    const undo: UndoReview = {
      referenceId: activeReference._id,
      title: referenceTitle(activeReference),
      destination: currentDestination(activeReference),
      favorite: activeReference.favorite,
    };
    const ok = await onReviewReference({
      referenceId: activeReference._id,
      destination,
    });
    if (!ok) return;
    setUndoReview(undo);
    setActiveId(next?._id);
  }

  async function toggleFavorite() {
    if (!activeReference || busy) return;
    const undo: UndoReview = {
      referenceId: activeReference._id,
      title: referenceTitle(activeReference),
      destination: currentDestination(activeReference),
      favorite: activeReference.favorite,
    };
    const ok = await onReviewReference({
      referenceId: activeReference._id,
      favorite: !activeReference.favorite,
    });
    if (ok) setUndoReview(undo);
  }

  async function undoLastReview() {
    if (!undoReview || busy) return;
    const ok = await onReviewReference({
      referenceId: undoReview.referenceId,
      destination: undoReview.destination,
      favorite: undoReview.favorite,
    });
    if (!ok) return;
    setActiveId(undoReview.referenceId);
    setUndoReview(null);
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable ||
        busy ||
        !activeReference
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "arrowright" || key === "arrowdown") {
        event.preventDefault();
        selectRelative(1);
      } else if (key === "arrowleft" || key === "arrowup") {
        event.preventDefault();
        selectRelative(-1);
      } else if (key === "k") {
        event.preventDefault();
        void applyDestination("keep");
      } else if (key === "l") {
        event.preventDefault();
        void applyDestination("later");
      } else if (key === "a") {
        event.preventDefault();
        void applyDestination("archive");
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void applyDestination("trash");
      } else if (key === "f") {
        event.preventDefault();
        void toggleFavorite();
      } else if (key === "o") {
        event.preventDefault();
        window.open(activeReference.sourceUrl, "_blank", "noopener,noreferrer");
      } else if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        void undoLastReview();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return (
    <div className="capture-session-detail">
      <section className="capture-session-summary">
        <div>
          <span className={`capture-session-kind ${session.kind}`} aria-hidden="true">
            {session.kind === "bundle" ? "▦" : "⇣"}
          </span>
          <div>
            <strong>{session.kind === "bundle" ? "Creative bundle" : "Bulk import"}</strong>
            <span>{formatSessionDate(session.startedAt)}</span>
          </div>
        </div>
        <dl>
          <div><dt>Saved</dt><dd>{session.savedCount}</dd></div>
          <div><dt>Existing</dt><dd>{session.duplicateCount}</dd></div>
          <div><dt>Skipped</dt><dd>{session.skippedCount}</dd></div>
          <div><dt>Failed</dt><dd>{session.failedCount}</dd></div>
        </dl>
        <div className="capture-session-progress-copy">
          <span>{reviewedCount} reviewed in loaded queue</span>
          <span>
            {pendingReferences.length} loaded remaining{hasMore ? " · older items available" : ""}
          </span>
        </div>
        <div
          className="capture-session-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={references.length}
          aria-valuenow={reviewedCount}
          aria-label="Loaded session review progress"
        >
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        {session.sourceUrl ? (
          <a className="button ghost full-width" href={session.sourceUrl} target="_blank" rel="noreferrer">
            Open bundle source ↗
          </a>
        ) : null}
      </section>

      <section className="capture-session-batch-actions" aria-label="Review remaining session items">
        <div>
          <strong>Apply to every remaining Inbox item</strong>
          <span>Runs in bounded batches and continues until the session is clear.</span>
        </div>
        <div>
          <button type="button" className="button primary" disabled={busy} onClick={() => void onReviewPending("keep")}>
            Keep all
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={() => void onReviewPending("later")}>
            Later all
          </button>
          <button type="button" className="button ghost" disabled={busy} onClick={() => void onReviewPending("archive")}>
            Archive all
          </button>
          <button type="button" className="button ghost danger" disabled={busy} onClick={() => void onReviewPending("trash")}>
            Trash all
          </button>
        </div>
      </section>

      {activeReference ? (
        <section className="capture-session-review-card" aria-label="Current review item">
          <div className="capture-session-review-visual">
            <ThumbImage
              imageUrl={activeReference.previewUrl}
              title={referenceTitle(activeReference)}
              kind={activeReference.kind}
            />
            <span className={`capture-session-item-state ${currentDestination(activeReference)}`}>
              {destinationLabel(currentDestination(activeReference))}
            </span>
            {activeReference.favorite ? (
              <span className="capture-session-favorite-badge" aria-label="Favorite">★</span>
            ) : null}
          </div>
          <div className="capture-session-review-copy">
            <p className="eyebrow">
              {activeIndex + 1} of {reviewQueue.length} ·{" "}
              {activeReference.siteName || activeReference.authorHandle || activeReference.authorName || getDomain(activeReference.sourceUrl)}
            </p>
            <h3>{referenceTitle(activeReference)}</h3>
            {activeReference.description ? <p>{activeReference.description}</p> : null}
            <a href={activeReference.sourceUrl} target="_blank" rel="noreferrer">
              Open live source ↗
            </a>
          </div>
          <div className="capture-session-item-actions">
            <button
              type="button"
              className={`button ghost ${activeReference.favorite ? "active" : ""}`}
              disabled={busy}
              onClick={() => void toggleFavorite()}
            >
              ★ Favorite <kbd>F</kbd>
            </button>
            <button type="button" className="button primary" disabled={busy} onClick={() => void applyDestination("keep")}>
              Keep <kbd>K</kbd>
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={() => void applyDestination("later")}>
              Later <kbd>L</kbd>
            </button>
            <button type="button" className="button ghost" disabled={busy} onClick={() => void applyDestination("archive")}>
              Archive <kbd>A</kbd>
            </button>
            <button type="button" className="button ghost danger" disabled={busy} onClick={() => void applyDestination("trash")}>
              Trash <kbd>⌫</kbd>
            </button>
          </div>
          <div className="capture-session-navigation-actions">
            <button type="button" className="button ghost" disabled={busy || activeIndex <= 0} onClick={() => selectRelative(-1)}>
              ← Previous
            </button>
            <button type="button" className="button ghost" disabled={busy || activeIndex >= reviewQueue.length - 1} onClick={() => selectRelative(1)}>
              Next →
            </button>
          </div>
        </section>
      ) : (
        <p className="capture-session-empty">
          {loading || loadingMore
            ? "Loading session references…"
            : "Every captured reference has left the Inbox."}
        </p>
      )}

      {undoReview ? (
        <div className="capture-session-undo">
          <span>Last move: {undoReview.title}</span>
          <button type="button" className="button ghost" disabled={busy} onClick={() => void undoLastReview()}>
            Undo <kbd>⌘Z</kbd>
          </button>
        </div>
      ) : null}

      {message ? <p className="capture-session-message" aria-live="polite">{message}</p> : null}
      {error ? <p className="capture-session-message error">{error}</p> : null}

      <div className="capture-session-review-actions">
        <button
          type="button"
          className="button ghost"
          disabled={busy}
          onClick={() => void onReviewState("deferred")}
        >
          Defer session
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => void onReviewState("completed")}
        >
          Complete review
        </button>
      </div>

      <section className="capture-session-reference-list" aria-label="Session references">
        <h3>Session queue</h3>
        {references.length > 0 ? (
          references.map((reference) => (
            <button
              type="button"
              className={`capture-session-reference-row ${reference._id === activeReference?._id ? "active" : ""} ${currentDestination(reference)}`}
              key={reference._id}
              onClick={() => setActiveId(reference._id)}
            >
              <ThumbImage
                imageUrl={reference.previewUrl}
                title={reference.title}
                kind={reference.kind}
              />
              <span>
                <strong>{referenceTitle(reference)}</strong>
                <small>
                  {destinationLabel(currentDestination(reference))} · {formatSessionDate(reference.capturedAt)}
                </small>
              </span>
              {reference.favorite ? <span aria-label="Favorite">★</span> : null}
            </button>
          ))
        ) : (
          <p className="capture-session-empty">
            {loading ? "Loading session references…" : "No references remain in this session."}
          </p>
        )}
        {hasMore ? (
          <button
            type="button"
            className="button ghost full-width"
            disabled={busy || loadingMore}
            onClick={() => void onLoadMore()}
          >
            {loadingMore ? "Loading older items…" : "Load older items"}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function isPendingReference(reference: CaptureSessionReference) {
  return !reference.deleted && !reference.archived && reference.triageState === "inbox";
}

function currentDestination(
  reference: CaptureSessionReference,
): CaptureSessionReviewDestination {
  if (reference.deleted) return "trash";
  if (reference.archived) return "archive";
  if (reference.triageState === "later") return "later";
  if (reference.triageState === "inbox") return "inbox";
  return "keep";
}

function destinationLabel(destination: CaptureSessionReviewDestination) {
  if (destination === "inbox") return "Inbox";
  if (destination === "keep") return "Kept";
  if (destination === "later") return "Later";
  if (destination === "archive") return "Archived";
  return "Trash";
}

function referenceTitle(reference: CaptureSessionReference) {
  return reference.title?.trim() ||
    reference.authorHandle ||
    reference.authorName ||
    reference.siteName ||
    getDomain(reference.sourceUrl) ||
    "Untitled reference";
}

function sessionTitle(session: CaptureSession) {
  return session.label?.trim() ||
    (session.kind === "bundle"
      ? `${session.savedCount} captured images`
      : `${session.savedCount} imported references`);
}

function reviewStateLabel(state: CaptureSessionReviewState) {
  if (state === "reviewing") return "Reviewing";
  if (state === "completed") return "Reviewed";
  if (state === "deferred") return "Later";
  return "New";
}

function reviewStateMessage(state: CaptureSessionReviewState) {
  if (state === "reviewing") return "Session marked as reviewing.";
  if (state === "completed") return "Session review completed.";
  if (state === "deferred") return "Session deferred for later.";
  return "Session returned to the review queue.";
}

function reviewActionMessage(
  destination?: CaptureSessionReviewDestination,
  favorite?: boolean,
) {
  if (typeof favorite === "boolean" && !destination) {
    return favorite ? "Adding favorite…" : "Removing favorite…";
  }
  if (destination === "inbox") return "Restoring the reference…";
  if (destination === "keep") return "Keeping the reference…";
  if (destination === "later") return "Moving the reference to Later…";
  if (destination === "archive") return "Archiving the reference…";
  return "Moving the reference to Trash…";
}

function reviewResultMessage(
  destination: CaptureSessionReviewDestination | undefined,
  favorite: boolean | undefined,
  hasRemaining: boolean,
) {
  if (typeof favorite === "boolean" && !destination) {
    return favorite ? "Added to favorites." : "Removed from favorites.";
  }
  const remaining = hasRemaining ? "More references remain." : "Session review complete.";
  if (destination === "inbox") return `Restored to Inbox. ${remaining}`;
  if (destination === "keep") return `Kept in Library. ${remaining}`;
  if (destination === "later") return `Moved to Later. ${remaining}`;
  if (destination === "archive") return `Archived. ${remaining}`;
  return `Moved to Trash. ${remaining}`;
}

function batchVerb(destination: CaptureSessionBatchDestination) {
  if (destination === "keep") return "Keeping";
  if (destination === "later") return "Deferring";
  if (destination === "archive") return "Archiving";
  return "Trashing";
}

function batchPastTense(destination: CaptureSessionBatchDestination) {
  if (destination === "keep") return "Kept";
  if (destination === "later") return "Deferred";
  if (destination === "archive") return "Archived";
  return "Trashed";
}

function formatSessionDate(value: number) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
