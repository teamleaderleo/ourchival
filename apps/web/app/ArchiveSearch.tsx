"use client";

import { useEffect, useRef } from "react";
import {
  visibleSearchText,
  replaceVisibleSearchText,
} from "../../../packages/shared/src/sourceFilters";

export function ArchiveSearch({
  query,
  onChange,
}: {
  query: string;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const text = visibleSearchText(query);
  const changeText = (value: string) =>
    onChange(replaceVisibleSearchText(query, value));
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const shortcut =
        (event.key === "/" && !event.metaKey && !event.ctrlKey) ||
        (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey));
      if (
        !shortcut ||
        event.altKey ||
        target?.closest("input, textarea, select, [contenteditable=true]") ||
        document.querySelector("[aria-modal=true]")
      )
        return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  return (
    <div role="search" className="search-field header-search">
      <svg
        className="search-icon"
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <input
        aria-label="Search Ourchival"
        aria-keyshortcuts="/ Meta+k Control+k"
        ref={input}
        type="search"
        value={text}
        onChange={(event) => changeText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (text) changeText("");
            else input.current?.blur();
          }
        }}
        placeholder="Find images, artists, tags…"
      />
      {text ? (
        <button
          type="button"
          className="clear-search"
          aria-label="Clear search text"
          title="Clear search text"
          onClick={() => {
            changeText("");
            input.current?.focus();
          }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      ) : (
        <kbd aria-hidden="true">/</kbd>
      )}
    </div>
  );
}
