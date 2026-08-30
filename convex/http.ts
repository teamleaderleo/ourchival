import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { fetchDriveFile, uploadBlobToDrive } from "./lib/drive";
import {
  fetchPublicResponse,
  fetchLinkMetadata,
  type LinkMetadata,
} from "./lib/linkMetadata";
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
const remoteAssetTimeoutMs = 15_000;
const pairingLifetimeMs = 10 * 60 * 1000;

type CaptureBody = {
  kind?:
    "image" | "post" | "page" | "link" | "article" | "video_frame" | "file";
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
    handler: httpAction(
      async (_ctx, request) =>
        new Response(null, {
          status: 204,
          headers: requestCorsHeaders(request),
        }),
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
    await ctx.runMutation(internal.httpDb.createPairingGrant, {
      codeHash: await hashSecret(code),
      createdAt: now,
      expiresAt: now + pairingLifetimeMs,
    });
    return jsonResponse(
      request,
      {
        ok: true,
        code,
        expiresAt: now + pairingLifetimeMs,
      },
      201,
    );
  }),
});

http.route({
  path: "/clipper-exchange",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson(request);
    if (!body)
      return jsonResponse(request, { ok: false, error: "Invalid JSON" }, 400);
    const code = normalizePairingCode(body.code);
    if (!code) {
      return jsonResponse(
        request,
        { ok: false, error: "Enter a valid pairing code." },
        400,
      );
    }

    const codeHash = await hashSecret(code);
    const token = createDeviceToken();
    const now = Date.now();
    const deviceName = cleanDeviceName(body.deviceName);
    const result = await ctx.runMutation(internal.httpDb.exchangePairingGrant, {
      codeHash,
      tokenHash: await hashSecret(token),
      name: deviceName,
      now,
      ...(cleanString(body.extensionVersion)
        ? { extensionVersion: cleanString(body.extensionVersion) }
        : {}),
    });
    if (!result.ok) {
      return jsonResponse(
        request,
        { ok: false, error: "That pairing code expired or was already used." },
        401,
      );
    }

    return jsonResponse(
      request,
      {
        ok: true,
        token,
        deviceId: result.deviceId,
        deviceName,
      },
      201,
    );
  }),
});

http.route({
  path: "/clipper-devices",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    const devices = await ctx.runQuery(internal.httpDb.listClipperDevices, {});
    return jsonResponse(request, { ok: true, devices });
  }),
});

