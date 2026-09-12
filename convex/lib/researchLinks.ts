// Search destinations are leads, never evidence that a matching page exists.
export function researchLinks(sourceUrl: string, artist?: string) {
  let source: URL;
  try { source = new URL(sourceUrl); } catch { return []; }
  if (!/^https?:$/.test(source.protocol) || source.username || source.password) return [];
  // Do not forward private query parameters to search providers.
  source.search = "";
  source.hash = "";
  const links = [
    { label: "Archived source page", url: `https://web.archive.org/web/*/${source.href}` },
    { label: "Search exact source URL", url: `https://www.google.com/search?q=${encodeURIComponent(`"${source.href}"`)}` },
  ];
  const pixiv = /(^|\.)pixiv\.net$/.test(source.hostname) && source.pathname.match(/\/(?:en\/)?artworks\/(\d+)\/?$/);
  if (pixiv) links.push({ label: "Search indexed artwork ID", url: `https://www.google.com/search?q=${encodeURIComponent(`"${pixiv[1]}" "pixiv"`)}` });
  if (artist?.trim() && !/^[-–—\s]+$/.test(artist))
    links.push({ label: "Search artist profiles", url: `https://www.google.com/search?q=${encodeURIComponent(`"${artist.trim().slice(0, 200)}" artist`)}` });
  return links;
}
