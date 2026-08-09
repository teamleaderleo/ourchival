import { parseXSnapshot, type ParsedXSource, type XDomSnapshot } from "@ourchival/parsers";
import type { PageSnapshot } from "@ourchival/shared";
import { buildXInlinePayloads, inlineXSourceKey } from "./inlineCapture";
import { captureReadableText } from "./readableText";
import { captureRedditThreadSnapshot } from "./redditSnapshot";
import {
  CREATIVE_CAPTURE_EVENT_KEY,
  CREATIVE_CAPTURE_QUEUE_KEY,
  INLINE_SAVED_KEYS,
  type CreativeCaptureEvent,
  type CreativeCaptureQueueItem,
} from "./storage";

type ContextCapture = {
  pageTitle: string;
  pageSnapshot?: PageSnapshot;
  selectedText?: string;
  clickedAssetUrl?: string;
  parsedSource?: ParsedXSource;
  rawMetadata?: string;
};

type InlineQueueResponse = {
  ok?: boolean;
  queued?: boolean;
  queueId?: string;
  error?: string;
};

type InlineButtonState = "ready" | "queued" | "saving" | "saved" | "warning";

const inlineSavedKeys = new Set<string>();
const inlineQueuedSources = new Map<string, string | undefined>();
const pendingInlineArticles = new Set<HTMLElement>();
let inlineScanScheduled = false;
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
  void Promise.all([loadInlineSavedKeys(), loadInlineQueueState()]).finally(
    enqueueAllInlineArticles,
  );

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
    if (areaName !== "local") return;

    const savedKeysChange = changes[INLINE_SAVED_KEYS];
    if (savedKeysChange) {
      replaceInlineSavedKeys(savedKeysChange.newValue);
      enqueueAllInlineArticles();
    }

    const queueChange = changes[CREATIVE_CAPTURE_QUEUE_KEY];
    if (queueChange) {
      replaceInlineQueueState(queueChange.newValue);
      enqueueAllInlineArticles();
    }

    const eventChange = changes[CREATIVE_CAPTURE_EVENT_KEY];
    if (eventChange) {
      applyCreativeCaptureEvent(eventChange.newValue);
    }
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
    const persisted = persistedInlineState(sourceKey);
    if (button && persisted) {
      if (button.dataset.state !== "saving" || persisted.state === "saved") {
        setInlineButtonState(button, persisted.state, persisted.detail);
      }
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
    void queueXArticleInline(article, button);
  });
  const persisted = persistedInlineState(sourceKey);
  setInlineButtonState(
    button,
    persisted?.state ?? "ready",
    persisted?.detail,
  );

  shadow.append(style, button);
  actionRow.append(host);
}

async function queueXArticleInline(
  article: HTMLElement,
  button: HTMLButtonElement,
) {
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

  try {
    const response = (await chrome.runtime.sendMessage({
      type: "OURCHIVAL_QUEUE_CAPTURE_PAYLOADS",
      payloads,
      source: "x_post",
      sourceKey,
    })) as InlineQueueResponse | undefined;

    if (!response?.ok || !response.queued) {
      throw new Error(response?.error || "Could not queue this Ourchival capture.");
    }
  } catch (error) {
    setInlineButtonState(
      button,
      "warning",
      error instanceof Error ? error.message : "Could not queue this Ourchival capture.",
    );
  }
}

function applyCreativeCaptureEvent(value: unknown) {
  if (!value || typeof value !== "object") return;
  const event = value as Partial<CreativeCaptureEvent>;
  if (!event.sourceKey || !event.state) return;

  const state: InlineButtonState =
    event.state === "saving"
      ? "saving"
      : event.state === "saved"
        ? "saved"
        : event.state === "warning"
          ? "warning"
          : "queued";
  updateInlineButtonsForSource(event.sourceKey, state, event.error);
}

function updateInlineButtonsForSource(
  sourceKey: string,
  state: InlineButtonState,
  detail?: string,
) {
  for (const host of document.querySelectorAll<HTMLElement>(
    '[data-ourchival-inline-capture="true"]',
  )) {
    if (host.dataset.ourchivalSourceKey !== sourceKey) continue;
    const button = host.shadowRoot?.querySelector<HTMLButtonElement>("button");
    if (button) setInlineButtonState(button, state, detail);
  }
}

function persistedInlineState(sourceKey: string) {
  if (inlineSavedKeys.has(sourceKey)) {
    return { state: "saved" as const };
  }
  if (!inlineQueuedSources.has(sourceKey)) return undefined;
  const lastError = inlineQueuedSources.get(sourceKey);
  return lastError
    ? { state: "warning" as const, detail: lastError }
    : { state: "queued" as const };
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

async function loadInlineQueueState() {
  const stored = await chrome.storage.local.get(CREATIVE_CAPTURE_QUEUE_KEY);
  replaceInlineQueueState(stored[CREATIVE_CAPTURE_QUEUE_KEY]);
}

function replaceInlineSavedKeys(value: unknown) {
  inlineSavedKeys.clear();
  if (!Array.isArray(value)) return;
  for (const key of value) {
    if (typeof key === "string" && key) inlineSavedKeys.add(key);
  }
}

function replaceInlineQueueState(value: unknown) {
  inlineQueuedSources.clear();
  if (!Array.isArray(value)) return;
  for (const candidate of value as CreativeCaptureQueueItem[]) {
    if (!candidate?.sourceKey) continue;
    inlineQueuedSources.set(candidate.sourceKey, candidate.lastError);
  }
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
