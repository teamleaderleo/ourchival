import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { fetchDriveFile, uploadBlobToDrive } from "./lib/drive";
import {
  fetchLinkMetadata,
  type LinkMetadata,
} from "./lib/linkMetadata";
import {
  applyReferenceStatsDelta,
  listReferencePage,
  sourceSnapshotPayload,
} from "./lib/referenceCatalog";
import { detectPlatform } from "./lib/platform";
import {
  AccessError,
  bearerToken,
  cleanDeviceName,
  createDeviceToken,
  createPairingCode,
  hashSecret,
  isOwnerAccessKey,
  normalizePairingCode,
  requestCorsHeaders,
  requireOwnerAccess,
  type AccessPrincipal,
} from "./lib/privateAccess";
import { normalizeSourceUrl } from "./lib/urls";

const http = httpRouter();
const maxRemoteAssetBytes = 25 * 1024 * 1024;
const pairingLifetimeMs = 10 * 60 * 1000;

type CaptureBody = {
  kind?: "image" | "post" | "page" | "link" | "article" | "video_frame" | "file";
  sourceUrl?: string;
  canonicalUrl?: string;
  assetUrl?: string;
  pageTitle?: string;
  pageDescription?: string;
  siteName?: string;
  faviconUrl?: string;
  previewImageUrl?: string;
  pageAuthor?: string;
  contentType?: string;
  deferMetadata?: boolean;
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

for (const path of [
  "/auth-check",
  "/capture",
  "/references",
  "/reference",
  "/reference-metadata",
  "/preference-export",
  "/drive-file",
  "/clipper-pairing",
  "/clipper-exchange",
  "/clipper-devices",
]) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async (_ctx, request) =>
      new Response(null, { status: 204, headers: requestCorsHeaders(request) }),
    ),
  });
}

http.route({
  path: "/auth-check",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    return jsonResponse(request, { ok: true, principal: "owner" });
  }),
});

http.route({
  path: "/clipper-pairing",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;

    const code = createPairingCode();
    const now = Date.now();
    await ctx.db.insert("clipperPairingGrants", {
      codeHash: await hashSecret(code),
      createdAt: now,
      expiresAt: now + pairingLifetimeMs,
    });
    return jsonResponse(request, {
      ok: true,
      code,
      expiresAt: now + pairingLifetimeMs,
    }, 201);
  }),
});

http.route({
  path: "/clipper-exchange",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson(request);
    if (!body) return jsonResponse(request, { ok: false, error: "Invalid JSON" }, 400);
    const code = normalizePairingCode(body.code);
    if (!code) {
      return jsonResponse(request, { ok: false, error: "Enter a valid pairing code." }, 400);
    }

    const grant = await ctx.db
      .query("clipperPairingGrants")
      .withIndex("by_code_hash", (q: any) => q.eq("codeHash", awaitableHashPlaceholder(code)))
      .first();
    const codeHash = await hashSecret(code);
    const matchedGrant = grant?.codeHash === codeHash
      ? grant
      : await ctx.db
          .query("clipperPairingGrants")
          .withIndex("by_code_hash", (q: any) => q.eq("codeHash", codeHash))
          .first();

    if (!matchedGrant || matchedGrant.usedAt || matchedGrant.expiresAt <= Date.now()) {
      return jsonResponse(
        request,
        { ok: false, error: "That pairing code expired or was already used." },
        401,
      );
    }

    const token = createDeviceToken();
    const now = Date.now();
    const deviceId = await ctx.db.insert("clipperDevices", {
      name: cleanDeviceName(body.deviceName),
      tokenHash: await hashSecret(token),
      createdAt: now,
      lastUsedAt: now,
      ...(cleanString(body.extensionVersion)
        ? { extensionVersion: cleanString(body.extensionVersion) }
        : {}),
    });
    await ctx.db.patch(matchedGrant._id, { usedAt: now });

    return jsonResponse(request, {
      ok: true,
      token,
      deviceId,
      deviceName: cleanDeviceName(body.deviceName),
    }, 201);
  }),
});

