import {
  pixivArtwork,
  pixivBody,
  pinterestOriginalFromState,
} from "./artworkIntake";
import {
  parseXSnapshot,
  type ParsedXSource,
  type XDomSnapshot,
} from "@ourchival/parsers";
import type { PageSnapshot } from "@ourchival/shared";
import {
  detectSourceIntakeContext,
  pinterestOriginalImageUrl,
  sourceIntakeItemKey,
  type SourceIntakeChunk,
  type SourceIntakeItem,
  type SourceIntakeProvider,
} from "./sourceIntake";
import { xTimelineAuditChannel } from "./xTimelineAudit";

type ContextCapture = {
  pageTitle: string;
  pageSnapshot?: PageSnapshot;
  selectedText?: string;
  clickedAssetUrl?: string;
  parsedSource?: ParsedXSource;
  rawMetadata?: string;
};

let lastContextCapture: ContextCapture | undefined;
let activeXLikesImport: Promise<void> | undefined;
let stopXLikesImport = false;
let positionedXLikesCursor: string | undefined;
let positionedXLikesImportId: string | undefined;
const observedXLikesSources = new Set<string>();
const networkXLikesPostIds = new Set<string>();
const unparseableXLikesArticles = new Set<string>();
let networkXLikesPages = 0;
let activeXLikesIdentity: { importId: string; profileUrl: string } | undefined;
const pendingXLikesObservations = new Map<
  string,
  {
    providerId: string;
    sourceUrl?: string;
    stage: "discovered" | "rendered" | "archived";
  }
>();
let xLikesObservationTimer: number | undefined;
let xLikesObservationFlush = Promise.resolve();

const xLikesChunkSize = 24;
const xLikesIdleRoundLimit = 80;
const xLikesRoundLimit = 5_000;
const xKnownBoundarySize = 24;
const archiveBadgeSelector = "[data-ourchival-archive-badge]";
const pendingLiveLikes = new Set<string>();
let archiveBadgeTimer: number | undefined;
let activeSourceIntake: Promise<void> | undefined;
let stopSourceIntake = false;

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    event.data?.channel !== xTimelineAuditChannel ||
    event.data?.kind !== "timeline_page" ||
    !Array.isArray(event.data.postIds)
  ) {
    return;
  }
  networkXLikesPages += 1;
  for (const postId of event.data.postIds.slice(0, 200)) {
    if (typeof postId === "string" && /^\d+$/.test(postId)) {
      networkXLikesPostIds.add(postId);
      queueXLikesObservation({ providerId: postId, stage: "discovered" });
    }
  }
});

function queueXLikesObservation(observation: {
  providerId: string;
  sourceUrl?: string;
  stage: "discovered" | "rendered" | "archived";
}) {
  if (!activeXLikesIdentity) return;
  const existing = pendingXLikesObservations.get(observation.providerId);
  const rank = { discovered: 0, rendered: 1, archived: 2 } as const;
  if (!existing || rank[observation.stage] >= rank[existing.stage]) {
    pendingXLikesObservations.set(observation.providerId, {
      ...existing,
      ...observation,
      sourceUrl: observation.sourceUrl ?? existing?.sourceUrl,
    });
  }
  if (xLikesObservationTimer !== undefined) return;
  xLikesObservationTimer = window.setTimeout(() => {
    xLikesObservationTimer = undefined;
    void flushXLikesObservations();
  }, 350);
}

async function flushXLikesObservations() {
  xLikesObservationFlush = xLikesObservationFlush
    .catch(() => undefined)
    .then(async () => {
      while (activeXLikesIdentity && pendingXLikesObservations.size > 0) {
        const observations = Array.from(
          pendingXLikesObservations.values(),
        ).slice(0, 200);
        for (const observation of observations) {
          pendingXLikesObservations.delete(observation.providerId);
        }
        const response = (await chrome.runtime
          .sendMessage({
            type: "OURCHIVAL_X_LIKES_OBSERVED",
            ...activeXLikesIdentity,
            observations,
          })
          .catch(() => undefined)) as { ok?: boolean } | undefined;
        if (!response?.ok) {
          for (const observation of observations) {
            queueXLikesObservation(observation);
          }
          break;
        }
      }
    });
  await xLikesObservationFlush;
}

if (isXPage()) {
  const observer = new MutationObserver(() => scheduleArchiveBadgeRefresh());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  scheduleArchiveBadgeRefresh();
}

function scheduleArchiveBadgeRefresh() {
  if (activeXLikesImport) return;
  if (archiveBadgeTimer !== undefined) window.clearTimeout(archiveBadgeTimer);
  archiveBadgeTimer = window.setTimeout(() => {
    archiveBadgeTimer = undefined;
    void refreshArchiveBadges();
  }, 250);
}

