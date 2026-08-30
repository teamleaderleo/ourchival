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

  if (message?.type === "OURCHIVAL_COLLECT_X_LIKES") {
    void collectXLikeSnapshots()
      .then((snapshots) => sendResponse({ ok: true, snapshots }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not collect this Likes page.",
        }),
      );
    return true;
  }
});

async function collectXLikeSnapshots() {
  if (
    !isXPage() ||
    !/^\/[A-Za-z0-9_]{1,15}\/likes\/?$/i.test(location.pathname)
  ) {
    throw new Error("Open your X profile Likes page before importing.");
  }

  const startingScroll = window.scrollY;
  const collected = new Map<string, XDomSnapshot>();
  let idleRounds = 0;

  try {
    for (let round = 0; round < 60 && collected.size < 250; round += 1) {
      const before = collected.size;
      for (const article of document.querySelectorAll("article")) {
        const snapshot = snapshotXArticle(article, undefined);
        const parsed = parseXSnapshot(snapshot);
        if (!parsed.postId || !/\/status\/\d+$/i.test(parsed.sourceUrl))
          continue;
        collected.set(parsed.sourceUrl, snapshot);
        if (collected.size >= 250) break;
      }

      idleRounds = collected.size === before ? idleRounds + 1 : 0;
      if (idleRounds >= 5 || collected.size >= 250) break;
      window.scrollBy({
        top: Math.max(520, Math.floor(window.innerHeight * 0.82)),
      });
      await wait(650);
    }
  } finally {
    window.scrollTo({ top: startingScroll });
  }

  return Array.from(collected.values());
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
