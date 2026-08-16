import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { fetchDriveFile, getDriveConfigurationStatus, uploadBlobToDrive } from "./lib/drive";
import { detectPlatform } from "./lib/platform";

const http = httpRouter();
const maxRemoteAssetBytes = 25 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

type CaptureBody = {
  kind?: "image" | "post" | "page" | "link" | "article" | "video_frame" | "file";
  sourceUrl?: string;
  assetUrl?: string;
  pageTitle?: string;
  selectedText?: string;
  capturedAt?: string;
};

type UpdateReferenceBody = {
  title?: string;
  notes?: string;
  favorite?: boolean;
  archived?: boolean;
};

type StoredRemoteAsset = {
  status: string;
  storageProvider: "google_drive" | "convex" | "linked";
  storageId?: Id<"_storage">;
  mimeType?: string;
  fileSize?: number;
  driveFileId?: string;
  driveFolderId?: string;
  driveWebViewLink?: string;
  driveWebContentLink?: string;
  driveThumbnailLink?: string;
  driveMimeType?: string;
};

type PersistedRemoteAsset = Omit<StoredRemoteAsset, "status">;

http.route({
  path: "/capture",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});

http.route({
  path: "/references",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});

http.route({
  path: "/reference",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});

http.route({
  path: "/drive-file",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});

http.route({
  path: "/storage-status",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});

http.route({
  path: "/storage-status",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const origin = new URL(request.url).origin;

    return jsonResponse(
      {
        ok: true,
        ...getDriveConfigurationStatus(),
        captureEndpoint: `${origin}/capture`,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  }),
});

http.route({
  path: "/drive-file",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const fileId = url.searchParams.get("id");

    if (!fileId) {
      return jsonResponse({ ok: false, error: "id is required" }, 400);
    }

    const driveResponse = await fetchDriveFile(fileId);

    if (!driveResponse.ok || !driveResponse.body) {
      return jsonResponse(
        { ok: false, error: `Drive file fetch failed: ${driveResponse.status}` },
        driveResponse.status,
      );
    }

    return new Response(driveResponse.body, {
      status: driveResponse.status,
      headers: {
        ...corsHeaders,
        "Content-Type": driveResponse.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }),
});

http.route({
  path: "/references",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const origin = new URL(request.url).origin;
    const references = await ctx.runQuery(internal.httpData.listReferences, {});
    const items = references.map((reference) => ({
      ...reference,
      assets: reference.assets.map((asset) => ({
        ...asset,
        storedUrl: asset.driveFileId
          ? `${origin}/drive-file?id=${encodeURIComponent(asset.driveFileId)}`
          : asset.storedUrl,
      })),
    }));

    return jsonResponse({ ok: true, references: items });
  }),
});

http.route({
  path: "/reference",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const referenceId = url.searchParams.get("id");

    if (!referenceId) {
      return jsonResponse({ ok: false, error: "id is required" }, 400);
    }

    let body: UpdateReferenceBody;

    try {
      body = (await request.json()) as UpdateReferenceBody;
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }

    const patch = {
      ...(typeof body.title === "string" ? { title: body.title.trim() } : {}),
      ...(typeof body.notes === "string" ? { notes: body.notes.trim() } : {}),
      ...(typeof body.favorite === "boolean" ? { favorite: body.favorite } : {}),
      ...(typeof body.archived === "boolean" ? { archived: body.archived } : {}),
    };

    const updated = await ctx.runMutation(internal.httpData.updateReference, {
      referenceId,
      ...patch,
    });

    if (!updated) {
      return jsonResponse({ ok: false, error: "Reference not found" }, 404);
    }

    return jsonResponse({ ok: true });
  }),
});

http.route({
  path: "/reference",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const referenceId = url.searchParams.get("id");

    if (!referenceId) {
      return jsonResponse({ ok: false, error: "id is required" }, 400);
    }

    const deleted = await ctx.runMutation(internal.httpData.softDeleteReference, {
      referenceId,
    });

    if (!deleted) {
      return jsonResponse({ ok: false, error: "Reference not found" }, 404);
    }

    return jsonResponse({ ok: true });
  }),
});