http.route({
  path: "/clipper-devices",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    const devices = await ctx.db
      .query("clipperDevices")
      .withIndex("by_created_at")
      .order("desc")
      .collect();
    return jsonResponse(request, {
      ok: true,
      devices: devices.map(({ tokenHash: _tokenHash, ...device }: any) => device),
    });
  }),
});

http.route({
  path: "/clipper-devices",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    const deviceId = new URL(request.url).searchParams.get("id");
    if (!deviceId) return jsonResponse(request, { ok: false, error: "id is required" }, 400);
    const device = await ctx.db.get(deviceId as any);
    if (!device) return jsonResponse(request, { ok: false, error: "Device not found" }, 404);
    await ctx.db.patch(deviceId as any, { revokedAt: Date.now() });
    return jsonResponse(request, { ok: true });
  }),
});

http.route({
  path: "/drive-file",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    const fileId = new URL(request.url).searchParams.get("id");
    if (!fileId) return jsonResponse(request, { ok: false, error: "id is required" }, 400);

    const driveResponse = await fetchDriveFile(fileId);
    if (!driveResponse.ok || !driveResponse.body) {
      return jsonResponse(
        request,
        { ok: false, error: `Drive file fetch failed: ${driveResponse.status}` },
        driveResponse.status,
      );
    }

    return new Response(driveResponse.body, {
      status: driveResponse.status,
      headers: {
        ...requestCorsHeaders(request),
        "Content-Type":
          driveResponse.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }),
});

http.route({
  path: "/references",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    try {
      const page = await listReferencePage(ctx, request);
      return jsonResponse(request, { ok: true, ...page });
    } catch (error) {
      return jsonResponse(
        request,
        {
          ok: false,
          error:
            error instanceof Error ? error.message : "Could not load reference page.",
        },
        500,
      );
    }
  }),
});

http.route({
  path: "/preference-export",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    const state = await ctx.runQuery(internal.preferenceExport.getExportState, {});
    return jsonResponse(request, {
      ok: true,
      export: state
        ? {
            status: state.status,
            requestedAt: state.requestedAt,
            exportedAt: state.exportedAt,
            itemCount: state.itemCount,
            hasDriveFile: Boolean(state.driveFileId),
            error: state.error,
          }
        : null,
    });
  }),
});

http.route({
  path: "/preference-export",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    await ctx.runMutation(internal.preferenceExport.requestRebuild, {});
    return jsonResponse(request, { ok: true, status: "queued" }, 202);
  }),
});

http.route({
  path: "/reference-metadata",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    const referenceId = new URL(request.url).searchParams.get("id");
    if (!referenceId) return jsonResponse(request, { ok: false, error: "id is required" }, 400);

    const reference = await ctx.db.get(referenceId as any);
    if (!reference) return jsonResponse(request, { ok: false, error: "Reference not found" }, 404);

    const metadata = await fetchLinkMetadata(reference.sourceUrl);
    const snapshotId = await insertSourceSnapshot(ctx, {
      referenceId: reference._id,
      metadata,
      jsonMetadata: { refresh: true, error: metadata.error },
    });
    const snapshot = await ctx.db.get(snapshotId);
    const patch: Record<string, unknown> = {};

    if (!reference.title && metadata.title) patch.title = metadata.title;
    if (!reference.authorName && metadata.author) patch.authorName = metadata.author;
    const refreshedCanonical = cleanUrl(metadata.canonicalUrl);
    if (refreshedCanonical) {
      const normalizedCanonical = normalizeSourceUrl(refreshedCanonical);
      if (normalizedCanonical !== reference.canonicalUrl) {
        const matches = await ctx.db
          .query("references")
          .withIndex("by_canonical_url", (q: any) =>
            q.eq("canonicalUrl", normalizedCanonical),
          )
          .collect();
        if (!matches.some((item: any) => item._id !== reference._id && !item.deleted)) {
          patch.canonicalUrl = normalizedCanonical;
        }
      }
    }

    if (Object.keys(patch).length > 0) await ctx.db.patch(reference._id, patch);
    await ctx.runMutation(internal.preferenceExport.syncReferencePreference, {
      referenceId: reference._id,
    });
    return jsonResponse(request, {
      ok: true,
      reference: patch,
      sourceSnapshot: snapshot ? sourceSnapshotPayload(snapshot) : undefined,
      status: metadata.metadataStatus,
    });
  }),
});

