export function driveSource(sourceUrl: string) {
  try {
    const host = new URL(sourceUrl).hostname;
    if (/(^|\.)(twitter\.com|x\.com|twimg\.com)$/.test(host))
      return "Twitter (X)";
    if (/(^|\.)(pinterest\.[a-z.]+|pinimg\.com)$/.test(host))
      return "Pinterest";
    if (/(^|\.)(pixiv\.net|pximg\.net)$/.test(host)) return "Pixiv";
    if (/(^|\.)hoyolab\.com$/.test(host)) return "HoYoLAB";
  } catch {
    /* Unknown sources stay explicitly unclassified. */
  }
  return "Other sources";
}
export function drivePath(
  sourceUrl: string,
  quality = "unknown",
  owned = false,
) {
  const provider = driveSource(sourceUrl);
  const rendition =
    quality === "original"
      ? owned
        ? "Posted originals"
        : "Originals"
      : quality === "degraded"
        ? "Other renditions"
        : "Unverified images";
  return `${owned ? "My Art/" : ""}${provider}/${rendition}`;
}
export function configuredDriveParent(root: string | undefined, path: string) {
  const raw = process.env.GOOGLE_DRIVE_FOLDER_MAP;
  if (!raw) return root;
  const map = JSON.parse(raw) as {
    root: string;
    folders: Record<string, string>;
  };
  if (map.root !== root || !map.folders[path])
    throw new Error("Drive folder configuration does not match the vault.");
  return map.folders[path];
}
export function configuredOwnSource(sourceUrl: string) {
  const prefixes = JSON.parse(
    process.env.OURCHIVAL_OWN_SOURCE_PREFIXES || "[]",
  ) as string[];
  return prefixes.some((prefix) => sourceUrl.startsWith(prefix));
}
