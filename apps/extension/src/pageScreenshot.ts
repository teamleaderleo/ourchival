import type { PageScreenshotCapture } from "@ourchival/shared";
import {
  convexMutationUrl,
  type SessionReportConnection,
} from "./sessionReporting";

const jpegQuality = 62;

type ConvexMutationResponse = {
  status?: "success" | "error";
  errorMessage?: string;
  value?: {
    artifactId?: string;
    storageId?: string;
    duplicate?: boolean;
  };
};

export async function captureVisiblePageScreenshot(
  tab: chrome.tabs.Tab | undefined,
): Promise<PageScreenshotCapture | undefined> {
  if (!tab?.active || typeof tab.windowId !== "number") return undefined;
  if (!isScreenshotUrl(tab.url)) return undefined;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: jpegQuality,
    });
    if (!dataUrl.startsWith("data:image/jpeg;base64,")) return undefined;
    return {
      dataUrl,
      ...(typeof tab.width === "number" ? { width: tab.width } : {}),
      ...(typeof tab.height === "number" ? { height: tab.height } : {}),
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

export async function uploadPageScreenshot(
  connection: SessionReportConnection,
  referenceId: string | undefined,
  screenshot: PageScreenshotCapture | undefined,
) {
  if (!referenceId || !screenshot) {
    return { uploaded: false, reason: "missing_capture" as const };
  }
  const endpoint = convexMutationUrl(connection.endpoint);
  if (!endpoint) {
    return { uploaded: false, reason: "unsupported_endpoint" as const };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "pageSnapshots:saveBrowserScreenshot",
        args: {
          deviceToken: connection.deviceToken,
          referenceId,
          dataUrl: screenshot.dataUrl,
          ...(screenshot.width ? { width: screenshot.width } : {}),
          ...(screenshot.height ? { height: screenshot.height } : {}),
          capturedAt: Date.parse(screenshot.capturedAt),
        },
        format: "json",
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ConvexMutationResponse;
    if (!response.ok || body.status === "error") {
      return {
        uploaded: false,
        reason: "request_failed" as const,
        error: body.errorMessage ?? response.statusText,
      };
    }
    return {
      uploaded: true as const,
      duplicate: Boolean(body.value?.duplicate),
      artifactId: body.value?.artifactId,
    };
  } catch (error) {
    return {
      uploaded: false,
      reason: "request_failed" as const,
      error: error instanceof Error ? error.message : "Screenshot upload failed.",
    };
  }
}

function isScreenshotUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
