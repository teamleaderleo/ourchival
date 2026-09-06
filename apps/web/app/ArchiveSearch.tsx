"use client";

import { useEffect, useRef } from "react";
import { visibleSearchText, replaceVisibleSearchText } from "../../../packages/shared/src/sourceFilters";

export function ArchiveSearch({ query, onChange }: { query: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const text = visibleSearchText(query);
  const changeText = (value: string) => onChange(replaceVisibleSearchText(query, value));
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey ||
        target?.closest("input, textarea, select, [contenteditable=true]") ||
        document.querySelector("[aria-modal=true]")) return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  return <label className="search-field header-search">
    <span className="sr-only">Search Ourchival</span>
    <span className="search-icon" aria-hidden="true">⌕</span>
    <input ref={input} type="search" value={text} onChange={(event) => changeText(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (text) changeText(""); else input.current?.blur(); } }} placeholder="Find images, artists, tags…" />
    {text ? <button type="button" className="clear-search" onClick={() => { changeText(""); input.current?.focus(); }}>Clear</button> : <kbd aria-hidden="true">/</kbd>}
  </label>;
}
