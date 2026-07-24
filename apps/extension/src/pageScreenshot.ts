import type { PageScreenshotCapture } from "@ourchival/shared";
import {
  convexMutationUrl,
  type SessionReportConnection,
} from "./sessionReporting";

const jpegQuality = 62;
const maxScreenshotBytes = 12_000_000;

type ConvexMutationResponse<T> = {
  status?: "success" | "error";
  errorMessage?: string;
  value?: T;
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
    const file = await screenshotFile(screenshot.dataUrl);
    if (file.size > maxScreenshotBytes) {
      return {
        uploaded: false,
        reason: "file_too_large" as const,
        error: "Screenshot is too large to upload.",
      };
    }
    const create = await callConvexMutation<{
      referenceId: string;
      uploadUrl: string;
    }>(endpoint, "pageSnapshots:createBrowserScreenshotUpload", {
      deviceToken: connection.deviceToken,
      referenceId,
    });
    if (!create.ok) return create;

    const uploadResponse = await fetch(create.value.uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const uploadBody = (await uploadResponse.json().catch(() => ({}))) as {
      storageId?: string;
    };
    if (!uploadResponse.ok || !uploadBody.storageId) {
      return {
        uploaded: false,
        reason: "upload_failed" as const,
        error: uploadResponse.statusText || "Screenshot file upload failed.",
      };
    }

    const commit = await callConvexMutation<{
      artifactId?: string;
      storageId?: string;
      duplicate?: boolean;
    }>(endpoint, "pageSnapshots:commitBrowserScreenshot", {
      deviceToken: connection.deviceToken,
      referenceId,
      storageId: uploadBody.storageId,
      ...(screenshot.width ? { width: screenshot.width } : {}),
      ...(screenshot.height ? { height: screenshot.height } : {}),
      capturedAt: Date.parse(screenshot.capturedAt),
    });
    if (!commit.ok) return commit;

    return {
      uploaded: true as const,
      duplicate: Boolean(commit.value.duplicate),
      artifactId: commit.value.artifactId,
    };
  } catch (error) {
    return {
      uploaded: false,
      reason: "request_failed" as const,
      error: error instanceof Error ? error.message : "Screenshot upload failed.",
    };
  }
}

export function isScreenshotUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function screenshotFile(dataUrl: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (
    blob.type !== "image/jpeg" &&
    blob.type !== "image/png" &&
    blob.type !== "image/webp"
  ) {
    throw new Error("Screenshot must be a JPEG, PNG, or WebP image.");
  }
  return blob;
}

async function callConvexMutation<T>(
  endpoint: string,
  path: string,
  args: Record<string, unknown>,
): Promise<
  | { ok: true; value: T }
  | { uploaded: false; reason: "request_failed"; error: string; ok: false }
> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const body = (await response.json().catch(() => ({}))) as ConvexMutationResponse<T>;
  if (!response.ok || body.status === "error" || body.value === undefined) {
    return {
      ok: false,
      uploaded: false,
      reason: "request_failed",
      error: body.errorMessage ?? response.statusText ?? "Convex mutation failed.",
    };
  }
  return { ok: true, value: body.value };
}