http.route({
  path: "/reference",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    const referenceId = new URL(request.url).searchParams.get("id");
    if (!referenceId) return jsonResponse(request, { ok: false, error: "id is required" }, 400);

    const body = (await readJson(request)) as UpdateReferenceBody | undefined;
    if (!body) return jsonResponse(request, { ok: false, error: "Invalid JSON" }, 400);
    const before = await ctx.db.get(referenceId as any);
    if (!before) return jsonResponse(request, { ok: false, error: "Reference not found" }, 404);

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
    await applyReferenceStatsDelta(ctx, before, { ...before, ...patch });
    if (shouldSyncPreference(body)) {
      await ctx.runMutation(internal.preferenceExport.syncReferencePreference, {
        referenceId: before._id,
      });
    }
    return jsonResponse(request, { ok: true });
  }),
});

http.route({
  path: "/reference",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    const referenceId = new URL(request.url).searchParams.get("id");
    if (!referenceId) return jsonResponse(request, { ok: false, error: "id is required" }, 400);

    const before = await ctx.db.get(referenceId as any);
    if (!before) return jsonResponse(request, { ok: false, error: "Reference not found" }, 404);
    const patch = { deleted: true, archived: true, reviewedAt: Date.now() };
    await ctx.db.patch(referenceId as any, patch);
    await applyReferenceStatsDelta(ctx, before, { ...before, ...patch });
    await ctx.runMutation(internal.preferenceExport.syncReferencePreference, {
      referenceId: before._id,
    });
    return jsonResponse(request, { ok: true });
  }),
});

