import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchDriveFile, uploadBlobToDrive } from "./lib/drive";
import { detectPlatform } from "./lib/platform";

const http = httpRouter();
const maxRemoteAssetBytes = 25 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type CaptureBody = {
  kind?: "image" | "post" | "page" | "video_frame" | "file";
  sourceUrl?: string;
  assetUrl?: string;
  pageTitle?: string;
  selectedText?: string;
  capturedAt?: string;
};

type StoredRemoteAsset = {
  status: string;
  storageProvider: "google_drive" | "convex" | "linked";
  storageId?: any;
  mimeType?: string;
  fileSize?: number;
  driveFileId?: string;
  driveFolderId?: string;
  driveWebViewLink?: string;
  driveWebContentLink?: string;
  driveThumbnailLink?: string;
  driveMimeType?: string;
};

http.route({
  path: "/capture",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }),
});

http.route({
  path: "/drive-file",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
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
      return jsonResponse({ ok: false, error: `Drive file fetch failed: ${driveResponse.status}` }, driveResponse.status);
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
    const kind = body.kind ?? (assetUrl ? "image" : "page");
    const platform = detectPlatform(sourceUrl);

    let storedAsset: StoredRemoteAsset | undefined;
    let storageStatus = "no asset url";

    if (assetUrl) {
      storedAsset = await fetchAndStoreRemoteAsset(ctx, {
        assetUrl,
        sourceUrl,
        title: pageTitle,
      });
      storageStatus = storedAsset.status;
    }

    const { referenceId, assetId } = await ctx.runMutation(internal.references.saveCapture, {
      kind,
      sourceUrl,
      ...(pageTitle ? { title: pageTitle } : {}),
      platform,
      capturedAt,
      ...(pageTitle ? { pageTitle } : {}),
      ...(selectedText ? { selectedText } : {}),
      jsonMetadata: JSON.stringify({ ...body, storageStatus }),
      ...(assetUrl && storedAsset
        ? {
            asset: {
              storageProvider: storedAsset.storageProvider,
              originalUrl: assetUrl,
              ...(storedAsset.storageId ? { originalStorageId: storedAsset.storageId } : {}),
              ...(storedAsset.mimeType ? { mimeType: storedAsset.mimeType } : {}),
              ...(storedAsset.fileSize ? { fileSize: storedAsset.fileSize } : {}),
              ...(storedAsset.driveFileId ? { driveFileId: storedAsset.driveFileId } : {}),
              ...(storedAsset.driveFolderId ? { driveFolderId: storedAsset.driveFolderId } : {}),
              ...(storedAsset.driveWebViewLink ? { driveWebViewLink: storedAsset.driveWebViewLink } : {}),
              ...(storedAsset.driveWebContentLink ? { driveWebContentLink: storedAsset.driveWebContentLink } : {}),
              ...(storedAsset.driveThumbnailLink ? { driveThumbnailLink: storedAsset.driveThumbnailLink } : {}),
              ...(storedAsset.driveMimeType ? { driveMimeType: storedAsset.driveMimeType } : {}),
            },
          }
        : {}),
    });

    return jsonResponse({ ok: true, referenceId, assetId, storageStatus }, 201);
  }),
});

async function fetchAndStoreRemoteAsset(
  ctx: { storage: { store: (blob: Blob) => Promise<any> } },
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
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
