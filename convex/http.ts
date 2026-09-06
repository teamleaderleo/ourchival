import {
  assetQuality,
  completeImageResponse,
  imageDimensions,
} from "./lib/assetQuality";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  fetchDriveFile,
  uploadBlobToDrive,
  uploadStreamToDrive,
} from "./lib/drive";
import {
  fetchPublicResponse,
  fetchLinkMetadata,
  remoteAssetCandidateUrls,
  type LinkMetadata,
} from "./lib/linkMetadata";
import { detectPlatform } from "./lib/platform";
import {
  AccessError,
  bearerToken,
  cleanDeviceName,
  createDeviceToken,
  createPairingCode,
  exchangeOwnerCredential,
  hashSecret,
  isOwnerAccessKey,
  normalizePairingCode,
  requestCorsHeaders,
  requireOwnerAccess,
  type AccessPrincipal,
} from "./lib/privateAccess";
import { readLinkBatch } from "./lib/linkIntake";
import { normalizeSourceUrl } from "./lib/urls";

const http = httpRouter();
const maxBufferedRemoteAssetBytes = 25 * 1024 * 1024;
const remoteAssetTimeoutMs = 15_000;
const remoteAssetStreamTimeoutMs = 8 * 60 * 1000;
const pairingLifetimeMs = 10 * 60 * 1000;

type CaptureBody = {
  kind?:
    "image" | "post" | "page" | "link" | "article" | "video_frame" | "file";
  sourceUrl?: string;
  canonicalUrl?: string;
  assetUrl?: string;
  assetOriginalUrl?: string;
  promoteOriginal?: boolean;
  assetIndex?: number;
  assetCount?: number;
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
  tags?: string[];
  captureSessionId?: string;
  capturedAt?: string;
};

type CaptureSessionBody = {
  receiptJson?: string;
  sessionKey?: string;
  source?: string;
  label?: string;
  sourceUrl?: string;
  expectedCount?: number;
  completedCount?: number;
  savedCount?: number;
  duplicateCount?: number;
  skippedCount?: number;
  failedCount?: number;
  status?: "running" | "completed" | "interrupted";
  startedAt?: string;
  completedAt?: string;
};

type CaptureObservationBody = {
  sessionKey?: string;
  source?: string;
  observations?: Array<{
    providerId?: string;
    sourceUrl?: string;
    stage?: "discovered" | "rendered" | "archived" | "failed";
    error?: string;
    observedAt?: string;
  }>;
};

type CaptureObservationGapsBody = {
  sessionKey?: string;
  limit?: number;
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

type UpdateAssetBody = {
  notes?: string;
  addTags?: string[];
  removeTagIds?: string[];
  metadata?: unknown;
};

type ReferenceStatusBody = {
  sourceUrls?: string[];
};

type StoredRemoteAsset = {
  status: string;
  storageProvider: "google_drive" | "convex" | "linked";
  fetchedUrl?: string;
  storedThisRequest?: boolean;
  quality?: string;
  qualityReason?: string;
  fetchReceipt?: string;
  width?: number;
  height?: number;
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
  storedAsset?: StoredRemoteAsset;
};

for (const path of [
  "/auth-check",
  "/capture",
  "/capture-session",
  "/capture-observations",
  "/capture-observation-gaps",
  "/capture-links",
  "/references",
  "/reference-status",
  "/reference",
  "/asset",
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
  path: "/reference-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      await authenticateCapture(ctx, request);
      const body = (await request
        .json()
        .catch(() => ({}))) as ReferenceStatusBody;
      const sourceUrls = cleanStringArray(body.sourceUrls, 80)
        .map(normalizeSourceUrl)
        .filter(Boolean);
      const indexedSourceUrls = await ctx.runQuery(
        internal.httpDb.referenceStatuses,
        { sourceUrls },
      );
      return jsonResponse(request, { ok: true, indexedSourceUrls });
    } catch (error) {
      return accessErrorResponse(request, error);
    }
  }),
});