async function refreshArchiveBadges() {
  if (activeXLikesImport) return;
  const articles = Array.from(
    document.querySelectorAll<HTMLElement>("article"),
  );
  const articlesBySource = new Map<string, HTMLElement[]>();
  for (const article of articles) {
    const parsed = parseXSnapshot(snapshotXArticle(article, undefined));
    if (!parsed.postId || !/\/status\/\d+$/i.test(parsed.sourceUrl)) continue;
    if (article.dataset.ourchivalSourceUrl !== parsed.sourceUrl) {
      article.querySelector(archiveBadgeSelector)?.remove();
      article.dataset.ourchivalSourceUrl = parsed.sourceUrl;
      delete article.dataset.ourchivalArchiveStatus;
    }
    if (article.dataset.ourchivalArchiveStatus) continue;
    const matching = articlesBySource.get(parsed.sourceUrl) ?? [];
    matching.push(article);
    articlesBySource.set(parsed.sourceUrl, matching);
  }
  if (articlesBySource.size === 0) return;

  const response = (await chrome.runtime
    .sendMessage({
      type: "OURCHIVAL_REFERENCE_STATUS",
      sourceUrls: Array.from(articlesBySource.keys()).slice(0, 80),
    })
    .catch(() => undefined)) as
    { ok?: boolean; indexedSourceUrls?: string[] } | undefined;
  if (!response?.ok) return;
  const indexed = new Set(response.indexedSourceUrls ?? []);
  for (const [sourceUrl, matchingArticles] of articlesBySource) {
    for (const article of matchingArticles) {
      if (article.dataset.ourchivalSourceUrl !== sourceUrl) continue;
      const isIndexed = indexed.has(sourceUrl);
      article.dataset.ourchivalArchiveStatus = isIndexed
        ? "indexed"
        : "missing";
      if (isIndexed) ensureArchiveBadge(article);
    }
  }
}

function ensureArchiveBadge(article: HTMLElement) {
  if (article.querySelector(archiveBadgeSelector)) return;
  const anchor = article.querySelector<HTMLElement>(
    '[data-testid="User-Name"]',
  );
  if (!anchor) return;
  const badge = document.createElement("span");
  badge.dataset.ourchivalArchiveBadge = "true";
  badge.textContent = "✦ Archived";
  badge.title = "This post is saved in Ourchival";
  badge.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "margin-left:6px",
    "padding:1px 6px",
    "border:1px solid rgba(196,181,253,.62)",
    "border-radius:999px",
    "background:rgba(139,92,246,.16)",
    "color:rgb(216,205,255)",
    "font:600 11px/16px system-ui,sans-serif",
    "letter-spacing:.01em",
    "white-space:nowrap",
    "pointer-events:none",
  ].join(";");
  anchor.append(badge);
}

function snapshotPage(): PageSnapshot {
  const images = Array.from(document.images).map((image) => ({
    src: image.currentSrc || image.src,
    alt: image.alt || undefined,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  }));
  const canonicalUrl = absoluteHttpUrl(
    document.querySelector<HTMLLinkElement>('link[rel~="canonical"]')?.href,
  );
  const faviconUrl = absoluteHttpUrl(
    document.querySelector<HTMLLinkElement>(
      'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]',
    )?.href,
  );
  const previewImageUrl = absoluteHttpUrl(
    metaContent('meta[property="og:image:secure_url"]') ??
      metaContent('meta[property="og:image"]') ??
      metaContent('meta[name="twitter:image"]') ??
      metaContent('meta[name="twitter:image:src"]') ??
      domainContentImageUrl(images),
  );

  return {
    url: location.href,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    title:
      metaContent('meta[property="og:title"]') ??
      metaContent('meta[name="twitter:title"]') ??
      document.title,
    ...(firstText(
      metaContent('meta[property="og:description"]'),
      metaContent('meta[name="twitter:description"]'),
      metaContent('meta[name="description"]'),
    )
      ? {
          description: firstText(
            metaContent('meta[property="og:description"]'),
            metaContent('meta[name="twitter:description"]'),
            metaContent('meta[name="description"]'),
          ),
        }
      : {}),
    ...(firstText(
      metaContent('meta[property="og:site_name"]'),
      metaContent('meta[name="application-name"]'),
    )
      ? {
          siteName: firstText(
            metaContent('meta[property="og:site_name"]'),
            metaContent('meta[name="application-name"]'),
          ),
        }
      : {}),
    ...(faviconUrl ? { faviconUrl } : {}),
    ...(previewImageUrl ? { previewImageUrl } : {}),
    ...(firstText(
      metaContent('meta[name="author"]'),
      metaContent('meta[property="article:author"]'),
    )
      ? {
          author: firstText(
            metaContent('meta[name="author"]'),
            metaContent('meta[property="article:author"]'),
          ),
        }
      : {}),
    ...(document.contentType ? { contentType: document.contentType } : {}),
    selectedText: window.getSelection()?.toString() || undefined,
    images,
  };
}

function domainContentImageUrl(
  images: Array<{ src: string; width?: number; height?: number }>,
) {
  const hostname = location.hostname.toLowerCase();
  const allowedImageHost = hostname.endsWith("reddit.com")
    ? /^(?:i|preview|external-preview)\.redd\.it$/i
    : hostname.endsWith("hoyolab.com")
      ? /^upload-os-bbs\.hoyolab\.com$/i
      : null;
  if (!allowedImageHost) return undefined;

  let best: (typeof images)[number] | undefined;
  let bestPixels = -1;
  for (const image of images) {
    try {
      if (!allowedImageHost.test(new URL(image.src, location.href).hostname)) {
        continue;
      }
    } catch {
      continue;
    }
    const pixels = (image.width ?? 0) * (image.height ?? 0);
    if (pixels > bestPixels) {
      best = image;
      bestPixels = pixels;
    }
  }
  return best?.src;
}

