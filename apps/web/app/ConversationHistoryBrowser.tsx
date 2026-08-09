"use client";

import { useEffect, useMemo, useState } from "react";
import {
  diffConversationArchives,
  type ConversationMessageChange,
} from "./conversationArchiveDiff";
import type { ConversationArchive } from "./conversationImport";
import {
  fetchConversationSnapshot,
  useConversationHistory,
  type ConversationSnapshotSummary,
} from "./useConversationHistory";

const maxVisibleChanges = 40;

export function ConversationHistoryBrowser({
  conversationId,
}: {
  conversationId: string;
}) {
  const history = useConversationHistory(conversationId, 50);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedArchive, setSelectedArchive] = useState<ConversationArchive | null>(null);
  const [previousArchive, setPreviousArchive] = useState<ConversationArchive | null>(null);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const selectedSnapshot = history.snapshots.find(
    (snapshot) => snapshot._id === selectedId,
  );
  const diff = useMemo(
    () =>
      selectedArchive
        ? diffConversationArchives(previousArchive, selectedArchive)
        : null,
    [previousArchive, selectedArchive],
  );

  useEffect(() => {
    setSelectedId(undefined);
    setSelectedArchive(null);
    setPreviousArchive(null);
    setArchiveError("");
  }, [conversationId]);

  async function selectSnapshot(snapshot: ConversationSnapshotSummary) {
    setSelectedId(snapshot._id);
    setLoadingArchive(true);
    setArchiveError("");
    try {
      const previous = snapshot.previousSnapshotId
        ? history.snapshots.find(
            (candidate) => candidate._id === snapshot.previousSnapshotId,
          )
        : undefined;
      const [archive, prior] = await Promise.all([
        fetchConversationSnapshot(snapshot),
        previous ? fetchConversationSnapshot(previous) : Promise.resolve(null),
      ]);
      setSelectedArchive(archive);
      setPreviousArchive(prior);
    } catch (caught) {
      setSelectedArchive(null);
      setPreviousArchive(null);
      setArchiveError(
        caught instanceof Error ? caught.message : "Could not load that revision.",
      );
    } finally {
      setLoadingArchive(false);
    }
  }

  return (
    <details className="conversation-history-browser">
      <summary>
        Revision history
        <span>
          {history.snapshots.length}
          {history.snapshots.length === 50 ? "+" : ""} loaded
        </span>
      </summary>

      {history.error ? (
        <p className="conversation-message error">{history.error}</p>
      ) : history.loading && !history.snapshots.length ? (
        <p className="conversation-empty">Loading revisions…</p>
      ) : history.snapshots.length ? (
        <div className="conversation-history-layout">
          <div className="conversation-history-list" aria-label="Conversation revisions">
            {history.snapshots.map((snapshot, index) => (
              <button
                type="button"
                className={snapshot._id === selectedId ? "active" : ""}
                key={snapshot._id}
                onClick={() => void selectSnapshot(snapshot)}
              >
                <strong>{index === 0 ? "Latest" : `Revision ${history.snapshots.length - index}`}</strong>
                <span>{formatDate(snapshot.capturedAt)}</span>
                <small>
                  {snapshot.messageCount} messages · {revisionSummary(snapshot)}
                </small>
              </button>
            ))}
          </div>

          <div className="conversation-history-detail">
            {loadingArchive ? (
              <p className="conversation-empty">Loading selected revision…</p>
            ) : archiveError ? (
              <p className="conversation-message error">{archiveError}</p>
            ) : selectedSnapshot && selectedArchive && diff ? (
              <RevisionDetail
                snapshot={selectedSnapshot}
                archive={selectedArchive}
                diff={diff}
              />
            ) : (
              <p className="conversation-empty">
                Choose a revision to inspect its saved content and differences.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="conversation-empty">No saved revisions are available.</p>
      )}
    </details>
  );
}

function RevisionDetail({
  snapshot,
  archive,
  diff,
}: {
  snapshot: ConversationSnapshotSummary;
  archive: ConversationArchive;
  diff: ReturnType<typeof diffConversationArchives>;
}) {
  const changes = [
    ...diff.changed.map((change) => ({ type: "changed" as const, change })),
    ...diff.added.map((change) => ({ type: "added" as const, change })),
    ...diff.removed.map((change) => ({ type: "removed" as const, change })),
  ];
  const visible = changes.slice(0, maxVisibleChanges);

  return (
    <>
      <header className="conversation-history-detail-heading">
        <div>
          <strong>{formatDate(snapshot.capturedAt)}</strong>
          <span>{identityConfidenceLabel(snapshot.adapter)}</span>
        </div>
        <dl>
          <div><dt>Added</dt><dd>{diff.added.length}</dd></div>
          <div><dt>Changed</dt><dd>{diff.changed.length}</dd></div>
          <div><dt>Removed</dt><dd>{diff.removed.length}</dd></div>
          <div><dt>Unchanged</dt><dd>{diff.unchangedCount}</dd></div>
        </dl>
      </header>

      {visible.length ? (
        <div className="conversation-history-changes">
          {visible.map(({ type, change }) => (
            <RevisionChange key={`${type}:${change.key}`} type={type} change={change} />
          ))}
          {changes.length > visible.length ? (
            <p className="conversation-empty">
              Showing the first {visible.length} of {changes.length} changed messages.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="conversation-history-snapshot-preview">
          <strong>No message-level differences from the previous saved revision.</strong>
          <p>{archive.messages.length} messages are stored in this snapshot.</p>
        </div>
      )}
    </>
  );
}

function RevisionChange({
  type,
  change,
}: {
  type: "added" | "changed" | "removed";
  change: ConversationMessageChange;
}) {
  return (
    <article className={`conversation-history-change ${type}`}>
      <header>
        <strong>{typeLabel(type)}</strong>
        <span>{change.after?.author || change.before?.author || change.after?.role || change.before?.role}</span>
      </header>
      {type === "changed" && change.before ? (
        <pre className="before">{change.before.text}</pre>
      ) : null}
      <pre>{change.after?.text || change.before?.text || ""}</pre>
    </article>
  );
}

function revisionSummary(snapshot: ConversationSnapshotSummary) {
  const parts: string[] = [];
  if (snapshot.addedCount) parts.push(`+${snapshot.addedCount}`);
  if (snapshot.changedCount) parts.push(`~${snapshot.changedCount}`);
  if (snapshot.removedCount) parts.push(`−${snapshot.removedCount}`);
  return parts.join(" ") || "no counted changes";
}

function identityConfidenceLabel(adapter: string) {
  const confidence = adapter.match(/(?:^|;)identity=([a-z-]+)/i)?.[1];
  if (confidence === "stable") return "Stable message identity";
  if (confidence === "mixed") return "Mixed identity; inferred edits are conservative";
  if (confidence === "positional") return "Positional identity; compare conservatively";
  if (confidence === "content") return "Content-derived identity; compare conservatively";
  return "Legacy revision matching";
}

function typeLabel(type: "added" | "changed" | "removed") {
  if (type === "added") return "Added";
  if (type === "changed") return "Changed";
  return "Removed";
}

function formatDate(value: number) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
