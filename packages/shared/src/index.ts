export type ReferenceKind =
  "image" | "post" | "page" | "link" | "article" | "video_frame" | "file";

export type CapturePayload = {
  kind: ReferenceKind;
  sourceUrl: string;
  canonicalUrl?: string;
  assetUrl?: string;
  assetIndex?: number;
  assetCount?: number;
  pageTitle?: string;
  pageDescription?: string;
  siteName?: string;
  faviconUrl?: string;
  previewImageUrl?: string;
  pageAuthor?: string;
  contentType?: string;
  deferMetadata?: boolean;
  selectedText?: string;
  authorName?: string;
  authorHandle?: string;
  authorUrl?: string;
  postId?: string;
  postText?: string;
  publishedAt?: string;
  altText?: string;
  rawMetadata?: string;
  tags?: string[];
  captureSessionId?: string;
  capturedAt: string;
};

export type PageSnapshot = {
  url: string;
  canonicalUrl?: string;
  title: string;
  description?: string;
  siteName?: string;
  faviconUrl?: string;
  previewImageUrl?: string;
  author?: string;
  contentType?: string;
  selectedText?: string;
  images: Array<{
    src: string;
    alt?: string;
    width?: number;
    height?: number;
  }>;
};

export type SourcePlatform =
  "x" | "pinterest" | "pixiv" | "discord" | "manual" | "generic";

export type ParsedSource = {
  platform: SourcePlatform;
  sourceUrl: string;
  canonicalUrl?: string;
  title?: string;
  authorName?: string;
  authorHandle?: string;
  authorUrl?: string;
  postId?: string;
  postText?: string;
  publishedAt?: string;
  mediaUrls: string[];
  altTexts?: Record<string, string>;
};
