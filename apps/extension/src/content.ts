import { parseXSnapshot, type ParsedXSource, type XDomSnapshot } from "@ourchival/parsers";
import type { CapturePayload, PageSnapshot } from "@ourchival/shared";

type ContextCapture = {
  pageTitle: string;
  pageSnapshot?: PageSnapshot;
  selectedText?: string;
  clickedAssetUrl?: string;
  parsedSource?: ParsedXSource;
  rawMetadata?: string;
};

type InlineCaptureResponse = {
  ok?: boolean;
  error?: string;
  state?: {
    saved: number;
    duplicates: number;
    failed: number;
    skipped: number;
  };
};

type InlineSaveState = "ready" | "saving" | "saved" | "failed";

const savedXPostIdsKey = "ourchivalSavedXPostIds";
const maxRememberedXPostIds = 5000;
let lastContextCapture: ContextCapture | undefined;
let xInlineScanQueued = false;

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

async function initializeXInlineSave() {
  const knownSavedPostIds = await loadKnownSavedXPostIds();

  const observer = new MutationObserver(() => queueXInlineSaveScan(knownSavedPostIds));
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  queueXInlineSaveScan(knownSavedPostIds);
}

function queueXInlineSaveScan(knownSavedPostIds: Set<string>) {
  if (xInlineScanQueued) return;
  xInlineScanQueued = true;
  requestAnimationFrame(() => {
    xInlineScanQueued = false;
    scanXArticles(knownSavedPostIds);
  });
}

function scanXArticles(knownSavedPostIds: Set<string>) {
  for (const article of document.querySelectorAll<HTMLElement>("article")) {
    const postId = visibleXPostId(article);
    if (!postId) continue;

    const existing = article.querySelector<HTMLButtonElement>(
      "button[data-ourchival-inline-save]",
    );
    if (existing?.dataset.ourchivalPostId === postId) continue;
    existing?.remove();

    const actionRow = xActionRow(article);
    if (!actionRow) continue;

    const snapshot = snapshotXArticle(article, undefined);
    const parsedSource = parseXSnapshot(snapshot);
    if (parsedSource.platform !== "x" || parsedSource.postId !== postId) continue;

    const button = createXInlineSaveButton(postId);
    actionRow.append(button);
    setXInlineSaveState(
      button,
      knownSavedPostIds.has(postId) ? "saved" : "ready",
    );

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.ourchivalState === "saving") return;
      void captureXArticleInline(article, button, knownSavedPostIds);
    });
  }
}

async function captureXArticleInline(
  article: HTMLElement,
  button: HTMLButtonElement,
  knownSavedPostIds: Set<string>,
) {
  const snapshot = snapshotXArticle(article, undefined);
  const source = parseXSnapshot(snapshot);
  if (source.platform !== "x" || !source.postId) {
    setXInlineSaveState(button, "failed", "Could not identify this X post. Click to retry.");
    return;
  }

  setXInlineSaveState(button, "saving");
  const rawMetadata = JSON.stringify(snapshot);
  const payloads: CapturePayload[] =
    source.mediaUrls.length > 0
      ? source.mediaUrls.map((assetUrl) =>
          buildInlineXPayload(source, rawMetadata, {
            kind: "image",
            assetUrl,
            altText: source.altTexts?.[assetUrl],
          }),
        )
      : [buildInlineXPayload(source, rawMetadata, { kind: "post" })];

  try {
    const response = (await chrome.runtime.sendMessage({
      type: "OURCHIVAL_CAPTURE_PAYLOADS",
      payloads,
      source: "x_post",
    })) as InlineCaptureResponse | undefined;

    if (!response?.ok || !response.state) {
      throw new Error(response?.error || "Ourchival capture failed.");
    }

    if (response.state.failed > 0 || response.state.skipped > 0) {
      const successful = response.state.saved + response.state.duplicates;
      setXInlineSaveState(
        button,
        "failed",
        successful > 0
          ? `Saved ${successful} item${successful === 1 ? "" : "s"}; some media needs retry.`
          : "Capture failed. Click to retry.",
      );
      return;
    }

    knownSavedPostIds.add(source.postId);
    await rememberSavedXPostIds(knownSavedPostIds);
    setXInlineSaveState(
      button,
      "saved",
      response.state.duplicates > 0 && response.state.saved === 0
        ? "Already saved to Ourchival"
        : "Saved to Ourchival",
    );
  } catch (error) {
    setXInlineSaveState(
      button,
      "failed",
      error instanceof Error ? `${error.message} Click to retry.` : "Capture failed. Click to retry.",
    );
  }
}

