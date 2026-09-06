export type SourceFilters = {
  include: string[];
  exclude: string[];
  origins: string[];
  excludedOrigins: string[];
};
export function readSourceFilters(query: string): SourceFilters {
  const result: SourceFilters = {
    include: [],
    exclude: [],
    origins: [],
    excludedOrigins: [],
  };
  for (const token of query.split(/\s+/)) {
    const match = /^(-?)(source|origin):(.+)$/.exec(token);
    if (!match) continue;
    try {
      const key =
        match[2] === "source"
          ? match[1]
            ? "exclude"
            : "include"
          : match[1]
            ? "excludedOrigins"
            : "origins";
      result[key].push(decodeURIComponent(match[3]!));
    } catch {
      /* Invalid encoded filters cannot become an accidental match. */
    }
  }
  return result;
}
export function setSourceFilter(
  query: string,
  kind: "source" | "origin",
  value: string,
  mode: "all" | "include" | "exclude",
) {
  const encoded = encodeURIComponent(value);
  const tokens = query
    .split(/\s+/)
    .filter(
      (token) =>
        token &&
        token !== `${kind}:${encoded}` &&
        token !== `-${kind}:${encoded}`,
    );
  if (mode !== "all")
    tokens.push(`${mode === "exclude" ? "-" : ""}${kind}:${encoded}`);
  return tokens.join(" ");
}
export function matchesSourcePlatform(
  platform: string,
  filters: SourceFilters,
) {
  return (
    (!filters.include.length || filters.include.includes(platform)) &&
    !filters.exclude.includes(platform)
  );
}
export function visibleSearchText(query: string) {
  return query.replace(/(^|\s)-?(?:source|origin):\S+/g, "");
}
export function replaceVisibleSearchText(query: string, text: string) {
  return [
    text,
    ...query.split(/\s+/).filter((token) => /^-?(source|origin):/.test(token)),
  ]
    .filter(Boolean)
    .join(" ");
}
