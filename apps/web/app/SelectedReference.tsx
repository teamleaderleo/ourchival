"use client";

import { useState } from "react";
import {
  assetLabel,
  referenceMode,
  type SavedReference,
} from "./referenceVaultModel";
import { getDomain, getInitial } from "./ReferenceCards";

export function SelectedReference({
  reference,
  onDelete,
  onToggleFavorite,
  onSaveDetails,
}: {
  reference: SavedReference;
  onDelete: (referenceId: string) => void;
  onToggleFavorite: (reference: SavedReference) => void;
  onSaveDetails: (
    referenceId: string,
    patch: { title?: string; notes?: string },
  ) => Promise<boolean>;
}) {
  const asset = reference.assets[0];
  const imageUrl = asset?.storedUrl ?? asset?.originalUrl;
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
          <dt>Platform</dt>
          <dd>{reference.platform}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>{new Date(reference.capturedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Asset</dt>
          <dd>{assetLabel(asset, reference.kind)}</dd>
        </div>
      </dl>
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
        <button
          type="button"
          className="button danger full-width"
          onClick={() => onDelete(reference._id)}
        >
          Remove reference
        </button>
      </div>
    </div>
  );
}