document.addEventListener(
  "contextmenu",
  (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    const closestImage = target?.closest("img");
    const clickedImage =
      target instanceof HTMLImageElement
        ? target
        : closestImage instanceof HTMLImageElement
          ? closestImage
          : undefined;
    const selectedText = window.getSelection()?.toString().trim() || undefined;
    const pageSnapshot = snapshotPage();

    if (isXPage() && target) {
      const article = target.closest("article");
      if (article) {
        const snapshot = snapshotXArticle(article, clickedImage);
        const parsedSource = parseXSnapshot(snapshot);
        lastContextCapture = {
          pageTitle: document.title,
          pageSnapshot,
          ...(selectedText ? { selectedText } : {}),
          ...(parsedSource.clickedAssetUrl
            ? { clickedAssetUrl: parsedSource.clickedAssetUrl }
            : {}),
          parsedSource,
          rawMetadata: JSON.stringify({
            provenance: "ourchival-clipper:x-context",
            sourceKind: "x_post",
            ...(parsedSource.textLanguage
              ? { textLanguage: parsedSource.textLanguage }
              : {}),
            ...(parsedSource.engagement
              ? { engagement: parsedSource.engagement }
              : {}),
            snapshot,
          }),
        };
        return;
      }
    }

    lastContextCapture = {
      pageTitle: document.title,
      pageSnapshot,
      ...(selectedText ? { selectedText } : {}),
      ...(clickedImage
        ? { clickedAssetUrl: clickedImage.currentSrc || clickedImage.src }
        : {}),
    };
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    if (!isXPage() || !(event.target instanceof Element)) return;
    const likeButton = event.target.closest<HTMLElement>(
      '[data-testid="like"]',
    );
    const article = likeButton?.closest<HTMLElement>("article");
    if (!likeButton || !article) return;
    const snapshot = snapshotXArticle(article, undefined);
    const parsed = parseXSnapshot(snapshot);
    if (!parsed.postId || pendingLiveLikes.has(parsed.sourceUrl)) return;
    pendingLiveLikes.add(parsed.sourceUrl);
    window.setTimeout(() => {
      void (async () => {
        try {
          if (!article.querySelector('[data-testid="unlike"]')) return;
          const response = (await chrome.runtime.sendMessage({
            type: "OURCHIVAL_CAPTURE_X_LIKE",
            snapshot,
          })) as { ok?: boolean; sourceUrl?: string } | undefined;
          if (!response?.ok) return;
          article.dataset.ourchivalSourceUrl = parsed.sourceUrl;
          article.dataset.ourchivalArchiveStatus = "indexed";
          ensureArchiveBadge(article);
        } catch {
          delete article.dataset.ourchivalArchiveStatus;
          scheduleArchiveBadgeRefresh();
        } finally {
          pendingLiveLikes.delete(parsed.sourceUrl);
        }
      })();
    }, 450);
  },
  true,
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OURCHIVAL_DISCOVER_PINTEREST_BOARDS") {
    const context = detectSourceIntakeContext(location.href);
    if (
      context?.provider !== "pinterest_board" ||
      context.scope !== "profile"
    ) {
      sendResponse({ ok: false, error: "Open your Pinterest profile first." });
      return;
    }
    void scanPinterestProfile(context)
      .then((chunk) => sendResponse({ ok: true, chunk }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Board discovery failed.",
        }),
      );
    return true;
  }

  if (message?.type === "OURCHIVAL_START_SOURCE_INTAKE") {
    if (activeSourceIntake) {
      sendResponse({ ok: true, alreadyRunning: true });
      return;
    }
    const provider = message.provider as SourceIntakeProvider;
    if (provider !== "pixiv_bookmarks" && provider !== "pinterest_board") {
      sendResponse({ ok: false, error: "Unsupported source intake." });
      return;
    }
    stopSourceIntake = false;
    activeSourceIntake = runSourceIntake(
      String(message.importId ?? ""),
      provider,
      String(message.sourceUrl ?? ""),
      message.purpose === "sync" && Array.isArray(message.knownProviderIds)
        ? new Set<string>(message.knownProviderIds)
        : undefined,
    ).finally(() => {
      activeSourceIntake = undefined;
    });
    sendResponse({ ok: true, started: true });
    return;
  }

  if (message?.type === "OURCHIVAL_STOP_SOURCE_INTAKE") {
    stopSourceIntake = true;
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "OURCHIVAL_SNAPSHOT_PAGE") {
    sendResponse(snapshotPage());
    return;
  }

  if (message?.type === "OURCHIVAL_GET_CONTEXT_CAPTURE") {
    sendResponse(lastContextCapture);
    return;
  }

  if (message?.type === "OURCHIVAL_START_X_LIKES") {
    if (activeXLikesImport) {
      sendResponse({ ok: true, alreadyRunning: true });
      return;
    }
    stopXLikesImport = false;
    const importId = String(message.importId ?? "");
    if (positionedXLikesImportId !== importId) {
      positionedXLikesImportId = importId;
      positionedXLikesCursor = undefined;
      observedXLikesSources.clear();
      unparseableXLikesArticles.clear();
    }
    activeXLikesImport = runXLikesImport({
      importId,
      profileUrl: String(message.profileUrl ?? ""),
      stopAtKnownBoundary: message.stopAtKnownBoundary === true,
      resumeAfterSourceUrl:
        typeof message.resumeAfterSourceUrl === "string"
          ? message.resumeAfterSourceUrl
          : undefined,
      resumeFromCurrentPosition: message.resumeFromCurrentPosition === true,
    })
      .catch(() => {
        // runXLikesImport reports its own bounded error state to the worker.
      })
      .finally(() => {
        activeXLikesImport = undefined;
        scheduleArchiveBadgeRefresh();
      });
    sendResponse({ ok: true, started: true });
    return;
  }

  if (message?.type === "OURCHIVAL_STOP_X_LIKES") {
    stopXLikesImport = true;
    sendResponse({ ok: true });
    return;
  }
});

