export type ReferenceKind =
  | "image"
  | "post"
  | "page"
  | "link"
  | "article"
  | "video_frame"
  | "file";

export type CapturePayload = {
  kind: ReferenceKind;
  sourceUrl: string;
  assetUrl?: string;
  pageTitle?: string;
  selectedText?: string;
  authorName?: string;
  authorHandle?: string;
  authorUrl?: string;
  postId?: string;
  postText?: string;
  publishedAt?: string;
  altText?: string;
  rawMetadata?: string;
  captureSessionId?: string;
  capturedAt: string;
};

export type PageSnapshot = {
  url: string;
  title: string;
  selectedText?: string;
  images: Array<{
    src: string;
    alt?: string;
    width?: number;
    height?: number;
  }>;
};

export type SourcePlatform =
  | "x"
  | "pinterest"
  | "pixiv"
  | "discord"
  | "manual"
  | "generic";

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
