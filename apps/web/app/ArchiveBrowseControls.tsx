"use client";
import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  archiveSorts,
  type ArchiveSort,
} from "../../../packages/shared/src/archiveSort";
import {
  readSourceFilters,
  setSourceFilter,
} from "../../../packages/shared/src/sourceFilters";
import { withOwnerAccess } from "./privateAccess";
import { Popover } from "./Popover";

export function ArchiveSortPicker({
  value,
  onChange,
}: {
  value: ArchiveSort;
  onChange: (value: ArchiveSort) => void;
}) {
  return (
    <Popover
      className="browse-menu sort-menu"
      label={
        <>
          <span className="control-caption">Sort</span>
          <span>{archiveSorts.find((s) => s.value === value)?.label}</span>
          <span aria-hidden="true">⌄</span>
        </>
      }
    >
      <p className="menu-hint">
        Changes the viewing order. Your filing stays the same.
      </p>
      <div role="group" aria-label="Sort archive" className="sort-options">
        {archiveSorts.map((sort) => (
          <button
            key={sort.value}
            type="button"
            aria-pressed={value === sort.value}
            onClick={(event) => {
              onChange(sort.value);
              const menu = event.currentTarget.closest("details");
              if (menu) {
                menu.open = false;
                menu.querySelector("summary")?.focus();
              }
            }}
          >
            <span>{sort.label}</span>
            <span aria-hidden="true">{sort.value === value ? "✓" : ""}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

const providers = [
  { value: "x", label: "Twitter / X likes" },
  { value: "pinterest", label: "Pinterest" },
  { value: "pixiv", label: "Pixiv bookmarks" },
] as const;
type Provider = (typeof providers)[number]["value"];
export function ActiveSourceFilters({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  const filters = readSourceFilters(query);
  const entries = [
    ...filters.include.map((value) => ({
      kind: "source" as const,
      value,
      hidden: false,
    })),
    ...filters.exclude.map((value) => ({
      kind: "source" as const,
      value,
      hidden: true,
    })),
    ...filters.origins.map((value) => ({
      kind: "origin" as const,
      value,
      hidden: false,
    })),
    ...filters.excludedOrigins.map((value) => ({
      kind: "origin" as const,
      value,
      hidden: true,
    })),
  ];
  if (!entries.length) return null;
  return (
    <div className="active-source-filters" aria-label="Active source filters">
      {entries.map(({ kind, value, hidden }) => {
        const label =
          kind === "source"
            ? (providers.find((p) => p.value === value)?.label ?? value)
            : (value.split("/").filter(Boolean).at(-1)?.replaceAll("-", " ") ??
              value);
        return (
          <button
            type="button"
            key={`${kind}:${value}`}
            title={`Remove ${label} filter`}
            onClick={() => onChange(setSourceFilter(query, kind, value, "all"))}
          >
            {hidden ? "Hidden: " : ""}
            {label} <span aria-hidden="true">×</span>
          </button>
        );
      })}
      <button
        type="button"
        className="clear-filters"
        onClick={() =>
          onChange(
            query
              .split(/\s+/)
              .filter((token) => !/^-?(source|origin):/.test(token))
              .join(" "),
          )
        }
      >
        Clear filters
      </button>
    </div>
  );
}
type Container = { key: string; name: string };
const list = makeFunctionReference<
  "query",
  { accessKey: string; platform: Provider; after?: string },
  { items: Container[]; after: string | null }
>("referenceOrigins:listContainers");

export function ArchiveSourcePicker({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  const filters = readSourceFilters(query);
  const count = Object.values(filters).reduce(
    (sum, values) => sum + values.length,
    0,
  );
  return (
    <Popover
      className="browse-menu source-menu"
      label={
        <>
          Sources{count ? ` · ${count}` : ""}
          <span aria-hidden="true">⌄</span>
        </>
      }
    >
      <p className="menu-hint">
        Include the sources you want, or hide the ones you don’t. Multiple
        included sources are combined.
      </p>
      {providers.map((provider) => (
        <div key={provider.value}>
          <FilterChoice
            label={provider.label}
            mode={
              filters.exclude.includes(provider.value)
                ? "exclude"
                : filters.include.includes(provider.value)
                  ? "include"
                  : "all"
            }
            onChange={(mode) =>
              onChange(setSourceFilter(query, "source", provider.value, mode))
            }
          />
          <SourceCollections
            platform={provider.value}
            query={query}
            onChange={onChange}
          />
        </div>
      ))}
      {count ? (
        <button
          type="button"
          className="button ghost"
          onClick={() =>
            onChange(
              query
                .split(/\s+/)
                .filter((t) => !/^-?(source|origin):/.test(t))
                .join(" "),
            )
          }
        >
          Clear source filters
        </button>
      ) : null}
    </Popover>
  );
}

function FilterChoice({
  label,
  mode,
  onChange,
}: {
  label: string;
  mode: "all" | "include" | "exclude";
  onChange: (mode: "all" | "include" | "exclude") => void;
}) {
  return (
    <fieldset className="source-choice">
      <legend>{label}</legend>
      <div>
        {(
          [
            ["all", "Any"],
            ["include", "Include"],
            ["exclude", "Hide"],
          ] as const
        ).map(([value, name]) => (
          <button
            key={value}
            type="button"
            aria-label={`${label}: ${name}`}
            aria-pressed={mode === value}
            onClick={() => onChange(value)}
          >
            {name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SourceCollections({
  platform,
  query,
  onChange,
}: {
  platform: Provider;
  query: string;
  onChange: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Container[]>([]);
  const [after, setAfter] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>();
  const filters = readSourceFilters(query);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return;
    setBusy(true);
    setStatus("");
    new ConvexHttpClient(url)
      .query(
        list,
        withOwnerAccess({ platform, ...(cursor ? { after: cursor } : {}) }),
      )
      .then((result) => {
        if (!active) return;
        setItems((current) => [
          ...current,
          ...result.items.filter(
            (item) => !current.some((old) => old.key === item.key),
          ),
        ]);
        setAfter(result.after);
        setBusy(false);
      })
      .catch(() => {
        if (active) {
          setStatus("Could not load source collections. Try again.");
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [open, request, platform, cursor]);
  return (
    <details
      className="source-collections"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {platform === "pinterest"
          ? "Imported boards"
          : "Bookmark / likes collections"}
      </summary>
      {items.map((item) => (
        <FilterChoice
          key={item.key}
          label={item.name}
          mode={
            filters.excludedOrigins.includes(item.key)
              ? "exclude"
              : filters.origins.includes(item.key)
                ? "include"
                : "all"
          }
          onChange={(mode) =>
            onChange(setSourceFilter(query, "origin", item.key, mode))
          }
        />
      ))}
      {busy ? (
        <p role="status">Loading collections…</p>
      ) : !items.length && !status ? (
        <p className="menu-hint">
          No structured collections recorded yet. The source filter above still
          works.
        </p>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
      {(after || status) && !busy ? (
        <button
          type="button"
          className="button ghost"
          onClick={() =>
            status
              ? setRequest((value) => value + 1)
              : setCursor(after ?? undefined)
          }
        >
          {status ? "Retry" : "More collections"}
        </button>
      ) : null}
    </details>
  );
}