async function runSourceIntake(
  importId: string,
  provider: SourceIntakeProvider,
  sourceUrl: string,
  known?: Set<string>,
) {
  if (!importId || !sourceUrl) return;
  const pinterestScan = {
    providerIds: new Set<string>(),
    recoveryProbes: 0,
  };
  if (
    provider === "pinterest_board" &&
    detectSourceIntakeContext(location.href)?.scope === "board"
  ) {
    window.scrollTo(0, 0);
    await wait(750);
  }
  const heartbeat = beginReaderHeartbeat(importId);
  try {
    while (!stopSourceIntake) {
      heartbeat.reading();
      const scanned =
        provider === "pixiv_bookmarks"
          ? await scanPixivBookmarksPage(known)
          : await scanPinterestPage(pinterestScan, known);
      const chunk = { ...scanned, sourceUrl };
      heartbeat.saving();
      const response = (await chrome.runtime.sendMessage({
        type: "OURCHIVAL_SOURCE_INTAKE_CHUNK",
        importId,
        chunk,
      })) as
        | { ok?: boolean; continue?: boolean; nextUrl?: string; error?: string }
        | undefined;
      if (!response?.ok || !response.continue || stopSourceIntake) return;
      if (response.nextUrl && response.nextUrl !== location.href) {
        location.assign(response.nextUrl);
        return;
      }
      if (provider === "pixiv_bookmarks") return;
      await wait(200);
    }
  } finally {
    heartbeat.stop();
  }
}

function beginReaderHeartbeat(importId: string) {
  let phase: "reading" | "saving" = "reading";
  const send = () => {
    void chrome.runtime
      .sendMessage({ type: "OURCHIVAL_READER_HEARTBEAT", importId, phase })
      .catch(() => undefined);
  };
  send();
  const timer = window.setInterval(send, 20_000);
  return {
    reading() {
      phase = "reading";
      send();
    },
    saving() {
      phase = "saving";
      send();
    },
    stop() {
      window.clearInterval(timer);
    },
  };
}

async function scanPinterestPage(
  scan: {
    providerIds: Set<string>;
    recoveryProbes: number;
  },
  known?: Set<string>,
): Promise<SourceIntakeChunk> {
  const context = detectSourceIntakeContext(location.href);
  if (context?.provider !== "pinterest_board") {
    throw new Error(
      "Open your Pinterest profile or one Pinterest board before importing.",
    );
  }
  return context.scope === "profile"
    ? scanPinterestProfile(context)
    : scanPinterestBoardChunk(scan, known);
}

async function scanPinterestProfile(
  context: NonNullable<ReturnType<typeof detectSourceIntakeContext>>,
): Promise<SourceIntakeChunk> {
  let boardAnchors: HTMLAnchorElement[] = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    boardAnchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ).filter((anchor) => {
      const candidate = detectSourceIntakeContext(anchor.href);
      return (
        candidate?.provider === "pinterest_board" && candidate.scope === "board"
      );
    });
    if (boardAnchors.length > 0) break;
    await wait(250);
  }
  const boardUrls = new Set<string>();
  let reportedCount = 0;
  for (const anchor of boardAnchors) {
    const candidate = detectSourceIntakeContext(anchor.href);
    if (
      candidate?.provider !== "pinterest_board" ||
      candidate.scope !== "board"
    ) {
      continue;
    }
    boardUrls.add(candidate.sourceUrl);
    const label = firstText(
      anchor.getAttribute("aria-label") ?? undefined,
      anchor.textContent?.trim(),
    );
    const count = label?.match(/([\d,]+)\s+Pins\b/i)?.[1];
    if (count) reportedCount += Number(count.replaceAll(",", ""));
  }
  return {
    provider: "pinterest_board",
    sourceUrl: context.sourceUrl,
    currentUrl: location.href,
    cursor: boardUrls.size ? "boards:index" : "boards:waiting",
    items: [],
    discoveredUrls: Array.from(boardUrls),
    ...(reportedCount ? { reportedCount } : {}),
    exhausted: boardUrls.size > 0,
  };
}

