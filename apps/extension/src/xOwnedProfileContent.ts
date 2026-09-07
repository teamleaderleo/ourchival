import type { XOwnedProfileSnapshot } from "./xOwnedProfile";
import {
  classifiedAuthoredMediaSourceUrls,
  detectXOwnedProfilePage,
  emptyXOwnedSyncState,
  processXOwnedRound,
  xOwnedProfileHandle,
} from "./xOwnedProfileSync";

const controlId = "ourchival-owned-x-sync";
const maximumRounds = 700;
const stableBottomLimit = 18;
const capturePayloadChunk = 32;

let running = false;
let stopRequested = false;
let lastSummary = "Sync authored media";

const initialContext = detectXOwnedProfilePage(location.href);
if (initialContext) {
  installControl();
  const observer = new MutationObserver(() => installControl());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const url = new URL(location.href);
  if (
    initialContext.route === "media" &&
    url.searchParams.get("ourchival_sync") === "1"
  ) {
    url.searchParams.delete("ourchival_sync");
    history.replaceState(history.state, "", url.toString());
    window.setTimeout(() => void startSync(), 500);
  }
}

function installControl() {
  const context = detectXOwnedProfilePage(location.href);
  const existing = document.getElementById(controlId) as HTMLButtonElement | null;
  if (!context) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const button = document.createElement("button");
  button.id = controlId;
  button.type = "button";
  button.textContent = lastSummary;
  button.title =
    "Archive recent TeamLeaderLeo-authored X media to Ourchival and Drive";
  button.style.cssText = [
    "position:fixed",
    "right:20px",
    "bottom:20px",
    "z-index:2147483646",
    "min-height:38px",
    "max-width:260px",
    "padding:9px 14px",
    "border:1px solid rgba(190,170,255,.62)",
    "border-radius:999px",
    "background:rgba(34,26,53,.94)",
    "color:rgb(236,231,255)",
    "font:650 13px/18px system-ui,sans-serif",
    "box-shadow:0 10px 30px rgba(0,0,0,.3)",
    "cursor:pointer",
    "backdrop-filter:blur(12px)",
  ].join(";");
  button.addEventListener("click", () => {
    if (running) {
      stopRequested = true;
      updateControl("Stopping after this batch…");
      return;
    }
    const current = detectXOwnedProfilePage(location.href);
    if (!current) return;
    if (current.route !== "media") {
      const next = new URL(current.mediaUrl);
      next.searchParams.set("ourchival_sync", "1");
      location.assign(next.toString());
      return;
    }
    void startSync();
  });
  document.documentElement.append(button);
}

async function startSync() {
  const context = detectXOwnedProfilePage(location.href);
  if (!context || context.route !== "media" || running) return;
  running = true;
  stopRequested = false;
  const state = emptyXOwnedSyncState();
  let captureFailures = 0;
  let stableRounds = 0;
  let previousSignature = "";
  let previousHeight = 0;
  let stopReason = "bounded window complete";

  try {
    window.scrollTo({ top: 0 });
    await wait(500);
    for (let round = 0; round < maximumRounds; round += 1) {
      if (stopRequested) {
        stopReason = "stopped with progress kept";
        break;
      }

      const articles = Array.from(
        document.querySelectorAll<HTMLElement>("article"),
      );
      const snapshots = articles.map(snapshotXOwnedArticle);
      const sourceUrls = classifiedAuthoredMediaSourceUrls(
        snapshots,
        xOwnedProfileHandle,
      );
      const knownSourceUrls = await queryIndexedSourceUrls(sourceUrls);
      const result = processXOwnedRound({
        snapshots,
        knownSourceUrls,
        state,
        expectedHandle: xOwnedProfileHandle,
      });

      if (result.payloads.length > 0) {
        for (let start = 0; start < result.payloads.length; start += capturePayloadChunk) {
          if (stopRequested) break;
          const response = (await chrome.runtime.sendMessage({
            type: "OURCHIVAL_CAPTURE_PAYLOADS",
            source: "x_post",
            payloads: result.payloads.slice(start, start + capturePayloadChunk),
          })) as
            | {
                ok?: boolean;
                error?: string;
                state?: { failed?: number };
              }
            | undefined;
          if (!response?.ok) {
            throw new Error(
              response?.error || "Ourchival could not save this X media batch.",
            );
          }
          captureFailures += response.state?.failed ?? 0;
        }
      }

      updateControl(progressLabel(state, captureFailures));
      if (result.knownBoundaryReached) {
        stopReason = "caught up at already archived posts";
        break;
      }
      if (result.recentWindowReached) {
        stopReason = "recent 200-media-post window complete";
        break;
      }

      const scrollHeight = document.documentElement.scrollHeight;
      const signature = visibleTimelineSignature(articles);
      const stable = signature === previousSignature && scrollHeight === previousHeight;
      const nearBottom =
        window.scrollY + window.innerHeight >= scrollHeight - 260;
      const loading = Boolean(document.querySelector('[role="progressbar"]'));
      stableRounds = stable && nearBottom && !loading ? stableRounds + 1 : 0;
      previousSignature = signature;
      previousHeight = scrollHeight;
      if (stableRounds >= stableBottomLimit) {
        stopReason = "rendered media timeline end reached";
        break;
      }

      if (stableRounds >= 5 && stableRounds % 5 === 0) {
        window.scrollBy({ top: -Math.max(320, window.innerHeight * 0.4) });
        await wait(180);
        window.scrollBy({ top: Math.max(850, window.innerHeight * 1.05) });
      } else {
        window.scrollBy({ top: Math.max(620, window.innerHeight * 0.82) });
      }
      await wait(Math.min(1_300, 480 + stableRounds * 45));
    }

    lastSummary = finalLabel(state, captureFailures, stopReason);
    updateControl(lastSummary);
  } catch (error) {
    lastSummary = `X sync stopped · ${error instanceof Error ? error.message : "unknown error"}`;
    updateControl(lastSummary, true);
  } finally {
    running = false;
    stopRequested = false;
  }
}

