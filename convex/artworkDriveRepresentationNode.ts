"use node";

import { createHash } from "node:crypto";
import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { fetchDriveFile } from "./lib/drive";
import {
  artworkRepresentationKind,
  artworkSourceApplication,
} from "./lib/artworkSchema";

const maxHashBytes = 256 * 1024 * 1024;

type RepresentationKind = "editable_source" | "master_export" | "web_derivative";
type SourceApplication =
  | "procreate"
  | "clip_studio_paint"
  | "blender"
  | "photoshop"
  | "other";

type AddRepresentationArgs = {
  accessKey: string;
  artworkId: Id<"artworks">;
  kind: RepresentationKind;
  storageProvider: "google_drive";
  driveFileId: string;
  fileName?: string;
  sourceApplication?: SourceApplication;
};
type UpdateRepresentationArgs = {
  accessKey: string;
  representationId: Id<"artworkRepresentations">;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  contentHash?: string;
  sourceApplication?: SourceApplication;
};
type HistoricalReconcileArgs = { contentHash: string };
type HistoricalReconcileResult = {
  contentHash: string;
  matchedAssets: number;
  referencesChecked: number;
  linked: number;
  truncated: boolean;
  results: Array<{ referenceId: string; status: string; changed: boolean }>;
};

const addRepresentation = makeFunctionReference<
  "mutation",
  AddRepresentationArgs,
  Doc<"artworkRepresentations"> | null
>("artworks:addRepresentation");
const updateRepresentation = makeFunctionReference<
  "mutation",
  UpdateRepresentationArgs,
  Doc<"artworkRepresentations"> | null
>("artworks:updateRepresentation");
const reconcileHistorical = makeFunctionReference<
  "mutation",
  HistoricalReconcileArgs,
  HistoricalReconcileResult
>("artworkAutoLink:reconcileReferencesForContentHashInternal") as unknown as FunctionReference<
  "mutation",
  "internal",
  HistoricalReconcileArgs,
  HistoricalReconcileResult
>;

export const attachDrive = action({
  args: {
    accessKey: v.string(),
    artworkId: v.id("artworks"),
    kind: artworkRepresentationKind,
    driveFileId: v.string(),
    fileName: v.optional(v.string()),
    sourceApplication: v.optional(artworkSourceApplication),
  },
  handler: async (ctx, args) => {
    const representation = await ctx.runMutation(addRepresentation, {
      accessKey: args.accessKey,
      artworkId: args.artworkId,
      kind: args.kind,
      storageProvider: "google_drive",
      driveFileId: args.driveFileId,
      ...(args.fileName ? { fileName: args.fileName } : {}),
      ...(args.sourceApplication
        ? { sourceApplication: args.sourceApplication }
        : {}),
    });
    if (!representation) throw new Error("Could not attach the Drive representation.");

    if (args.kind === "editable_source") {
      return {
        representation,
        hashStatus: "skipped_editable_source" as const,
        reconciliation: null,
      };
    }

    const existingHash = normalizeSha256(representation.contentHash);
    if (existingHash) {
      const reconciliation = await ctx.runMutation(reconcileHistorical, {
        contentHash: existingHash,
      });
      return {
        representation,
        hashStatus: "already_hashed" as const,
        contentHash: existingHash,
        reconciliation,
      };
    }

    let response: Response;
    try {
      response = await fetchDriveFile(args.driveFileId);
    } catch (error) {
      return {
        representation,
        hashStatus: "unavailable" as const,
        error:
          error instanceof Error
            ? error.message
            : "Google Drive file could not be fetched.",
        reconciliation: null,
      };
    }
    if (!response.ok || !response.body) {
      return {
        representation,
        hashStatus: "unavailable" as const,
        error: `Google Drive file fetch failed with HTTP ${response.status}.`,
        reconciliation: null,
      };
    }

    let hashed: Awaited<ReturnType<typeof hashResponseBody>>;
    try {
      hashed = await hashResponseBody(response, maxHashBytes);
    } catch (error) {
      return {
        representation,
        hashStatus: "unavailable" as const,
        error:
          error instanceof Error
            ? error.message
            : "Drive file could not be hashed.",
        reconciliation: null,
      };
    }

    const updated = await ctx.runMutation(updateRepresentation, {
      accessKey: args.accessKey,
      representationId: representation._id,
      contentHash: hashed.contentHash,
      fileSize: hashed.fileSize,
      ...(hashed.mimeType ? { mimeType: hashed.mimeType } : {}),
      ...(args.fileName ? { fileName: args.fileName } : {}),
      ...(args.sourceApplication
        ? { sourceApplication: args.sourceApplication }
        : {}),
    });
    if (!updated) throw new Error("Drive representation disappeared while hashing.");

    const reconciliation = await ctx.runMutation(reconcileHistorical, {
      contentHash: hashed.contentHash,
    });
    return {
      representation: updated,
      hashStatus: "ready" as const,
      contentHash: hashed.contentHash,
      fileSize: hashed.fileSize,
      reconciliation,
    };
  },
});

export async function hashResponseBody(
  response: Response,
  maxBytes = maxHashBytes,
) {
  if (!response.ok || !response.body) {
    throw new Error("Drive response has no readable body.");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Hash byte limit is invalid.");
  }
  const declared = Number(response.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Drive file exceeds the ${formatMegabytes(maxBytes)} MB hashing limit.`);
  }

  const hash = createHash("sha256");
  const reader = response.body.getReader();
  let fileSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      fileSize += value.byteLength;
      if (fileSize > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(
          `Drive file exceeds the ${formatMegabytes(maxBytes)} MB hashing limit.`,
        );
      }
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (fileSize === 0) throw new Error("Drive file is empty.");

  const mimeType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim();
  return {
    contentHash: hash.digest("hex"),
    fileSize,
    ...(mimeType ? { mimeType } : {}),
  };
}

function normalizeSha256(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{64}$/.test(normalized)
    ? normalized
    : undefined;
}

function formatMegabytes(bytes: number) {
  return Math.round(bytes / (1024 * 1024));
}