async function scanPixivBookmarksPage(
  known?: Set<string>,
): Promise<SourceIntakeChunk> {
  const context = detectSourceIntakeContext(location.href);
  if (context?.provider !== "pixiv_bookmarks")
    throw new Error("Open a Pixiv artwork-bookmarks page before importing.");
  const page = Number(context.cursor.replace("page:", "")) || 1;
  if (new URL(context.sourceUrl).searchParams.get("mode") !== "all")
    throw new Error(
      "Use the All artworks bookmark view for a complete import.",
    );
  const limit = 44;
  const offset = (page - 1) * limit;
  const userId = new URL(context.sourceUrl).pathname.match(/users\/(\d+)/)?.[1];
  const rest = context.sensitiveDefault ? "hide" : "show";
  const request = async (path: string): Promise<unknown> => {
    // The browser owns the session; credentials are neither read nor relayed to the vault.
    const response = await fetch(new URL(path, location.origin), {
      credentials: "same-origin",
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Pixiv metadata HTTP " + response.status);
    return response.json();
  };
  const listing = pixivBody(
    await request(
      `/ajax/user/${userId}/illusts/bookmarks?tag=&offset=${offset}&limit=${limit}&rest=${rest}`,
    ),
  );
  if (
    !Array.isArray(listing.works) ||
    !Number.isSafeInteger(listing.total) ||
    listing.total < 0
  ) {
    throw new Error(
      "Pixiv bookmark listing is incomplete; checkpoint retained.",
    );
  }
  if (!listing.works.length && offset < listing.total)
    throw new Error("Pixiv returned an empty page before its declared end.");
  const items: SourceIntakeItem[] = [];
  const gaps: Array<{ key: string; message: string; ordinal: number }> = [];
  for (const [index, bookmark] of listing.works.entries()) {
    if (known?.has(String(bookmark.id))) continue;
    if (stopSourceIntake)
      throw new Error("Paused; current bookmark page will be replayed.");
    const ordinal = offset + index;
    if (!/^\d+$/.test(String(bookmark.id))) {
      gaps.push({
        key: `bookmark:${bookmark.bookmarkData?.id ?? ordinal}`,
        ordinal,
        message: "Deleted or unavailable bookmark has no artwork ID",
      });
      continue;
    }
    items.push(await pixivArtwork(bookmark, context, ordinal, page, request));
  }
  const exhausted =
    offset + listing.works.length >= listing.total ||
    Boolean(
      known &&
      listing.works.length &&
      listing.works.every((work: { id?: number | string }) =>
        known.has(String(work.id)),
      ),
    );
  return {
    provider: "pixiv_bookmarks",
    sourceUrl: context.sourceUrl,
    currentUrl: location.href,
    cursor: context.cursor,
    items,
    gaps,
    reportedCount: listing.total,
    exhausted,
    ...(!exhausted
      ? { nextUrl: pixivNextPageUrl(context.sourceUrl, page + 1) }
      : {}),
  };
}

async function resolvePinterestOriginal(item: SourceIntakeItem) {
  if (!item.assetUrl) return;
  const evidence: Record<string, unknown> = {
    url: item.sourceUrl,
    status: null,
  };
  try {
    const response = await fetch(item.sourceUrl, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(15_000),
    });
    evidence.status = response.status;
    if (!response.ok) throw new Error("Pin metadata HTTP " + response.status);
    const html = await response.text();
    if (html.length > 5_000_000)
      throw new Error("Pin metadata exceeds bounded parser limit");
    const document = new DOMParser().parseFromString(html, "text/html");
    for (const script of document.querySelectorAll(
      'script[type="application/json"]',
    )) {
      let value: unknown;
      try {
        value = JSON.parse(script.textContent ?? "");
      } catch {
        continue;
      }
      const original = pinterestOriginalFromState(value, item.providerId);
      if (original) {
        item.assetOriginalUrl = original;
        evidence.originalUrl = original;
        evidence.method = "pin.images.orig";
        break;
      }
    }
    if (!item.assetOriginalUrl)
      throw new Error("Authoritative pin.images.orig metadata unavailable");
  } catch (error) {
    evidence.error =
      error instanceof Error ? error.message : "Pin metadata unavailable";
  }
  item.metadata = { ...item.metadata, originalResolution: evidence };
}

async function scanPinterestBoardChunk(
  scan: {
    providerIds: Set<string>;
    recoveryProbes: number;
  },
  known?: Set<string>,
): Promise<SourceIntakeChunk> {
  const context = detectSourceIntakeContext(location.href);
  if (context?.provider !== "pinterest_board") {
    throw new Error("Open one Pinterest board before importing.");
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (pinterestBoardPinAnchors().length > 0) break;
    await wait(250);
  }
  const countMatch = document.body.innerText.match(/([\d,]+)\s+Pins\b/i);
  const reportedCount = countMatch?.[1]
    ? Number(countMatch[1].replaceAll(",", ""))
    : undefined;
  if (pinterestBoardPinAnchors().length === 0) {
    return {
      provider: "pinterest_board",
      sourceUrl: context.sourceUrl,
      currentUrl: location.href,
      cursor: "scroll:waiting",
      items: [],
      ...(reportedCount ? { reportedCount } : {}),
      exhausted: false,
    };
  }
  const boardUrl = new URL(context.sourceUrl);
  const boardParts = boardUrl.pathname.split("/").filter(Boolean);
  const boardKey = boardParts.slice(0, 2).join("/");
  const boardName = firstText(
    document.querySelector<HTMLElement>("h1")?.textContent?.trim(),
    boardParts[1]?.replaceAll("-", " "),
  );
  const items = new Map<string, SourceIntakeItem>();
  let stagnantBottomRounds = 0;
  for (let round = 0; round < 10 && !stopSourceIntake; round += 1) {
    const before = items.size;
    for (const anchor of pinterestBoardPinAnchors()) {
      const providerId = anchor.href.match(/\/pin\/(\d+)/)?.[1];
      if (!providerId || items.has(providerId)) continue;
      scan.providerIds.add(providerId);
      const card = closestPinterestCard(anchor);
      const image = card.querySelector<HTMLImageElement>("img");
      const title = firstText(
        anchor.getAttribute("aria-label")?.replace(/\s+pin page$/i, ""),
        image?.alt,
      );
      const previewImageUrl = absoluteHttpUrl(image?.currentSrc || image?.src);
      const assetUrl = pinterestOriginalImageUrl(previewImageUrl);
      items.set(providerId, {
        providerId,
        sourceUrl: `${location.origin}/pin/${providerId}/`,
        ...(title ? { title } : {}),
        ...(previewImageUrl ? { previewImageUrl } : {}),
        ...(assetUrl ? { assetUrl } : {}),
        sensitive: "unknown",
        metadata: {
          provenance: {
            platform: "pinterest",
            containerType: "board",
            containerKey: boardKey,
            containerUrl: context.sourceUrl,
            ...(boardName ? { containerName: boardName } : {}),
          },
        },
      });
    }
    const atBottom =
      window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 4;
    stagnantBottomRounds =
      atBottom && items.size === before ? stagnantBottomRounds + 1 : 0;
    if (stagnantBottomRounds >= 2) break;
    window.scrollBy(0, Math.max(480, Math.floor(window.innerHeight * 0.8)));
    await wait(500);
  }
  const settledAtBottom =
    window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 4 && stagnantBottomRounds >= 2;
  const expectedPinsObserved =
    !reportedCount || scan.providerIds.size >= reportedCount;
  if (settledAtBottom && !expectedPinsObserved && scan.recoveryProbes < 6) {
    scan.recoveryProbes += 1;
    window.scrollBy(0, -Math.max(960, Math.floor(window.innerHeight * 4)));
    await wait(1_000);
  }
  const exhausted =
    settledAtBottom && (expectedPinsObserved || scan.recoveryProbes >= 6);
  const capturedItems = Array.from(items.values()).filter(
    (item) => !known?.has(sourceIntakeItemKey("pinterest_board", item)),
  );
  for (let start = 0; start < capturedItems.length; start += 3) {
    await Promise.all(
      capturedItems.slice(start, start + 3).map(resolvePinterestOriginal),
    );
  }
  return {
    provider: "pinterest_board",
    sourceUrl: context.sourceUrl,
    currentUrl: location.href,
    cursor: `scroll:${Math.round(window.scrollY)}`,
    items: capturedItems,
    ...(reportedCount ? { reportedCount } : {}),
    exhausted,
  };
}

function pinterestBoardPinAnchors() {
  // Pinterest appends recommendation carousels after a board's own masonry
  // grid. Those cards use the same /pin/ links and pin-card markup, so a
  // document-wide selector silently attributes recommendations to the board.
  // Fail closed when the board grid is unavailable instead of importing pins
  // whose membership we cannot prove.
  const boardGrid = document.querySelector<HTMLElement>(
    '[data-test-id="base-board-pin-grid"]',
  );
  return boardGrid
    ? Array.from(
        boardGrid.querySelectorAll<HTMLAnchorElement>('a[href*="/pin/"]'),
      )
    : [];
}

function closestArtworkCard(anchor: HTMLAnchorElement) {
  return (
    anchor.closest<HTMLElement>("li") ??
    anchor.closest<HTMLElement>('div[role="listitem"]') ??
    anchor.parentElement?.parentElement?.parentElement ??
    anchor.parentElement ??
    anchor
  );
}

function closestPinterestCard(anchor: HTMLAnchorElement) {
  return (
    anchor.closest<HTMLElement>('[data-grid-item="true"]') ??
    anchor.closest<HTMLElement>('div[role="listitem"]') ??
    anchor.parentElement?.parentElement?.parentElement ??
    anchor.parentElement ??
    anchor
  );
}

function confidentPageCount(card: Element) {
  const labelled = Array.from(
    card.querySelectorAll<HTMLElement>("[aria-label], [title]"),
  )
    .map((element) =>
      firstText(element.getAttribute("aria-label") ?? undefined, element.title),
    )
    .find((value) => /\b\d+\s+(pages?|images?)\b/i.test(value ?? ""));
  const match = labelled?.match(/\b(\d+)\s+(?:pages?|images?)\b/i);
  const count = match?.[1] ? Number(match[1]) : undefined;
  return count && Number.isSafeInteger(count) && count > 1 ? count : undefined;
}

function isExplicitArtworkCard(card: Element) {
  if (/\bR-18\b/i.test(card.textContent ?? "")) return true;
  return Array.from(
    card.querySelectorAll<HTMLElement>("[aria-label], [title], img[alt]"),
  )
    .map((element) =>
      firstText(
        element.getAttribute("aria-label") ?? undefined,
        element.getAttribute("title") ?? undefined,
        element.getAttribute("alt") ?? undefined,
      ),
    )
    .some((value) => /\bR-18\b/i.test(value ?? ""));
}

function pixivNextPageUrl(sourceUrl: string, page: number) {
  const next = new URL(sourceUrl);
  next.searchParams.set("p", String(page));
  return next.toString();
}

function sameUrlIgnoringOrder(left: string, right: string) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    if (a.origin !== b.origin || a.pathname !== b.pathname) return false;
    return (
      Array.from(a.searchParams.entries()).sort().toString() ===
      Array.from(b.searchParams.entries()).sort().toString()
    );
  } catch {
    return false;
  }
}

