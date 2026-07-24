import type { PageStructuredSnapshotCapture } from "@ourchival/shared";
import {
  callArtifactMutation,
  commitArtifactMutation,
} from "./artifactMutationClient";
import { trackArtifactResult } from "./artifactWarnings";
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
  const finish = <T extends { uploaded: boolean; reason?: string; error?: string }>(
    result: T,
  ) => trackArtifactResult(referenceId, "page_snapshot", result);
  const endpoint = convexMutationUrl(connection.endpoint);
  if (!endpoint) {
    return await finish({
      uploaded: false,
      reason: "unsupported_endpoint" as const,
      error: "The configured Convex endpoint does not support structured snapshots.",
    });
  }

  try {
    const file = new Blob([capture.data], {
      type: "application/json;charset=utf-8",
    });
    if (file.size < 40 || file.size > maxStructuredSnapshotBytes) {
      return await finish({
        uploaded: false,
        reason: "invalid_size" as const,
        error: "Structured page snapshot size is invalid.",
      });
    }
    const create = await callArtifactMutation<{
      referenceId: string;
      uploadUrl: string;
    }>(endpoint, "pageStructuredSnapshots:createBrowserSnapshotUpload", {
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
        error: uploadResponse.statusText || "Structured snapshot upload failed.",
      });
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
    if (!commit.ok) return await finish(commit);

    return await finish({
      uploaded: true as const,
      duplicate: Boolean(commit.value.duplicate),
      artifactId: commit.value.artifactId,
    });
  } catch (error) {
    return await finish({
      uploaded: false,
      reason: "request_failed" as const,
      error: error instanceof Error
        ? error.message
        : "Structured snapshot upload failed.",
    });
  }
}
