import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { uploadBlobToDrive } from "./lib/drive";
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
  path: "/references",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }),
});

http.route({
  path: "/references",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const references = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .take(80);

    const items = await Promise.all(
      references.map(async (reference) => {
        const assets = await ctx.db
          .query("assets")
          .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
          .collect();

        const assetsWithUrls = await Promise.all(
          assets.map(async (asset) => ({
            ...asset,
            storedUrl: asset.driveThumbnailLink ?? asset.driveWebContentLink ?? asset.driveWebViewLink ?? (asset.originalStorageId
              ? await ctx.storage.getUrl(asset.originalStorageId)
              : null),
          })),
        );

        return { ...reference, assets: assetsWithUrls };
      }),
    );

    return jsonResponse({ ok: true, references: items });
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

    const referenceId = await ctx.db.insert("references", {
      kind,
      ...(pageTitle ? { title: pageTitle } : {}),
      sourceUrl,
      platform,
      capturedAt,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });

    let assetId = null;
    let storageStatus = "no asset url";

    if (assetUrl) {
      const storedAsset = await fetchAndStoreRemoteAsset(ctx, {
        assetUrl,
        sourceUrl,
        title: pageTitle,
      });
      storageStatus = storedAsset.status;

      assetId = await ctx.db.insert("assets", {
        referenceId,
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
        dominantColors: [],
      });
    }

    await ctx.db.insert("sourceSnapshots", {
      referenceId,
      ...(pageTitle ? { pageTitle } : {}),
      ...(selectedText ? { selectedText } : {}),
      jsonMetadata: JSON.stringify({ ...body, storageStatus }),
      createdAt: Date.now(),
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
