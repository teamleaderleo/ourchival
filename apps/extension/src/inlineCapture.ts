import type { ParsedXSource } from "@ourchival/parsers";
import type { CapturePayload } from "@ourchival/shared";

export function inlineXSourceKey(source: ParsedXSource) {
  const id = source.postId?.trim() || source.sourceUrl?.trim();
  return id ? `x:${id}` : undefined;
}

export function buildXInlinePayloads(
  source: ParsedXSource,
  rawMetadata: string,
  pageTitle: string,
  capturedAt = new Date().toISOString(),
): CapturePayload[] {
  const common = {
    sourceUrl: source.sourceUrl,
    ...(source.title ? { pageTitle: source.title } : { pageTitle }),
    ...(source.authorName ? { authorName: source.authorName } : {}),
    ...(source.authorHandle ? { authorHandle: source.authorHandle } : {}),
    ...(source.authorUrl ? { authorUrl: source.authorUrl } : {}),
    ...(source.postId ? { postId: source.postId } : {}),
    ...(source.postText ? { postText: source.postText } : {}),
    ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
    rawMetadata,
    capturedAt,
  };

  if (source.mediaUrls.length === 0) {
    return [{ kind: "post", ...common }];
  }

  return source.mediaUrls.map((assetUrl) => ({
    kind: "image",
    assetUrl,
    ...(source.altTexts?.[assetUrl]
      ? { altText: source.altTexts[assetUrl] }
      : {}),
    ...common,
  }));
}
