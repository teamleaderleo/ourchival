import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { fetchDriveFile, uploadBlobToDrive } from "./lib/drive";
import { detectPlatform } from "./lib/platform";
import { normalizeSourceUrl } from "./lib/urls";

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
  authorName?: string;
  authorHandle?: string;
  authorUrl?: string;
  postId?: string;
  postText?: string;
  publishedAt?: string;
  altText?: string;
  rawMetadata?: string;
  captureSessionId?: string;
  capturedAt?: string;
};

type UpdateReferenceBody = {
  title?: string;
  notes?: string;
  favorite?: boolean;
  triageState?: "inbox" | "kept" | "later";
  reviewedAt?: number;
  lastOpenedAt?: number;
  archived?: boolean;
  deleted?: boolean;
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

type DuplicateCapture = {
  reference: any;
  assetId: any | null;
  reason: "asset_url" | "canonical_url" | "source_url";
};

for (const path of ["/capture", "/references", "/reference", "/drive-file"]) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
  });
}

http.route({
  path: "/drive-file",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const fileId = new URL(request.url).searchParams.get("id");
    if (!fileId) return jsonResponse({ ok: false, error: "id is required" }, 400);

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
    const references = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .take(300);

    const items = await Promise.all(
      references.map(async (reference) => {
        const assets = await ctx.db
          .query("assets")
          .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
          .collect();
        const assetsWithUrls = await Promise.all(
          assets.map(async (asset) => ({
            ...asset,
            storedUrl: asset.driveFileId
              ? `${origin}/drive-file?id=${encodeURIComponent(asset.driveFileId)}`
              : asset.originalStorageId
                ? await ctx.storage.getUrl(asset.originalStorageId)
                : null,
          })),
        );
        return { ...reference, assets: assetsWithUrls };
      }),
    );

    return jsonResponse({ ok: true, references: items });
  }),
});

http.route({
  path: "/reference",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const referenceId = new URL(request.url).searchParams.get("id");
    if (!referenceId) return jsonResponse({ ok: false, error: "id is required" }, 400);

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
      ...(body.triageState === "inbox" || body.triageState === "kept" || body.triageState === "later"
        ? { triageState: body.triageState }
        : {}),
      ...(typeof body.reviewedAt === "number" ? { reviewedAt: body.reviewedAt } : {}),
      ...(typeof body.lastOpenedAt === "number" ? { lastOpenedAt: body.lastOpenedAt } : {}),
      ...(typeof body.archived === "boolean" ? { archived: body.archived } : {}),
      ...(typeof body.deleted === "boolean" ? { deleted: body.deleted } : {}),
    };

    await ctx.db.patch(referenceId as any, patch);
    return jsonResponse({ ok: true });
  }),
});

