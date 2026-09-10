import type { SavedReference } from "./referenceVaultModel";

export type SidebarFacet = { key: string; label: string; query: string; count: number };

/** Counts references, not image pages. These are shortcuts over loaded results, not global totals. */
export function sidebarFacets(references: SavedReference[], limit = 5) {
  const artists = new Map<string, SidebarFacet>();
  const tags = new Map<string, SidebarFacet>();
  const seen = new Set<string>();
  function add(map: Map<string, SidebarFacet>, key: string, label: string, query: string) {
    const previous = map.get(key);
    if (previous) previous.count++;
    else map.set(key, { key, label, query, count: 1 });
  }
  for (const ref of references) {
    if (seen.has(ref._id) || ref.deleted || (ref.sealed && !ref.previewsRevealed)) continue;
    seen.add(ref._id);
    const name = ref.authorName?.trim() || ref.authorHandle?.trim();
    if (name && !/^[-—\s]+$/.test(name)) {
      const identity = ref.authorUrl || `${ref.platform}:${ref.authorHandle || name}`;
      add(artists, identity, name, ref.authorHandle || name);
    }
    const referenceTags = new Set<string>();
    for (const tag of ref.tags ?? []) {
      if (referenceTags.has(tag._id) || /^(pixiv bookmarks|pinterest|twitter likes|x likes|own[- :]|import[- :]|capture[- :])/i.test(tag.name)) continue;
      referenceTags.add(tag._id);
      add(tags, tag._id, tag.name, `tag:${tag.slug}`);
    }
  }
  const top = (map: Map<string, SidebarFacet>) => [...map.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label) || a.key.localeCompare(b.key)).slice(0, limit);
  return { artists: top(artists), tags: top(tags) };
}