function reportedPixivCount(text: string) {
  const match = text.match(/Illustrations and Manga\s+([\d,]+)/i);
  const count = match?.[1] ? Number(match[1].replaceAll(",", "")) : undefined;
  return count && Number.isSafeInteger(count) ? count : undefined;
}

async function runXLikesImport(args: {
  importId: string;
  profileUrl: string;
  stopAtKnownBoundary?: boolean;
  resumeAfterSourceUrl?: string;
  resumeFromCurrentPosition?: boolean;
}) {
  const seen = new Set(observedXLikesSources);
  let pending: XDomSnapshot[] = [];
  let idleRounds = 0;
  let consecutiveKnown = 0;
  let lastBottomSourceUrl: string | undefined;
  let lastScrollHeight = 0;
  let lastSourceUrl = args.resumeAfterSourceUrl;
  let seekingCursor = Boolean(
    args.resumeAfterSourceUrl &&
    !args.resumeFromCurrentPosition &&
    positionedXLikesCursor !== args.resumeAfterSourceUrl,
  );
  let stopReason:
    | "paused"
    | "known_boundary"
    | "stalled"
    | "timeline_end"
    | "round_limit"
    | "cursor_not_found"
    | "error" = "round_limit";
  let finishMessage: string | undefined;

  const heartbeat = beginReaderHeartbeat(args.importId);
  try {
    if (
      !isXPage() ||
      !(
        /^\/[A-Za-z0-9_]{1,15}\/likes\/?$/i.test(location.pathname) ||
        /^\/i\/history\/likes\/?$/i.test(location.pathname)
      )
    ) {
      throw new Error("Open your X profile Likes page before importing.");
    }
    if (
      !args.importId ||
      args.profileUrl !== canonicalLikesUrl(location.href)
    ) {
      throw new Error(
        "The X Likes import checkpoint does not match this page.",
      );
    }
    activeXLikesIdentity = {
      importId: args.importId,
      profileUrl: args.profileUrl,
    };
    if (!args.resumeAfterSourceUrl) {
      window.scrollTo({ top: 0 });
      await wait(400);
    }

    for (let round = 0; round < xLikesRoundLimit; round += 1) {
      if (stopXLikesImport) {
        stopReason = "paused";
        break;
      }

      let visibleBottomSourceUrl: string | undefined;
      const candidates: Array<{
        article: HTMLElement;
        snapshot: XDomSnapshot;
        parsed: ParsedXSource;
      }> = [];
      const articles = Array.from(
        document.querySelectorAll<HTMLElement>("article"),
      );
      for (const article of articles) {
        const snapshot = snapshotXArticle(article, undefined);
        const parsed = parseXSnapshot(snapshot);
        if (!parsed.postId || !/\/status\/\d+$/i.test(parsed.sourceUrl)) {
          if (article.querySelector('[data-testid="User-Name"]')) {
            unparseableXLikesArticles.add(articleFingerprint(article));
          }
          continue;
        }
        visibleBottomSourceUrl = parsed.sourceUrl;
        observedXLikesSources.add(parsed.sourceUrl);
        queueXLikesObservation({
          providerId: parsed.postId,
          sourceUrl: parsed.sourceUrl,
          stage: "rendered",
        });

        if (seekingCursor) {
          if (parsed.sourceUrl === args.resumeAfterSourceUrl) {
            seekingCursor = false;
            positionedXLikesCursor = parsed.sourceUrl;
          }
          continue;
        }
        if (parsed.sourceUrl === args.resumeAfterSourceUrl) continue;
        if (seen.has(parsed.sourceUrl)) continue;
        seen.add(parsed.sourceUrl);
        candidates.push({ article, snapshot, parsed });
      }

      const indexed = await queryIndexedSourceUrls(
        candidates.map(({ parsed }) => parsed.sourceUrl),
      );
      for (const { parsed } of candidates) {
        if (indexed.has(parsed.sourceUrl)) {
          queueXLikesObservation({
            providerId: parsed.postId!,
            sourceUrl: parsed.sourceUrl,
            stage: "archived",
          });
        }
      }
      const knownOnlyRound =
        candidates.length > 0 && indexed.size === candidates.length;
      for (const { article, snapshot, parsed } of candidates) {
        if (article.isConnected) {
          article.dataset.ourchivalSourceUrl = parsed.sourceUrl;
          article.dataset.ourchivalArchiveStatus = indexed.has(parsed.sourceUrl)
            ? "indexed"
            : "missing";
          if (indexed.has(parsed.sourceUrl)) ensureArchiveBadge(article);
        }
        lastSourceUrl = parsed.sourceUrl;
        if (indexed.has(parsed.sourceUrl)) {
          consecutiveKnown += 1;
          continue;
        }
        consecutiveKnown = 0;
        pending.push(snapshot);
        if (pending.length >= xLikesChunkSize) {
          heartbeat.saving();
          await sendXLikesChunk(args, pending, lastSourceUrl);
          heartbeat.reading();
          positionedXLikesCursor = lastSourceUrl;
          pending = [];
        }
      }

      if (args.stopAtKnownBoundary && consecutiveKnown >= xKnownBoundarySize) {
        stopReason = "known_boundary";
        finishMessage = "Caught up at posts already archived in Ourchival.";
        break;
      }

      const scrollHeight = document.documentElement.scrollHeight;
      const stableBottom =
        visibleBottomSourceUrl === lastBottomSourceUrl &&
        scrollHeight === lastScrollHeight;
      idleRounds = candidates.length === 0 && stableBottom ? idleRounds + 1 : 0;
      lastBottomSourceUrl = visibleBottomSourceUrl;
      lastScrollHeight = scrollHeight;
      const nearBottom =
        window.scrollY + window.innerHeight >= scrollHeight - 240;
      const loading = Boolean(document.querySelector('[role="progressbar"]'));
      if (
        !seekingCursor &&
        idleRounds >= xLikesIdleRoundLimit &&
        nearBottom &&
        !loading
      ) {
        stopReason = "stalled";
        finishMessage =
          "X stopped yielding new Likes after repeated recovery probes. Your checkpoint is safe; continue from this position to look for older posts.";
        break;
      }
      if (idleRounds >= 4 && idleRounds % 8 === 0) {
        // X virtualizes its timeline and can stop responding when repeatedly
        // assigned the exact same bottom position. Pulse upward, then cross the
        // old boundary again so its intersection observers request more rows.
        window.scrollBy({ top: -Math.max(360, window.innerHeight * 0.45) });
        await wait(220);
        window.scrollBy({ top: Math.max(900, window.innerHeight * 1.15) });
      } else if (idleRounds >= 4 && idleRounds % 4 === 0) {
        const lastArticle = articles.at(-1);
        lastArticle?.scrollIntoView({ block: "end" });
        window.scrollBy({ top: Math.max(480, window.innerHeight * 0.6) });
      } else if (idleRounds >= 4) {
        window.scrollTo({ top: document.documentElement.scrollHeight });
      } else {
        window.scrollBy({
          top: Math.max(
            620,
            Math.floor(window.innerHeight * (seekingCursor ? 1.2 : 0.82)),
          ),
        });
      }
      await wait(
        seekingCursor
          ? 350
          : knownOnlyRound && idleRounds === 0
            ? 300
            : Math.min(1_600, 600 + idleRounds * 20),
      );
    }

    if (seekingCursor && stopReason !== "paused") {
      stopReason = "cursor_not_found";
      finishMessage =
        "The saved Likes cursor was not found. Leave the Likes page at the last imported position and continue again.";
    }
    if (pending.length > 0 && !seekingCursor) {
      heartbeat.saving();
      await sendXLikesChunk(args, pending, lastSourceUrl);
      heartbeat.reading();
      positionedXLikesCursor = lastSourceUrl;
    }
  } catch (error) {
    stopReason = "error";
    finishMessage =
      error instanceof Error ? error.message : "The X Likes import stopped.";
  } finally {
    heartbeat.stop();
    if (xLikesObservationTimer !== undefined) {
      window.clearTimeout(xLikesObservationTimer);
      xLikesObservationTimer = undefined;
    }
    await flushXLikesObservations();
    await chrome.runtime.sendMessage({
      type: "OURCHIVAL_X_LIKES_FINISHED",
      importId: args.importId,
      profileUrl: args.profileUrl,
      stopReason,
      ...(lastSourceUrl ? { lastSourceUrl } : {}),
      ...(finishMessage ? { message: finishMessage } : {}),
      audit: {
        networkPages: networkXLikesPages,
        networkPostIds: Array.from(networkXLikesPostIds).slice(0, 20_000),
        observedSourceUrls: Array.from(observedXLikesSources).slice(0, 20_000),
        unparseableArticles: unparseableXLikesArticles.size,
        truncated:
          networkXLikesPostIds.size > 20_000 ||
          observedXLikesSources.size > 20_000,
      },
    });
    activeXLikesIdentity = undefined;
  }
}