http.route({
  path: "/auth-check",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    try {
      const owner = await exchangeOwnerCredential(bearerToken(request));
      return jsonResponse(request, {
        ok: true,
        principal: "owner",
        credential: owner.credential,
        ...(owner.expiresAt ? { expiresAt: owner.expiresAt } : {}),
      });
    } catch (error) {
      return accessErrorResponse(request, error);
    }
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
      let searchMode: string | undefined;
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
        searchMode = batch.searchMode;
        counts = batch.counts;
        if (batch.scanned === 0) break;
      }

      return jsonResponse(request, {
        ok: true,
        references,
        continueCursor: hasMore ? cursor : null,
        hasMore,
        scanned,
        searchMode,
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
  path: "/asset",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const denied = await ownerDenied(request);
    if (denied) return denied;
    const assetId = new URL(request.url).searchParams.get("id");
    if (!assetId)
      return jsonResponse(request, { ok: false, error: "id is required" }, 400);
    const body = (await readJson(request)) as UpdateAssetBody | undefined;
    if (!body)
      return jsonResponse(request, { ok: false, error: "Invalid JSON" }, 400);

    const notes = cleanString(body.notes)?.slice(0, 4_000);
    const metadata = boundedJsonMetadata(body.metadata);
    if (body.metadata !== undefined && metadata === undefined) {
      return jsonResponse(
        request,
        {
          ok: false,
          error: "metadata must be valid JSON no larger than 32 KiB",
        },
        400,
      );
    }
    const updated = await ctx.runMutation(internal.httpDb.updateAssetMetadata, {
      assetId,
      patch: serializableValue({
        ...(typeof body.notes === "string" ? { notes: notes ?? "" } : {}),
        ...(metadata ? { jsonMetadata: metadata } : {}),
      }),
      addTagNames: cleanTagNames(body.addTags),
      removeTagIds: cleanStringArray(body.removeTagIds, 32),
    });
    if (!updated)
      return jsonResponse(
        request,
        { ok: false, error: "Asset not found" },
        404,
      );
    return jsonResponse(request, { ok: true, ...updated });
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
  path: "/capture-links",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      await authenticateCapture(ctx, request);
    } catch (error) {
      return accessErrorResponse(request, error);
    }
    try {
      const body = await readLinkBatch(request);
      const receipt = await ctx.runMutation(internal.httpDb.importLinkBatch, {
        batch: body,
      });
      return jsonResponse(request, receipt);
    } catch {
      return jsonResponse(
        request,
        {
          ok: false,
          error:
            "Batch was not acknowledged. Check the input limits, then submit the same list to resume.",
        },
        400,
      );
    }
  }),
});

http.route({
  path: "/capture-observation-gaps",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      await authenticateCapture(ctx, request);
    } catch (error) {
      return accessErrorResponse(request, error);
    }
    const body = (await readJson(request)) as
      CaptureObservationGapsBody | undefined;
    const sessionKey = cleanString(body?.sessionKey);
    if (!sessionKey || sessionKey.length > 160) {
      return jsonResponse(
        request,
        { ok: false, error: "sessionKey is required" },
        400,
      );
    }
    const gaps = await ctx.runQuery(internal.captureObservations.listGaps, {
      sessionKey,
      limit: Math.min(400, Math.max(1, Math.floor(body?.limit ?? 200))),
    });
    return jsonResponse(request, { ok: true, gaps });
  }),
});

