"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ThumbImage, getDomain } from "./ReferenceCards";
import { importReceipt } from "./importReceipt";
import { CloseButton } from "./CloseButton";
import {
  setCaptureSessionReviewState,
  useCaptureSessionReferences,
  useCaptureSessions,
  type CaptureSession,
  type CaptureSessionReviewState,
} from "./useCaptureSessions";

export function CaptureSessionPanel() {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    }
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); launcher.current?.focus({ preventScroll: true }); };
  }, [open]);
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { sessions, loading, error, refresh, sync } = useCaptureSessions(30);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionKey === selectedKey),
    [sessions, selectedKey],
  );
  const detail = useCaptureSessionReferences(selectedSession?.sessionKey);
  const unreviewedCount = sessions.filter(
    (session) => session.reviewState === "unreviewed",
  ).length;

  async function updateReviewState(reviewState: CaptureSessionReviewState) {
    if (!selectedSession) return;
    setBusy(true);
    setMessage("Saving session review state…");
    try {
      await setCaptureSessionReviewState(selectedSession._id, reviewState);
      setMessage(reviewStateMessage(reviewState));
      await refresh();
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Could not update the session.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="capture-session-launcher button ghost"
        ref={launcher}
        aria-expanded={open}
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
              <h2>
                {selectedSession
                  ? sessionTitle(selectedSession)
                  : "Capture sessions"}
              </h2>
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
              <CloseButton ref={closeButton} label="Close capture sessions" onClick={() => setOpen(false)} />
            </div>
          </header>

          <div className="capture-session-body" tabIndex={0} role="region" aria-label="Capture session contents">
          {selectedSession ? (
            <SessionDetail
              session={selectedSession}
              references={detail.references}
              loading={detail.loading}
              error={detail.error}
              busy={busy}
              message={message}
              onReviewState={updateReviewState}
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
          </div>
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
        <a href="/missing" className="button secondary">Research missing works ↗</a>
        <p>
          Multi-image posts and browser imports stay together after the Clipper
          popup closes.
        </p>
        <button
          type="button"
          className="button secondary"
          onClick={onSync}
          disabled={loading}
        >
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
            <span
              className={`capture-session-kind ${session.kind}`}
              aria-hidden="true"
            >
              {session.kind === "bundle" ? "▦" : "⇣"}
            </span>
            <span className="capture-session-row-copy">
              <strong>{sessionTitle(session)}</strong>
              <small>
                {session.kind === "bundle" ? "Creative bundle" : "Bulk import"}{" "}
                · {formatSessionDate(session.startedAt)}
              </small>
              <span>
                {importReceipt(session.receiptJson)?.originals != null
                  ? `${importReceipt(session.receiptJson)!.originals} proven originals · ${importReceipt(session.receiptJson)!.remaining ?? "Unknown"} artworks left to scan`
                  : `${session.savedCount} new references`}
                {!session.receiptJson && session.duplicateCount
                  ? ` · ${session.duplicateCount} existing`
                  : ""}
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

function SessionDetail({
  session,
  references,
  loading,
  error,
  busy,
  message,
  onReviewState,
}: {
  session: CaptureSession;
  references: ReturnType<typeof useCaptureSessionReferences>["references"];
  loading: boolean;
  error: string;
  busy: boolean;
  message: string;
  onReviewState: (state: CaptureSessionReviewState) => Promise<void>;
}) {
  const receipt = importReceipt(session.receiptJson);
  return (
    <div className="capture-session-detail">
      <section className="capture-session-summary">
        <div>
          <span
            className={`capture-session-kind ${session.kind}`}
            aria-hidden="true"
          >
            {session.kind === "bundle" ? "▦" : "⇣"}
          </span>
          <div>
            <strong>
              {session.kind === "bundle" ? "Creative bundle" : "Bulk import"}
            </strong>
            <span>{formatSessionDate(session.startedAt)}</span>
          </div>
        </div>
        <dl>
          <div>
            <dt>New references</dt>
            <dd>{session.savedCount}</dd>
          </div>
          <div>
            <dt>Reused captures</dt>
            <dd>{session.duplicateCount}</dd>
          </div>
          <div>
            <dt>Skipped</dt>
            <dd>{session.skippedCount}</dd>
          </div>
          <div>
            <dt>Capture failures</dt>
            <dd>{session.failedCount}</dd>
          </div>
        </dl>
        {receipt ? <section aria-label="Image recovery progress">
          <h3>Image recovery</h3>
          <p>{receipt.observed ?? "Unknown"} artworks observed · {receipt.remaining ?? "Unknown"} left to scan</p>
          <p><strong>{receipt.originals ?? "Unknown"} proven originals stored</strong> / {receipt.expected ?? "unknown"} known image pages</p>
          {(receipt.unknown ?? 0) > 0 ? <p>{receipt.unknown} artworks still need their image counts checked. The known-page total does not include their missing pages.</p> : null}
          {(receipt.degraded ?? 0) + (receipt.unproven ?? 0) + (receipt.linked ?? 0) > 0 ? <p>{receipt.degraded ?? 0} lower-resolution copies · {receipt.unproven ?? 0} unverified renditions · {receipt.linked ?? 0} link-only images</p> : null}
          <p>Last checkpoint: {formatSessionDate(session.updatedAt)}. A zero capture-failure count does not mean every artwork is complete.</p>
          <details><summary>How recovery works</summary><p>Resume continues the unfinished scan. Repair missing originals in the Clipper rechecks earlier bookmarks and reuses durable images. Failure history records individual errors and suggested next steps. Reviewing this session does not change download completeness.</p></details>
        </section> : null}
        {typeof session.discoveredCount === "number" ? (
          <p className="capture-session-message">
            Receipt: {session.discoveredCount} discovered ·{" "}
            {session.renderedCount ?? 0} rendered · {session.archivedCount ?? 0}{" "}
            archived
            {session.discoveredCount - (session.renderedCount ?? 0) > 0
              ? ` · ${session.discoveredCount - (session.renderedCount ?? 0)} awaiting render`
              : ""}
            {(session.renderedCount ?? 0) - (session.archivedCount ?? 0) > 0
              ? ` · ${(session.renderedCount ?? 0) - (session.archivedCount ?? 0)} awaiting archive`
              : ""}
          </p>
        ) : null}
        {session.sourceUrl ? (
          <a
            className="button ghost full-width"
            href={session.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Source ↗
          </a>
        ) : null}
      </section>

      <div className="capture-session-review-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => void onReviewState("reviewing")}
        >
          Reviewing
        </button>
        <button
          type="button"
          className="button ghost"
          disabled={busy}
          onClick={() => void onReviewState("deferred")}
        >
          Later
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
      {message ? <p className="capture-session-message">{message}</p> : null}
      {error ? <p className="capture-session-message error">{error}</p> : null}

      <section
        className="capture-session-reference-list"
        aria-label="Session references"
      >
        {references.length > 0 ? (
          references.map((reference) => (
            <article key={reference._id}>
              <ThumbImage
                imageUrl={reference.previewUrl}
                title={reference.title}
                kind={reference.kind}
              />
              <div>
                <strong>
                  {reference.title?.trim() ||
                    reference.authorHandle ||
                    reference.authorName ||
                    reference.siteName ||
                    getDomain(reference.sourceUrl)}
                </strong>
                {reference.description ? <p>{reference.description}</p> : null}
                <span>
                  {reference.triageState || "inbox"} ·{" "}
                  {formatSessionDate(reference.capturedAt)}
                </span>
              </div>
              <a
                className="button ghost"
                href={reference.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </a>
            </article>
          ))
        ) : (
          <p className="capture-session-empty">
            {loading
              ? "Loading session references…"
              : "No active references remain in this session."}
          </p>
        )}
      </section>
    </div>
  );
}

function sessionTitle(session: CaptureSession) {
  return (
    session.label?.trim() ||
    (session.kind === "bundle"
      ? `${session.savedCount} captured images`
      : `${session.savedCount} imported references`)
  );
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

function formatSessionDate(value: number) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
