"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  assetLabel,
  filterReferences,
  getSelectedReference,
  referenceKindLabel,
  type ReferenceLane,
  type SavedReference,
} from "./referenceVaultModel";

type ReferencesResponse = {
  ok: boolean;
  references?: SavedReference[];
  error?: string;
};

type StatusTone = "info" | "success" | "error";

const projectShelves = [
  "Current study",
  "Character ideas",
  "Color language",
  "CSP handoff",
];

const lanes: Array<{ id: ReferenceLane; label: string }> = [
  { id: "all", label: "All" },
  { id: "images", label: "Images" },
  { id: "links", label: "Links" },
];

export function ReferenceVault() {
  const siteUrl = useMemo(resolveConvexSiteUrl, []);
  const [references, setReferences] = useState<SavedReference[]>([]);
  const [status, setStatus] = useState("Loading saved references…");
  const [statusTone, setStatusTone] = useState<StatusTone>("info");
  const [refreshKey, setRefreshKey] = useState(0);
  const [sourceUrl, setSourceUrl] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [lane, setLane] = useState<ReferenceLane>("all");
  const [activeShelf, setActiveShelf] = useState(projectShelves[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function report(message: string, tone: StatusTone = "info") {
    setStatus(message);
    setStatusTone(tone);
  }

  const filteredReferences = useMemo(
    () => filterReferences(references, { query, favoritesOnly, lane }),
    [query, references, favoritesOnly, lane],
  );

  const selectedReference = getSelectedReference(filteredReferences, selectedId);
  const favoriteCount = references.filter((reference) => reference.favorite).length;
  const imageCount = filterReferences(references, { lane: "images" }).length;
  const linkCount = filterReferences(references, { lane: "links" }).length;

  useEffect(() => {
    if (!siteUrl) {
      report(
        "Add NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_SITE_URL to load saved references.",
        "error",
      );
      return;
    }

    let cancelled = false;

    async function loadReferences() {
      try {
        const response = await fetch(`${siteUrl}/references`);
        const body = (await response.json()) as ReferencesResponse;

        if (cancelled) return;

        if (!response.ok || body.ok === false) {
          report(body.error ?? response.statusText, "error");
          return;
        }

        setReferences(body.references ?? []);
        report(`Loaded ${body.references?.length ?? 0} saved references.`, "info");
      } catch (error) {
        if (cancelled) return;
        report(error instanceof Error ? error.message : "Could not load saved references.", "error");
      }
    }

    void loadReferences();

    const timer = window.setInterval(loadReferences, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [siteUrl, refreshKey]);

  async function saveManualReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!siteUrl) {
      report("Add a Convex site URL before saving.", "error");
      return;
    }

    setIsSaving(true);
    report("Saving reference…", "info");

    try {
      const response = await fetch(`${siteUrl}/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: assetUrl.trim() ? "image" : "link",
          sourceUrl,
          assetUrl,
          pageTitle,
          capturedAt: new Date().toISOString(),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        storageStatus?: string;
      };

      if (!response.ok || body.ok === false) {
        report(body.error ?? response.statusText, "error");
        return;
      }

      setSourceUrl("");
      setAssetUrl("");
      setPageTitle("");
      setRefreshKey((key) => key + 1);
      report(`Saved reference. ${body.storageStatus ?? ""}`.trim(), "success");
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not save reference.", "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function patchReference(referenceId: string, patch: Partial<SavedReference>) {
    if (!siteUrl) {
      report("Add a Convex site URL before editing.", "error");
      return false;
    }

    try {
      const response = await fetch(`${siteUrl}/reference?id=${encodeURIComponent(referenceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

      if (!response.ok || body.ok === false) {
        report(body.error ?? response.statusText, "error");
        return false;
      }

      setReferences((items) =>
        items.map((item) => (item._id === referenceId ? { ...item, ...patch } : item)),
      );
      return true;
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not update reference.", "error");
      return false;
    }
  }

  async function toggleFavorite(reference: SavedReference) {
    const next = !reference.favorite;
    const ok = await patchReference(reference._id, { favorite: next });
    if (ok) {
      report(next ? "Marked as favorite." : "Removed from favorites.", "success");
    }
  }

  async function saveDetails(referenceId: string, patch: { title?: string; notes?: string }) {
    const ok = await patchReference(referenceId, patch);
    if (ok) report("Reference details saved.", "success");
    return ok;
  }

  async function deleteReference(referenceId: string) {
    if (!siteUrl) return;

    const confirmed = window.confirm("Remove this reference from Reliquary? The original Drive file is kept.");
    if (!confirmed) return;

    try {
      const response = await fetch(`${siteUrl}/reference?id=${encodeURIComponent(referenceId)}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

      if (!response.ok || body.ok === false) {
        report(body.error ?? response.statusText, "error");
        return;
      }

      setReferences((items) => items.filter((item) => item._id !== referenceId));
      setSelectedId(null);
      report("Reference removed from Reliquary. Original file kept.", "success");
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not delete reference.", "error");
    }
  }

  return (
    <>
      <section className="endpoint-panel">
        <div>
          <p className="eyebrow">Clipper endpoint</p>
          <code>{siteUrl ? `${siteUrl}/capture` : "Missing Convex site URL"}</code>
        </div>
        <p>
          Paste this into the Edge extension popup. The gallery refreshes every few seconds while your dev server is open.
        </p>
      </section>

      <form className="manual-capture" onSubmit={saveManualReference}>
        <div>
          <p className="eyebrow">Manual save</p>
          <h2>Add a reference or link</h2>
        </div>
        <label>
          Source URL
          <input
            required
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://example.com/post-or-article"
          />
        </label>
        <label>
          Image URL optional
          <input
            type="url"
            value={assetUrl}
            onChange={(event) => setAssetUrl(event.target.value)}
            placeholder="https://example.com/image.jpg"
          />
        </label>
        <label>
          Title
          <input
            value={pageTitle}
            onChange={(event) => setPageTitle(event.target.value)}
            placeholder="Optional title"
          />
        </label>
        <button disabled={isSaving}>{isSaving ? "Saving…" : "Save reference"}</button>
      </form>

      <section className="vault-workspace">
        <aside className="vault-sidebar">
          <p className="eyebrow">Projects</p>
          <div className="shelf-list">
            {projectShelves.map((shelf) => (
              <button
                type="button"
                className={shelf === activeShelf ? "active" : ""}
                key={shelf}
                onClick={() => setActiveShelf(shelf)}
              >
                {shelf}
              </button>
            ))}
          </div>

          <div className="sidebar-block">
            <p className="eyebrow">Status</p>
            <p className={`status-line status-${statusTone}`}>{status}</p>
          </div>
        </aside>

        <section className="vault-main">
          <div className="vault-toolbar">
            <label>
              Search Ourchival
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="artist, source, lighting, article, domain…"
              />
            </label>
            <div className="toolbar-actions">
              <div className="segmented" aria-label="Reference lane">
                {lanes.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={lane === item.id ? "active" : ""}
                    aria-pressed={lane === item.id}
                    onClick={() => setLane(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`pill-toggle ${favoritesOnly ? "active" : ""}`}
                aria-pressed={favoritesOnly}
                onClick={() => setFavoritesOnly((value) => !value)}
              >
                {favoritesOnly ? "★ Favorites" : "☆ Favorites"}
                {favoriteCount > 0 ? ` (${favoriteCount})` : ""}
              </button>
              <button type="button" disabled title="Not wired up yet">
                Upload
              </button>
              <button type="button" disabled title="Not wired up yet">
                New board
              </button>
              <button type="button" disabled title="Not wired up yet">
                Export pack
              </button>
            </div>
          </div>

          <div className="result-summary">
            <strong>{filteredReferences.length}</strong> shown · {references.length} total · {imageCount} images · {linkCount} links
            {favoritesOnly ? " · favorites only" : ""}
          </div>

          <section className="grid">
            {filteredReferences.length === 0 ? (
              <article className="empty-card">
                <h2>{favoritesOnly || query ? "No matching saves." : "Your Ourchival is waiting."}</h2>
                <p>
                  {favoritesOnly || query
                    ? "Try clearing search, favorites, or the active lane."
                    : "Right-click an image, link, or page in Edge and save it to Ourchival."}
                </p>
              </article>
            ) : (
              filteredReferences.map((reference) => {
                const asset = reference.assets[0];
                const imageUrl = asset?.storedUrl ?? asset?.originalUrl;
                const isSelected = reference._id === selectedId;

                return (
                  <article
                    className={`card ${isSelected ? "selected" : ""}`}
                    key={reference._id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedId(reference._id)}
                    onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(reference._id);
                      }
                    }}
                  >
                    <div className="thumb-wrap">
                      <ThumbImage imageUrl={imageUrl} title={reference.title} kind={reference.kind} />
                      <span className="kind-badge">{referenceKindLabel(reference.kind)}</span>
                      <button
                        type="button"
                        className={`favorite-toggle ${reference.favorite ? "active" : ""}`}
                        aria-label={reference.favorite ? "Remove from favorites" : "Add to favorites"}
                        aria-pressed={Boolean(reference.favorite)}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleFavorite(reference);
                        }}
                      >
                        {reference.favorite ? "★" : "☆"}
                      </button>
                    </div>
                    <h2>{reference.title || reference.sourceUrl}</h2>
                    <p>{reference.platform} · {new Date(reference.capturedAt).toLocaleString()}</p>
                  </article>
                );
              })
            )}
          </section>
        </section>

        <aside className="inspector">
          <p className="eyebrow">Inspector</p>
          {selectedReference ? (
            <SelectedReference
              key={selectedReference._id}
              reference={selectedReference}
              onDelete={deleteReference}
              onToggleFavorite={toggleFavorite}
              onSaveDetails={saveDetails}
            />
          ) : (
            <p>Select a reference to view source, project use, and actions.</p>
          )}
        </aside>
      </section>
    </>
  );
}

function ThumbImage({ imageUrl, title, kind }: { imageUrl?: string | null; title?: string; kind: string }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return <div className={`thumb placeholder ${kind === "link" || kind === "article" || kind === "page" ? "link-placeholder" : ""}`} aria-hidden={!title} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="thumb"
      src={imageUrl}
      alt={title ?? "Saved reference"}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function SelectedReference({
  reference,
  onDelete,
  onToggleFavorite,
  onSaveDetails,
}: {
  reference: SavedReference;
  onDelete: (referenceId: string) => void;
  onToggleFavorite: (reference: SavedReference) => void;
  onSaveDetails: (referenceId: string, patch: { title?: string; notes?: string }) => Promise<boolean>;
}) {
  const asset = reference.assets[0];
  const imageUrl = asset?.storedUrl ?? asset?.originalUrl;

  const [titleDraft, setTitleDraft] = useState(reference.title ?? "");
  const [notesDraft, setNotesDraft] = useState(reference.notes ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const isDirty =
    titleDraft.trim() !== (reference.title ?? "") || notesDraft.trim() !== (reference.notes ?? "");

  async function handleSave() {
    setSavingDetails(true);
    await onSaveDetails(reference._id, { title: titleDraft.trim(), notes: notesDraft.trim() });
    setSavingDetails(false);
  }

  return (
    <div className="selected-reference">
      {imageUrl && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={reference.title ?? "Selected reference"}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className={`selected-placeholder ${reference.kind === "link" || reference.kind === "article" || reference.kind === "page" ? "link-placeholder" : ""}`} />
      )}

      <div className="inspector-heading">
        <h2>{reference.title || "Untitled reference"}</h2>
        <button
          type="button"
          className={`favorite-toggle inline ${reference.favorite ? "active" : ""}`}
          aria-label={reference.favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={Boolean(reference.favorite)}
          onClick={() => onToggleFavorite(reference)}
        >
          {reference.favorite ? "★" : "☆"}
        </button>
      </div>

      <dl>
        <div>
          <dt>Kind</dt>
          <dd>{referenceKindLabel(reference.kind)}</dd>
        </div>
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
        {asset?.driveFileId ? (
          <div>
            <dt>Drive ID</dt>
            <dd>{asset.driveFileId}</dd>
          </div>
        ) : null}
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
          Notes
          <textarea
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            placeholder="Lighting, palette, why you saved it, why this tab survived…"
            rows={3}
          />
        </label>
        <button type="button" onClick={handleSave} disabled={!isDirty || savingDetails}>
          {savingDetails ? "Saving…" : "Save details"}
        </button>
      </div>

      <div className="inspector-actions">
        <a href={reference.sourceUrl} target="_blank" rel="noreferrer">
          Open source
        </a>
        {asset?.driveWebViewLink ? (
          <a href={asset.driveWebViewLink} target="_blank" rel="noreferrer">
            Open in Drive
          </a>
        ) : null}
        {imageUrl ? (
          <a href={imageUrl} target="_blank" rel="noreferrer">
            Open image
          </a>
        ) : null}
        <button type="button" disabled title="Not wired up yet">
          Add to project
        </button>
        <button type="button" className="danger" onClick={() => onDelete(reference._id)}>
          Remove reference
        </button>
      </div>
    </div>
  );
}

function resolveConvexSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) return undefined;

  return convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");
}
