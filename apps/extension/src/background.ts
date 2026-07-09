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
    id: "save-page-to-ourchival",
    title: "Save page to Ourchival",
    contexts: ["page", "selection", "link"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const payload: CapturePayload = {
    kind: info.srcUrl ? "image" : "page",
    sourceUrl: info.pageUrl ?? tab?.url ?? "",
    assetUrl: info.srcUrl,
    pageTitle: tab?.title,
    selectedText: info.selectionText,
    capturedAt: new Date().toISOString(),
  };

  await saveLastCapture(payload);

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
    };

    await markResult({
      ok: response.ok && body.ok !== false,
      status: response.status,
      message: response.ok ? "Saved to Ourchival." : body.error ?? response.statusText,
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

async function markResult(result: CaptureResult) {
  await saveLastResult(result);
  await chrome.action.setBadgeText({ text: result.ok ? "✓" : "!" });
  await chrome.action.setBadgeBackgroundColor({ color: result.ok ? "#3d6b3d" : "#8a3d3d" });
}
