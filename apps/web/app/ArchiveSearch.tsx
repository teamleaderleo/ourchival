"use client";

import { useEffect, useRef } from "react";

export function ArchiveSearch({ query, onChange }: { query: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey ||
        target?.closest("input, textarea, select, [contenteditable=true]") ||
        document.querySelector("[aria-modal=true]")) return;
      event.preventDefault();
      input.current?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  return <label className="search-field header-search">
    <span className="sr-only">Search Ourchival</span>
    <span className="search-icon" aria-hidden="true">⌕</span>
    <input ref={input} type="search" value={query} onChange={(event) => onChange(event.target.value)} placeholder="Search your archive" />
    {query ? <button type="button" className="clear-search" onClick={() => onChange("")}>Clear</button> : <kbd aria-hidden="true">/</kbd>}
  </label>;
}
