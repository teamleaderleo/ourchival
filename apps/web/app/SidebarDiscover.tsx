"use client";
import { useState } from "react";
import { discoveryFacet, withDiscoveryFacet } from "../../../packages/shared/src/discoveryFilter";
import { useArchiveDiscovery } from "./useArchiveDiscovery";

export function SidebarDiscover({ query, onSearch, revealSensitive }: { query: string; onSearch: (query: string) => void; revealSensitive: boolean }) {
  const [search, setSearch] = useState("");
  const selected = discoveryFacet(query);
  const { data, error, retry } = useArchiveDiscovery(search, revealSensitive, selected);
  const selectedLabel = data?.selected?.id === selected ? data.selected.label : [...(data?.artists ?? []), ...(data?.tags ?? [])].find(facet => facet.id === selected)?.label;
  return <section className="sidebar-discover" aria-label="Archive-wide artists and tags">
    <p className="sidebar-discover-scope" title="Counts include active saved references across the archive, excluding My Art and Trash. Each reference counts once.">Across your archive</p>
    <input className="sidebar-directory-search" type="search" aria-label="Find an artist or tag" placeholder="Find artist or tag…" value={search} onChange={event => setSearch(event.target.value)} />
    {selected ? <button className="sidebar-selected-facet" type="button" onClick={() => onSearch(withDiscoveryFacet(query, ""))} title="Clear artist or tag filter"><span>{selectedLabel || "Artist / tag filter"}</span><span aria-hidden="true">×</span></button> : null}
    {error ? <div className="sidebar-facet-empty"><p>Couldn’t load the directory.</p><button type="button" className="sidebar-facet-clear" onClick={retry}>Retry</button></div>
      : !data?.ready ? <p className="sidebar-facet-empty" role="status">{data ? `Building directory · ${data.scanned.toLocaleString()} checked` : "Loading directory…"}</p>
      : (["artists", "tags"] as const).map(kind => <details key={kind} open className="sidebar-facets">
      <summary>{kind === "artists" ? "Artists" : "Tags"}</summary>
      {data[kind].length ? data[kind].map(facet => <button type="button" key={facet.id} className="sidebar-facet" aria-pressed={selected === facet.id} onClick={() => onSearch(withDiscoveryFacet(query, selected === facet.id ? "" : facet.id))} title={`${facet.label} · ${facet.detail} · ${facet.count.toLocaleString()} saved references`}>
        <span>{facet.label}</span><small>{facet.count.toLocaleString()}</small>
      </button>) : <p className="sidebar-facet-empty">{search ? "No matches." : kind === "artists" ? "No identified artists yet." : "No saved tags yet."}</p>}
    </details>)}
  </section>;
}
