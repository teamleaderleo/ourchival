"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "../privateAccess";
import styles from "./missing.module.css";

type Outcome = "lead" | "no_match" | "confirmed_identity" | "ruled_out";
type Relationship = "same_artist" | "possible_same_image" | "archived_page";
const relationships: Record<Relationship, string> = {
  same_artist: "Same artist",
  possible_same_image: "Possible same image",
  archived_page: "Archived source page",
};
const outcomes: Record<Outcome, string> = {
  lead: "Possible match",
  no_match: "Checked — no match",
  confirmed_identity: "Confirmed identity",
  ruled_out: "Candidate ruled out",
};
type Item = {
  id: string;
  title?: string;
  sourceUrl: string;
  artist?: string;
  durablePages: number;
  expectedPages: number | null;
  lastOutcome: Outcome | null;
};
type Detail = {
  searchLinks?: { label: string; url: string }[];
  sourceUrl: string;
  title?: string;
  artist?: string;
  artistUrl?: string;
  snapshots: { title?: string; description?: string; capturedAt: number }[];
  moreSnapshots: boolean;
  checks: {
    _id: string;
    url: string;
    outcome: Outcome;
    evidence: string;
    relationship?: Relationship;
    createdAt: number;
  }[];
  moreChecks: boolean;
};
type Page = { items: Item[]; cursor: string; done: boolean; scanned: number };
function title(item: { title?: string; sourceUrl: string }) {
  return item.title?.trim() && !/^[-–—\s]+$/.test(item.title)
    ? item.title
    : `Artwork ${item.sourceUrl.match(/(?:artworks|status|pin)\/(\d+)/)?.[1] ?? "with missing images"}`;
}

async function fetchMissingPage(
  client: ConvexHttpClient,
  start: string | null,
): Promise<Page> {
  return await client.query(
    makeFunctionReference<"query">("missingWorks:list"),
    withOwnerAccess({ paginationOpts: { cursor: start, numItems: 48 } }),
  );
}

