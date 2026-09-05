"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "../privateAccess";
import { buildCatalogExport, type CatalogPage } from "./catalogExport";
import styles from "./catalogExport.module.css";

type Collection = "inbox" | "library" | "later" | "archive";
type QueryArgs = {
  accessKey: string;
  cursor?: string;
  limit: number;
  sessionKey?: string;
  platform?: string;
  collection?: Collection;
};
const findCatalog = makeFunctionReference<"query", QueryArgs, CatalogPage>(
  "catalog:find",
);

export function CatalogExportPanel() {
  const [collection, setCollection] = useState<Collection | "">("");
  const [platform, setPlatform] = useState("");
  const [sessionKey, setSessionKey] = useState("");
  const [resumeCursor, setResumeCursor] = useState("");
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [fromCursor, setFromCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function changed() {
    setPage(null);
    setResumeCursor("");
    setError("");
  }
  async function load(cursor?: string) {
    setBusy(true);
    setError("");
    try {
      const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
      if (!url) throw new Error("The archive connection is not configured.");
      const result = await new ConvexHttpClient(url, {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
      }).query(
        findCatalog,
        withOwnerAccess({
          limit: 25,
          ...(cursor ? { cursor } : {}),
          ...(collection ? { collection } : {}),
          ...(platform ? { platform } : {}),
          ...(sessionKey.trim() ? { sessionKey: sessionKey.trim() } : {}),
        }),
      );
      setPage(result);
      setFromCursor(cursor ?? null);
    } catch {
      setError(
        "Could not read the catalog. Check the archive connection and query filters, then retry. Downloaded receipts remain usable.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    if (!page) return;
    try {
      const result = await buildCatalogExport(page, fromCursor);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ourchival-catalog-${result.manifest.sha256.slice(0, 12)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(
        "Could not create the download. Your page is still available; retry the download.",
      );
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void load(resumeCursor || undefined);
  }

  return (
    <main className={styles.page}>
      <Link href="/">← Back to archive</Link>
      <p className="eyebrow">Agent access</p>
      <h1>Export a small catalog slice</h1>
      <p>
        Choose what to share with ChatGPT or Codex. Each page checks up to 25
        references.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className={styles.filters}>
          <label>
            Collection
            <select
              value={collection}
              onChange={(e) => {
                changed();
                setCollection(e.target.value as Collection | "");
              }}
            >
              <option value="">All except Trash</option>
              <option value="inbox">Inbox</option>
              <option value="library">Library</option>
              <option value="later">Later</option>
              <option value="archive">Archive</option>
            </select>
          </label>
          <label>
            Source
            <select
              value={platform}
              onChange={(e) => {
                changed();
                setPlatform(e.target.value);
              }}
            >
              <option value="">All sources</option>
              {["x", "pinterest", "pixiv", "discord", "manual", "generic"].map(
                (source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ),
              )}
            </select>
          </label>
          <details className={styles.advanced}>
            <summary>One import or resume a previous export</summary>
            <label>
              Import identity
              <input
                maxLength={256}
                value={sessionKey}
                onChange={(e) => {
                  changed();
                  setSessionKey(e.target.value);
                }}
                placeholder="Optional capture session key"
              />
            </label>
            <label>
              Continue from receipt
              <textarea
                maxLength={16384}
                value={resumeCursor}
                onChange={(e) => {
                  setPage(null);
                  setResumeCursor(e.target.value);
                }}
                placeholder="Paste nextCursor from a download, using the same filters"
              />
            </label>
          </details>
        </fieldset>
        <button className="button primary" disabled={busy} type="submit">
          {busy
            ? "Reading…"
            : resumeCursor
              ? "Resume export"
              : "Preview export"}
        </button>
      </form>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {page ? (
        <section aria-label="Export preview" className={styles.results}>
          <p role="status">
            <strong>{page.returned} matches</strong> · {page.scanned} checked ·{" "}
            {page.hasMore ? "more to check" : "end reached"}
          </p>
          <div className={styles.actions}>
            <button
              className="button secondary"
              onClick={() => void download()}
            >
              Download this page
            </button>
            {page.nextCursor ? (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void load(page.nextCursor!)}
              >
                Check next page
              </button>
            ) : null}
          </div>
          {!page.returned ? (
            <p>
              {page.hasMore
                ? "No matches in this page. Continue to check older references."
                : "No matches in this page. Change the filters to start again."}
            </p>
          ) : (
            <ul>
              {page.rows.map((row) => (
                <li key={row.id}>
                  <strong>
                    {String(row.title || row.sourceUrl || row.id)}
                  </strong>
                  <span>
                    {String(row.platform ?? "")} ·{" "}
                    {String(row.triageState ?? "")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.note}>
            A live text projection, not a backup. Downloads include a digest and
            continuation receipt. Long text is marked when shortened; originals,
            images and save occurrences remain in the archive. Nothing is sent
            to an agent automatically.
          </p>
        </section>
      ) : null}
    </main>
  );
}
