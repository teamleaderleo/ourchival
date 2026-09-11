"use node";

import { createHash } from "node:crypto";
import { internalAction } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { uploadDerivativeToDrive } from "./lib/drive";

type JobArgs = { jobId: Id<"enrichmentJobs"> };
type DerivativeKind = "preview" | "thumb";
type JobContext = {
  job: Doc<"enrichmentJobs">;
  asset: Doc<"assets">;
  reference: Doc<"references">;
  previewStorageUrl: string | null;
  thumbStorageUrl: string | null;
};
type VerifiedFile = { id: string; size: number; md5Checksum: string };
type CompleteArgs = {
  jobId: Id<"enrichmentJobs">;
  assetId: Id<"assets">;
  preview?: VerifiedFile;
  thumb?: VerifiedFile;
  resultSummary?: string;
};
type FailArgs = JobArgs & { error: string };

const getDriveJobContext = makeFunctionReference<
  "query",
  JobArgs,
  JobContext | null
>("driveDerivatives:getDriveJobContext") as unknown as FunctionReference<
  "query",
  "internal",
  JobArgs,
  JobContext | null
>;
const claimJob = makeFunctionReference<"mutation", JobArgs, boolean>(
  "enrichmentJobs:claim",
) as unknown as FunctionReference<"mutation", "internal", JobArgs, boolean>;
const completeJob = makeFunctionReference<
  "mutation",
  CompleteArgs,
  { status: "succeeded" }
>("driveDerivatives:complete") as unknown as FunctionReference<
  "mutation",
  "internal",
  CompleteArgs,
  { status: "succeeded" }
>;
const failJob = makeFunctionReference<"mutation", FailArgs, boolean>(
  "enrichmentJobs:fail",
) as unknown as FunctionReference<"mutation", "internal", FailArgs, boolean>;

export const process = internalAction({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "succeeded" | "failed"; summary?: string } | null> => {
    const jobContext = await ctx.runQuery(getDriveJobContext, args);
    if (!jobContext || jobContext.job.status !== "queued") return null;

    const claimed = await ctx.runMutation(claimJob, args);
    if (!claimed) return null;

    try {
      const { asset, reference } = jobContext;
      const preview = await mirrorDerivative(
        ctx,
        asset,
        reference,
        "preview",
        jobContext.previewStorageUrl,
      );
      const thumb = await mirrorDerivative(
        ctx,
        asset,
        reference,
        "thumb",
        jobContext.thumbStorageUrl,
      );
      if (!preview && !thumb) {
        throw new Error("Asset has no stored derivatives to mirror.");
      }
      await ctx.runMutation(completeJob, {
        jobId: args.jobId,
        assetId: asset._id,
        ...(preview ? { preview } : {}),
        ...(thumb ? { thumb } : {}),
      });
      return { status: "succeeded" };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Drive derivative processor failed.";
      await ctx.runMutation(failJob, {
        jobId: args.jobId,
        error: message,
      });
      return { status: "failed", summary: message };
    }
  },
});

async function mirrorDerivative(
  ctx: any,
  asset: Doc<"assets">,
  reference: Doc<"references">,
  kind: DerivativeKind,
  storageUrl: string | null,
): Promise<VerifiedFile | null> {
  const storageId =
    kind === "preview" ? asset.previewStorageId : asset.thumbStorageId;
  if (!storageId || !storageUrl) return null;
  if (
    (kind === "preview" && asset.drivePreviewFileId) ||
    (kind === "thumb" && asset.driveThumbFileId)
  ) {
    return null;
  }

  const response = await fetch(storageUrl);
  if (!response.ok) {
    throw new Error(
      `Derivative fetch failed with HTTP ${response.status}.`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("Stored derivative is empty.");

  const contentType =
    response.headers.get("Content-Type") ?? "image/webp";
  const extension =
    contentType.toLowerCase().includes("avif") ? "avif" : "webp";
  const uploaded = await uploadDerivativeToDrive({
    blob: new Blob([new Uint8Array(bytes)], { type: contentType }),
    name: `${asset._id}-${kind}.${extension}`,
    sourceUrl: reference.sourceUrl,
    parentFolderId: asset.driveFolderId,
    mimeType: contentType,
  });
  if (!uploaded.ok || !uploaded.fileId) {
    throw new Error(uploaded.status);
  }
  // Verify the remote copy before recording its identity.
  verifyMirroredBytes(bytes, {
    size: uploaded.size,
    md5Checksum: uploaded.md5Checksum,
    label: kind,
  });
  return {
    id: uploaded.fileId,
    size: bytes.byteLength,
    md5Checksum: createHash("md5").update(bytes).digest("hex"),
  };
}

export function verifyMirroredBytes(
  local: Uint8Array,
  remote: { size?: number; md5Checksum?: string; label: string },
): string {
  const localMd5 = createHash("md5").update(local).digest("hex");
  if (
    remote.size !== local.byteLength ||
    (remote.md5Checksum ?? "").toLowerCase() !== localMd5
  ) {
    throw new Error(
      `Drive verification mismatch for ${remote.label} (size or checksum).`,
    );
  }
  return localMd5;
}
