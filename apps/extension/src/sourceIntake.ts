import type { CapturePayload } from "@ourchival/shared";

export type SourceIntakeProvider =
  | "pixiv_bookmarks"
  | "pixiv_owned_profile"
  | "pinterest_board";

export function originalDownloadFailure(
  source: string,
  hasImage: boolean,
  result?: {
    blocked?: boolean;
    storageProvider?: string;
    storageStatus?: string;
  },
) {
  return source.startsWith("pixiv_") &&
    hasImage &&
    !result?.blocked &&
    result?.storageProvider === "linked"
    ? result.storageStatus || "Original upload failed"
    : undefined;
}

/** Recheck after downloads: Stop or a new reader invalidates an old chunk. */
export function sourceReaderCanCommit(
  state: { running: boolean; workerTabId?: number } | undefined,
  senderTabId?: number,
) {
  return Boolean(
    state?.running &&
      typeof senderTabId === "number" &&
      state.workerTabId === senderTabId,
  );
}

export type SourceIntakeContext = {
  provider: SourceIntakeProvider;
  scope: "bookmarks" | "profile" | "board";
  sourceUrl: string;
  currentUrl: string;
  cursor: string;
  sensitiveDefault: boolean;
  label: string;
};

export type SourceIntakeItem = {
  providerId: string;
  sourceUrl: string;
  assetUrl?: string;
  assetOriginalUrl?: string;
  assetUrls?: string[];
  ordinal?: number;
  publishedAt?: string;
  tags?: string[];
  gap?: string;
  title?: string;
  authorName?: string;
  authorUrl?: string;
  previewImageUrl?: string;
  pageCount?: number;
  sensitive?: "unknown" | "general" | "suggestive" | "explicit";
  metadata?: Record<string, unknown>;
};

export type SourceIntakeChunk = {
  provider: SourceIntakeProvider;
  sourceUrl: string;
  currentUrl: string;
  cursor: string;
  items: SourceIntakeItem[];
  gaps?: Array<{ key: string; message: string; ordinal: number }>;
  discoveredUrls?: string[];
  nextUrl?: string;
  reportedCount?: number;
  exhausted: boolean;
};

export function detectSourceIntakeContext(
  value: string | undefined,
): SourceIntakeContext | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (/(^|\.)pixiv\.net$/i.test(url.hostname)) {
    const bookmarkMatch = url.pathname.match(
      /^\/(?:en\/)?users\/(\d+)\/bookmarks\/artworks\/?$/i,
    );
    if (bookmarkMatch?.[1]) {
      const page = positiveInteger(url.searchParams.get("p")) ?? 1;
      const rest =
        url.searchParams.get("rest") === "hide" ? "hide" : "show";
      const mode = cleanMode(url.searchParams.get("mode"));
      const source = new URL(
        `/en/users/${bookmarkMatch[1]}/bookmarks/artworks`,
        "https://www.pixiv.net",
      );
      source.searchParams.set("rest", rest);
      source.searchParams.set("mode", mode);
      const current = new URL(source);
      if (page > 1) current.searchParams.set("p", String(page));
      return {
        provider: "pixiv_bookmarks",
        scope: "bookmarks",
        sourceUrl: source.toString(),
        currentUrl: current.toString(),
        cursor: `page:${page}`,
        sensitiveDefault: rest === "hide",
        label: rest === "hide" ? "Private Pixiv bookmarks" : "Pixiv bookmarks",
      };
    }

    const profileMatch = url.pathname.match(
      /^\/(?:en\/)?users\/(\d+)(?:\/artworks)?\/?$/i,
    );
    if (profileMatch?.[1]) {
      const source = `https://www.pixiv.net/en/users/${profileMatch[1]}/artworks`;
      return {
        provider: "pixiv_owned_profile",
        scope: "profile",
        sourceUrl: source,
        currentUrl: source,
        cursor: "works:0",
        sensitiveDefault: false,
        label: "Pixiv creator works",
      };
    }
    return undefined;
  }

  if (/(^|\.)pinterest\.[a-z.]+$/i.test(url.hostname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      parts.length === 1 &&
      !parts[0]?.startsWith("_") &&
      !PINTEREST_RESERVED_ROOTS.has(parts[0]!.toLowerCase())
    ) {
      const source = new URL(`/${parts[0]}/`, url.origin);
      return {
        provider: "pinterest_board",
        scope: "profile",
        sourceUrl: source.toString(),
        currentUrl: source.toString(),
        cursor: "boards:index",
        sensitiveDefault: false,
        label: "Pinterest boards",
      };
    }
    if (
      parts.length !== 2 ||
      parts[0]?.startsWith("_") ||
      parts[1]?.startsWith("_") ||
      parts[0] === "pin"
    ) {
      return undefined;
    }
    const source = new URL(`/${parts[0]}/${parts[1]}/`, url.origin);
    return {
      provider: "pinterest_board",
      scope: "board",
      sourceUrl: source.toString(),
      currentUrl: source.toString(),
      cursor: "scroll:0",
      sensitiveDefault: false,
      label: "Pinterest board",
    };
  }

  return undefined;
}