http.route({
  path: "/capture",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let principal: AccessPrincipal;
    try {
      principal = await authenticateCapture(ctx, request);
    } catch (error) {
      return accessErrorResponse(request, error);
    }

    const body = (await readJson(request)) as CaptureBody | undefined;
    if (!body) return jsonResponse(request, { ok: false, error: "Invalid JSON" }, 400);

    const sourceUrl = cleanString(body.sourceUrl);
    const assetUrl = cleanString(body.assetUrl);
    const pageTitle = cleanString(body.pageTitle);
    const selectedText = cleanString(body.selectedText);
    const explicitAuthorName = cleanString(body.authorName);
    const authorHandle = cleanString(body.authorHandle);
    const authorUrl = cleanString(body.authorUrl);
    const postId = cleanString(body.postId);
    const postText = cleanString(body.postText);
    const altText = cleanString(body.altText);
    const rawMetadata = cleanString(body.rawMetadata);
    const captureSessionId = cleanString(body.captureSessionId);
    const deferMetadata = body.deferMetadata === true || Boolean(captureSessionId);
    const publishedAt = parseOptionalDate(body.publishedAt);

    if (!sourceUrl) {
      return jsonResponse(request, { ok: false, error: "sourceUrl is required" }, 400);
    }

    const kind = body.kind ?? (assetUrl ? "image" : "link");
    const clientMetadata = linkMetadataFromBody(body);
    let canonicalUrl = normalizeSourceUrl(cleanUrl(clientMetadata.canonicalUrl) ?? sourceUrl);
    let duplicate = await findDuplicateCapture(ctx, { sourceUrl, canonicalUrl, assetUrl });

    if (duplicate) {
      await enrichDuplicateReference(ctx, duplicate, {
        body,
        canonicalUrl,
        pageTitle,
        postText,
        altText,
        selectedText,
        rawMetadata,
        explicitAuthorName,
        authorHandle,
        authorUrl,
        postId,
        publishedAt,
        captureSessionId,
        metadata: hasClientLinkMetadata(clientMetadata) ? clientMetadata : undefined,
      });
      return duplicateResponse(request, duplicate);
    }

    let linkMetadata: LinkMetadata | undefined;
    if (isLinkKind(kind) && !assetUrl && !deferMetadata) {
      linkMetadata = mergeLinkMetadata(await fetchLinkMetadata(sourceUrl), clientMetadata);
      const enrichedCanonical = cleanUrl(linkMetadata.canonicalUrl);
      if (enrichedCanonical) canonicalUrl = normalizeSourceUrl(enrichedCanonical);
      duplicate = await findDuplicateCapture(ctx, { sourceUrl, canonicalUrl, assetUrl });
      if (duplicate) {
        await enrichDuplicateReference(ctx, duplicate, {
          body,
          canonicalUrl,
          pageTitle,
          postText,
          altText,
          selectedText,
          rawMetadata,
          explicitAuthorName,
          authorHandle,
          authorUrl,
          postId,
          publishedAt,
          captureSessionId,
          metadata: linkMetadata,
        });
        return duplicateResponse(request, duplicate);
      }
    } else if (hasClientLinkMetadata(clientMetadata)) {
      linkMetadata = clientMetadata;
    } else if (isLinkKind(kind) && !assetUrl) {
      linkMetadata = {
        metadataStatus: "missing",
        metadataFetchedAt: Date.now(),
        error: "Metadata enrichment deferred for bulk capture.",
      };
    }

    const capturedAt = parseCapturedAt(body.capturedAt);
    const platform = detectPlatform(sourceUrl);
    const title = pageTitle ?? linkMetadata?.title;
    const authorName = explicitAuthorName ?? linkMetadata?.author;
    const referenceId = await ctx.db.insert("references", {
      kind,
      ...(title ? { title } : {}),
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

    const insertedReference = await ctx.db.get(referenceId);
    await applyReferenceStatsDelta(ctx, null, insertedReference);

    let assetId = null;
    let storageStatus = linkMetadata
      ? metadataStorageStatus(linkMetadata)
      : assetUrl
        ? "asset pending"
        : "link only";

    if (assetUrl) {
      const storedAsset = await fetchAndStoreRemoteAsset(ctx, { assetUrl, sourceUrl, title });
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
        ...(storedAsset.driveWebContentLink
          ? { driveWebContentLink: storedAsset.driveWebContentLink }
          : {}),
        ...(storedAsset.driveThumbnailLink
          ? { driveThumbnailLink: storedAsset.driveThumbnailLink }
          : {}),
        ...(storedAsset.driveMimeType ? { driveMimeType: storedAsset.driveMimeType } : {}),
        dominantColors: [],
      });
    }

    await insertSourceSnapshot(ctx, {
      referenceId,
      pageTitle: title,
      postText,
      altText,
      selectedText,
      metadata: linkMetadata,
      jsonMetadata: {
        ...body,
        ...(rawMetadata ? { rawMetadata: safeJsonValue(rawMetadata) } : {}),
        canonicalUrl,
        storageStatus,
        capturePrincipal: principal.kind,
        ...(principal.kind === "clipper" ? { captureDeviceId: principal.deviceId } : {}),
        metadataError: linkMetadata?.error,
      },
    });

    return jsonResponse(
      request,
      { ok: true, alreadySaved: false, referenceId, assetId, storageStatus },
      201,
    );
  }),
});

async function ownerDenied(request: Request) {
  try {
    await requireOwnerAccess(bearerToken(request));
    return undefined;
  } catch (error) {
    return accessErrorResponse(request, error);
  }
}

