"use client";
import { ProjectPanel } from "./ProjectPanel";
import { Popover } from "./Popover";

import { useMemo, useState } from "react";
import { BatchOrganizationBar } from "./BatchOrganizationBar";
import { BoardPanel } from "./BoardPanel";
import { EnrichmentQueuePanel } from "./EnrichmentQueuePanel";
import { PersonalTagPanel } from "./PersonalTagPanel";
import { useAllReferenceTags } from "./useReferenceTags";

export function TagFilterBar({
  query,
  onChange,
  imagesOnly,
  onImagesOnly,
  onRefresh,
}: {
  query: string;
  onChange: (query: string) => void;
  imagesOnly?: boolean;
  onImagesOnly?: (value: boolean) => void;
  onRefresh?: () => void;
}) {
  const tags = useAllReferenceTags();
  const activeSlug = tagToken(query);
  const [tagSearch, setTagSearch] = useState("");
  const activeTag = tags.find((tag) => tag.slug === activeSlug);
  const visibleTags = useMemo(
    () => tagChoices(tags, tagSearch, activeSlug, 12),
    [activeSlug, tagSearch, tags],
  );
  const activeFilterCount = query
    .trim()
    .split(/\s+/)
    .filter((token) =>
      /^(tag|board|project|site|domain|type|kind):/i.test(token),
    ).length;

  function applyTag(slug: string) {
    const text = stripTagToken(query);
    onChange([text, slug ? `tag:${slug}` : ""].filter(Boolean).join(" "));
  }

  return (
    <Popover className="vault-tools" label={<>
        <span>
          <strong>Tags & boards</strong>
        </span>
        <span>
          {activeFilterCount ? `${activeFilterCount} active` : <span aria-hidden="true">+</span>}
        </span>
      </>}>
      <div className="vault-tools-content">
        <p className="menu-hint">Browse your accepted tags here. Open an image’s details to review its source tags and model suggestions.</p>
        <details className="tool-section"><summary>Projects</summary><ProjectPanel query={query} onChange={onChange} /></details>
        {onImagesOnly ? <label className="media-preference"><input type="checkbox" checked={!imagesOnly} onChange={(event) => onImagesOnly(!event.target.checked)} />Include text posts</label> : null}
        {onRefresh ? <button type="button" className="button ghost" onClick={onRefresh}>Refresh archive</button> : null}
        {tags.length > 0 ? (
          <div className="tag-filter-bar searchable" aria-label="Filter by tag">
            <label>
              <span>Tag</span>
              <select
                value={activeSlug}
                onChange={(event) => applyTag(event.target.value)}
              >
                <option value="">All tags</option>
                {tags.map((tag) => (
                  <option key={tag._id} value={tag.slug}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="tag-filter-search">
              <span>Find</span>
              <div>
                <input
                  type="search"
                  value={tagSearch}
                  onChange={(event) => setTagSearch(event.target.value)}
                  placeholder="Search tag catalog…"
                  aria-label="Search tag catalog"
                />
                {tagSearch ? (
                  <button
                    type="button"
                    onClick={() => setTagSearch("")}
                    aria-label="Clear tag search"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </label>
            <div className="tag-filter-chips" aria-label="Tag choices">
              {visibleTags.length > 0 ? (
                visibleTags.map((tag) => (
                  <button
                    key={tag._id}
                    type="button"
                    className={activeSlug === tag.slug ? "active" : ""}
                    onClick={() =>
                      applyTag(activeSlug === tag.slug ? "" : tag.slug)
                    }
                    title={
                      activeSlug === tag.slug
                        ? `Clear #${tag.name}`
                        : `Filter by #${tag.name}`
                    }
                  >
                    #{tag.name}
                  </button>
                ))
              ) : (
                <span className="tag-filter-empty">No matching tags</span>
              )}
            </div>
            <div className="tag-filter-status" aria-live="polite">
              <span>
                {tagSearch.trim()
                  ? `${visibleTags.length} shown · ${tags.length} total`
                  : `${tags.length} tags`}
              </span>
              {activeTag ? (
                <button type="button" onClick={() => applyTag("")}>
                  Clear #{activeTag.name}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <PersonalTagPanel />
        <BoardPanel query={query} onChange={onChange} />
        <BatchOrganizationBar />
        <EnrichmentQueuePanel />
      </div>
    </Popover>
  );
}

export function tagChoices<T extends { slug: string; name: string }>(
  tags: T[],
  search: string,
  activeSlug: string,
  limit: number,
) {
  const normalized = search.trim().toLocaleLowerCase();
  const active = tags.find((tag) => tag.slug === activeSlug);
  const matches = normalized
    ? tags.filter((tag) =>
        `${tag.name} ${tag.slug}`.toLocaleLowerCase().includes(normalized),
      )
    : tags;
  const ordered = active
    ? [active, ...matches.filter((tag) => tag.slug !== active.slug)]
    : matches;
  return ordered.slice(0, Math.max(1, limit));
}

function tagToken(value: string) {
  const token = value
    .trim()
    .split(/\s+/)
    .find((part) => /^tag:/i.test(part));
  return token?.slice(token.indexOf(":") + 1) ?? "";
}

function stripTagToken(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter((token) => !/^tag:/i.test(token))
    .join(" ");
}