http.route({
  path: "/capture-observations",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      await authenticateCapture(ctx, request);
    } catch (error) {
      return accessErrorResponse(request, error);
    }

    const body = (await readJson(request)) as
      CaptureObservationBody | undefined;
    const sessionKey = cleanString(body?.sessionKey);
    const source = cleanString(body?.source);
    if (!sessionKey || !source || !Array.isArray(body?.observations)) {
      return jsonResponse(
        request,
        {
          ok: false,
          error: "sessionKey, source, and observations are required",
        },
        400,
      );
    }
    if (
      sessionKey.length > 160 ||
      source.length > 64 ||
      body.observations.length === 0 ||
      body.observations.length > 200
    ) {
      return jsonResponse(
        request,
        { ok: false, error: "Invalid observation batch" },
        400,
      );
    }

    const observations = body.observations.flatMap((item) => {
      const providerId = cleanString(item.providerId);
      const sourceUrl = cleanUrl(item.sourceUrl);
      const status =
        item.stage === "discovered" ||
        item.stage === "rendered" ||
        item.stage === "archived" ||
        item.stage === "failed"
          ? item.stage
          : undefined;
      if (!providerId || providerId.length > 96 || !status) return [];
      const error = cleanString(item.error);
      return [
        {
          providerId,
          ...(sourceUrl ? { sourceUrl } : {}),
          status,
          ...(error ? { error: error.slice(0, 320) } : {}),
          observedAt: parseOptionalDate(item.observedAt) ?? Date.now(),
        },
      ];
    });
    if (observations.length !== body.observations.length) {
      return jsonResponse(
        request,
        { ok: false, error: "Invalid observation" },
        400,
      );
    }
    const receipt = await ctx.runMutation(internal.captureObservations.record, {
      sessionKey,
      source,
      observations,
      updatedAt: Date.now(),
    });
    return jsonResponse(request, { ok: true, receipt });
  }),
});

