import type { ReferenceAsset } from "./referenceVaultModel";

/** Automatic viewing never falls through to an original or arbitrary source URL. */
export function compactPreviewSources(asset?: ReferenceAsset, thumbFirst = false): string[] {
  const urls = thumbFirst ? [asset?.thumbUrl, asset?.previewUrl] : [asset?.previewUrl, asset?.thumbUrl];
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}