export function MissingWorks() {
  const pageInFlight = useRef(false);
  const client = useMemo(
    () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!),
    [],
  );
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [selected, setSelected] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const appendPage = useCallback((page: Page) => {
    setItems((old) =>
      Array.from(
        new Map(
          [...old, ...page.items].map((item) => [item.id, item]),
        ).values(),
      ),
    );
    setCursor(page.cursor);
    setDone(page.done);
    setScanned((n) => n + page.scanned);
  }, []);
  // Initial batch: the effect only subscribes to the fetch promise, so all
  // state updates land in async callbacks, never in the effect body.
  useEffect(() => {
    let cancelled = false;
    pageInFlight.current = true;
    fetchMissingPage(client, null).then(
      (page) => {
        pageInFlight.current = false;
        if (cancelled) return;
        appendPage(page);
        setLoading(false);
      },
      (e) => {
        pageInFlight.current = false;
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load missing works.");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, appendPage]);
  async function loadMore() {
    if (pageInFlight.current) return;
    pageInFlight.current = true;
    setLoading(true);
    setError("");
    try {
      appendPage(await fetchMissingPage(client, cursor));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load missing works.",
      );
    } finally {
      pageInFlight.current = false;
      setLoading(false);
    }
  }
  const markOutcome = useCallback((id: string, lastOutcome: Outcome) => {
    setItems((old) =>
      old.map((item) => (item.id === id ? { ...item, lastOutcome } : item)),
    );
  }, []);
  return (
    <main className={styles.workspace}>
      <header>
        <Link href="/">← Library</Link>
        <h1>Missing works</h1>
        <p>Identify missing images, preserve clues, and track archive leads.</p>
      </header>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <div className={styles.columns}>
        <section aria-label="Missing image queue">
          <p>
            {items.length} candidates found · {scanned} references checked
            {done ? " · End reached" : ""}
          </p>
          {!items.length ? (
            <p>
              {loading
                ? "Checking saved references…"
                : "No missing images in this batch. Continue checking older references."}
            </p>
          ) : null}
          <div className={styles.queue}>
            {items.map((item) => (
              <button
                key={item.id}
                aria-pressed={selected?.id === item.id}
                onClick={() => setSelected(item)}
              >
                <strong>{title(item)}</strong>
                <span>
                  {item.artist && !/^[-–—\s]+$/.test(item.artist)
                    ? item.artist
                    : "Artist not yet identified"}
                </span>
                <small>
                  {item.durablePages} image pages stored ·{" "}
                  {item.expectedPages == null
                    ? "total unknown"
                    : `${item.expectedPages} expected`}
                  {item.lastOutcome ? ` · ${outcomes[item.lastOutcome]}` : ""}
                </small>
              </button>
            ))}
          </div>
          {!done ? (
            <button
              className="button secondary"
              disabled={loading}
              onClick={() => void loadMore()}
            >
              {loading ? "Checking…" : "Check next 48 references"}
            </button>
          ) : null}
        </section>
        <section aria-label="Artwork research" className={styles.research}>
          {!selected ? (
            <>
              <h2>Follow the clues</h2>
              <p>
                Choose a missing work to inspect its saved history and record a
                lead.
              </p>
              <p>
                Artist galleries, booru entries, mirrored posts, and web
                archives can help establish identity. A gallery containing the
                artist’s work alone is not an exact-image match.
              </p>
            </>
          ) : (
            <WorkDetail
              key={selected.id}
              client={client}
              item={selected}
              onOutcome={markOutcome}
            />
          )}
        </section>
      </div>
    </main>
  );
}

// Keyed by artwork so selecting another work remounts with a clean form;
// no reset-on-select effect needed.
function WorkDetail({
  client,
  item,
  onOutcome,
}: {
  client: ConvexHttpClient;
  item: Item;
  onOutcome: (id: string, outcome: Outcome) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("lead");
  const [notice, setNotice] = useState("");
  const [relationship, setRelationship] = useState<Relationship | "">("");
  useEffect(() => {
    let cancelled = false;
    client
      .query(
        makeFunctionReference<"query">("missingWorks:detail"),
        withOwnerAccess({ referenceId: item.id }),
      )
      .then(
        (value) => {
          if (!cancelled) setDetail(value as Detail);
        },
        (e) => {
          if (!cancelled) setError(String(e));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [client, item.id]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await client.mutation(
        makeFunctionReference<"mutation">("missingWorks:recordCheck"),
        withOwnerAccess({ referenceId: item.id, url, evidence, outcome,
          ...(relationship ? { relationship } : {}) }),
      );
      const updated: Detail = await client.query(
        makeFunctionReference<"query">("missingWorks:detail"),
        withOwnerAccess({ referenceId: item.id }),
      );
      setDetail(updated);
      onOutcome(item.id, outcome);
      setUrl("");
      setEvidence("");
      setNotice(
        "Research saved. Original source and download status are unchanged.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save research.");
    } finally {
      setSaving(false);
    }
  }
  if (!detail) return <p>Loading saved history…</p>;
  return (
    <>
      <h2>{title(detail)}</h2>
      <a href={detail.sourceUrl} target="_blank" rel="noreferrer">
        Original source ↗
      </a>
      {detail.artist && !/^[-–—\s]+$/.test(detail.artist) ? <p>Artist: {detail.artist}</p> : <p>Artist not yet identified</p>}
      {detail.artistUrl ? (
        <a href={detail.artistUrl} target="_blank" rel="noreferrer">
          Saved artist profile ↗
        </a>
      ) : null}
      <details>
        <summary>Find alternate sources</summary>
        <p>Search links are starting points, not confirmed matches.</p>
        <ul>{detail.searchLinks?.map(link => (
          <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a></li>
        ))}</ul>
      </details>
      <details>
        <summary>
          Earlier saved metadata ({detail.snapshots.length}
          {detail.moreSnapshots ? "+" : ""})
        </summary>
        {detail.snapshots.map((snapshot, i) => (
          <div key={i} className={styles.check}>
            <time>
              {new Date(snapshot.capturedAt).toLocaleString()}
            </time>
            <p>{snapshot.title || "No title recorded"}</p>
            {snapshot.description ? (
              <p>{snapshot.description}</p>
            ) : null}
          </div>
        ))}
        {!detail.snapshots.length ? (
          <p>No earlier snapshots were saved.</p>
        ) : null}
      </details>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <form onSubmit={save}>
        <h3>Record a research check</h3>
        <label>
          Page checked or candidate link
          <input
            type="url"
            required
            maxLength={2048}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label>
          Connection to this work
          <select value={relationship} onChange={e => setRelationship(e.target.value as Relationship | "")}>
            <option value="">General research check</option>
            {Object.entries(relationships).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>
          Outcome
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as Outcome)}
          >
            {Object.entries(outcomes).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Evidence or what you checked
          <textarea
            required
            maxLength={4000}
            rows={4}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Matching source ID, caption, signature, or why this candidate does not match…"
          />
        </label>
        <p>
          Confirmation records your identity assessment. It does not
          download an image or prove its resolution.
        </p>
        <button className="button primary" disabled={saving}>
          {saving ? "Saving…" : "Save research"}
        </button>
      </form>
      {notice ? <p role="status">{notice}</p> : null}
      <h3>Research history</h3>
      {!detail.checks.length ? (
        <p>No places checked yet.</p>
      ) : (
        detail.checks.map((check) => (
          <article key={check._id} className={styles.check}>
            <strong>{outcomes[check.outcome]}</strong>
            {check.relationship ? <p>{relationships[check.relationship]}</p> : null}
            <p>
              <a href={check.url} target="_blank" rel="noreferrer">
                {check.url}
              </a>
            </p>
            <p>{check.evidence}</p>
            <time>{new Date(check.createdAt).toLocaleString()}</time>
          </article>
        ))
      )}
      {detail.moreChecks ? (
        <p>
          Showing the latest 100 checks. Older checks remain stored.
        </p>
      ) : null}
    </>
  );
}
