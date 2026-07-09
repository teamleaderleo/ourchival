"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ReferenceAsset = {
  _id: string;
  originalUrl?: string;
  storedUrl?: string | null;
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

export function ReferenceVault() {
  const siteUrl = useMemo(resolveConvexSiteUrl, []);
  const [references, setReferences] = useState<SavedReference[]>([]);
  const [status, setStatus] = useState("Loading saved references…");
  const [refreshKey, setRefreshKey] = useState(0);
  const [sourceUrl, setSourceUrl] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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

      <section className="toolbar">
        <button>Upload reference</button>
        <button>New board</button>
        <button>Install clipper</button>
        <span>{status}</span>
      </section>

      <section className="grid">
        {references.length === 0 ? (
          <article className="empty-card">
            <h2>Your Reliquary is waiting.</h2>
            <p>Right-click an image in Edge, save it to Ourchival, then watch it appear here.</p>
          </article>
        ) : (
          references.map((reference) => {
            const asset = reference.assets[0];
            const imageUrl = asset?.storedUrl ?? asset?.originalUrl;

            return (
              <article className="card" key={reference._id}>
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumb" src={imageUrl} alt={reference.title ?? "Saved reference"} />
                ) : (
                  <div className="thumb placeholder" />
                )}
                <h2>{reference.title || reference.sourceUrl}</h2>
                <p>{reference.platform} · {new Date(reference.capturedAt).toLocaleString()}</p>
                <a href={reference.sourceUrl} target="_blank" rel="noreferrer">
                  Open source
                </a>
              </article>
            );
          })
        )}
      </section>
    </>
  );
}

function resolveConvexSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) return undefined;

  return convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");
}
