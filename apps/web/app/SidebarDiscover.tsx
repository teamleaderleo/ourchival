"use client";
import { useMemo } from "react";
import type { SavedReference } from "./referenceVaultModel";
import { sidebarFacets } from "./sidebarFacets";

export function SidebarDiscover({ references, query, onSearch }: { references: SavedReference[]; query: string; onSearch: (query: string) => void }) {
  const facets = useMemo(() => sidebarFacets(references), [references]);
  return <section className="sidebar-discover" aria-label="Discover artists and tags">
    <p className="sidebar-discover-scope">Frequent in loaded results</p>
    {(["artists", "tags"] as const).map(kind => <details key={kind} open className="sidebar-facets">
      <summary>{kind === "artists" ? "Artists" : "Tags"}</summary>
      {facets[kind].length ? facets[kind].map(facet => <button type="button" key={facet.key} className="sidebar-facet" aria-pressed={query === facet.query} onClick={() => onSearch(query === facet.query ? "" : facet.query)} title={`${kind === "artists" ? "Search saved work for" : "Filter saved work by"} ${facet.label}`}>
        <span>{facet.label}</span><small>{facet.count}</small>
      </button>) : <p className="sidebar-facet-empty">{kind === "artists" ? "Artist names will appear as you browse." : "Accepted tags will appear here."}</p>}
    </details>)}
    {query ? <button type="button" className="sidebar-facet-clear" onClick={() => onSearch("")}>Clear search</button> : null}
  </section>;
}
