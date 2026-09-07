import { detectPixivOwnedProfile } from "./pixivOwnedProfile";
import { scanPixivOwnedProfile } from "./pixivOwnedProfileReader";

const context = detectPixivOwnedProfile(location.href);
let active: Promise<void> | undefined;
let stopped = false;

if (context) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "OURCHIVAL_START_SOURCE_INTAKE") {
      if (message.provider !== "pixiv_owned_profile") {
        sendResponse({ ok: false, error: "This reader only handles Pixiv creator works." });
        return;
      }
      if (String(message.sourceUrl ?? "") !== context.sourceUrl) {
        sendResponse({ ok: false, error: "The Pixiv creator checkpoint does not match this page." });
        return;
      }
      if (active) {
        sendResponse({ ok: true, alreadyRunning: true });
        return;
      }
      stopped = false;
      const importId = String(message.importId ?? "");
      const known =
        message.purpose === "sync" && Array.isArray(message.knownProviderIds)
          ? new Set<string>(message.knownProviderIds)
          : undefined;
      active = run(importId, known).finally(() => {
        active = undefined;
      });
      sendResponse({ ok: true, started: true });
      return;
    }

    if (message?.type === "OURCHIVAL_STOP_SOURCE_INTAKE") {
      stopped = true;
      sendResponse({ ok: true });
      return;
    }
  });
}

async function run(importId: string, known?: Set<string>) {
  if (!context || !importId) return;
  const heartbeat = beginReaderHeartbeat(importId);
  try {
    heartbeat.reading();
    const chunk = await scanPixivOwnedProfile({
      context,
      currentUrl: location.href,
      known,
      stopped: () => stopped,
      request: pixivRequest,
    });
    if (stopped) throw new Error("Paused; current Pixiv profile chunk will be replayed.");
    heartbeat.saving();
    const response = (await chrome.runtime.sendMessage({
      type: "OURCHIVAL_SOURCE_INTAKE_CHUNK",
      importId,
      chunk,
    })) as
      | { ok?: boolean; continue?: boolean; nextUrl?: string; error?: string }
      | undefined;
    if (!response?.ok) {
      throw new Error(response?.error || "Ourchival could not save this Pixiv profile chunk.");
    }
    if (response.continue && response.nextUrl && response.nextUrl !== location.href) {
      location.assign(response.nextUrl);
    }
  } finally {
    heartbeat.stop();
  }
}

async function pixivRequest(path: string): Promise<unknown> {
  const url = new URL(path, "https://www.pixiv.net");
  if (url.origin !== "https://www.pixiv.net" || !url.pathname.startsWith("/ajax/")) {
    throw new Error("Pixiv reader refused an unexpected metadata URL.");
  }
  const response = await fetch(url, {
    credentials: "same-origin",
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Pixiv metadata HTTP ${response.status}`);
  return response.json();
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