http.route({
  path: "/clipper-devices",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    const deviceId = new URL(request.url).searchParams.get("id");
    if (!deviceId)
      return jsonResponse(request, { ok: false, error: "id is required" }, 400);
    const revoked = await ctx.runMutation(internal.httpDb.revokeClipperDevice, {
      deviceId,
      revokedAt: Date.now(),
    });
    if (!revoked)
      return jsonResponse(
        request,
        { ok: false, error: "Device not found" },
        404,
      );
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
    if (!fileId)
      return jsonResponse(request, { ok: false, error: "id is required" }, 400);

    const driveResponse = await fetchDriveFile(fileId);
    if (!driveResponse.ok || !driveResponse.body) {
      return jsonResponse(
        request,
        {
          ok: false,
          error: `Drive file fetch failed: ${driveResponse.status}`,
        },
        driveResponse.status,
      );
    }

    return new Response(driveResponse.body, {
      status: driveResponse.status,
      headers: {
        ...requestCorsHeaders(request),
        "Content-Type":
          driveResponse.headers.get("Content-Type") ??
          "application/octet-stream",
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
      await ctx.runMutation(internal.httpDb.initializeReferenceStats, {});
      await ctx.runMutation(
        internal.preferenceExport.ensureExportRequested,
        {},
      );
      const requestUrl = new URL(request.url);
      const requestedLimit = Number(requestUrl.searchParams.get("limit") ?? 48);
      const pageSize = Number.isFinite(requestedLimit)
        ? Math.min(96, Math.max(12, Math.floor(requestedLimit)))
        : 48;
      const maxScanned = Math.max(pageSize * 8, 384);
      const references: Array<Record<string, unknown>> = [];
      let cursor = requestUrl.searchParams.get("cursor") || null;
      let hasMore = true;
      let scanned = 0;
      let counts;

      while (hasMore && references.length < pageSize && scanned < maxScanned) {
        const batchUrl = new URL(requestUrl);
        batchUrl.searchParams.set(
          "limit",
          String(pageSize - references.length),
        );
        if (cursor) batchUrl.searchParams.set("cursor", cursor);
        else batchUrl.searchParams.delete("cursor");

        const batch = await ctx.runQuery(internal.httpDb.listReferences, {
          url: batchUrl.toString(),
        });
        references.push(...batch.references);
        cursor = batch.continueCursor;
        hasMore = batch.hasMore;
        scanned += batch.scanned;
        counts = batch.counts;
        if (batch.scanned === 0) break;
      }

      return jsonResponse(request, {
        ok: true,
        references,
        continueCursor: hasMore ? cursor : null,
        hasMore,
        scanned,
        counts,
      });
    } catch (error) {
      return jsonResponse(
        request,
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not load reference page.",
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
    const state = await ctx.runQuery(
      internal.preferenceExport.getExportState,
      {},
    );
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
    if (!referenceId)
      return jsonResponse(request, { ok: false, error: "id is required" }, 400);

    const reference = await ctx.runQuery(internal.httpDb.getReferenceSource, {
      referenceId,
    });
    if (!reference)
      return jsonResponse(
        request,
        { ok: false, error: "Reference not found" },
        404,
      );

    const metadata = await fetchLinkMetadata(reference.sourceUrl);
    const result = await ctx.runMutation(
      internal.httpDb.applyReferenceMetadata,
      {
        referenceId,
        metadata: serializableValue(metadata),
      },
    );
    if (!result)
      return jsonResponse(
        request,
        { ok: false, error: "Reference not found" },
        404,
      );
    return jsonResponse(request, {
      ok: true,
      ...result,
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
    if (!referenceId)
      return jsonResponse(request, { ok: false, error: "id is required" }, 400);

    const body = (await readJson(request)) as UpdateReferenceBody | undefined;
    if (!body)
      return jsonResponse(request, { ok: false, error: "Invalid JSON" }, 400);
    const patch = {
      ...(typeof body.title === "string" ? { title: body.title.trim() } : {}),
      ...(typeof body.notes === "string" ? { notes: body.notes.trim() } : {}),
      ...(typeof body.favorite === "boolean"
        ? { favorite: body.favorite }
        : {}),
      ...(body.triageState === "inbox" ||
      body.triageState === "kept" ||
      body.triageState === "later"
        ? { triageState: body.triageState }
        : {}),
      ...(typeof body.reviewedAt === "number"
        ? { reviewedAt: body.reviewedAt }
        : {}),
      ...(typeof body.lastOpenedAt === "number"
        ? { lastOpenedAt: body.lastOpenedAt }
        : {}),
      ...(typeof body.archived === "boolean"
        ? { archived: body.archived }
        : {}),
      ...(typeof body.deleted === "boolean" ? { deleted: body.deleted } : {}),
    };

    const updated = await ctx.runMutation(internal.httpDb.updateReference, {
      referenceId,
      patch,
      syncPreference: shouldSyncPreference(body),
    });
    if (!updated)
      return jsonResponse(
        request,
        { ok: false, error: "Reference not found" },
        404,
      );
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
    if (!referenceId)
      return jsonResponse(request, { ok: false, error: "id is required" }, 400);

    const deleted = await ctx.runMutation(internal.httpDb.deleteReference, {
      referenceId,
      deletedAt: Date.now(),
    });
    if (!deleted)
      return jsonResponse(
        request,
        { ok: false, error: "Reference not found" },
        404,
      );
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
    if (!body)
      return jsonResponse(request, { ok: false, error: "Invalid JSON" }, 400);

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
    const deferMetadata =
      body.deferMetadata === true || Boolean(captureSessionId);
    const publishedAt = parseOptionalDate(body.publishedAt);

    if (!sourceUrl) {
      return jsonResponse(
        request,
        { ok: false, error: "sourceUrl is required" },
        400,
      );
    }

    const kind = body.kind ?? (assetUrl ? "image" : "link");
    const clientMetadata = linkMetadataFromBody(body);
    let canonicalUrl = normalizeSourceUrl(
      cleanUrl(clientMetadata.canonicalUrl) ?? sourceUrl,
    );
    let duplicate = await ctx.runQuery(internal.httpDb.findDuplicateCapture, {
      sourceUrl,
      canonicalUrl,
      ...(assetUrl ? { assetUrl } : {}),
    });

    if (duplicate) {
      duplicate = await persistDuplicateCapture(ctx, duplicate, {
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
        metadata: hasClientLinkMetadata(clientMetadata)
          ? clientMetadata
          : undefined,
      });
      if (!duplicate) {
        return jsonResponse(
          request,
          { ok: false, error: "Reference not found" },
          404,
        );
      }
      return duplicateResponse(request, duplicate);
    }

    let linkMetadata: LinkMetadata | undefined;
    if (isLinkKind(kind) && !assetUrl && !deferMetadata) {
      linkMetadata = mergeLinkMetadata(
        await fetchLinkMetadata(sourceUrl),
        clientMetadata,
      );
      const enrichedCanonical = cleanUrl(linkMetadata.canonicalUrl);
      if (enrichedCanonical)
        canonicalUrl = normalizeSourceUrl(enrichedCanonical);
      duplicate = await ctx.runQuery(internal.httpDb.findDuplicateCapture, {
        sourceUrl,
        canonicalUrl,
        ...(assetUrl ? { assetUrl } : {}),
      });
      if (duplicate) {
        duplicate = await persistDuplicateCapture(ctx, duplicate, {
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
        if (!duplicate) {
          return jsonResponse(
            request,
            { ok: false, error: "Reference not found" },
            404,
          );
        }
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
    const referenceDocument = {
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
    };

    let storageStatus = linkMetadata
      ? metadataStorageStatus(linkMetadata)
      : assetUrl
        ? "asset pending"
        : "link only";

    let storedAsset: StoredRemoteAsset | undefined;
    if (assetUrl) {
      storedAsset = await fetchAndStoreRemoteAsset(ctx, {
        assetUrl,
        sourceUrl,
        title,
      });
      storageStatus = storedAsset.status;
    }

    const created = await ctx.runMutation(internal.httpDb.createCapture, {
      reference: referenceDocument,
      ...(assetUrl ? { assetUrl } : {}),
      ...(storedAsset ? { storedAsset: serializableValue(storedAsset) } : {}),
      snapshot: serializableValue({
        ...(title ? { pageTitle: title } : {}),
        ...(postText ? { postText } : {}),
        ...(altText ? { altText } : {}),
        ...(selectedText ? { selectedText } : {}),
        ...(linkMetadata ? { metadata: linkMetadata } : {}),
        jsonMetadata: {
          ...body,
          ...(rawMetadata ? { rawMetadata: safeJsonValue(rawMetadata) } : {}),
          canonicalUrl,
          storageStatus,
          capturePrincipal: principal.kind,
          ...(principal.kind === "clipper"
            ? { captureDeviceId: principal.deviceId }
            : {}),
          metadataError: linkMetadata?.error,
        },
      }),
    });

    return jsonResponse(
      request,
      {
        ok: true,
        alreadySaved: false,
        referenceId: created.referenceId,
        assetId: created.assetId,
        storageStatus,
      },
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

async function authenticateCapture(
  ctx: any,
  request: Request,
): Promise<AccessPrincipal> {
  const token = bearerToken(request);
  if (!token)
    throw new AccessError("Pair or unlock Ourchival before capturing.");

  try {
    if (await isOwnerAccessKey(token)) return { kind: "owner" };
  } catch (error) {
    if (
      !(error instanceof AccessError) ||
      error.code !== "owner_access_unconfigured"
    )
      throw error;
  }

  const tokenHash = await hashSecret(token);
  const result = await ctx.runMutation(internal.httpDb.authenticateClipper, {
    tokenHash,
    usedAt: Date.now(),
  });
  if (!result.ok && result.reason === "invalid") {
    throw new AccessError(
      "This Clipper credential is invalid.",
      401,
      "invalid_device",
    );
  }
  if (!result.ok) {
    throw new AccessError("This Clipper was revoked.", 403, "revoked_device");
  }
  return {
    kind: "clipper",
    deviceId: result.deviceId,
    deviceName: result.deviceName,
  };
}

function accessErrorResponse(request: Request, error: unknown) {
  if (error instanceof AccessError) {
    return jsonResponse(
      request,
      { ok: false, error: error.message, code: error.code },
      error.status,
    );
  }
  return jsonResponse(
    request,
    { ok: false, error: "Access check failed." },
    500,
  );
}

async function persistDuplicateCapture(
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
): Promise<DuplicateCapture | null> {
  const assetUrl = cleanString(args.body.assetUrl);
  let storedAsset: StoredRemoteAsset | undefined;
  if (assetUrl && !duplicate.assetId) {
    storedAsset = await fetchAndStoreRemoteAsset(ctx, {
      assetUrl,
      sourceUrl: duplicate.reference.sourceUrl,
      title: args.pageTitle ?? duplicate.reference.title,
    });
  }
  const saved = await ctx.runMutation(internal.httpDb.saveDuplicateCapture, {
    referenceId: String(duplicate.reference._id),
    reason: duplicate.reason,
    ...(assetUrl ? { assetUrl } : {}),
    ...(storedAsset ? { storedAsset: serializableValue(storedAsset) } : {}),
    body: serializableValue(args.body),
    details: serializableValue({
      canonicalUrl: args.canonicalUrl,
      pageTitle: args.pageTitle,
      postText: args.postText,
      altText: args.altText,
      selectedText: args.selectedText,
      rawMetadata: args.rawMetadata,
      explicitAuthorName: args.explicitAuthorName,
      authorHandle: args.authorHandle,
      authorUrl: args.authorUrl,
      postId: args.postId,
      publishedAt: args.publishedAt,
      captureSessionId: args.captureSessionId,
    }),
    ...(args.metadata ? { metadata: serializableValue(args.metadata) } : {}),
  });
  return saved
    ? {
        reference: saved.reference,
        assetId: saved.assetId,
        reason: duplicate.reason,
      }
    : null;
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

function mergeLinkMetadata(
  remote: LinkMetadata,
  client: LinkMetadata,
): LinkMetadata {
  const merged = {
    ...remote,
    ...(client.canonicalUrl ? { canonicalUrl: client.canonicalUrl } : {}),
    ...(client.title ? { title: client.title } : {}),
    ...(client.description ? { description: client.description } : {}),
    ...(client.siteName ? { siteName: client.siteName } : {}),
    ...(client.faviconUrl ? { faviconUrl: client.faviconUrl } : {}),
    ...(client.previewImageUrl
      ? { previewImageUrl: client.previewImageUrl }
      : {}),
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
  if (metadata.metadataStatus === "missing")
    return "link saved; metadata sparse";
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

async function fetchAndStoreRemoteAsset(
  ctx: { storage: { store: (blob: Blob) => Promise<any> } },
  args: { assetUrl: string; sourceUrl: string; title?: string },
): Promise<StoredRemoteAsset> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remoteAssetTimeoutMs);
  try {
    const { response } = await fetchPublicResponse(args.assetUrl, {
      signal: controller.signal,
      headers: {
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      return {
        status: `fetch failed: ${response.status}`,
        storageProvider: "linked",
      };
    }

    const mimeType = response.headers.get("Content-Type") ?? undefined;
    const contentLength = Number(response.headers.get("Content-Length") ?? 0);
    if (contentLength > maxRemoteAssetBytes) {
      return { status: "remote asset too large", storageProvider: "linked" };
    }
    if (!mimeType?.toLowerCase().startsWith("image/")) {
      return {
        status: `remote asset is ${mimeType ?? "an unknown type"}`,
        storageProvider: "linked",
      };
    }

    const blob = await readBoundedBlob(response, mimeType, maxRemoteAssetBytes);
    if (!blob) {
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
      status:
        error instanceof Error ? error.message : "remote asset fetch failed",
      storageProvider: "linked",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBlob(
  response: Response,
  mimeType: string,
  maxBytes: number,
) {
  if (!response.body) return new Blob([], { type: mimeType });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    return new Blob(chunks, { type: mimeType });
  } finally {
    reader.releaseLock();
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
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
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

function serializableValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default http;
