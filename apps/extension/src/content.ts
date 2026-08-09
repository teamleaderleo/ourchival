import { parseXSnapshot, type ParsedXSource, type XDomSnapshot } from "@ourchival/parsers";
import type { CapturePayload, PageSnapshot } from "@ourchival/shared";
import { buildXInlinePayloads, inlineXSourceKey } from "./inlineCapture";
import { captureReadableText } from "./readableText";
import { captureRedditThreadSnapshot } from "./redditSnapshot";

type ContextCapture = {
  pageTitle: string;
  pageSnapshot?: PageSnapshot;
  selectedText?: string;
  clickedAssetUrl?: string;
  parsedSource?: ParsedXSource;
  rawMetadata?: string;
};

type InlineBatchResponse = {
  ok?: boolean;
  error?: string;
  state?: {
    saved: number;
    duplicates: number;
    failed: number;
  };
};

type InlineButtonState = "ready" | "queued" | "saving" | "saved" | "warning";

const INLINE_SAVED_KEYS = "ourchival:inline-saved-source-keys:v1";
const MAX_INLINE_SAVED_KEYS = 20_000;
const inlineSavedKeys = new Set<string>();
const pendingInlineArticles = new Set<HTMLElement>();
let inlineScanScheduled = false;
let inlineCaptureTail: Promise<void> = Promise.resolve();
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
  const readable = captureReadableText(document);
  const structuredSnapshot = captureRedditThreadSnapshot(document, location.href);

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
    ...(readable
      ? {
          readableText: readable.text,
          readableTextSource: readable.source,
        }
      : {}),
    ...(structuredSnapshot ? { structuredSnapshot } : {}),
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

function startInlineCreativeCapture() {
  if (!isXPage()) return;

  enqueueAllInlineArticles();
  void loadInlineSavedKeys().finally(enqueueAllInlineArticles);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target instanceof Element) {
        const targetArticle = record.target.closest<HTMLElement>("article");
        if (targetArticle) pendingInlineArticles.add(targetArticle);
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches("article")) {
          pendingInlineArticles.add(node as HTMLElement);
        }
        for (const article of node.querySelectorAll<HTMLElement>("article")) {
          pendingInlineArticles.add(article);
        }
      }
    }
    scheduleInlineScan();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const savedKeysChange = changes[INLINE_SAVED_KEYS];
    if (areaName !== "local" || !savedKeysChange) return;
    replaceInlineSavedKeys(savedKeysChange.newValue);
    enqueueAllInlineArticles();
  });
}

function enqueueAllInlineArticles() {
  for (const article of document.querySelectorAll<HTMLElement>("article")) {
    pendingInlineArticles.add(article);
  }
  scheduleInlineScan();
}

function scheduleInlineScan() {
  if (inlineScanScheduled || pendingInlineArticles.size === 0) return;
  inlineScanScheduled = true;
  window.requestAnimationFrame(() => {
    inlineScanScheduled = false;
    const articles = Array.from(pendingInlineArticles);
    pendingInlineArticles.clear();
    for (const article of articles) {
      if (article.isConnected) mountXInlineButton(article);
    }
    if (pendingInlineArticles.size > 0) scheduleInlineScan();
  });
}

