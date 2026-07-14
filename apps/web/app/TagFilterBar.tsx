"use client";

import { BoardPanel } from "./BoardPanel";
import { useAllReferenceTags } from "./useReferenceTags";

export function TagFilterBar({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  const tags = useAllReferenceTags();
  const activeSlug = tagToken(query);

  function applyTag(slug: string) {
    const text = stripTagToken(query);
    onChange([text, slug ? `tag:${slug}` : ""].filter(Boolean).join(" "));
  }

  return (
    <>
      {tags.length > 0 ? (
        <div className="tag-filter-bar" aria-label="Filter by tag">
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
          <div className="tag-filter-chips" aria-label="Recent tag choices">
            {tags.slice(0, 8).map((tag) => (
              <button
                key={tag._id}
                type="button"
                className={activeSlug === tag.slug ? "active" : ""}
                onClick={() => applyTag(activeSlug === tag.slug ? "" : tag.slug)}
              >
                #{tag.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <BoardPanel query={query} onChange={onChange} />
    </>
  );
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