function snapshotXOwnedArticle(article: Element): XOwnedProfileSnapshot {
  const links = Array.from(
    article.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ).map((link) => ({ href: link.href, text: link.textContent?.trim() || undefined }));
  const images = Array.from(
    article.querySelectorAll<HTMLImageElement>("img"),
  ).map((image) => ({
    src: image.currentSrc || image.src,
    alt: image.alt || undefined,
    href: image.closest<HTMLAnchorElement>("a[href]")?.href,
  }));
  const userNameText = article
    .querySelector<HTMLElement>('[data-testid="User-Name"]')
    ?.innerText.trim();
  const tweetText = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const articleText = tweetText?.innerText.trim();
  const textLanguage = tweetText?.getAttribute("lang")?.trim();
  const timestamp =
    article.querySelector<HTMLTimeElement>("time[datetime]")?.dateTime;
  const engagementLabels = Array.from(
    article.querySelectorAll<HTMLElement>("[aria-label]"),
  )
    .map((element) => element.getAttribute("aria-label")?.trim())
    .filter((label): label is string => Boolean(label))
    .slice(0, 30);

  return {
    pageUrl: location.href,
    pageTitle: document.title,
    ...(articleText ? { articleText } : {}),
    ...(textLanguage ? { textLanguage } : {}),
    ...(userNameText ? { userNameText } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(engagementLabels.length ? { engagementLabels } : {}),
    links,
    images,
  };
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

function visibleTimelineSignature(articles: Element[]) {
  const ids = new Set<string>();
  for (const article of articles) {
    for (const anchor of article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
      const match = anchor.href.match(/\/status\/(\d+)/);
      if (match?.[1]) ids.add(match[1]);
    }
  }
  return Array.from(ids).sort().join(",");
}

function progressLabel(
  state: ReturnType<typeof emptyXOwnedSyncState>,
  failures: number,
) {
  return `Syncing · ${state.newPosts} new · ${state.existingPosts} existing${failures ? ` · ${failures} failed` : ""}`;
}

function finalLabel(
  state: ReturnType<typeof emptyXOwnedSyncState>,
  failures: number,
  reason: string,
) {
  return `${state.newPosts} new · ${state.existingPosts} existing · ${reason}${failures ? ` · ${failures} failed` : ""}`;
}

function updateControl(value: string, error = false) {
  lastSummary = value;
  const button = document.getElementById(controlId) as HTMLButtonElement | null;
  if (!button) return;
  button.textContent = value;
  button.style.borderColor = error
    ? "rgba(239,132,145,.75)"
    : "rgba(190,170,255,.62)";
  button.style.color = error ? "rgb(255,205,211)" : "rgb(236,231,255)";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
