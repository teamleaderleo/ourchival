import {
  parseXSnapshot,
  type ParsedXSource,
  type XDomSnapshot,
} from "@ourchival/parsers";
import type { PageSnapshot } from "@ourchival/shared";

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

const xLikesChunkSize = 12;
const xLikesIdleRoundLimit = 12;
const xLikesRoundLimit = 5_000;

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
      metaContent('meta[name="twitter:image:src"]'),
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
          rawMetadata: JSON.stringify(snapshot),
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
    }
    activeXLikesImport = runXLikesImport({
      importId,
      profileUrl: String(message.profileUrl ?? ""),
      resumeAfterSourceUrl:
        typeof message.resumeAfterSourceUrl === "string"
          ? message.resumeAfterSourceUrl
          : undefined,
    })
      .catch(() => {
        // runXLikesImport reports its own bounded error state to the worker.
      })
      .finally(() => {
        activeXLikesImport = undefined;
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
  resumeAfterSourceUrl?: string;
}) {
  const seen = new Set(observedXLikesSources);
  let pending: XDomSnapshot[] = [];
  let idleRounds = 0;
  let lastSourceUrl = args.resumeAfterSourceUrl;
  let seekingCursor = Boolean(
    args.resumeAfterSourceUrl &&
    positionedXLikesCursor !== args.resumeAfterSourceUrl,
  );
  let stopReason:
    "paused" | "timeline_end" | "round_limit" | "cursor_not_found" | "error" =
    "round_limit";
  let finishMessage: string | undefined;

  try {
    if (
      !isXPage() ||
      !/^\/[A-Za-z0-9_]{1,15}\/likes\/?$/i.test(location.pathname)
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

      let discoveredThisRound = 0;
      const articles = Array.from(document.querySelectorAll("article"));
      for (const article of articles) {
        const snapshot = snapshotXArticle(article, undefined);
        const parsed = parseXSnapshot(snapshot);
        if (!parsed.postId || !/\/status\/\d+$/i.test(parsed.sourceUrl))
          continue;

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
        observedXLikesSources.add(parsed.sourceUrl);
        pending.push(snapshot);
        discoveredThisRound += 1;
        lastSourceUrl = parsed.sourceUrl;

        if (pending.length >= xLikesChunkSize) {
          await sendXLikesChunk(args, pending, lastSourceUrl);
          positionedXLikesCursor = lastSourceUrl;
          pending = [];
        }
      }

      idleRounds = discoveredThisRound === 0 ? idleRounds + 1 : 0;
      if (!seekingCursor && idleRounds >= xLikesIdleRoundLimit) {
        stopReason = "timeline_end";
        break;
      }
      window.scrollBy({
        top: Math.max(520, Math.floor(window.innerHeight * 0.82)),
      });
      await wait(700);
    }

    if (seekingCursor) {
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
    });
  }
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
  const timestamp =
    article.querySelector<HTMLTimeElement>("time[datetime]")?.dateTime;

  return {
    pageUrl: location.href,
    pageTitle: document.title,
    ...(articleText ? { articleText } : {}),
    ...(userNameText ? { userNameText } : {}),
    ...(clickedImage
      ? { clickedImageUrl: clickedImage.currentSrc || clickedImage.src }
      : {}),
    ...(timestamp ? { timestamp } : {}),
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
