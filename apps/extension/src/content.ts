import {
  parseXSnapshot,
  type ParsedXSource,
  type XDomSnapshot,
} from "@ourchival/parsers";
import type { PageSnapshot } from "@ourchival/shared";
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

const xLikesChunkSize = 24;
const xLikesIdleRoundLimit = 80;
const xLikesRoundLimit = 5_000;
const xKnownBoundarySize = 24;
const archiveBadgeSelector = "[data-ourchival-archive-badge]";
const pendingLiveLikes = new Set<string>();
let archiveBadgeTimer: number | undefined;

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
    }
  }
});

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
          await sendXLikesChunk(args, pending, lastSourceUrl);
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
      await sendXLikesChunk(args, pending, lastSourceUrl);
      positionedXLikesCursor = lastSourceUrl;
    }
  } catch (error) {
    stopReason = "error";
    finishMessage =
      error instanceof Error ? error.message : "The X Likes import stopped.";
  } finally {
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