function articleFingerprint(article: Element) {
  const value = `${article.textContent ?? ""}|${article.querySelector("a")?.getAttribute("href") ?? ""}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

async function sendXLikesChunk(
  args: { importId: string; profileUrl: string },
  snapshots: XDomSnapshot[],
  lastSourceUrl: string | undefined,
) {
  const response = (await chrome.runtime.sendMessage({
    type: "OURCHIVAL_X_LIKES_CHUNK",
    importId: args.importId,
    profileUrl: args.profileUrl,
    snapshots,
    ...(lastSourceUrl ? { lastSourceUrl } : {}),
  })) as { ok?: boolean; error?: string } | undefined;
  if (!response?.ok) {
    throw new Error(
      response?.error || "Ourchival could not save this Likes chunk.",
    );
  }
}

async function queryIndexedSourceUrls(sourceUrls: string[]) {
  if (sourceUrls.length === 0) return new Set<string>();
  const response = (await chrome.runtime
    .sendMessage({
      type: "OURCHIVAL_REFERENCE_STATUS",
      sourceUrls: sourceUrls.slice(0, 80),
    })
    .catch(() => undefined)) as
    { ok?: boolean; indexedSourceUrls?: string[] } | undefined;
  return response?.ok
    ? new Set(response.indexedSourceUrls ?? [])
    : new Set<string>();
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function snapshotXArticle(
  article: Element,
  clickedImage: HTMLImageElement | undefined,
): XDomSnapshot {
  const links = Array.from(
    article.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ).map((link) => ({
    href: link.href,
    text: link.innerText.trim() || undefined,
  }));
  const images = Array.from(
    article.querySelectorAll<HTMLImageElement>("img"),
  ).map((image) => ({
    src: image.currentSrc || image.src,
    alt: image.alt || undefined,
  }));
  const userNameText = article
    .querySelector<HTMLElement>('[data-testid="User-Name"]')
    ?.innerText.trim();
  const articleText = article
    .querySelector<HTMLElement>('[data-testid="tweetText"]')
    ?.innerText.trim();
  const textLanguage = article
    .querySelector<HTMLElement>('[data-testid="tweetText"]')
    ?.getAttribute("lang")
    ?.trim();
  const timestamp =
    article.querySelector<HTMLTimeElement>("time[datetime]")?.dateTime;
  const engagementLabels = Array.from(
    article.querySelectorAll<HTMLElement>("[aria-label]"),
  )
    .map((element) => element.getAttribute("aria-label")?.trim())
    .filter((label): label is string =>
      Boolean(
        label &&
        /\d[\d,.]*\s*[KMB]?\s+(?:repl(?:y|ies)|reposts?|retweets?|quotes?|likes?|bookmarks?|views?)\b/i.test(
          label,
        ),
      ),
    )
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 24);

  return {
    pageUrl: location.href,
    pageTitle: document.title,
    ...(articleText ? { articleText } : {}),
    ...(textLanguage ? { textLanguage } : {}),
    ...(userNameText ? { userNameText } : {}),
    ...(clickedImage
      ? { clickedImageUrl: clickedImage.currentSrc || clickedImage.src }
      : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(engagementLabels.length > 0 ? { engagementLabels } : {}),
    links,
    images,
  };
}

function metaContent(selector: string) {
  return (
    document.querySelector<HTMLMetaElement>(selector)?.content.trim() ||
    undefined
  );
}

function firstText(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function absoluteHttpUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value, location.href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function isXPage() {
  const host = location.hostname.toLowerCase();
  return (
    host === "x.com" ||
    host.endsWith(".x.com") ||
    host === "twitter.com" ||
    host.endsWith(".twitter.com")
  );
}

function canonicalLikesUrl(value: string) {
  try {
    const url = new URL(value);
    return `https://x.com${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}