function mountXInlineButton(article: HTMLElement) {
  const snapshot = snapshotXArticle(article, undefined);
  const source = parseXSnapshot(snapshot);
  const sourceKey = inlineXSourceKey(source);
  if (!sourceKey) return;

  const replyAction = article.querySelector<HTMLElement>('[data-testid="reply"]');
  const actionRow = replyAction?.closest<HTMLElement>('[role="group"]');
  if (!actionRow) return;

  const existingHost = actionRow.querySelector<HTMLElement>(
    ':scope > [data-ourchival-inline-capture="true"]',
  );
  if (existingHost?.dataset.ourchivalSourceKey === sourceKey) {
    const button = existingHost.shadowRoot?.querySelector<HTMLButtonElement>("button");
    if (button && inlineSavedKeys.has(sourceKey)) {
      setInlineButtonState(button, "saved");
    }
    return;
  }
  existingHost?.remove();

  const host = document.createElement("span");
  host.dataset.ourchivalInlineCapture = "true";
  host.dataset.ourchivalSourceKey = sourceKey;
  host.style.display = "inline-flex";
  host.style.alignItems = "center";
  host.style.justifyContent = "center";
  host.style.flex = "0 0 auto";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    button {
      all: initial;
      box-sizing: border-box;
      width: 30px;
      height: 30px;
      display: inline-grid;
      place-items: center;
      border-radius: 999px;
      cursor: pointer;
      color: rgb(113, 118, 123);
      font: 700 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      transition: background-color 120ms ease, color 120ms ease, transform 80ms ease;
    }
    button:hover {
      color: rgb(111, 91, 183);
      background: rgba(111, 91, 183, 0.12);
    }
    button:active { transform: scale(0.92); }
    button[data-state="queued"],
    button[data-state="saving"] { color: rgb(111, 91, 183); cursor: progress; }
    button[data-state="saved"] { color: rgb(61, 107, 61); }
    button[data-state="warning"] { color: rgb(138, 61, 61); }
    @media (prefers-color-scheme: dark) {
      button { color: rgb(113, 118, 123); }
      button:hover { color: rgb(186, 168, 255); }
      button[data-state="saved"] { color: rgb(112, 188, 112); }
      button[data-state="warning"] { color: rgb(224, 119, 119); }
    }
  `;

  const button = document.createElement("button");
  button.type = "button";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    queueXArticleInline(article, button);
  });
  setInlineButtonState(
    button,
    inlineSavedKeys.has(sourceKey) ? "saved" : "ready",
  );

  shadow.append(style, button);
  actionRow.append(host);
}

function queueXArticleInline(article: HTMLElement, button: HTMLButtonElement) {
  if (button.dataset.state === "queued" || button.dataset.state === "saving") return;

  const snapshot = snapshotXArticle(article, undefined);
  const source = parseXSnapshot(snapshot);
  const sourceKey = inlineXSourceKey(source);
  if (!sourceKey) {
    setInlineButtonState(button, "warning", "Could not identify this post.");
    return;
  }
  if (inlineSavedKeys.has(sourceKey)) {
    setInlineButtonState(button, "saved");
    return;
  }

  const payloads = buildXInlinePayloads(
    source,
    JSON.stringify(snapshot),
    document.title,
  );
  setInlineButtonState(button, "queued");
  inlineCaptureTail = inlineCaptureTail
    .catch(() => undefined)
    .then(() => captureXPayloadsInline(sourceKey, payloads, button));
}

async function captureXPayloadsInline(
  sourceKey: string,
  payloads: CapturePayload[],
  button: HTMLButtonElement,
) {
  setInlineButtonState(button, "saving");
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "OURCHIVAL_CAPTURE_PAYLOADS",
      payloads,
      source: "x_post",
    })) as InlineBatchResponse | undefined;

    if (!response?.ok || !response.state) {
      throw new Error(response?.error || "Ourchival capture failed.");
    }
    if (response.state.failed > 0) {
      setInlineButtonState(
        button,
        "warning",
        `${response.state.failed} item${response.state.failed === 1 ? "" : "s"} need retry.`,
      );
      return;
    }

    inlineSavedKeys.add(sourceKey);
    await persistInlineSavedKeys();
    setInlineButtonState(button, "saved");
  } catch (error) {
    setInlineButtonState(
      button,
      "warning",
      error instanceof Error ? error.message : "Ourchival capture failed.",
    );
  }
}

function setInlineButtonState(
  button: HTMLButtonElement,
  state: InlineButtonState,
  detail?: string,
) {
  button.dataset.state = state;
  button.disabled = state === "queued" || state === "saving";

  if (state === "queued") {
    button.textContent = "…";
    button.title = "Queued for Ourchival";
    button.setAttribute("aria-label", "Queued for Ourchival");
    return;
  }
  if (state === "saving") {
    button.textContent = "…";
    button.title = "Saving to Ourchival…";
    button.setAttribute("aria-label", "Saving to Ourchival");
    return;
  }
  if (state === "saved") {
    button.textContent = "✓";
    button.title = "Saved to Ourchival";
    button.setAttribute("aria-label", "Saved to Ourchival");
    return;
  }
  if (state === "warning") {
    button.textContent = "!";
    button.title = detail || "Ourchival capture needs attention. Click to retry.";
    button.setAttribute("aria-label", "Retry Ourchival capture");
    button.disabled = false;
    return;
  }

  button.textContent = "O";
  button.title = "Save this post to Ourchival";
  button.setAttribute("aria-label", "Save this post to Ourchival");
}

async function loadInlineSavedKeys() {
  const stored = await chrome.storage.local.get(INLINE_SAVED_KEYS);
  replaceInlineSavedKeys(stored[INLINE_SAVED_KEYS]);
}

function replaceInlineSavedKeys(value: unknown) {
  inlineSavedKeys.clear();
  if (!Array.isArray(value)) return;
  for (const key of value) {
    if (typeof key === "string" && key) inlineSavedKeys.add(key);
  }
}

async function persistInlineSavedKeys() {
  const keys = Array.from(inlineSavedKeys);
  const bounded = keys.slice(Math.max(0, keys.length - MAX_INLINE_SAVED_KEYS));
  if (bounded.length !== keys.length) {
    inlineSavedKeys.clear();
    for (const key of bounded) inlineSavedKeys.add(key);
  }
  await chrome.storage.local.set({ [INLINE_SAVED_KEYS]: bounded });
}

function metaContent(selector: string) {
  return document.querySelector<HTMLMetaElement>(selector)?.content.trim() || undefined;
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

startInlineCreativeCapture();
