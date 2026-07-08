import type { CapturePayload } from "@ourchival/shared";

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

  await chrome.storage.local.set({ lastCapture: payload });

  // V1 placeholder:
  // Send this payload to a Convex HTTP action or open the popup for confirmation.
  console.log("Ourchival capture", payload);
});
