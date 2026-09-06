"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "./privateAccess";

export type CommunityItem = {
  postId: number;
  postUrl: string;
  sourceUrl?: string;
  pixivId?: string;
  state: "current" | "stale";
  correctionRevision: number;
  tagCount: number;
  tags: Array<{
    code: number;
    name: string;
    category: string;
    hidden: boolean;
  }>;
};
type Result = { items: CommunityItem[]; truncated: boolean };
const inspect = makeFunctionReference<
  "query",
  { accessKey: string; assetId: string },
  Result
>("communityTags:inspect");
const setHidden = makeFunctionReference<
  "mutation",
  {
    accessKey: string;
    assetId: string;
    code: number;
    hidden: boolean;
    expectedRevision: number;
  },
  { revision: number }
>("communityTags:setHidden");
let client: ConvexHttpClient | undefined;
function connection() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Archive unavailable");
  return (client ??= new ConvexHttpClient(url));
}

export function safeCommunitySource(value?: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* No usable link. */
  }
}

export function ReferenceCommunityTags({
  assetId,
  sealed = false,
}: {
  assetId: string;
  sealed?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const serial = useRef(0);
  const load = useCallback(async () => {
    const request = ++serial.current;
    try {
      const result = await connection().query(
        inspect,
        withOwnerAccess({ assetId }),
      );
      if (request === serial.current) {
        setData(result);
        setMessage("");
      }
      return true;
    } catch {
      if (request === serial.current) {
        setData(null);
        setMessage("Could not load source tags. Try again.");
      }
      return false;
    }
  }, [assetId]);
  useEffect(() => {
    const requests = serial;
    if (!sealed || revealed) void load();
    return () => {
      requests.current++;
    };
  }, [load, sealed, revealed]);
  async function toggle(item: CommunityItem, code: number, hidden: boolean) {
    setBusy(true);
    setMessage("");
    try {
      await connection().mutation(
        setHidden,
        withOwnerAccess({
          assetId,
          code,
          hidden,
          expectedRevision: item.correctionRevision,
        }),
      );
      const loaded = await load();
      setMessage(
        loaded
          ? hidden
            ? "Hidden from Danbooru search."
            : "Restored to Danbooru search."
          : "Saved, but tags could not be refreshed. Reload before editing again.",
      );
    } catch {
      await load();
      setMessage(
        "Could not confirm the change. Review the current tags and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (sealed && !revealed)
    return (
      <section className="community-tags">
        <button
          type="button"
          className="button ghost"
          onClick={() => setRevealed(true)}
        >
          Show source tags
        </button>
      </section>
    );
  if (data && !data.items.length && !message) return null;
  return (
    <section className="community-tags" aria-label="Danbooru source tags">
      {!data && !message ? <p role="status">Checking source tags…</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {message &&
      (!data ||
        message.includes("could not") ||
        message.includes("Could not")) ? (
        <button
          className="button ghost"
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >
          Reload source tags
        </button>
      ) : null}
      {data?.items.map((item) => (
        <CommunityTagList
          key={item.postId}
          item={item}
          disabled={busy}
          onToggle={(code, hidden) => void toggle(item, code, hidden)}
        />
      ))}
      {data?.truncated ? <p>Showing the first four source matches.</p> : null}
    </section>
  );
}

const categories = [
  ["general", "Subject and details"],
  ["character", "Characters"],
  ["copyright", "Series"],
  ["artist", "Artists"],
  ["meta", "Source details"],
] as const;
export function CommunityTagList({
  item,
  disabled,
  onToggle,
}: {
  item: CommunityItem;
  disabled: boolean;
  onToggle: (code: number, hidden: boolean) => void;
}) {
  const [filter, setFilter] = useState("");
  const visible = item.tags.filter((tag) => !tag.hidden);
  const summary = visible
    .filter((tag) => ["general", "character"].includes(tag.category))
    .slice(0, 6);
  const hiddenCount = item.tags.length - visible.length;
  const source = safeCommunitySource(item.sourceUrl);
  const label = (name: string) => name.replaceAll("_", " ");
  return (
    <div className="community-source">
      <div className="community-heading">
        <strong>Danbooru</strong>
        <a
          href={safeCommunitySource(item.postUrl)}
          target="_blank"
          rel="noreferrer"
        >
          Source ↗
        </a>
      </div>
      {item.state === "stale" ? (
        <p>
          Matched an earlier image version. These terms are excluded from
          search.
        </p>
      ) : (
        <>
          <p className="menu-hint">Matched to this image · community tags</p>
          <div className="community-summary">
            {summary.map((tag) => (
              <span key={tag.code}>{label(tag.name)}</span>
            ))}
          </div>
          {!visible.length ? (
            <p>All source terms are hidden from search.</p>
          ) : null}
        </>
      )}
      <details>
        <summary>
          Review {item.tagCount} terms
          {hiddenCount ? ` · ${hiddenCount} hidden` : ""}
        </summary>
        {item.state === "current" ? (
          <p className="menu-hint">
            Hide removes this source term from search. Your saved tags and model
            suggestions stay separate.
          </p>
        ) : null}
        <input
          type="search"
          aria-label="Filter source tags"
          placeholder="Filter source tags…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {categories.map(([category, heading]) => {
          const tags = item.tags.filter(
            (tag) =>
              tag.category === category &&
              label(tag.name)
                .toLocaleLowerCase()
                .includes(filter.replaceAll("_", " ").toLocaleLowerCase()),
          );
          return tags.length ? (
            <div className="community-group" key={category}>
              <h4>{heading}</h4>
              {tags.map((tag) => (
                <div className="community-term" key={tag.code}>
                  <span className={tag.hidden ? "community-hidden" : undefined}>
                    {label(tag.name)}
                    {tag.hidden ? " · hidden" : ""}
                  </span>
                  {item.state === "current" ? (
                    <button
                      className="button ghost"
                      type="button"
                      disabled={disabled}
                      aria-label={`${tag.hidden ? "Restore" : "Hide"} ${label(tag.name)} ${tag.hidden ? "in" : "from"} Danbooru search`}
                      onClick={() => onToggle(tag.code, !tag.hidden)}
                    >
                      {tag.hidden ? "Restore" : "Hide"}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null;
        })}
        {!item.tags.some((tag) =>
          label(tag.name)
            .toLocaleLowerCase()
            .includes(filter.replaceAll("_", " ").toLocaleLowerCase()),
        ) ? (
          <p>No matching terms.</p>
        ) : null}
        <div className="community-links">
          {source ? (
            <a href={source} target="_blank" rel="noreferrer">
              Linked source ↗
            </a>
          ) : null}
          {item.pixivId && /^\d+$/.test(item.pixivId) ? (
            <a
              href={`https://www.pixiv.net/artworks/${item.pixivId}`}
              target="_blank"
              rel="noreferrer"
            >
              Pixiv ↗
            </a>
          ) : null}
        </div>
      </details>
    </div>
  );
}
