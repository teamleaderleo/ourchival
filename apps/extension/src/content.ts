import { parseXSnapshot, type ParsedXSource, type XDomSnapshot } from "@ourchival/parsers";
import type { PageSnapshot } from "@ourchival/shared";

type ContextCapture = {
  pageTitle: string;
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

  return {
    url: location.href,
    title: document.title,
    selectedText: window.getSelection()?.toString() || undefined,
    images,
  };
}

document.addEventListener(
  "contextmenu",
  (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    const clickedImage =
      target instanceof HTMLImageElement
        ? target
        : target?.closest("img") instanceof HTMLImageElement
          ? target.closest("img")
          : undefined;
    const selectedText = window.getSelection()?.toString().trim() || undefined;

    if (isXPage() && target) {
      const article = target.closest("article");
      if (article) {
        const snapshot = snapshotXArticle(article, clickedImage);
        const parsedSource = parseXSnapshot(snapshot);
        lastContextCapture = {
          pageTitle: document.title,
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
  }
});

function snapshotXArticle(
  article: Element,
  clickedImage: HTMLImageElement | undefined,
): XDomSnapshot {
  const links = Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]")).map(
    (link) => ({
      href: link.href,
      text: link.innerText.trim() || undefined,
    }),
  );
  const images = Array.from(article.querySelectorAll<HTMLImageElement>("img")).map(
    (image) => ({
      src: image.currentSrc || image.src,
      alt: image.alt || undefined,
    }),
  );
  const userNameText = article
    .querySelector<HTMLElement>('[data-testid="User-Name"]')
    ?.innerText.trim();
  const articleText = article
    .querySelector<HTMLElement>('[data-testid="tweetText"]')
    ?.innerText.trim();
  const timestamp = article.querySelector<HTMLTimeElement>("time[datetime]")?.dateTime;

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

function isXPage() {
  const host = location.hostname.toLowerCase();
  return host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com");
}
