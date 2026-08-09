export type ReferenceKind =
  | "image"
  | "post"
  | "page"
  | "link"
  | "article"
  | "video_frame"
  | "file";

export type PageScreenshotCapture = {
  dataUrl: string;
  width?: number;
  height?: number;
  capturedAt: string;
};

export type PageReadableTextSource = "article" | "main" | "body";

export type PageReadableTextCapture = {
  text: string;
  source: PageReadableTextSource;
  capturedAt: string;
};

export type PageStructuredSnapshotProvider = "reddit.dom";

export type PageStructuredSnapshotCapture = {
  data: string;
  provider: PageStructuredSnapshotProvider;
  capturedAt: string;
};

export type ConversationFingerprintMessage = {
  id: string;
  role: string;
  author?: string;
  text: string;
  createdAt?: string;
};

export type ConversationIdentityConfidence =
  | "stable"
  | "mixed"
  | "content"
  | "positional";

export function buildConversationFingerprints(
  messages: ConversationFingerprintMessage[],
) {
  const stableOccurrences = new Map<string, number>();
  const unstableOccurrences = new Map<string, number>();
  let stableCount = 0;
  let positionalCount = 0;
  let contentCount = 0;

  const fingerprints = messages.map((message) => {
    const id = message.id.trim();
    const positional = /^message-\d+$/i.test(id) || !id;
    const contentDerived = /^captured-/i.test(id);
    const stable = !positional && !contentDerived;
    const base = stable
      ? `id:${id}`
      : JSON.stringify({ role: message.role, text: message.text });
    const occurrences = stable ? stableOccurrences : unstableOccurrences;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);

    if (stable) stableCount += 1;
    else if (positional) positionalCount += 1;
    else contentCount += 1;

    const identity = stableFingerprint(
      JSON.stringify({ base, occurrence }),
    );
    const content = stableFingerprint(
      JSON.stringify({
        role: message.role,
        author: message.author,
        text: message.text,
        createdAt: message.createdAt,
      }),
    );
    return `${stable ? "s" : "u"}:${identity}:${content}`;
  });

  return {
    fingerprints,
    confidence: identityConfidence({
      stableCount,
      positionalCount,
      contentCount,
    }),
  };
}

export type CapturePayload = {
  kind: ReferenceKind;
  sourceUrl: string;
  canonicalUrl?: string;
  assetUrl?: string;
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
  readableText?: string;
  readableTextSource?: PageReadableTextSource;
  structuredSnapshot?: PageStructuredSnapshotCapture;
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
  | "danbooru"
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

function identityConfidence(args: {
  stableCount: number;
  positionalCount: number;
  contentCount: number;
}): ConversationIdentityConfidence {
  const unstableCount = args.positionalCount + args.contentCount;
  if (args.stableCount > 0 && unstableCount === 0) return "stable";
  if (args.stableCount > 0 || (args.positionalCount > 0 && args.contentCount > 0)) {
    return "mixed";
  }
  return args.positionalCount > 0 ? "positional" : "content";
}

function stableFingerprint(value: string) {
  return [
    hash32(value, 0x811c9dc5),
    hash32(value, 0x9e3779b9),
    hash32(value, 0x85ebca6b),
    hash32(value, 0xc2b2ae35),
  ]
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("");
}

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