async function authenticateCapture(ctx: any, request: Request): Promise<AccessPrincipal> {
  const token = bearerToken(request);
  if (!token) throw new AccessError("Pair or unlock Ourchival before capturing.");

  try {
    if (await isOwnerAccessKey(token)) return { kind: "owner" };
  } catch (error) {
    if (!(error instanceof AccessError) || error.code !== "owner_access_unconfigured") throw error;
  }

  const tokenHash = await hashSecret(token);
  const device = await ctx.db
    .query("clipperDevices")
    .withIndex("by_token_hash", (q: any) => q.eq("tokenHash", tokenHash))
    .first();
  if (!device) throw new AccessError("This Clipper credential is invalid.", 401, "invalid_device");
  if (device.revokedAt) throw new AccessError("This Clipper was revoked.", 403, "revoked_device");
  await ctx.db.patch(device._id, { lastUsedAt: Date.now() });
  return { kind: "clipper", deviceId: String(device._id), deviceName: device.name };
}

function accessErrorResponse(request: Request, error: unknown) {
  if (error instanceof AccessError) {
    return jsonResponse(request, { ok: false, error: error.message, code: error.code }, error.status);
  }
  return jsonResponse(request, { ok: false, error: "Access check failed." }, 500);
}

async function enrichDuplicateReference(
  ctx: any,
  duplicate: DuplicateCapture,
  args: {
    body: CaptureBody;
    canonicalUrl: string;
    pageTitle?: string;
    postText?: string;
    altText?: string;
    selectedText?: string;
    rawMetadata?: string;
    explicitAuthorName?: string;
    authorHandle?: string;
    authorUrl?: string;
    postId?: string;
    publishedAt?: number;
    captureSessionId?: string;
    metadata?: LinkMetadata;
  },
) {
  const authorName = args.explicitAuthorName ?? args.metadata?.author;
  const patch: Record<string, unknown> = {
    ...(!duplicate.reference.canonicalUrl ? { canonicalUrl: args.canonicalUrl } : {}),
    ...(!duplicate.reference.title && (args.pageTitle ?? args.metadata?.title)
      ? { title: args.pageTitle ?? args.metadata?.title }
      : {}),
    ...(!duplicate.reference.authorName && authorName ? { authorName } : {}),
    ...(!duplicate.reference.authorHandle && args.authorHandle
      ? { authorHandle: args.authorHandle }
      : {}),
    ...(!duplicate.reference.authorUrl && args.authorUrl ? { authorUrl: args.authorUrl } : {}),
    ...(!duplicate.reference.postId && args.postId ? { postId: args.postId } : {}),
    ...(!duplicate.reference.publishedAt && args.publishedAt
      ? { publishedAt: args.publishedAt }
      : {}),
    ...(!duplicate.reference.captureSessionId && args.captureSessionId
      ? { captureSessionId: args.captureSessionId }
      : {}),
  };

  const assetUrl = cleanString(args.body.assetUrl);
  if (assetUrl && !duplicate.assetId) {
    const storedAsset = await fetchAndStoreRemoteAsset(ctx, {
      assetUrl,
      sourceUrl: duplicate.reference.sourceUrl,
      title: args.pageTitle ?? duplicate.reference.title,
    });
    duplicate.assetId = await ctx.db.insert("assets", {
      referenceId: duplicate.reference._id,
      storageProvider: storedAsset.storageProvider,
      originalUrl: assetUrl,
      ...(storedAsset.storageId ? { originalStorageId: storedAsset.storageId } : {}),
      ...(storedAsset.mimeType ? { mimeType: storedAsset.mimeType } : {}),
      ...(storedAsset.fileSize ? { fileSize: storedAsset.fileSize } : {}),
      ...(storedAsset.driveFileId ? { driveFileId: storedAsset.driveFileId } : {}),
      ...(storedAsset.driveFolderId ? { driveFolderId: storedAsset.driveFolderId } : {}),
      ...(storedAsset.driveWebViewLink ? { driveWebViewLink: storedAsset.driveWebViewLink } : {}),
      ...(storedAsset.driveWebContentLink
        ? { driveWebContentLink: storedAsset.driveWebContentLink }
        : {}),
      ...(storedAsset.driveThumbnailLink
        ? { driveThumbnailLink: storedAsset.driveThumbnailLink }
        : {}),
      ...(storedAsset.driveMimeType ? { driveMimeType: storedAsset.driveMimeType } : {}),
      dominantColors: [],
    });
    if (args.body.kind === "image" && isLinkKind(duplicate.reference.kind)) {
      patch.kind = "image";
    }
  }

  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(duplicate.reference._id, patch);
    if (patch.kind) {
      await applyReferenceStatsDelta(ctx, duplicate.reference, {
        ...duplicate.reference,
        ...patch,
      });
    }
  }

  if (args.postText || args.altText || args.selectedText || args.rawMetadata || args.metadata) {
    await insertSourceSnapshot(ctx, {
      referenceId: duplicate.reference._id,
      pageTitle: args.pageTitle ?? args.metadata?.title,
      postText: args.postText,
      altText: args.altText,
      selectedText: args.selectedText,
      metadata: args.metadata,
      jsonMetadata: {
        ...args.body,
        canonicalUrl: args.canonicalUrl,
        duplicateReason: duplicate.reason,
        ...(args.rawMetadata ? { rawMetadata: safeJsonValue(args.rawMetadata) } : {}),
        metadataError: args.metadata?.error,
      },
    });
  }
}