http.route({
  path: "/reference",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const referenceId = new URL(request.url).searchParams.get("id");
    if (!referenceId) return jsonResponse({ ok: false, error: "id is required" }, 400);
    await ctx.db.patch(referenceId as any, {
      deleted: true,
      archived: true,
      reviewedAt: Date.now(),
    });
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
    const authorName = cleanString(body.authorName);
    const authorHandle = cleanString(body.authorHandle);
    const authorUrl = cleanString(body.authorUrl);
    const postId = cleanString(body.postId);
    const postText = cleanString(body.postText);
    const altText = cleanString(body.altText);
    const rawMetadata = cleanString(body.rawMetadata);
    const captureSessionId = cleanString(body.captureSessionId);
    const publishedAt = parseOptionalDate(body.publishedAt);

    if (!sourceUrl) return jsonResponse({ ok: false, error: "sourceUrl is required" }, 400);

    const canonicalUrl = normalizeSourceUrl(sourceUrl);
    const duplicate = await findDuplicateCapture(ctx, { sourceUrl, canonicalUrl, assetUrl });

    if (duplicate) {
      const patch = {
        ...(!duplicate.reference.canonicalUrl ? { canonicalUrl } : {}),
        ...(!duplicate.reference.authorName && authorName ? { authorName } : {}),
        ...(!duplicate.reference.authorHandle && authorHandle ? { authorHandle } : {}),
        ...(!duplicate.reference.authorUrl && authorUrl ? { authorUrl } : {}),
        ...(!duplicate.reference.postId && postId ? { postId } : {}),
        ...(!duplicate.reference.publishedAt && publishedAt ? { publishedAt } : {}),
        ...(!duplicate.reference.captureSessionId && captureSessionId ? { captureSessionId } : {}),
      };
      if (Object.keys(patch).length > 0) await ctx.db.patch(duplicate.reference._id, patch);
      if (postText || altText || selectedText || rawMetadata) {
        await ctx.db.insert("sourceSnapshots", {
          referenceId: duplicate.reference._id,
          ...(pageTitle ? { pageTitle } : {}),
          ...(postText ? { postText } : {}),
          ...(altText ? { altText } : {}),
          ...(selectedText ? { selectedText } : {}),
          jsonMetadata: JSON.stringify({ ...body, canonicalUrl, duplicateReason: duplicate.reason }),
          createdAt: Date.now(),
        });
      }

      return jsonResponse({
        ok: true,
        alreadySaved: true,
        duplicateReason: duplicate.reason,
        referenceId: duplicate.reference._id,
        assetId: duplicate.assetId,
        storageStatus: "already saved",
        existingReference: {
          title: duplicate.reference.title,
          sourceUrl: duplicate.reference.sourceUrl,
          capturedAt: duplicate.reference.capturedAt,
          favorite: duplicate.reference.favorite,
          boardCount: duplicate.reference.boardIds.length,
        },
      });
    }

    const capturedAt = parseCapturedAt(body.capturedAt);
    const kind = body.kind ?? (assetUrl ? "image" : "link");
    const platform = detectPlatform(sourceUrl);

    const referenceId = await ctx.db.insert("references", {
      kind,
      ...(pageTitle ? { title: pageTitle } : {}),
      sourceUrl,
      canonicalUrl,
      platform,
      ...(authorName ? { authorName } : {}),
      ...(authorHandle ? { authorHandle } : {}),
      ...(authorUrl ? { authorUrl } : {}),
      ...(postId ? { postId } : {}),
      capturedAt,
      ...(publishedAt ? { publishedAt } : {}),
      ...(captureSessionId ? { captureSessionId } : {}),
      triageState: "inbox",
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });

    let assetId = null;
    let storageStatus = assetUrl ? "asset pending" : "link only";

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
      ...(postText ? { postText } : {}),
      ...(altText ? { altText } : {}),
      ...(selectedText ? { selectedText } : {}),
      jsonMetadata: JSON.stringify({
        ...body,
        ...(rawMetadata ? { rawMetadata: safeJsonValue(rawMetadata) } : {}),
        canonicalUrl,
        storageStatus,
      }),
      createdAt: Date.now(),
    });

    return jsonResponse({ ok: true, alreadySaved: false, referenceId, assetId, storageStatus }, 201);
  }),
});

async function findDuplicateCapture(
  ctx: { db: any },
  args: { sourceUrl: string; canonicalUrl: string; assetUrl?: string },
): Promise<DuplicateCapture | undefined> {
  if (args.assetUrl) {
    const matchingAssets = await ctx.db
      .query("assets")
      .withIndex("by_original_url", (q: any) => q.eq("originalUrl", args.assetUrl))
      .collect();
    for (const asset of matchingAssets) {
      const reference = await ctx.db.get(asset.referenceId);
      if (reference && !reference.deleted) return { reference, assetId: asset._id, reason: "asset_url" };
    }
    return undefined;
  }

  const canonicalMatches = await ctx.db
    .query("references")
    .withIndex("by_canonical_url", (q: any) => q.eq("canonicalUrl", args.canonicalUrl))
    .collect();
  const canonicalReference = canonicalMatches.find((reference: any) => !reference.deleted);
  if (canonicalReference) return { reference: canonicalReference, assetId: null, reason: "canonical_url" };

  const sourceMatches = await ctx.db
    .query("references")
    .withIndex("by_source_url", (q: any) => q.eq("sourceUrl", args.sourceUrl))
    .collect();
  const sourceReference = sourceMatches.find((reference: any) => !reference.deleted);
  return sourceReference ? { reference: sourceReference, assetId: null, reason: "source_url" } : undefined;
}

async function fetchAndStoreRemoteAsset(
  ctx: { storage: { store: (blob: Blob) => Promise<any> } },
  args: { assetUrl: string; sourceUrl: string; title?: string },
): Promise<StoredRemoteAsset> {
  try {
    const response = await fetch(args.assetUrl, {
      headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
    });
    if (!response.ok) return { status: `fetch failed: ${response.status}`, storageProvider: "linked" };

    const mimeType = response.headers.get("Content-Type") ?? undefined;
    const contentLength = Number(response.headers.get("Content-Length") ?? 0);
    if (contentLength > maxRemoteAssetBytes) return { status: "remote asset too large", storageProvider: "linked" };
    if (mimeType && !mimeType.toLowerCase().startsWith("image/")) {
      return { status: `remote asset is ${mimeType}`, storageProvider: "linked" };
    }

    const blob = await response.blob();
    if (blob.size > maxRemoteAssetBytes) return { status: "remote asset too large", storageProvider: "linked" };

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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

function parseOptionalDate(value: unknown) {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safeJsonValue(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export default http;
