import type { PageStructuredSnapshotCapture } from "@ourchival/shared";
import {
  callArtifactMutation,
  commitArtifactMutation,
} from "./artifactMutationClient";
import {
  convexMutationUrl,
  type SessionReportConnection,
} from "./sessionReporting";

const maxStructuredSnapshotBytes = 1_500_000;

export async function uploadStructuredPageSnapshot(
  connection: SessionReportConnection,
  referenceId: string | undefined,
  capture: PageStructuredSnapshotCapture | undefined,
) {
  if (!referenceId || !capture) {
    return { uploaded: false, reason: "missing_capture" as const };
  }
  const endpoint = convexMutationUrl(connection.endpoint);
  if (!endpoint) {
    return { uploaded: false, reason: "unsupported_endpoint" as const };
  }

  try {
    const file = new Blob([capture.data], {
      type: "application/json;charset=utf-8",
    });
    if (file.size < 40 || file.size > maxStructuredSnapshotBytes) {
      return {
        uploaded: false,
        reason: "invalid_size" as const,
        error: "Structured page snapshot size is invalid.",
      };
    }
    const create = await callArtifactMutation<{
      referenceId: string;
      uploadUrl: string;
    }>(endpoint, "pageStructuredSnapshots:createBrowserSnapshotUpload", {
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
        error: uploadResponse.statusText || "Structured snapshot upload failed.",
      };
    }

    const commit = await commitArtifactMutation<{
      artifactId?: string;
      storageId?: string;
      duplicate?: boolean;
    }>(endpoint, "pageStructuredSnapshots:commitBrowserSnapshot", {
      deviceToken: connection.deviceToken,
      referenceId,
      storageId: uploadBody.storageId,
      provider: capture.provider,
      capturedAt: Date.parse(capture.capturedAt),
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
      error: error instanceof Error
        ? error.message
        : "Structured snapshot upload failed.",
    };
  }
}