async function insertSourceSnapshot(
  ctx: any,
  args: {
    referenceId: any;
    pageTitle?: string;
    postText?: string;
    altText?: string;
    selectedText?: string;
    metadata?: LinkMetadata;
    jsonMetadata?: unknown;
  },
) {
  return await ctx.db.insert("sourceSnapshots", {
    referenceId: args.referenceId,
    ...(args.pageTitle ? { pageTitle: args.pageTitle } : {}),
    ...(args.postText ? { postText: args.postText } : {}),
    ...(args.altText ? { altText: args.altText } : {}),
    ...(args.selectedText ? { selectedText: args.selectedText } : {}),
    ...(args.metadata?.description ? { description: args.metadata.description } : {}),
    ...(args.metadata?.siteName ? { siteName: args.metadata.siteName } : {}),
    ...(args.metadata?.faviconUrl ? { faviconUrl: args.metadata.faviconUrl } : {}),
    ...(args.metadata?.previewImageUrl ? { previewImageUrl: args.metadata.previewImageUrl } : {}),
    ...(args.metadata?.author ? { pageAuthor: args.metadata.author } : {}),
    ...(args.metadata?.canonicalUrl ? { canonicalUrl: args.metadata.canonicalUrl } : {}),
    ...(args.metadata?.contentType ? { contentType: args.metadata.contentType } : {}),
    ...(args.metadata?.metadataStatus ? { metadataStatus: args.metadata.metadataStatus } : {}),
    ...(typeof args.metadata?.httpStatus === "number" ? { httpStatus: args.metadata.httpStatus } : {}),
    ...(typeof args.metadata?.metadataFetchedAt === "number"
      ? { metadataFetchedAt: args.metadata.metadataFetchedAt }
      : {}),
    ...(args.jsonMetadata !== undefined
      ? { jsonMetadata: JSON.stringify(args.jsonMetadata) }
      : {}),
    createdAt: Date.now(),
  });
}

