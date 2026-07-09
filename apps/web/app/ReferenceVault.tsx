"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ReferenceAsset = {
  _id: string;
  originalUrl?: string;
  storedUrl?: string | null;
  storageProvider?: "google_drive" | "convex" | "linked";
  driveFileId?: string;
  driveWebViewLink?: string;
  width?: number;
  height?: number;
};

type SavedReference = {
  _id: string;
  kind: string;
  title?: string;
  sourceUrl: string;
  platform: string;
  capturedAt: number;
  assets: ReferenceAsset[];
};

type ReferencesResponse = {
  ok: boolean;
  references?: SavedReference[];
  error?: string;
};

const projectShelves = [
  "Current study",
  "Character ideas",
  "Color language",
  "CSP handoff",
];

export function ReferenceVault() {
  const siteUrl = useMemo(resolveConvexSiteUrl, []);
  const [references, setReferences] = useState<SavedReference[]>([]);
  const [status, setStatus] = useState("Loading saved references…");
  const [refreshKey, setRefreshKey] = useState(0);
  const [sourceUrl, setSourceUrl] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [activeShelf, setActiveShelf] = useState(projectShelves[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filteredReferences = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return references;

    return references.filter((reference) => {
      return [reference.title, reference.sourceUrl, reference.platform, reference.kind]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [query, references]);

  const selectedReference =
    references.find((reference) => reference._id === selectedId) ?? filteredReferences[0];

  useEffect(() => {
    if (!siteUrl) {
      setStatus("Add NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_SITE_URL to load saved references.");
      return;
    }

    let cancelled = false;

    async function loadReferences() {
      try {
        const response = await fetch(`${siteUrl}/references`);
        const body = (await response.json()) as ReferencesResponse;

        if (cancelled) return;

        if (!response.ok || body.ok === false) {
          setStatus(body.error ?? response.statusText);
          return;
        }

        setReferences(body.references ?? []);
        setStatus(`Loaded ${body.references?.length ?? 0} saved references.`);
      } catch (error) {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : "Could not load saved references.");
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
      setStatus("Add a Convex site URL before saving.");
      return;
    }

    setIsSaving(true);
    setStatus("Saving reference…");

    try {
      const response = await fetch(`${siteUrl}/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: assetUrl.trim() ? "image" : "page",
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
        setStatus(body.error ?? response.statusText);
        return;
      }

      setSourceUrl("");
      setAssetUrl("");
      setPageTitle("");
      setRefreshKey((key) => key + 1);
      setStatus(`Saved reference. ${body.storageStatus ?? ""}`.trim());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save reference.");
    } finally {
      setIsSaving(false);
    }
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
        setStatus(body.error ?? response.statusText);
        return;
      }

      setReferences((items) => items.filter((item) => item._id !== referenceId));
      setSelectedId(null);
      setStatus("Reference removed from Reliquary. Original file kept.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete reference.");
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
          <h2>Add a reference</h2>
        </div>
        <label>
          Source URL
          <input
            required
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://example.com/post"
          />
        </label>
        <label>
          Image URL
          <input
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
            <p>{status}</p>
          </div>
        </aside>

        <section className="vault-main">
          <div className="vault-toolbar">
            <label>
              Search references
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="artist, source, lighting, x.com…"
              />
            </label>
            <div className="toolbar-actions">
              <button>Upload</button>
              <button>New board</button>
              <button>Export pack</button>
            </div>
          </div>

          <div className="result-summary">
            <strong>{filteredReferences.length}</strong> references · {activeShelf}
          </div>

          <section className="grid">
            {filteredReferences.length === 0 ? (
              <article className="empty-card">
                <h2>Your Reliquary is waiting.</h2>
                <p>Right-click an image in Edge, save it to Ourchival, then watch it appear here.</p>
              </article>
            ) : (
              filteredReferences.map((reference) => {
                const asset = reference.assets[0];
                const imageUrl = asset?.storedUrl ?? asset?.originalUrl;
                const isSelected = selectedReference?._id === reference._id;

                return (
                  <article
                    className={`card ${isSelected ? "selected" : ""}`}
                    key={reference._id}
                    onClick={() => setSelectedId(reference._id)}
                  >
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="thumb" src={imageUrl} alt={reference.title ?? "Saved reference"} />
                    ) : (
                      <div className="thumb placeholder" />
                    )}
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
            <SelectedReference reference={selectedReference} onDelete={deleteReference} />
          ) : (
            <p>Select a reference to view source, project use, and actions.</p>
          )}
        </aside>
      </section>
    </>
  );
}

function SelectedReference({
  reference,
  onDelete,
}: {
  reference: SavedReference;
  onDelete: (referenceId: string) => void;
}) {
  const asset = reference.assets[0];
  const imageUrl = asset?.storedUrl ?? asset?.originalUrl;

  return (
    <div className="selected-reference">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={reference.title ?? "Selected reference"} />
      ) : (
        <div className="selected-placeholder" />
      )}

      <h2>{reference.title || "Untitled reference"}</h2>
      <dl>
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
          <dd>{asset ? assetLabel(asset) : "Page only"}</dd>
        </div>
        {asset?.driveFileId ? (
          <div>
            <dt>Drive ID</dt>
            <dd>{asset.driveFileId}</dd>
          </div>
        ) : null}
      </dl>

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
        <button>Add to project</button>
        <button className="danger" onClick={() => onDelete(reference._id)}>
          Remove reference
        </button>
      </div>
    </div>
  );
}

function assetLabel(asset: ReferenceAsset) {
  if (asset.storageProvider === "google_drive") return "Google Drive original";
  if (asset.storageProvider === "convex") return "Convex fallback original";
  if (asset.storageProvider === "linked") return "Linked source URL";
  if (asset.storedUrl) return "Stored original";
  if (asset.originalUrl) return "Linked URL";
  return "Page only";
}

function resolveConvexSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) return undefined;

  return convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");
}
