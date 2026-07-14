"use client";

import { useState } from "react";
import {
  assetLabel,
  referenceCollection,
  referenceCollectionLabel,
  referenceDisplayTitle,
  referenceMetadataLabel,
  referenceMode,
  type ReferenceSourceSnapshot,
  type SavedReference,
} from "./referenceVaultModel";
import { getDomain, getInitial } from "./ReferenceCards";
import { type TriageDestination } from "./useReferenceVault";

export function SelectedReference({
  reference,
  onMove,
  onOpen,
  onToggleFavorite,
  onSaveDetails,
}: {
  reference: SavedReference;
  onMove: (referenceId: string, destination: TriageDestination) => Promise<boolean>;
  onOpen: (reference: SavedReference) => Promise<void>;
  onToggleFavorite: (reference: SavedReference) => void;
  onSaveDetails: (
    referenceId: string,
    patch: { title?: string; notes?: string },
  ) => Promise<boolean>;
}) {
  const asset = reference.assets[0];
  const snapshot = reference.sourceSnapshot;
  const imageUrl =
    asset?.storedUrl ?? asset?.originalUrl ?? snapshot?.previewImageUrl;
  const collection = referenceCollection(reference);
  const displayTitle = referenceDisplayTitle(reference);
  const [titleDraft, setTitleDraft] = useState(reference.title ?? "");
  const [notesDraft, setNotesDraft] = useState(reference.notes ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);
  const [metadataMessage, setMetadataMessage] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const isDirty =
    titleDraft.trim() !== (reference.title ?? "") ||
    notesDraft.trim() !== (reference.notes ?? "");

  async function handleSave() {
    setSavingDetails(true);
    await onSaveDetails(reference._id, {
      title: titleDraft.trim(),
      notes: notesDraft.trim(),
    });
    setSavingDetails(false);
  }

  async function handleRefreshMetadata() {
    const siteUrl = resolveConvexSiteUrl();
    if (!siteUrl) {
      setMetadataMessage("Add a Convex site URL in Setup before refreshing metadata.");
      return;
    }

    setRefreshingMetadata(true);
    setMetadataMessage("Checking the source page…");
    try {
      const response = await fetch(
        `${siteUrl}/reference-metadata?id=${encodeURIComponent(reference._id)}`,
        { method: "POST" },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        status?: "ready" | "missing" | "failed";
      };
      if (!response.ok || body.ok === false) {
        setMetadataMessage(body.error ?? response.statusText);
        return;
      }

      setMetadataMessage(
        body.status === "ready"
          ? "Metadata refreshed."
          : body.status === "missing"
            ? "The page returned sparse metadata."
            : "The metadata check recorded a failure.",
      );
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setMetadataMessage(
        error instanceof Error ? error.message : "Could not refresh metadata.",
      );
    } finally {
      setRefreshingMetadata(false);
    }
  }

  return (
    <div className="selected-reference">
      {imageUrl && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="selected-image"
          src={imageUrl}
          alt={displayTitle}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div
          className={`selected-placeholder ${referenceMode(reference.kind) === "links" ? "link-placeholder" : ""}`}
        >
          {referenceMode(reference.kind) === "links" ? (
            <span>{getInitial(displayTitle)}</span>
          ) : null}
        </div>
      )}
      <div className="inspector-heading">
        <div>
          <p className="inspector-domain">
            {snapshot?.siteName ||
              reference.authorHandle ||
              reference.authorName ||
              getDomain(reference.sourceUrl)}
          </p>
          <h2>{displayTitle}</h2>
        </div>
        <button
          type="button"
          className={`favorite-toggle inline ${reference.favorite ? "active" : ""}`}
          aria-label={
            reference.favorite ? "Remove from favorites" : "Add to favorites"
          }
          aria-pressed={Boolean(reference.favorite)}
          onClick={() => onToggleFavorite(reference)}
        >
          {reference.favorite ? "★" : "☆"}
        </button>
      </div>
      <dl className="reference-facts">
        <div>
          <dt>Location</dt>
          <dd>{referenceCollectionLabel(reference)}</dd>
        </div>
        {reference.authorName || reference.authorHandle || snapshot?.pageAuthor ? (
          <div>
            <dt>Creator</dt>
            <dd>
              {reference.authorName || snapshot?.pageAuthor}
              {(reference.authorName || snapshot?.pageAuthor) && reference.authorHandle
                ? " · "
                : ""}
              {reference.authorHandle}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Platform</dt>
          <dd>{reference.platform}</dd>
        </div>
        {referenceMode(reference.kind) === "links" ? (
          <div>
            <dt>Metadata</dt>
            <dd>{referenceMetadataLabel(reference)}</dd>
          </div>
        ) : null}
        {snapshot?.contentType ? (
          <div>
            <dt>Type</dt>
            <dd>{snapshot.contentType}</dd>
          </div>
        ) : null}
        {reference.publishedAt ? (
          <div>
            <dt>Published</dt>
            <dd>{new Date(reference.publishedAt).toLocaleString()}</dd>
          </div>
        ) : null}
        <div>
          <dt>Captured</dt>
          <dd>{new Date(reference.capturedAt).toLocaleString()}</dd>
        </div>
        {snapshot?.metadataFetchedAt ? (
          <div>
            <dt>Checked</dt>
            <dd>{new Date(snapshot.metadataFetchedAt).toLocaleString()}</dd>
          </div>
        ) : null}
        {reference.lastOpenedAt ? (
          <div>
            <dt>Opened</dt>
            <dd>{new Date(reference.lastOpenedAt).toLocaleString()}</dd>
          </div>
        ) : null}
        <div>
          <dt>Asset</dt>
          <dd>{assetLabel(asset, reference.kind)}</dd>
        </div>
      </dl>

      {referenceMode(reference.kind) === "links" ? (
        <div className="metadata-refresh">
          <button
            type="button"
            className="button ghost full-width"
            onClick={() => void handleRefreshMetadata()}
            disabled={refreshingMetadata}
          >
            {refreshingMetadata ? "Refreshing metadata…" : "Refresh link metadata"}
          </button>
          {metadataMessage ? <p aria-live="polite">{metadataMessage}</p> : null}
        </div>
      ) : null}

      {snapshot ? <SourceContext snapshot={snapshot} /> : null}

      <div className="triage-actions" aria-label="Reference workflow actions">
        {collection === "trash" || collection === "archive" ? (
          <button
            type="button"
            className="button secondary full-width"
            onClick={() => void onMove(reference._id, "restore")}
          >
            {collection === "trash" ? "Restore to Inbox" : "Restore to Library"}
          </button>
        ) : (
          <>
            {collection !== "library" ? (
              <button
                type="button"
                className="button primary"
                onClick={() => void onMove(reference._id, "keep")}
              >
                Keep
              </button>
            ) : null}
            {collection !== "later" ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => void onMove(reference._id, "later")}
              >
                Later
              </button>
            ) : null}
            <button
              type="button"
              className="button ghost"
              onClick={() => void onMove(reference._id, "archive")}
            >
              Archive
            </button>
          </>
        )}
      </div>

      <div className="inspector-fields">
        <label>
          Title
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            placeholder="Name this reference"
          />
        </label>
        <label>
          Why did you save this?
          <textarea
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            placeholder="Pose, lighting, palette, an idea worth revisiting…"
            rows={4}
          />
        </label>
        <button
          type="button"
          className="button secondary full-width"
          onClick={handleSave}
          disabled={!isDirty || savingDetails}
        >
          {savingDetails ? "Saving…" : "Save details"}
        </button>
      </div>
      <div className="inspector-actions">
        <a
          className="button primary full-width"
          href={reference.sourceUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => void onOpen(reference)}
        >
          Open source ↗
        </a>
        <div className="action-row">
          {reference.authorUrl ? (
            <a
              className="button ghost"
              href={reference.authorUrl}
              target="_blank"
              rel="noreferrer"
            >
              Creator
            </a>
          ) : null}
          {asset?.driveWebViewLink ? (
            <a
              className="button ghost"
              href={asset.driveWebViewLink}
              target="_blank"
              rel="noreferrer"
            >
              Drive
            </a>
          ) : null}
          {imageUrl ? (
            <a
              className="button ghost"
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
            >
              {asset ? "Image" : "Preview"}
            </a>
          ) : null}
        </div>
        {collection !== "trash" ? (
          <button
            type="button"
            className="button danger full-width"
            onClick={() => void onMove(reference._id, "trash")}
          >
            Move to Trash
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SourceContext({ snapshot }: { snapshot: ReferenceSourceSnapshot }) {
  const entries = [
    snapshot.description
      ? { label: "Page description", value: snapshot.description }
      : undefined,
    snapshot.postText ? { label: "Post text", value: snapshot.postText } : undefined,
    snapshot.altText ? { label: "Image description", value: snapshot.altText } : undefined,
    snapshot.selectedText
      ? { label: "Selected quotation", value: snapshot.selectedText }
      : undefined,
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry));

  if (entries.length === 0) return null;

  return (
    <section className="source-context" aria-label="Captured source context">
      <p className="eyebrow">Source context</p>
      {entries.map((entry) => (
        <details key={entry.label} open={entries.length === 1}>
          <summary>{entry.label}</summary>
          {entry.label === "Selected quotation" ? (
            <blockquote>{entry.value}</blockquote>
          ) : (
            <p>{entry.value}</p>
          )}
        </details>
      ))}
    </section>
  );
}

function resolveConvexSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) return undefined;
  return convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");
}
