"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { BrandMark } from "./BrandMark";
import {
  attachDriveRepresentation,
  createArtwork,
  getArtworkDetail,
  linkArtworkPublicationByUrl,
  listArtworks,
  removeArtworkRepresentation,
  unlinkArtworkPublication,
  type Artwork,
  type ArtworkDetail,
  type ArtworkRepresentationKind,
  type ArtworkSourceApplication,
  type ArtworkStatus,
} from "./useArtworkCorpus";

type AttachMode = "drive" | "publication";

export function ArtworkCorpus() {
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ArtworkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newStatus, setNewStatus] = useState<ArtworkStatus>("finished");
  const [attachMode, setAttachMode] = useState<AttachMode>("drive");
  const [driveLocation, setDriveLocation] = useState("");
  const [driveFileName, setDriveFileName] = useState("");
  const [representationKind, setRepresentationKind] =
    useState<ArtworkRepresentationKind>("editable_source");
  const [sourceApplication, setSourceApplication] =
    useState<ArtworkSourceApplication>("procreate");
  const [publicationUrl, setPublicationUrl] = useState("");

  const selected = useMemo(
    () => artworks.find((artwork) => artwork._id === selectedId) ?? null,
    [artworks, selectedId],
  );

  useEffect(() => {
    void refreshArtworks(true);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setMessage("");
    void getArtworkDetail(selectedId)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((error) => {
        if (!cancelled) showError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function refreshArtworks(initial = false) {
    if (initial) setLoading(true);
    try {
      const next = await listArtworks();
      setArtworks(next);
      setSelectedId((current) => current || next[0]?._id || "");
      if (next.length === 0) setCreating(true);
    } catch (error) {
      showError(error);
    } finally {
      if (initial) setLoading(false);
    }
  }

  async function refreshSelected() {
    if (!selectedId) return;
    const [nextDetail, nextArtworks] = await Promise.all([
      getArtworkDetail(selectedId),
      listArtworks(),
    ]);
    setDetail(nextDetail);
    setArtworks(nextArtworks);
  }

  async function submitArtwork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTitle.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const artwork = await createArtwork({ title: newTitle, status: newStatus });
      const next = await listArtworks();
      setArtworks(next);
      setSelectedId(artwork._id);
      setNewTitle("");
      setCreating(false);
      showSuccess("Artwork added. Attach its best original or export next.");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function submitDrive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setMessage("");
    try {
      const driveFileId = parseDriveFileId(driveLocation);
      await attachDriveRepresentation({
        artworkId: selectedId,
        kind: representationKind,
        driveFileId,
        ...(driveFileName.trim() ? { fileName: driveFileName.trim() } : {}),
        sourceApplication,
      });
      setDriveLocation("");
      setDriveFileName("");
      await refreshSelected();
      showSuccess("Drive file attached to this artwork.");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function submitPublication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !publicationUrl.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await linkArtworkPublicationByUrl(
        selectedId,
        publicationUrl.trim(),
      );
      setPublicationUrl("");
      await refreshSelected();
      showSuccess(`Linked ${platformLabel(result.reference.platform)} publication.`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function removeRepresentation(representationId: string) {
    setBusy(true);
    try {
      await removeArtworkRepresentation(representationId);
      await refreshSelected();
      showSuccess("File link removed. The file itself was not deleted.");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function unlinkPublication(referenceId: string) {
    if (!selectedId) return;
    setBusy(true);
    try {
      await unlinkArtworkPublication(selectedId, referenceId);
      await refreshSelected();
      showSuccess("Publication link removed. The captured reference stays in Ourchival.");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function showSuccess(value: string) {
    setMessageTone("success");
    setMessage(value);
  }

  function showError(error: unknown) {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : "Ourchival could not complete that action.");
  }

  return (
    <main className="artwork-corpus-frame">
      <header className="artwork-corpus-header">
        <div className="brand-lockup">
          <BrandMark />
          <div>
            <p className="brand-name">Ourchival</p>
            <p className="brand-subtitle">Artwork corpus</p>
          </div>
        </div>
        <Link className="button ghost" href="/">
          Back to archive
        </Link>
      </header>

      <section className="artwork-corpus-intro">
        <div>
          <p className="eyebrow">Your work</p>
          <h1>Keep one identity for every artwork.</h1>
          <p>
            Connect editable originals, master exports, and the places you published
            them without duplicating the work itself.
          </p>
        </div>
        {!creating ? (
          <button className="button primary" type="button" onClick={() => setCreating(true)}>
            Add artwork
          </button>
        ) : null}
      </section>

      {creating ? (
        <form className="artwork-create-panel" onSubmit={submitArtwork}>
          <label>
            Artwork title
            <input
              autoFocus
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Pink Navia"
              maxLength={160}
            />
          </label>
          <label>
            State
            <select
              value={newStatus}
              onChange={(event) => setNewStatus(event.target.value as ArtworkStatus)}
            >
              <option value="finished">Finished</option>
              <option value="wip">In progress</option>
              <option value="study">Study</option>
              <option value="abandoned">Abandoned</option>
            </select>
          </label>
          <button className="button primary" disabled={busy || !newTitle.trim()}>
            {busy ? "Adding…" : "Create artwork"}
          </button>
          {artworks.length > 0 ? (
            <button className="button ghost" type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          ) : null}
        </form>
      ) : null}

      {message ? (
        <p className={`artwork-corpus-message ${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>
          {message}
        </p>
      ) : null}

      {loading ? (
        <section className="artwork-corpus-empty">
          <h2>Opening your artwork corpus…</h2>
        </section>
      ) : artworks.length === 0 && !creating ? (
        <section className="artwork-corpus-empty">
          <h2>Add your first artwork.</h2>
          <p>Start with one finished piece that already has a Procreate, Clip Studio, or master image file.</p>
          <button className="button primary" type="button" onClick={() => setCreating(true)}>
            Add artwork
          </button>
        </section>
      ) : artworks.length > 0 ? (
        <div className="artwork-corpus-workspace">
          <aside className="artwork-list" aria-label="Artworks">
            <p className="eyebrow">Corpus</p>
            <div className="artwork-list-items">
              {artworks.map((artwork) => (
                <button
                  key={artwork._id}
                  type="button"
                  className={artwork._id === selectedId ? "artwork-list-item selected" : "artwork-list-item"}
                  onClick={() => setSelectedId(artwork._id)}
                >
                  <strong>{artwork.title}</strong>
                  <span>{statusLabel(artwork.status)}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="artwork-detail">
            {selected && detail ? (
              <>
                <div className="artwork-detail-heading">
                  <div>
                    <p className="eyebrow">{statusLabel(selected.status)}</p>
                    <h2>{selected.title}</h2>
                  </div>
                </div>

                <div className="artwork-attach-switch" role="group" aria-label="What to connect">
                  <button
                    type="button"
                    className={attachMode === "drive" ? "active" : ""}
                    onClick={() => setAttachMode("drive")}
                  >
                    Original or export
                  </button>
                  <button
                    type="button"
                    className={attachMode === "publication" ? "active" : ""}
                    onClick={() => setAttachMode("publication")}
                  >
                    Published post
                  </button>
                </div>

                {attachMode === "drive" ? (
                  <form className="artwork-attach-form" onSubmit={submitDrive}>
                    <div className="artwork-form-copy">
                      <h3>Attach a Drive file</h3>
                      <p>Paste the Drive URL you already have open, or its file ID. Ourchival records the relationship; it does not move the file.</p>
                    </div>
                    <label className="artwork-wide-field">
                      Drive URL or file ID
                      <input
                        value={driveLocation}
                        onChange={(event) => setDriveLocation(event.target.value)}
                        placeholder="https://drive.google.com/file/d/…"
                      />
                    </label>
                    <label>
                      Role
                      <select
                        value={representationKind}
                        onChange={(event) => setRepresentationKind(event.target.value as ArtworkRepresentationKind)}
                      >
                        <option value="editable_source">Editable original</option>
                        <option value="master_export">Master export</option>
                        <option value="web_derivative">Web derivative</option>
                      </select>
                    </label>
                    <label>
                      Made in
                      <select
                        value={sourceApplication}
                        onChange={(event) => setSourceApplication(event.target.value as ArtworkSourceApplication)}
                      >
                        <option value="procreate">Procreate</option>
                        <option value="clip_studio_paint">Clip Studio Paint</option>
                        <option value="blender">Blender</option>
                        <option value="photoshop">Photoshop</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="artwork-wide-field">
                      File label <span>optional</span>
                      <input
                        value={driveFileName}
                        onChange={(event) => setDriveFileName(event.target.value)}
                        placeholder="Pink Navia.procreate"
                      />
                    </label>
                    <button className="button primary" disabled={busy || !driveLocation.trim()}>
                      {busy ? "Attaching…" : "Attach Drive file"}
                    </button>
                  </form>
                ) : (
                  <form className="artwork-attach-form publication-form" onSubmit={submitPublication}>
                    <div className="artwork-form-copy">
                      <h3>Link a captured publication</h3>
                      <p>Paste the X, Pixiv, Instagram, HoYoLAB, or other source URL. The post must already exist in Ourchival.</p>
                    </div>
                    <label className="artwork-wide-field">
                      Publication URL
                      <input
                        type="url"
                        value={publicationUrl}
                        onChange={(event) => setPublicationUrl(event.target.value)}
                        placeholder="https://x.com/TeamLeaderLeo/status/…"
                      />
                    </label>
                    <button className="button primary" disabled={busy || !publicationUrl.trim()}>
                      {busy ? "Linking…" : "Link publication"}
                    </button>
                  </form>
                )}

                <div className="artwork-linked-sections">
                  <section>
                    <div className="artwork-section-heading">
                      <h3>Files</h3>
                      <span>{detail.representations.length}</span>
                    </div>
                    {detail.representations.length ? (
                      <div className="artwork-linked-list">
                        {detail.representations.map((representation) => (
                          <article key={representation._id}>
                            <div>
                              <strong>{representation.fileName || representationLabel(representation.kind)}</strong>
                              <span>
                                {representationLabel(representation.kind)}
                                {representation.sourceApplication ? ` · ${applicationLabel(representation.sourceApplication)}` : ""}
                              </span>
                            </div>
                            <button
                              className="button ghost"
                              type="button"
                              disabled={busy}
                              onClick={() => void removeRepresentation(representation._id)}
                            >
                              Unlink
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="artwork-section-empty">No original or export connected yet.</p>
                    )}
                  </section>

                  <section>
                    <div className="artwork-section-heading">
                      <h3>Publications</h3>
                      <span>{detail.publications.length}</span>
                    </div>
                    {detail.publications.length ? (
                      <div className="artwork-linked-list">
                        {detail.publications.map((publication) => (
                          <article key={publication._id}>
                            <div>
                              <strong>{publication.reference?.title || platformLabel(publication.reference?.platform || "source")}</strong>
                              {publication.reference ? (
                                <a href={publication.reference.canonicalUrl || publication.reference.sourceUrl} target="_blank" rel="noreferrer">
                                  Open {platformLabel(publication.reference.platform)} source
                                </a>
                              ) : (
                                <span>Captured reference is unavailable</span>
                              )}
                            </div>
                            {publication.reference ? (
                              <button
                                className="button ghost"
                                type="button"
                                disabled={busy}
                                onClick={() => void unlinkPublication(publication.reference!.id)}
                              >
                                Unlink
                              </button>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="artwork-section-empty">No published post linked yet.</p>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <div className="artwork-corpus-empty compact">
                <h2>Select an artwork.</h2>
                <p>Then attach its best original or a captured publication.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function parseDriveFileId(value: string) {
  const cleaned = value.trim();
  if (!cleaned) throw new Error("Paste a Google Drive file URL or file ID.");
  if (!cleaned.includes("/")) return cleaned.slice(0, 512);
  try {
    const url = new URL(cleaned);
    const queryId = url.searchParams.get("id")?.trim();
    if (queryId) return queryId.slice(0, 512);
    const match = /\/d\/([^/?#]+)/.exec(url.pathname);
    if (match?.[1]) return decodeURIComponent(match[1]).slice(0, 512);
  } catch {
    throw new Error("That does not look like a Google Drive file URL or ID.");
  }
  throw new Error("Could not find a file ID in that Google Drive URL.");
}

function statusLabel(value: ArtworkStatus) {
  if (value === "wip") return "In progress";
  if (value === "study") return "Study";
  if (value === "abandoned") return "Abandoned";
  return "Finished";
}

function representationLabel(value: ArtworkRepresentationKind) {
  if (value === "editable_source") return "Editable original";
  if (value === "master_export") return "Master export";
  return "Web derivative";
}

function applicationLabel(value: ArtworkSourceApplication) {
  if (value === "clip_studio_paint") return "Clip Studio Paint";
  if (value === "procreate") return "Procreate";
  if (value === "blender") return "Blender";
  if (value === "photoshop") return "Photoshop";
  return "Other";
}

function platformLabel(value: string) {
  if (value === "x") return "X";
  if (value === "pixiv") return "Pixiv";
  if (value === "instagram") return "Instagram";
  if (value === "hoyolab") return "HoYoLAB";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