export function reconcilePinterestQueue(args: {
  pendingUrls?: string[];
  discoveredUrls?: string[];
  currentUrl: string;
  exhausted: boolean;
}) {
  const pending = new Set<string>();
  for (const value of [
    ...(args.pendingUrls ?? []),
    ...(args.discoveredUrls ?? []),
  ]) {
    const context = detectSourceIntakeContext(value);
    if (context?.provider === "pinterest_board" && context.scope === "board") {
      pending.add(context.sourceUrl);
    }
  }
  if (args.exhausted) {
    const current = detectSourceIntakeContext(args.currentUrl);
    if (current?.scope === "board") pending.delete(current.sourceUrl);
  }
  return {
    pendingUrls: Array.from(pending),
    nextUrl: args.exhausted ? pending.values().next().value : undefined,
  };
}

export function selectSourceIntakeState<
  T extends {
    provider: SourceIntakeProvider;
    sourceUrl: string;
    running: boolean;
    updatedAt: string;
  },
>(context: SourceIntakeContext | undefined, states: T[]) {
  const ranked = [...states].sort((left, right) => {
    if (left.running !== right.running) return left.running ? -1 : 1;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  if (context) {
    return ranked.find(
      (state) =>
        state.provider === context.provider &&
        state.sourceUrl === context.sourceUrl,
    );
  }
  return ranked[0];
}

const PINTEREST_RESERVED_ROOTS = new Set([
  "ideas",
  "pin",
  "search",
  "settings",
  "today",
]);

export function sourceIntakePayload(
  item: SourceIntakeItem,
  args: {
    provider: SourceIntakeProvider;
    importId: string;
    ordinal: number;
    sensitiveDefault: boolean;
  },
): CapturePayload {
  const sealed =
    args.sensitiveDefault ||
    item.sensitive === "explicit" ||
    item.sensitive === "suggestive";
  const providerLabel = sourceIntakeProviderLabel(args.provider);
  const rawMetadata = {
    version: 1,
    provider: args.provider,
    providerId: item.providerId,
    ordinal: item.ordinal ?? args.ordinal,
    sensitivity: item.sensitive ?? (sealed ? "unknown" : "general"),
    sealed,
    ...(item.pageCount ? { pageCount: item.pageCount } : {}),
    ...(item.previewImageUrl
      ? sealed
        ? { sealedPreviewImageUrl: item.previewImageUrl }
        : { previewImageUrl: item.previewImageUrl }
      : {}),
    ...(item.metadata ? { source: item.metadata } : {}),
  };

  return {
    kind: "post",
    sourceUrl: item.sourceUrl,
    canonicalUrl: item.sourceUrl,
    ...(item.assetUrl
      ? { assetUrl: item.assetUrl, assetIndex: 0, assetCount: 1 }
      : {}),
    ...(item.assetOriginalUrl
      ? { assetOriginalUrl: item.assetOriginalUrl }
      : {}),
    ...(item.assetUrl ? { promoteOriginal: true } : {}),
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    ...(item.title ? { pageTitle: item.title } : {}),
    ...(item.authorName ? { authorName: item.authorName } : {}),
    ...(item.authorUrl ? { authorUrl: item.authorUrl } : {}),
    postId: item.providerId,
    ...(!sealed && item.previewImageUrl
      ? { previewImageUrl: item.previewImageUrl }
      : {}),
    deferMetadata: true,
    rawMetadata: JSON.stringify(rawMetadata),
    tags: [
      ...(sealed ? [providerLabel, "Sealed"] : [providerLabel]),
      ...(item.tags ?? []),
    ],
    captureSessionId: args.importId,
    capturedAt: new Date().toISOString(),
  };
}

export function sourceIntakeProviderLabel(provider: SourceIntakeProvider) {
  if (provider === "pixiv_bookmarks") return "Pixiv bookmarks";
  if (provider === "pixiv_owned_profile") return "Pixiv creator works";
  return "Pinterest board";
}

export function pinterestOriginalImageUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)pinimg\.com$/i.test(url.hostname)
    ) {
      return undefined;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return undefined;
    if (/^(?:\d+x|originals)$/i.test(parts[0] ?? "")) {
      parts[0] = "originals";
    } else {
      return undefined;
    }
    url.pathname = `/${parts.join("/")}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function sourceIntakeItemKey(
  provider: SourceIntakeProvider,
  item: SourceIntakeItem,
) {
  if (provider !== "pinterest_board") return item.providerId;
  const provenance = objectValue(item.metadata?.provenance);
  const containerKey = stringValue(provenance?.containerKey);
  return containerKey ? `${containerKey}:${item.providerId}` : item.providerId;
}

function positiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function cleanMode(value: string | null) {
  return value && /^[a-z_]{1,24}$/i.test(value) ? value : "all";
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function sourceIntakePayloads(
  item: SourceIntakeItem,
  args: Parameters<typeof sourceIntakePayload>[1],
): CapturePayload[] {
  const base = sourceIntakePayload(item, args);
  if (!item.assetUrls?.length) return [base];
  return item.assetUrls.map((assetUrl, assetIndex) => ({
    ...base,
    assetUrl,
    assetIndex,
    assetCount: item.assetUrls!.length,
    promoteOriginal: true,
  }));
}