http.route({
  path: "/capture",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: CaptureBody;

    try {
      body = (await request.json()) as CaptureBody;
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }

    const sourceUrl = cleanString(body.sourceUrl);
    const assetUrl = cleanString(body.assetUrl);
    const pageTitle = cleanString(body.pageTitle);
    const selectedText = cleanString(body.selectedText);

    if (!sourceUrl) {
      return jsonResponse({ ok: false, error: "sourceUrl is required" }, 400);
    }

    const capturedAt = parseCapturedAt(body.capturedAt);
    const kind = body.kind ?? (assetUrl ? "image" : "link");
    const platform = detectPlatform(sourceUrl);

    const existingCapture = await ctx.runQuery(internal.httpData.findDuplicate, {
      sourceUrl,
      ...(assetUrl ? { assetUrl } : {}),
    });

    if (existingCapture) {
      return alreadySavedResponse(existingCapture);
    }

    let storedAsset: StoredRemoteAsset | undefined;
    let storageStatus = assetUrl ? "asset pending" : "link only";

    if (assetUrl) {
      storedAsset = await fetchAndStoreRemoteAsset(ctx, {
        assetUrl,
        sourceUrl,
        title: pageTitle,
      });
      storageStatus = storedAsset.status;
    }

    const capture = await ctx.runMutation(internal.httpData.createCapture, {
      kind,
      sourceUrl,
      ...(assetUrl ? { assetUrl } : {}),
      ...(pageTitle ? { pageTitle } : {}),
      ...(selectedText ? { selectedText } : {}),
      capturedAt,
      platform,
      jsonMetadata: JSON.stringify({ ...body, storageStatus }),
      ...(storedAsset ? { storedAsset: persistStoredAsset(storedAsset) } : {}),
    });

    if (capture.alreadySaved) {
      if (storedAsset?.storageProvider === "convex" && storedAsset.storageId) {
        await ctx.storage.delete(storedAsset.storageId);
      }

      return alreadySavedResponse(capture);
    }

    return jsonResponse(
      {
        ok: true,
        status: "saved",
        referenceId: capture.referenceId,
        assetId: capture.assetId,
        storageStatus,
      },
      201,
    );
  }),
});

async function fetchAndStoreRemoteAsset(
  ctx: Pick<ActionCtx, "storage">,
  args: { assetUrl: string; sourceUrl: string; title?: string },
): Promise<StoredRemoteAsset> {
  try {
    const response = await fetch(args.assetUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      return { status: `fetch failed: ${response.status}`, storageProvider: "linked" };
    }

    const mimeType = response.headers.get("Content-Type") ?? undefined;
    const contentLength = Number(response.headers.get("Content-Length") ?? 0);

    if (contentLength > maxRemoteAssetBytes) {
      return { status: "remote asset too large", storageProvider: "linked" };
    }

    if (mimeType && !mimeType.toLowerCase().startsWith("image/")) {
      return { status: `remote asset is ${mimeType}`, storageProvider: "linked" };
    }

    const blob = await response.blob();

    if (blob.size > maxRemoteAssetBytes) {
      return { status: "remote asset too large", storageProvider: "linked" };
    }

    const driveUpload = await uploadBlobToDrive({
      blob,
      sourceUrl: args.sourceUrl,
      title: args.title,
      mimeType,
    });

    if (driveUpload.ok && driveUpload.file?.id) {
      return {
        status: driveUpload.status,
        storageProvider: "google_drive",
        mimeType,
        fileSize: blob.size,
        driveFileId: driveUpload.file.id,
        driveFolderId: driveUpload.file.parents?.[0],
        driveWebViewLink: driveUpload.file.webViewLink,
        driveWebContentLink: driveUpload.file.webContentLink,
        driveThumbnailLink: driveUpload.file.thumbnailLink,
        driveMimeType: driveUpload.file.mimeType,
      };
    }

    const storageId = await ctx.storage.store(blob);

    return {
      status: `${driveUpload.status}; stored original asset in Convex Storage fallback`,
      storageProvider: "convex",
      storageId,
      mimeType,
      fileSize: blob.size,
    };
  } catch (error) {
    return {
      status: error instanceof Error ? error.message : "remote asset fetch failed",
      storageProvider: "linked",
    };
  }
}

function persistStoredAsset(asset: StoredRemoteAsset): PersistedRemoteAsset {
  return {
    storageProvider: asset.storageProvider,
    ...(asset.storageId ? { storageId: asset.storageId } : {}),
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    ...(asset.fileSize ? { fileSize: asset.fileSize } : {}),
    ...(asset.driveFileId ? { driveFileId: asset.driveFileId } : {}),
    ...(asset.driveFolderId ? { driveFolderId: asset.driveFolderId } : {}),
    ...(asset.driveWebViewLink ? { driveWebViewLink: asset.driveWebViewLink } : {}),
    ...(asset.driveWebContentLink
      ? { driveWebContentLink: asset.driveWebContentLink }
      : {}),
    ...(asset.driveThumbnailLink
      ? { driveThumbnailLink: asset.driveThumbnailLink }
      : {}),
    ...(asset.driveMimeType ? { driveMimeType: asset.driveMimeType } : {}),
  };
}

function alreadySavedResponse(capture: {
  referenceId: Id<"references">;
  assetId: Id<"assets"> | null;
}) {
  return jsonResponse({
    ok: true,
    status: "already_saved",
    already_saved: true,
    alreadySaved: true,
    referenceId: capture.referenceId,
    assetId: capture.assetId,
    storageStatus: "already_saved",
  });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function cleanString(value: unknown) {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseCapturedAt(value: unknown) {
  if (typeof value !== "string") return Date.now();

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export default http;