function duplicateResponse(request: Request, duplicate: DuplicateCapture) {
  return jsonResponse(request, {
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

function linkMetadataFromBody(body: CaptureBody): LinkMetadata {
  const canonicalUrl = cleanUrl(body.canonicalUrl);
  const faviconUrl = cleanUrl(body.faviconUrl);
  const previewImageUrl = cleanUrl(body.previewImageUrl);
  const title = cleanString(body.pageTitle);
  const description = cleanString(body.pageDescription);
  const siteName = cleanString(body.siteName);
  const author = cleanString(body.pageAuthor);
  const contentType = cleanString(body.contentType);
  const hasMetadata = Boolean(
    title || description || siteName || faviconUrl || previewImageUrl || author,
  );
  return {
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(siteName ? { siteName } : {}),
    ...(faviconUrl ? { faviconUrl } : {}),
    ...(previewImageUrl ? { previewImageUrl } : {}),
    ...(author ? { author } : {}),
    ...(contentType ? { contentType } : {}),
    metadataStatus: hasMetadata ? "ready" : "missing",
    metadataFetchedAt: Date.now(),
  };
}

function mergeLinkMetadata(remote: LinkMetadata, client: LinkMetadata): LinkMetadata {
  const merged = {
    ...remote,
    ...(client.canonicalUrl ? { canonicalUrl: client.canonicalUrl } : {}),
    ...(client.title ? { title: client.title } : {}),
    ...(client.description ? { description: client.description } : {}),
    ...(client.siteName ? { siteName: client.siteName } : {}),
    ...(client.faviconUrl ? { faviconUrl: client.faviconUrl } : {}),
    ...(client.previewImageUrl ? { previewImageUrl: client.previewImageUrl } : {}),
    ...(client.author ? { author: client.author } : {}),
    ...(client.contentType ? { contentType: client.contentType } : {}),
  };
  const hasUsefulMetadata = Boolean(
    merged.title ||
      merged.description ||
      merged.siteName ||
      merged.faviconUrl ||
      merged.previewImageUrl ||
      merged.author,
  );
  return {
    ...merged,
    metadataStatus: hasUsefulMetadata ? "ready" : remote.metadataStatus,
    metadataFetchedAt: remote.metadataFetchedAt,
  };
}

function hasClientLinkMetadata(metadata: LinkMetadata) {
  return Boolean(
    metadata.canonicalUrl ||
      metadata.title ||
      metadata.description ||
      metadata.siteName ||
      metadata.faviconUrl ||
      metadata.previewImageUrl ||
      metadata.author ||
      metadata.contentType,
  );
}

function metadataStorageStatus(metadata: LinkMetadata) {
  if (metadata.metadataStatus === "ready") return "link metadata ready";
  if (metadata.metadataStatus === "missing") return "link saved; metadata sparse";
  return `link saved; ${metadata.error ?? "metadata fetch failed"}`;
}

function isLinkKind(kind: string) {
  return kind === "link" || kind === "page" || kind === "article";
}

function shouldSyncPreference(body: UpdateReferenceBody) {
  return (
    typeof body.title === "string" ||
    body.triageState !== undefined ||
    typeof body.reviewedAt === "number" ||
    typeof body.archived === "boolean" ||
    typeof body.deleted === "boolean"
  );
}

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
      if (reference && !reference.deleted) {
        return { reference, assetId: asset._id, reason: "asset_url" };
      }
    }
  }

  const canonicalMatches = await ctx.db
    .query("references")
    .withIndex("by_canonical_url", (q: any) => q.eq("canonicalUrl", args.canonicalUrl))
    .collect();
  const canonicalReference = canonicalMatches.find((reference: any) => !reference.deleted);
  if (canonicalReference) {
    return { reference: canonicalReference, assetId: null, reason: "canonical_url" };
  }

  const sourceMatches = await ctx.db
    .query("references")
    .withIndex("by_source_url", (q: any) => q.eq("sourceUrl", args.sourceUrl))
    .collect();
  const sourceReference = sourceMatches.find((reference: any) => !reference.deleted);
  return sourceReference
    ? { reference: sourceReference, assetId: null, reason: "source_url" }
    : undefined;
}

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

function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...requestCorsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function cleanString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanUrl(value: unknown) {
  const text = cleanString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
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

function awaitableHashPlaceholder(_code: string) {
  return "__pairing_hash_pending__";
}

export default http;
