import {
  discoverHoYoLabArticleIdentities,
  mergeHoYoLabDiscoveryQueue,
} from "./hoyolabOwnedDiscovery";
import {
  detectHoYoLabArticle,
  hoyolabFullPostEndpoint,
  hoyolabOwnedPost,
  hoyolabPostPublisherIdentity,
  type HoYoLabArticleIdentity,
} from "./hoyolabOwnedPost";
import {
  buildHoYoLabOwnedPayloads,
  unknownHoYoLabCandidates,
} from "./hoyolabOwnedSync";
import type { CapturePayload } from "@ourchival/shared";

const controlId = "ourchival-hoyolab-owned-sync";
const maximumCandidates = 80;
const captureChunkSize = 32;
let running = false;
let lastLabel = "Archive related creator works";

if (detectHoYoLabArticle(location.href)) {
  installControl();
  const observer = new MutationObserver(() => installControl());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function installControl() {
  const identity = detectHoYoLabArticle(location.href);
  const existing = document.getElementById(controlId) as HTMLButtonElement | null;
  if (!identity) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const button = document.createElement("button");
  button.id = controlId;
  button.type = "button";
  button.textContent = lastLabel;
  button.title =
    "Archive image posts from the same HoYoLAB creator as this seed article";
  button.style.cssText = [
    "position:fixed",
    "right:20px",
    "bottom:20px",
    "z-index:2147483646",
    "min-height:38px",
    "max-width:280px",
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
    if (!running) void archiveRelatedCreatorWorks(identity);
  });
  document.documentElement.append(button);
}

async function archiveRelatedCreatorWorks(seedIdentity: HoYoLabArticleIdentity) {
  if (running) return;
  running = true;
  let accepted = 0;
  let existing = 0;
  let foreign = 0;
  let failed = 0;
  let captureFailures = 0;

  try {
    updateControl("Reading seed creator…");
    const seedResponse = await fetchFullPost(seedIdentity.postId);
    const publisher = hoyolabPostPublisherIdentity(seedResponse, seedIdentity);

    const observedHrefs = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/article/"]'),
    ).map((anchor) => anchor.href);
    const discovered = discoverHoYoLabArticleIdentities(
      observedHrefs,
      maximumCandidates,
    );
    const queueIds = mergeHoYoLabDiscoveryQueue({
      currentPostId: seedIdentity.postId,
      discovered,
      maximum: maximumCandidates,
    });
    const byId = new Map(discovered.map((identity) => [identity.postId, identity]));
    const identities: HoYoLabArticleIdentity[] = [
      seedIdentity,
      ...queueIds
        .map((postId) => byId.get(postId))
        .filter((value): value is HoYoLabArticleIdentity => Boolean(value)),
    ];
    const indexed = await queryIndexedSourceUrls(
      identities.map((identity) => identity.sourceUrl),
    );
    existing = identities.filter((identity) => indexed.has(identity.sourceUrl)).length;
    const candidates = unknownHoYoLabCandidates(identities, indexed);
    let pendingPayloads: CapturePayload[] = [];

    for (const [index, identity] of candidates.entries()) {
      updateControl(
        `HoYoLAB · ${index + 1}/${candidates.length} · ${accepted} accepted`,
      );
      try {
        const response =
          identity.postId === seedIdentity.postId
            ? seedResponse
            : await fetchFullPost(identity.postId);
        const item = hoyolabOwnedPost(response, identity, publisher.uid);
        const payloads = buildHoYoLabOwnedPayloads(item);
        if (payloads.length === 0) continue;
        pendingPayloads.push(...payloads);
        accepted += 1;
        if (pendingPayloads.length >= captureChunkSize) {
          captureFailures += await flushPayloads(pendingPayloads);
          pendingPayloads = [];
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "HoYoLAB metadata failed.";
        if (
          message.includes("publisher does not match") ||
          message.includes("conflicting UIDs")
        ) {
          foreign += 1;
        } else {
          failed += 1;
        }
      }
    }

    if (pendingPayloads.length > 0) {
      captureFailures += await flushPayloads(pendingPayloads);
    }
    lastLabel = `${publisher.nickname ?? "Creator"} · ${accepted} archived · ${existing} existing${foreign ? ` · ${foreign} foreign skipped` : ""}${failed + captureFailures ? ` · ${failed + captureFailures} failed` : ""}`;
    updateControl(lastLabel, failed + captureFailures > 0);
  } catch (error) {
    lastLabel = `HoYoLAB sync stopped · ${error instanceof Error ? error.message : "unknown error"}`;
    updateControl(lastLabel, true);
  } finally {
    running = false;
  }
}

async function fetchFullPost(postId: string) {
  const response = await fetch(hoyolabFullPostEndpoint(postId), {
    credentials: "omit",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/json",
      "x-rpc-language": "en-us",
      "x-rpc-client_type": "4",
    },
  });
  if (!response.ok) throw new Error(`HoYoLAB metadata HTTP ${response.status}`);
  return response.json();
}

async function flushPayloads(payloads: CapturePayload[]) {
  let failures = 0;
  for (let start = 0; start < payloads.length; start += captureChunkSize) {
    const response = (await chrome.runtime.sendMessage({
      type: "OURCHIVAL_CAPTURE_PAYLOADS",
      source: "current_tab",
      payloads: payloads.slice(start, start + captureChunkSize),
    })) as
      | { ok?: boolean; error?: string; state?: { failed?: number } }
      | undefined;
    if (!response?.ok) {
      throw new Error(
        response?.error || "Ourchival could not save this HoYoLAB media batch.",
      );
    }
    failures += response.state?.failed ?? 0;
  }
  return failures;
}

async function queryIndexedSourceUrls(sourceUrls: string[]) {
  const indexed = new Set<string>();
  for (let start = 0; start < sourceUrls.length; start += 80) {
    const response = (await chrome.runtime
      .sendMessage({
        type: "OURCHIVAL_REFERENCE_STATUS",
        sourceUrls: sourceUrls.slice(start, start + 80),
      })
      .catch(() => undefined)) as
      { ok?: boolean; indexedSourceUrls?: string[] } | undefined;
    if (!response?.ok) continue;
    for (const sourceUrl of response.indexedSourceUrls ?? []) indexed.add(sourceUrl);
  }
  return indexed;
}

function updateControl(value: string, error = false) {
  lastLabel = value;
  const button = document.getElementById(controlId) as HTMLButtonElement | null;
  if (!button) return;
  button.textContent = value;
  button.style.borderColor = error
    ? "rgba(239,132,145,.75)"
    : "rgba(190,170,255,.62)";
  button.style.color = error ? "rgb(255,205,211)" : "rgb(236,231,255)";
}
