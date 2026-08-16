import type { CapturePayload } from "@ourchival/shared";
import {
  getSettings,
  normalizeCaptureEndpoint,
  saveLastCapture,
  saveLastResult,
  type CaptureResult,
} from "./storage";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-image-to-ourchival",
    title: "Save image to Ourchival",
    contexts: ["image"],
  });

  chrome.contextMenus.create({
    id: "save-link-to-ourchival",
    title: "Save link to Ourchival",
    contexts: ["link"],
  });

  chrome.contextMenus.create({
    id: "save-page-to-ourchival",
    title: "Save page to Ourchival",
    contexts: ["page", "selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const payload = buildCapturePayload(info, tab);

  await saveLastCapture(payload);
  await chrome.action.setBadgeText({ text: "…" });
  await chrome.action.setBadgeBackgroundColor({ color: "#7b684f" });

  const settings = await getSettings();
  const endpoint = normalizeCaptureEndpoint(settings.captureEndpoint);

  if (!endpoint) {
    await markResult({
      ok: false,
      message: "Add your Convex site URL in the Ourchival popup.",
      savedAt: new Date().toISOString(),
    });
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      referenceId?: string;
      assetId?: string | null;
      storageStatus?: string;
      status?: "saved" | "already_saved";
      alreadySaved?: boolean;
    };

    const ok = response.ok && body.ok !== false;
    const alreadySaved = body.status === "already_saved" || body.alreadySaved === true;

    await markResult({
      ok,
      status: response.status,
      message: ok
        ? friendlyCaptureMessage(body.storageStatus, alreadySaved)
        : body.error ?? response.statusText,
      storageStatus: body.storageStatus,
      alreadySaved,
      referenceId: body.referenceId,
      assetId: body.assetId,
      savedAt: new Date().toISOString(),
    });
  } catch (error) {
    await markResult({
      ok: false,
      message: error instanceof Error ? error.message : "Capture request failed.",
      savedAt: new Date().toISOString(),
    });
  }
});

function buildCapturePayload(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): CapturePayload {
  if (info.srcUrl) {
    return {
      kind: "image",
      sourceUrl: info.pageUrl ?? tab?.url ?? info.srcUrl,
      assetUrl: info.srcUrl,
      pageTitle: tab?.title,
      selectedText: info.selectionText,
      capturedAt: new Date().toISOString(),
    };
  }

  if (info.linkUrl) {
    return {
      kind: "link",
      sourceUrl: info.linkUrl,
      pageTitle: tab?.title,
      selectedText: info.selectionText,
      capturedAt: new Date().toISOString(),
    };
  }

  return {
    kind: "page",
    sourceUrl: info.pageUrl ?? tab?.url ?? "",
    pageTitle: tab?.title,
    selectedText: info.selectionText,
    capturedAt: new Date().toISOString(),
  };
}

async function markResult(result: CaptureResult) {
  await saveLastResult(result);
  await chrome.action.setBadgeText({ text: result.alreadySaved ? "=" : result.ok ? "✓" : "!" });
  await chrome.action.setBadgeBackgroundColor({
    color: result.alreadySaved ? "#7b684f" : result.ok ? "#3d6b3d" : "#8a3d3d",
  });
}

function friendlyCaptureMessage(storageStatus: string | undefined, alreadySaved: boolean) {
  if (alreadySaved) return "Already in Reliquary — no duplicate added.";
  if (storageStatus === "link only") return "Link tucked into Reliquary.";
  if (storageStatus?.includes("Google Drive")) return "Saved to Reliquary · Google Drive original.";
  if (storageStatus?.includes("Convex Storage")) return "Saved to Reliquary · Convex fallback original.";
  if (storageStatus?.startsWith("fetch failed")) return "Metadata saved · image fetch was blocked.";
  if (storageStatus === "remote asset too large") return "Metadata saved · image was too large to copy.";

  return ["Saved to Reliquary.", storageStatus].filter(Boolean).join(" ");
}
