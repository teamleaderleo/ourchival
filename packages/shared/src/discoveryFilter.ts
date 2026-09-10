export function discoveryFacet(query: string) {
  return /(?:^|\s)facet:([^\s]+)/.exec(query)?.[1] ?? "";
}
export function withDiscoveryFacet(query: string, id: string) {
  return [query.replace(/(?:^|\s)facet:[^\s]+/g, "").trim(), id ? `facet:${id}` : ""].filter(Boolean).join(" ");
}
