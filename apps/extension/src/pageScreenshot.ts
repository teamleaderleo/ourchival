import type { PageScreenshotCapture } from "@ourchival/shared";
import {
  callArtifactMutation,
  commitArtifactMutation,
  discardRejectedArtifact,
} from "./artifactMutationClient";
import { trackArtifactResult } from "./artifactWarnings";
import {
  convexMutationUrl,
  type SessionReportConnection,
} from "./sessionReporting";

const jpegQuality = 62;
const maxScreenshotBytes = 12_000_000;

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
  const finish = <T extends { uploaded: boolean; reason?: string; error?: string }>(
    result: T,
  ) => trackArtifactResult(referenceId, "page_screenshot", result);
  const endpoint = convexMutationUrl(connection.endpoint);
  if (!endpoint) {
    return await finish({
      uploaded: false,
      reason: "unsupported_endpoint" as const,
      error: "The configured Convex endpoint does not support screenshot uploads.",
    });
  }

  try {
    const file = await screenshotFile(screenshot.dataUrl);
    if (file.size > maxScreenshotBytes) {
      return await finish({
        uploaded: false,
        reason: "file_too_large" as const,
        error: "Screenshot is too large to upload.",
      });
    }
    const create = await callArtifactMutation<{
      referenceId: string;
      uploadUrl: string;
    }>(endpoint, "pageSnapshots:createBrowserScreenshotUpload", {
      deviceToken: connection.deviceToken,
      referenceId,
    });
    if (!create.ok) return await finish(create);

    const uploadResponse = await fetch(create.value.uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const uploadBody = (await uploadResponse.json().catch(() => ({}))) as {
      storageId?: string;
    };
    if (!uploadResponse.ok || !uploadBody.storageId) {
      return await finish({
        uploaded: false,
        reason: "upload_failed" as const,
        error: uploadResponse.statusText || "Screenshot file upload failed.",
      });
    }

    const commit = await commitArtifactMutation<{
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
    if (!commit.ok) {
      if (!commit.retryable) {
        await discardRejectedArtifact(
          endpoint,
          connection.deviceToken,
          uploadBody.storageId,
        );
      }
      return await finish(commit);
    }

    return await finish({
      uploaded: true as const,
      duplicate: Boolean(commit.value.duplicate),
      artifactId: commit.value.artifactId,
    });
  } catch (error) {
    return await finish({
      uploaded: false,
      reason: "request_failed" as const,
      error: error instanceof Error ? error.message : "Screenshot upload failed.",
    });
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