function buildInlineXPayload(
  source: ParsedXSource,
  rawMetadata: string,
  args: { kind: "image" | "post"; assetUrl?: string; altText?: string },
): CapturePayload {
  return {
    kind: args.kind,
    sourceUrl: source.sourceUrl,
    ...(args.assetUrl ? { assetUrl: args.assetUrl } : {}),
    ...(source.title ? { pageTitle: source.title } : { pageTitle: document.title }),
    ...(source.authorName ? { authorName: source.authorName } : {}),
    ...(source.authorHandle ? { authorHandle: source.authorHandle } : {}),
    ...(source.authorUrl ? { authorUrl: source.authorUrl } : {}),
    ...(source.postId ? { postId: source.postId } : {}),
    ...(source.postText ? { postText: source.postText } : {}),
    ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
    ...(args.altText ? { altText: args.altText } : {}),
    rawMetadata,
    capturedAt: new Date().toISOString(),
  };
}

function createXInlineSaveButton(postId: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.ourchivalInlineSave = "true";
  button.dataset.ourchivalPostId = postId;
  button.style.cssText = [
    "display:grid",
    "place-items:center",
    "width:34px",
    "height:34px",
    "flex:0 0 34px",
    "border:0",
    "border-radius:999px",
    "padding:0",
    "background:transparent",
    "color:rgb(113,118,123)",
    "cursor:pointer",
    "font:700 13px/1 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "transition:background-color 120ms ease,color 120ms ease",
  ].join(";");
  button.addEventListener("mouseenter", () => {
    if (!button.disabled) button.style.backgroundColor = "rgba(120, 86, 255, 0.1)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.backgroundColor = "transparent";
  });
  return button;
}

function setXInlineSaveState(
  button: HTMLButtonElement,
  state: InlineSaveState,
  message?: string,
) {
  button.dataset.ourchivalState = state;
  button.disabled = state === "saving" || state === "saved";

  if (state === "saving") {
    button.textContent = "…";
    button.style.color = "rgb(120,86,255)";
    button.title = message || "Saving to Ourchival…";
    button.setAttribute("aria-label", button.title);
    return;
  }
  if (state === "saved") {
    button.textContent = "✓";
    button.style.color = "rgb(0,186,124)";
    button.title = message || "Saved to Ourchival";
    button.setAttribute("aria-label", button.title);
    return;
  }
  if (state === "failed") {
    button.textContent = "!";
    button.style.color = "rgb(244,33,46)";
    button.title = message || "Capture failed. Click to retry.";
    button.setAttribute("aria-label", button.title);
    return;
  }

  button.textContent = "O";
  button.style.color = "rgb(113,118,123)";
  button.title = message || "Save this post to Ourchival";
  button.setAttribute("aria-label", button.title);
}

function xActionRow(article: HTMLElement) {
  const reply = article.querySelector<HTMLElement>('[data-testid="reply"]');
  return reply?.closest<HTMLElement>('[role="group"]') ?? undefined;
}

function visibleXPostId(article: HTMLElement) {
  for (const link of article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
    const match = link.href.match(/\/status\/(\d+)/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

async function loadKnownSavedXPostIds() {
  try {
    const stored = await chrome.storage.local.get(savedXPostIdsKey);
    const ids = stored[savedXPostIdsKey];
    return new Set(
      Array.isArray(ids)
        ? ids.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

async function rememberSavedXPostIds(ids: Set<string>) {
  try {
    const bounded = Array.from(ids).slice(-maxRememberedXPostIds);
    await chrome.storage.local.set({ [savedXPostIdsKey]: bounded });
  } catch {
    // Saved-state caching is an ergonomic hint; capture success remains authoritative.
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

if (isXPage()) void initializeXInlineSave();