http.route({
  path: "/capture-session",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      await authenticateCapture(ctx, request);
    } catch (error) {
      return accessErrorResponse(request, error);
    }

    const body = (await readJson(request)) as CaptureSessionBody | undefined;
    if (!body)
      return jsonResponse(request, { ok: false, error: "Invalid JSON" }, 400);
    const sessionKey = cleanString(body.sessionKey);
    const source = cleanString(body.source);
    const status =
      body.status === "running" ||
      body.status === "completed" ||
      body.status === "interrupted"
        ? body.status
        : undefined;
    if (!sessionKey || !source || !status) {
      return jsonResponse(
        request,
        { ok: false, error: "sessionKey, source, and status are required" },
        400,
      );
    }
    if (sessionKey.length > 160 || source.length > 64) {
      return jsonResponse(
        request,
        { ok: false, error: "Capture session identity is too long" },
        400,
      );
    }

    const label = cleanString(body.label);
    const sourceUrl = cleanUrl(body.sourceUrl);
    const startedAt = parseOptionalDate(body.startedAt) ?? Date.now();
    const completedAt = parseOptionalDate(body.completedAt);
    const session = await ctx.runMutation(
      internal.httpDb.upsertCaptureSession,
      {
        sessionKey,
        source,
        ...(label ? { label: label.slice(0, 160) } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(typeof body.receiptJson === "string" &&
        body.receiptJson.length <= 16_000
          ? { receiptJson: body.receiptJson }
          : {}),
        expectedCount: boundedSessionCount(body.expectedCount),
        completedCount: boundedSessionCount(body.completedCount),
        savedCount: boundedSessionCount(body.savedCount),
        duplicateCount: boundedSessionCount(body.duplicateCount),
        skippedCount: boundedSessionCount(body.skippedCount),
        failedCount: boundedSessionCount(body.failedCount),
        status,
        startedAt,
        ...(completedAt ? { completedAt } : {}),
        updatedAt: Date.now(),
      },
    );
    return jsonResponse(request, { ok: true, session });
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
    const assetIndex = boundedAssetOrdinal(body.assetIndex);
    const assetCount = boundedAssetCount(body.assetCount);
    const rawMetadata = cleanString(body.rawMetadata);
    const tagNames = cleanTagNames(body.tags);
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
    let duplicate: DuplicateCapture | null = await ctx.runQuery(
      internal.httpDb.findDuplicateCapture,
      {
        sourceUrl,
        canonicalUrl,
        ...(assetUrl ? { assetUrl } : {}),
      },
    );

    if (duplicate) {
      duplicate = await persistDuplicateCapture(ctx, duplicate, {
        body,
        canonicalUrl,
        pageTitle,
        postText,
        altText,
        assetIndex,
        assetCount,
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
          assetIndex,
          assetCount,
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
      ...(tagNames.includes("Sealed") ? { sealed: true } : {}),
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
        originalUrl: cleanString(body.assetOriginalUrl),
        sourceUrl,
        title,
      });
      storageStatus = storedAsset.status;
    }

    const created = await ctx.runMutation(internal.httpDb.createCapture, {
      reference: referenceDocument,
      tagNames,
      ...(assetUrl ? { assetUrl } : {}),
      ...(storedAsset ? { storedAsset: serializableValue(storedAsset) } : {}),
      ...(assetUrl
        ? {
            assetDetails: serializableValue({
              assetIndex,
              assetCount,
              altText,
            }),
          }
        : {}),
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
        ...(storedAsset
          ? {
              storageProvider: storedAsset.storageProvider,
              assetQuality: assetQuality(storedAsset),
              storedBytes: storedAsset.fileSize,
              newStoredBytes: storedAsset.storedThisRequest
                ? storedAsset.fileSize
                : 0,
            }
          : {}),
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
    assetIndex?: number;
    assetCount?: number;
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
  // Trash is a retained rejection, not an invitation to download the same post again.
  if (duplicate.reference.deleted) return duplicate;
  const assetUrl = cleanString(args.body.assetUrl);
  let storedAsset: StoredRemoteAsset | undefined;
  if (
    assetUrl &&
    (!duplicate.assetId ||
      duplicate.storedAsset?.storageProvider === "linked" ||
      (args.body.promoteOriginal === true &&
        assetQuality(duplicate.storedAsset ?? {}) !== "original"))
  ) {
    storedAsset = await fetchAndStoreRemoteAsset(ctx, {
      assetUrl,
      originalUrl: cleanString(args.body.assetOriginalUrl),
      promotionOnly: Boolean(
        duplicate.assetId &&
        duplicate.storedAsset?.storageProvider !== "linked",
      ),
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
    tagNames: cleanTagNames(args.body.tags),
    details: serializableValue({
      canonicalUrl: args.canonicalUrl,
      pageTitle: args.pageTitle,
      postText: args.postText,
      altText: args.altText,
      assetIndex: args.assetIndex,
      assetCount: args.assetCount,
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
  const assetReceipt = duplicateAssetReceipt(
    storedAsset,
    duplicate.storedAsset,
  );
  return saved
    ? {
        reference: saved.reference,
        assetId: saved.assetId,
        reason: duplicate.reason,
        ...(assetReceipt ? { storedAsset: assetReceipt } : {}),
      }
    : null;
}

export function duplicateAssetReceipt<T extends { storageProvider?: string }>(
  fetched: T | undefined,
  existing: T | undefined,
) {
  return fetched?.storageProvider === "linked" &&
    existing &&
    existing.storageProvider !== "linked"
    ? existing
    : (fetched ?? existing);
}

function cleanTagNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().replace(/\s+/g, " ").slice(0, 48))
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function cleanStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

function boundedAssetOrdinal(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < 100
    ? value
    : undefined;
}

function boundedAssetCount(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 100
    ? value
    : undefined;
}

function boundedJsonMetadata(value: unknown) {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" && json.length <= 32_768 ? json : undefined;
  } catch {
    return undefined;
  }
}

function boundedSessionCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1_000_000, Math.max(0, Math.floor(value)))
    : 0;
}

function duplicateResponse(request: Request, duplicate: DuplicateCapture) {
  return jsonResponse(request, {
    ok: true,
    alreadySaved: true,
    blocked: Boolean(duplicate.reference.deleted),
    duplicateReason: duplicate.reason,
    referenceId: duplicate.reference._id,
    assetId: duplicate.assetId,
    storageStatus: duplicate.reference.deleted
      ? "blocked by Trash"
      : (duplicate.storedAsset?.status ?? "already saved"),
    ...(duplicate.storedAsset
      ? {
          storageProvider: duplicate.storedAsset.storageProvider,
          assetQuality: assetQuality(duplicate.storedAsset),
          storedBytes: duplicate.storedAsset.fileSize,
          newStoredBytes: duplicate.storedAsset.storedThisRequest
            ? duplicate.storedAsset.fileSize
            : 0,
        }
      : {}),
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

export async function fetchAndStoreRemoteAsset(
  ctx: { storage: { store: (blob: Blob) => Promise<any> } },
  args: {
    assetUrl: string;
    originalUrl?: string;
    promotionOnly?: boolean;
    sourceUrl: string;
    title?: string;
  },
): Promise<StoredRemoteAsset> {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), remoteAssetTimeoutMs);
  const candidates = Array.from(
    new Set([
      ...(args.originalUrl ? [args.originalUrl] : []),
      ...remoteAssetCandidateUrls(args.assetUrl),
    ]),
  ).filter(
    (url) =>
      !args.promotionOnly || assetQuality({ fetchedUrl: url }) === "original",
  );
  const attempts: Array<Record<string, unknown>> = [];
  let selectedUrl: string | undefined;
  let dimensions: { width: number; height: number } | undefined;
  const receipt = (result: StoredRemoteAsset): StoredRemoteAsset => ({
    ...result,
    storedThisRequest: result.storageProvider !== "linked",
    ...(selectedUrl ? { fetchedUrl: selectedUrl } : {}),
    ...dimensions,
    quality: selectedUrl
      ? assetQuality({ fetchedUrl: selectedUrl })
      : "unknown",
    qualityReason: !selectedUrl
      ? "No complete image retrieved; original availability unresolved"
      : assetQuality({ fetchedUrl: selectedUrl }) === "degraded"
        ? "Original candidates failed; retained a resized rendition. HTTP 403 does not prove nonexistence."
        : assetQuality({ fetchedUrl: selectedUrl }) === "unknown"
          ? "Served rendition lacks original evidence"
          : "Fetched original rendition",
    fetchReceipt: JSON.stringify({
      version: 1,
      at: new Date().toISOString(),
      candidates,
      selectedUrl: selectedUrl ?? null,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      attempts,
      candidateOutcomes: candidates.map(
        (url) =>
          attempts.find((a) => a.url === url) ?? {
            url,
            outcome: "not_attempted",
            status: null,
            bytes: null,
            width: null,
            height: null,
          },
      ),
    }),
  });
  try {
    for (const candidateUrl of candidates) {
      const attempt: Record<string, unknown> = {
        url: candidateUrl,
        status: null,
        bytes: null,
        width: null,
        height: null,
      };
      attempts.push(attempt);
      try {
        const isPixiv = /(^|\.)pximg\.net$/.test(
          new URL(candidateUrl).hostname,
        );
        const result = await fetchPublicResponse(candidateUrl, {
          signal: controller.signal,
          headers: {
            Accept: "image/*",
            ...(isPixiv ? { Referer: "https://www.pixiv.net/" } : {}),
          },
        });
        const response = result.response;
        attempt.status = response.status;
        attempt.finalUrl = result.finalUrl;
        attempt.contentRange = response.headers.get("content-range");
        const mimeType = response.headers.get("content-type") ?? "";
        attempt.mimeType = mimeType;
        if (
          !completeImageResponse(response) ||
          !mimeType.toLowerCase().startsWith("image/") ||
          (isPixiv &&
            assetQuality({ fetchedUrl: result.finalUrl }) !== "original")
        ) {
          attempt.error = !response.ok
            ? "HTTP " + response.status
            : response.status === 206
              ? "Incomplete or unproven byte range"
              : "Not an image";
          const errorBody = await readBoundedBlob(
            response,
            mimeType,
            64 * 1024,
          );
          attempt.bytes = errorBody?.size ?? null;
          continue;
        }
        const contentLength = Number(
          response.headers.get("content-length") ?? 0,
        );
        let driveUpload;
        let blob: Blob | undefined;
        let fileSize: number;
        if (contentLength > maxBufferedRemoteAssetBytes && response.body) {
          clearTimeout(timer);
          timer = setTimeout(
            () => controller.abort(),
            remoteAssetStreamTimeoutMs,
          );
          const reader = response.body.getReader();
          const first = await reader.read();
          dimensions = first.value ? imageDimensions(first.value) : undefined;
          let pending = first.value;
          let total = 0;
          const stream = new ReadableStream<Uint8Array>({
            async pull(target) {
              const chunk = pending
                ? { done: false, value: pending }
                : await reader.read();
              pending = undefined;
              if (chunk.done) {
                if (total !== contentLength)
                  target.error(new Error("Image byte count mismatch"));
                else target.close();
                reader.releaseLock();
                return;
              }
              total += chunk.value!.byteLength;
              if (total > contentLength) {
                target.error(new Error("Image exceeds declared size"));
                await reader.cancel();
                return;
              }
              target.enqueue(chunk.value!);
            },
            cancel(reason) {
              return reader.cancel(reason);
            },
          });
          driveUpload = await uploadStreamToDrive({
            stream,
            size: contentLength,
            sourceUrl: args.sourceUrl,
            title: args.title,
            mimeType,
          });
          fileSize = total;
        } else {
          const downloaded = await readBoundedBlob(
            response,
            mimeType,
            maxBufferedRemoteAssetBytes,
          );
          if (
            !downloaded ||
            downloaded.size === 0 ||
            (contentLength && downloaded.size !== contentLength)
          ) {
            attempt.error = "Empty, oversized, or incomplete image body";
            continue;
          }
          blob = downloaded;
          dimensions = imageDimensions(
            new Uint8Array(await blob.arrayBuffer()),
          );
          fileSize = blob.size;
          driveUpload = await uploadBlobToDrive({
            blob,
            sourceUrl: args.sourceUrl,
            title: args.title,
            mimeType,
          });
        }
        selectedUrl = result.finalUrl;
        attempt.bytes = fileSize;
        attempt.width = dimensions?.width ?? null;
        attempt.height = dimensions?.height ?? null;
        if (driveUpload.ok && driveUpload.file?.id) {
          return receipt({
            status: driveUpload.status,
            storageProvider: "google_drive",
            mimeType,
            fileSize,
            driveFileId: driveUpload.file.id,
            driveFolderId: driveUpload.file.parents?.[0],
            driveWebViewLink: driveUpload.file.webViewLink,
            driveWebContentLink: driveUpload.file.webContentLink,
            driveThumbnailLink: driveUpload.file.thumbnailLink,
            driveMimeType: driveUpload.file.mimeType,
          });
        }
        // Pixiv originals must reach Drive. A failed upload remains retryable.
        if (blob && !isPixiv) {
          const storageId = await ctx.storage.store(blob);
          return receipt({
            status:
              driveUpload.status + "; asset stored in Convex Storage fallback",
            storageProvider: "convex",
            storageId,
            mimeType,
            fileSize,
          });
        }
        return receipt({
          status: driveUpload.status,
          storageProvider: "linked",
        });
      } catch (error) {
        attempt.error =
          error instanceof Error ? error.message : "Asset request failed";
        if (controller.signal.aborted) break;
      }
    }
    return receipt({
      status: "No complete original image secured; see fetch receipt",
      storageProvider: "linked",
    });
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
  const chunks: ArrayBuffer[] = [];
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
      chunks.push(new Uint8Array(value).buffer);
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
