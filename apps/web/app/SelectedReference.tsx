"use client";

import { useState } from "react";
import {
  assetLabel,
  referenceCollection,
  referenceCollectionLabel,
  referenceMode,
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
  const imageUrl = asset?.storedUrl ?? asset?.originalUrl;
  const collection = referenceCollection(reference);
  const [titleDraft, setTitleDraft] = useState(reference.title ?? "");
  const [notesDraft, setNotesDraft] = useState(reference.notes ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
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

  return (
    <div className="selected-reference">
      {imageUrl && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="selected-image"
          src={imageUrl}
          alt={reference.title ?? "Selected reference"}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div
          className={`selected-placeholder ${referenceMode(reference.kind) === "links" ? "link-placeholder" : ""}`}
        >
          {referenceMode(reference.kind) === "links" ? (
            <span>{getInitial(reference.title)}</span>
          ) : null}
        </div>
      )}
      <div className="inspector-heading">
        <div>
          <p className="inspector-domain">{getDomain(reference.sourceUrl)}</p>
          <h2>{reference.title || "Untitled reference"}</h2>
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
        <div>
          <dt>Platform</dt>
          <dd>{reference.platform}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>{new Date(reference.capturedAt).toLocaleString()}</dd>
        </div>
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
              Image
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
