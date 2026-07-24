import type { PageReadableTextCapture } from "@ourchival/shared";
import {
  callArtifactMutation,
  commitArtifactMutation,
} from "./artifactMutationClient";
import { trackArtifactResult } from "./artifactWarnings";
import {
  convexMutationUrl,
  type SessionReportConnection,
} from "./sessionReporting";

const maxReadableTextBytes = 500_000;

export async function uploadReadablePageText(
  connection: SessionReportConnection,
  referenceId: string | undefined,
  capture: PageReadableTextCapture | undefined,
) {
  if (!referenceId || !capture) {
    return { uploaded: false, reason: "missing_capture" as const };
  }
  const finish = <T extends { uploaded: boolean; reason?: string; error?: string }>(
    result: T,
  ) => trackArtifactResult(referenceId, "readable_text", result);
  const endpoint = convexMutationUrl(connection.endpoint);
  if (!endpoint) {
    return await finish({
      uploaded: false,
      reason: "unsupported_endpoint" as const,
      error: "The configured Convex endpoint does not support readable text uploads.",
    });
  }

  try {
    const file = new Blob([capture.text], {
      type: "text/plain;charset=utf-8",
    });
    if (file.size < 80 || file.size > maxReadableTextBytes) {
      return await finish({
        uploaded: false,
        reason: "invalid_size" as const,
        error: "Readable page content size is invalid.",
      });
    }
    const create = await callArtifactMutation<{
      referenceId: string;
      uploadUrl: string;
    }>(endpoint, "pageText:createBrowserReadableTextUpload", {
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
        error: uploadResponse.statusText || "Readable text upload failed.",
      });
    }

    const commit = await commitArtifactMutation<{
      artifactId?: string;
      storageId?: string;
      duplicate?: boolean;
    }>(endpoint, "pageText:commitBrowserReadableText", {
      deviceToken: connection.deviceToken,
      referenceId,
      storageId: uploadBody.storageId,
      source: capture.source,
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
      error: error instanceof Error ? error.message : "Readable text upload failed.",
    });
  }
}
