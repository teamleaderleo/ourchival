import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  applyReferenceStatsDelta,
  ensureReferenceStats,
  listReferencePage,
  sourceSnapshotPayload,
} from "./lib/referenceCatalog";
import { normalizeSourceUrl } from "./lib/urls";
import { updateReferenceTags } from "./lib/tags";

export const initializeReferenceStats = internalMutation({
  args: {},
  handler: async (ctx) => await ensureReferenceStats(ctx),
});

export const listReferences = internalQuery({
  args: { url: v.string() },
  handler: async (ctx, args) => await listReferencePage(ctx, args.url),
});

export const createPairingGrant = internalMutation({
  args: {
    codeHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("clipperPairingGrants", args);
    return null;
  },
});

export const exchangePairingGrant = internalMutation({
  args: {
    codeHash: v.string(),
    tokenHash: v.string(),
    name: v.string(),
    now: v.number(),
    extensionVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("clipperPairingGrants")
      .withIndex("by_code_hash", (q) => q.eq("codeHash", args.codeHash))
      .first();
    if (!grant || grant.usedAt || grant.expiresAt <= args.now) {
      return { ok: false as const };
    }

    const deviceId = await ctx.db.insert("clipperDevices", {
      name: args.name,
      tokenHash: args.tokenHash,
      createdAt: args.now,
      lastUsedAt: args.now,
      ...(args.extensionVersion
        ? { extensionVersion: args.extensionVersion }
        : {}),
    });
    await ctx.db.patch(grant._id, { usedAt: args.now });
    return { ok: true as const, deviceId };
  },
});

export const listClipperDevices = internalQuery({
  args: {},
  handler: async (ctx) => {
    const devices = await ctx.db
      .query("clipperDevices")
      .withIndex("by_created_at")
      .order("desc")
      .collect();
    return devices.map(({ tokenHash: _tokenHash, ...device }) => device);
  },
});

export const revokeClipperDevice = internalMutation({
  args: { deviceId: v.string(), revokedAt: v.number() },
  handler: async (ctx, args) => {
    const deviceId = ctx.db.normalizeId("clipperDevices", args.deviceId);
    if (!deviceId || !(await ctx.db.get(deviceId))) return false;
    await ctx.db.patch(deviceId, { revokedAt: args.revokedAt });
    return true;
  },
});

export const authenticateClipper = internalMutation({
  args: { tokenHash: v.string(), usedAt: v.number() },
  handler: async (ctx, args) => {
    const device = await ctx.db
      .query("clipperDevices")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .first();
    if (!device) return { ok: false as const, reason: "invalid" as const };
    if (device.revokedAt)
      return { ok: false as const, reason: "revoked" as const };
    await ctx.db.patch(device._id, { lastUsedAt: args.usedAt });
    return {
      ok: true as const,
      deviceId: String(device._id),
      deviceName: device.name,
    };
  },
});

export const upsertCaptureSession = internalMutation({
  args: {
    sessionKey: v.string(),
    source: v.string(),
    label: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    expectedCount: v.number(),
    completedCount: v.number(),
    savedCount: v.number(),
    duplicateCount: v.number(),
    skippedCount: v.number(),
    failedCount: v.number(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("interrupted"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("captureSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    const counts = {
      expectedCount: Math.max(existing?.expectedCount ?? 0, args.expectedCount),
      completedCount: Math.max(
        existing?.completedCount ?? 0,
        args.completedCount,
      ),
      savedCount: Math.max(existing?.savedCount ?? 0, args.savedCount),
      duplicateCount: Math.max(
        existing?.duplicateCount ?? 0,
        args.duplicateCount,
      ),
      skippedCount: Math.max(existing?.skippedCount ?? 0, args.skippedCount),
      failedCount: Math.max(existing?.failedCount ?? 0, args.failedCount),
    };
    if (existing) {
      await ctx.db.patch(existing._id, {
        source: args.source,
        kind: "import",
        ...(args.label ? { label: args.label } : {}),
        ...(args.sourceUrl ? { sourceUrl: args.sourceUrl } : {}),
        ...counts,
        status: args.status,
        startedAt: Math.min(existing.startedAt, args.startedAt),
        ...(args.completedAt ? { completedAt: args.completedAt } : {}),
        updatedAt: args.updatedAt,
      });
      return await ctx.db.get(existing._id);
    }
    const sessionId = await ctx.db.insert("captureSessions", {
      sessionKey: args.sessionKey,
      source: args.source,
      kind: "import",
      ...(args.label ? { label: args.label } : {}),
      ...(args.sourceUrl ? { sourceUrl: args.sourceUrl } : {}),
      ...counts,
      status: args.status,
      reviewState: "unreviewed",
      startedAt: args.startedAt,
      ...(args.completedAt ? { completedAt: args.completedAt } : {}),
      createdAt: args.updatedAt,
      updatedAt: args.updatedAt,
    });
    return await ctx.db.get(sessionId);
  },
});

const importSourceValidator = v.union(
  v.literal("onetab"),
  v.literal("bookmarks"),
  v.literal("url_list"),
);

export const submitImportBatch = internalMutation({
  args: {
    sessionKey: v.string(),
    source: importSourceValidator,
    parserVersion: v.string(),
    importDigest: v.string(),
    expectedCount: v.number(),
    records: v.array(
      v.object({
        ordinal: v.number(),
        submittedUrl: v.string(),
        submittedTitle: v.optional(v.string()),
        sourceGroup: v.optional(v.string()),
      }),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existingSession = await ctx.db
      .query("captureSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();

    if (
      existingSession &&
      (existingSession.source !== args.source ||
        existingSession.expectedCount !== args.expectedCount ||
        (existingSession.parserVersion &&
          existingSession.parserVersion !== args.parserVersion) ||
        (existingSession.importDigest &&
          existingSession.importDigest !== args.importDigest))
    ) {
      throw new Error(
        "Import session identity does not match its saved receipt.",
      );
    }

    let savedDelta = 0;
    let duplicateDelta = 0;
    let skippedDelta = 0;
    let failedDelta = 0;
    const receipts = [];

    for (const record of args.records) {
      const replay = await ctx.db
        .query("importOccurrences")
        .withIndex("by_session_key_and_ordinal", (q) =>
          q.eq("sessionKey", args.sessionKey).eq("ordinal", record.ordinal),
        )
        .unique();
      if (replay) {
        if (
          replay.submittedUrl !== record.submittedUrl ||
          replay.submittedTitle !== record.submittedTitle ||
          replay.sourceGroup !== record.sourceGroup
        ) {
          throw new Error(
            `Import ordinal ${record.ordinal} conflicts with its saved source record.`,
          );
        }
        receipts.push(importReceipt(replay, true));
        continue;
      }

      const cleanSubmittedUrl = record.submittedUrl.trim();
      let parsedUrl: URL | undefined;
      try {
        parsedUrl = new URL(cleanSubmittedUrl);
      } catch {
        parsedUrl = undefined;
      }

      if (
        !Number.isSafeInteger(record.ordinal) ||
        record.ordinal < 0 ||
        !parsedUrl ||
        (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")
      ) {
        const occurrenceId = await ctx.db.insert("importOccurrences", {
          sessionKey: args.sessionKey,
          ordinal: record.ordinal,
          source: args.source,
          parserVersion: args.parserVersion,
          submittedUrl: record.submittedUrl,
          ...(record.submittedTitle
            ? { submittedTitle: record.submittedTitle }
            : {}),
          ...(record.sourceGroup ? { sourceGroup: record.sourceGroup } : {}),
          outcome: "skipped",
          errorClass: "invalid_url",
          createdAt: args.now,
        });
        const occurrence = await ctx.db.get(occurrenceId);
        skippedDelta += 1;
        receipts.push(importReceipt(occurrence!, false));
        continue;
      }

      if (
        record.submittedUrl.length > 4_096 ||
        (record.submittedTitle?.length ?? 0) > 2_000 ||
        (record.sourceGroup?.length ?? 0) > 2_000
      ) {
        const occurrenceId = await ctx.db.insert("importOccurrences", {
          sessionKey: args.sessionKey,
          ordinal: record.ordinal,
          source: args.source,
          parserVersion: args.parserVersion,
          submittedUrl: record.submittedUrl,
          ...(record.submittedTitle
            ? { submittedTitle: record.submittedTitle }
            : {}),
          ...(record.sourceGroup ? { sourceGroup: record.sourceGroup } : {}),
          outcome: "failed",
          errorClass: "invalid_record",
          createdAt: args.now,
        });
        const occurrence = await ctx.db.get(occurrenceId);
        failedDelta += 1;
        receipts.push(importReceipt(occurrence!, false));
        continue;
      }

      const normalizedUrl = normalizeSourceUrl(cleanSubmittedUrl);
      const exact = await ctx.db
        .query("references")
        .withIndex("by_source_url", (q) => q.eq("sourceUrl", cleanSubmittedUrl))
        .first();
      const normalized = exact
        ? null
        : await ctx.db
            .query("references")
            .withIndex("by_normalized_source_url", (q) =>
              q.eq("normalizedSourceUrl", normalizedUrl),
            )
            .first();
      const canonical =
        exact || normalized
          ? null
          : await ctx.db
              .query("references")
              .withIndex("by_canonical_url", (q) =>
                q.eq("canonicalUrl", normalizedUrl),
              )
              .first();
      const duplicate =
        exact && !exact.deleted
          ? { reference: exact, reason: "source_url" as const }
          : normalized && !normalized.deleted
            ? { reference: normalized, reason: "normalized_url" as const }
            : canonical && !canonical.deleted
              ? {
                  reference: canonical,
                  reason:
                    normalizeSourceUrl(canonical.sourceUrl) === normalizedUrl
                      ? ("normalized_url" as const)
                      : ("canonical_url" as const),
                }
              : null;

      let referenceId;
      let outcome: "saved" | "duplicate";
      let duplicateReason:
        "source_url" | "normalized_url" | "canonical_url" | undefined;
      if (duplicate) {
        referenceId = duplicate.reference._id;
        outcome = "duplicate";
        duplicateReason = duplicate.reason;
        duplicateDelta += 1;
      } else {
        referenceId = await ctx.db.insert("references", {
          kind: "page",
          ...(record.submittedTitle
            ? { title: record.submittedTitle.slice(0, 500) }
            : {}),
          sourceUrl: cleanSubmittedUrl,
          normalizedSourceUrl: normalizedUrl,
          canonicalUrl: normalizedUrl,
          platform: "generic",
          capturedAt: args.now,
          captureSessionId: args.sessionKey,
          triageState: "inbox",
          boardIds: [],
          tagIds: [],
          favorite: false,
          archived: false,
          deleted: false,
        });
        const reference = await ctx.db.get(referenceId);
        await applyReferenceStatsDelta(ctx, null, reference);
        await insertSourceSnapshot(ctx, {
          referenceId,
          ...(record.submittedTitle
            ? { pageTitle: record.submittedTitle.slice(0, 500) }
            : {}),
          metadata: {
            canonicalUrl: normalizedUrl,
            metadataStatus: "missing",
            metadataFetchedAt: args.now,
          },
          jsonMetadata: {
            source: args.source,
            parserVersion: args.parserVersion,
            ordinal: record.ordinal,
            ...(record.sourceGroup ? { sourceGroup: record.sourceGroup } : {}),
          },
        });
        outcome = "saved";
        savedDelta += 1;
      }

      const occurrenceId = await ctx.db.insert("importOccurrences", {
        sessionKey: args.sessionKey,
        ordinal: record.ordinal,
        source: args.source,
        parserVersion: args.parserVersion,
        submittedUrl: record.submittedUrl,
        ...(record.submittedTitle
          ? { submittedTitle: record.submittedTitle }
          : {}),
        ...(record.sourceGroup ? { sourceGroup: record.sourceGroup } : {}),
        outcome,
        referenceId,
        ...(duplicateReason ? { duplicateReason } : {}),
        createdAt: args.now,
      });
      const occurrence = await ctx.db.get(occurrenceId);
      receipts.push(importReceipt(occurrence!, false));
    }

    let checkpointOrdinal = existingSession?.checkpointOrdinal ?? -1;
    while (true) {
      const next = await ctx.db
        .query("importOccurrences")
        .withIndex("by_session_key_and_ordinal", (q) =>
          q
            .eq("sessionKey", args.sessionKey)
            .eq("ordinal", checkpointOrdinal + 1),
        )
        .unique();
      if (!next) break;
      checkpointOrdinal += 1;
    }

    const counts = {
      expectedCount: Math.max(
        existingSession?.expectedCount ?? 0,
        args.expectedCount,
      ),
      completedCount:
        (existingSession?.completedCount ?? 0) +
        savedDelta +
        duplicateDelta +
        skippedDelta +
        failedDelta,
      savedCount: (existingSession?.savedCount ?? 0) + savedDelta,
      duplicateCount: (existingSession?.duplicateCount ?? 0) + duplicateDelta,
      skippedCount: (existingSession?.skippedCount ?? 0) + skippedDelta,
      failedCount: (existingSession?.failedCount ?? 0) + failedDelta,
    };
    const completed = checkpointOrdinal + 1 >= counts.expectedCount;
    const sessionPatch = {
      source: args.source,
      parserVersion: args.parserVersion,
      importDigest: args.importDigest,
      kind: "import" as const,
      label: `${args.source.replace("_", " ")} import`,
      ...counts,
      checkpointOrdinal,
      status: completed ? ("completed" as const) : ("running" as const),
      ...(completed ? { completedAt: args.now } : {}),
      updatedAt: args.now,
    };
    let sessionId = existingSession?._id;
    if (existingSession) {
      await ctx.db.patch(existingSession._id, sessionPatch);
    } else {
      sessionId = await ctx.db.insert("captureSessions", {
        sessionKey: args.sessionKey,
        ...sessionPatch,
        reviewState: "unreviewed",
        startedAt: args.now,
        createdAt: args.now,
      });
    }
    return {
      session: await ctx.db.get(sessionId!),
      receipts,
      replayedCount: receipts.filter((receipt) => receipt.replayed).length,
      batchReceipt: {
        saved: savedDelta,
        duplicate: duplicateDelta,
        skipped: skippedDelta,
        failed: failedDelta,
        replayed: receipts.filter((receipt) => receipt.replayed).length,
        failedOrdinals: receipts
          .filter((receipt) => receipt.outcome === "failed")
          .map((receipt) => receipt.ordinal),
      },
    };
  },
});

function importReceipt(
  occurrence: {
    ordinal: number;
    outcome: "saved" | "duplicate" | "skipped" | "failed";
    referenceId?: unknown;
    duplicateReason?: "source_url" | "normalized_url" | "canonical_url";
    errorClass?: "invalid_url" | "invalid_record" | "capacity" | "internal";
  },
  replayed: boolean,
) {
  return {
    ordinal: occurrence.ordinal,
    outcome: occurrence.outcome,
    ...(occurrence.referenceId
      ? { referenceId: String(occurrence.referenceId) }
      : {}),
    ...(occurrence.duplicateReason
      ? { duplicateReason: occurrence.duplicateReason }
      : {}),
    ...(occurrence.errorClass ? { errorClass: occurrence.errorClass } : {}),
    replayed,
  };
}

export const getReferenceSource = internalQuery({
  args: { referenceId: v.string() },
  handler: async (ctx, args) => {
    const referenceId = ctx.db.normalizeId("references", args.referenceId);
    if (!referenceId) return null;
    const reference = await ctx.db.get(referenceId);
    return reference ? { sourceUrl: reference.sourceUrl } : null;
  },
});

export const applyReferenceMetadata = internalMutation({
  args: { referenceId: v.string(), metadata: v.any() },
  handler: async (ctx, args) => {
    const referenceId = ctx.db.normalizeId("references", args.referenceId);
    if (!referenceId) return null;
    const reference = await ctx.db.get(referenceId);
    if (!reference) return null;
    const metadata = args.metadata as Record<string, any>;
    const snapshotId = await insertSourceSnapshot(ctx, {
      referenceId,
      metadata,
      jsonMetadata: { refresh: true, error: metadata.error },
    });
    const snapshot = await ctx.db.get(snapshotId);
    const referencePatch: Record<string, unknown> = {};

    if (!reference.title && metadata.title)
      referencePatch.title = metadata.title;
    if (!reference.authorName && metadata.author)
      referencePatch.authorName = metadata.author;
    const refreshedCanonical = cleanUrl(metadata.canonicalUrl);
    if (refreshedCanonical) {
      const normalizedCanonical = normalizeSourceUrl(refreshedCanonical);
      if (normalizedCanonical !== reference.canonicalUrl) {
        const matches = await ctx.db
          .query("references")
          .withIndex("by_canonical_url", (q) =>
            q.eq("canonicalUrl", normalizedCanonical),
          )
          .collect();
        if (
          !matches.some((item) => item._id !== reference._id && !item.deleted)
        ) {
          referencePatch.canonicalUrl = normalizedCanonical;
        }
      }
    }

    if (Object.keys(referencePatch).length > 0) {
      await ctx.db.patch(referenceId, referencePatch);
    }
    await ctx.scheduler.runAfter(
      0,
      internal.preferenceExport.syncReferencePreference,
      {
        referenceId,
      },
    );
    return {
      reference: referencePatch,
      sourceSnapshot: snapshot ? sourceSnapshotPayload(snapshot) : undefined,
      status: metadata.metadataStatus,
    };
  },
});

export const updateReference = internalMutation({
  args: {
    referenceId: v.string(),
    patch: v.any(),
    syncPreference: v.boolean(),
  },
  handler: async (ctx, args) => {
    const referenceId = ctx.db.normalizeId("references", args.referenceId);
    if (!referenceId) return false;
    const before = await ctx.db.get(referenceId);
    if (!before) return false;
    const patch = args.patch as Record<string, unknown>;
    await ctx.db.patch(referenceId, patch);
    await applyReferenceStatsDelta(ctx, before, { ...before, ...patch });
    if (args.syncPreference) {
      await ctx.scheduler.runAfter(
        0,
        internal.preferenceExport.syncReferencePreference,
        {
          referenceId,
        },
      );
    }
    return true;
  },
});

export const deleteReference = internalMutation({
  args: { referenceId: v.string(), deletedAt: v.number() },
  handler: async (ctx, args) => {
    const referenceId = ctx.db.normalizeId("references", args.referenceId);
    if (!referenceId) return false;
    const before = await ctx.db.get(referenceId);
    if (!before) return false;
    const referencePatch = {
      deleted: true,
      archived: true,
      reviewedAt: args.deletedAt,
    };
    await ctx.db.patch(referenceId, referencePatch);
    await applyReferenceStatsDelta(ctx, before, {
      ...before,
      ...referencePatch,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.preferenceExport.syncReferencePreference,
      {
        referenceId,
      },
    );
    return true;
  },
});

export const findDuplicateCapture = internalQuery({
  args: {
    sourceUrl: v.string(),
    canonicalUrl: v.string(),
    assetUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => await findDuplicate(ctx, args),
});

export const saveDuplicateCapture = internalMutation({
  args: {
    referenceId: v.string(),
    reason: v.string(),
    assetUrl: v.optional(v.string()),
    storedAsset: v.optional(v.any()),
    body: v.any(),
    tagNames: v.array(v.string()),
    details: v.any(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const referenceId = ctx.db.normalizeId("references", args.referenceId);
    if (!referenceId) return null;
    const reference = await ctx.db.get(referenceId);
    if (!reference) return null;
    const details = args.details as Record<string, any>;
    const metadata = args.metadata as Record<string, any> | undefined;
    const body = args.body as Record<string, any>;
    const referencePatch: Record<string, unknown> = {
      ...(!reference.canonicalUrl && details.canonicalUrl
        ? { canonicalUrl: details.canonicalUrl }
        : {}),
      ...(!reference.title && (details.pageTitle ?? metadata?.title)
        ? { title: details.pageTitle ?? metadata?.title }
        : {}),
      ...(!reference.authorName &&
      (details.explicitAuthorName ?? metadata?.author)
        ? { authorName: details.explicitAuthorName ?? metadata?.author }
        : {}),
      ...(!reference.authorHandle && details.authorHandle
        ? { authorHandle: details.authorHandle }
        : {}),
      ...(!reference.authorUrl && details.authorUrl
        ? { authorUrl: details.authorUrl }
        : {}),
      ...(!reference.postId && details.postId
        ? { postId: details.postId }
        : {}),
      ...(!reference.publishedAt && details.publishedAt
        ? { publishedAt: details.publishedAt }
        : {}),
      ...(!reference.captureSessionId && details.captureSessionId
        ? { captureSessionId: details.captureSessionId }
        : {}),
    };

    let assetId = null;
    if (args.assetUrl && args.storedAsset) {
      const matchingAssets = await ctx.db
        .query("assets")
        .withIndex("by_reference", (q) => q.eq("referenceId", referenceId))
        .collect();
      const existingAsset = matchingAssets.find(
        (asset) => asset.originalUrl === args.assetUrl,
      );
      assetId = existingAsset?._id ?? null;
      if (!assetId) {
        assetId = await insertAsset(
          ctx,
          referenceId,
          args.assetUrl,
          args.storedAsset,
        );
      }
      if (body.kind === "image" && isLinkKind(reference.kind)) {
        referencePatch.kind = "image";
      }
    }

    if (Object.keys(referencePatch).length > 0) {
      await ctx.db.patch(referenceId, referencePatch);
      if (referencePatch.kind) {
        await applyReferenceStatsDelta(ctx, reference, {
          ...reference,
          ...referencePatch,
        });
      }
    }

    if (args.tagNames.length > 0) {
      await updateReferenceTags(ctx, referenceId, {
        addNames: args.tagNames,
      });
    }

    if (
      details.postText ||
      details.altText ||
      details.selectedText ||
      details.rawMetadata ||
      metadata
    ) {
      await insertSourceSnapshot(ctx, {
        referenceId,
        pageTitle: details.pageTitle ?? metadata?.title,
        postText: details.postText,
        altText: details.altText,
        selectedText: details.selectedText,
        metadata,
        jsonMetadata: {
          ...body,
          canonicalUrl: details.canonicalUrl,
          duplicateReason: args.reason,
          ...(details.rawMetadata
            ? { rawMetadata: safeJsonValue(details.rawMetadata) }
            : {}),
          metadataError: metadata?.error,
        },
      });
    }

    return { reference: { ...reference, ...referencePatch }, assetId };
  },
});

export const createCapture = internalMutation({
  args: {
    reference: v.any(),
    tagNames: v.array(v.string()),
    assetUrl: v.optional(v.string()),
    storedAsset: v.optional(v.any()),
    snapshot: v.any(),
  },
  handler: async (ctx, args) => {
    const referenceId = await ctx.db.insert("references", args.reference);
    if (args.tagNames.length > 0) {
      await updateReferenceTags(ctx, referenceId, {
        addNames: args.tagNames,
      });
    }
    const insertedReference = await ctx.db.get(referenceId);
    await applyReferenceStatsDelta(ctx, null, insertedReference);
    const assetId =
      args.assetUrl && args.storedAsset
        ? await insertAsset(ctx, referenceId, args.assetUrl, args.storedAsset)
        : null;
    await insertSourceSnapshot(ctx, {
      referenceId,
      ...(args.snapshot as Record<string, any>),
    });
    return { referenceId, assetId };
  },
});

async function findDuplicate(
  ctx: any,
  args: { sourceUrl: string; canonicalUrl: string; assetUrl?: string },
) {
  if (args.assetUrl) {
    const matchingAssets = await ctx.db
      .query("assets")
      .withIndex("by_original_url", (q: any) =>
        q.eq("originalUrl", args.assetUrl),
      )
      .collect();
    for (const asset of matchingAssets) {
      const reference = await ctx.db.get(asset.referenceId);
      if (reference && !reference.deleted) {
        return { reference, assetId: asset._id, reason: "asset_url" as const };
      }
    }
  }

  const canonicalMatches = await ctx.db
    .query("references")
    .withIndex("by_canonical_url", (q: any) =>
      q.eq("canonicalUrl", args.canonicalUrl),
    )
    .collect();
  const canonicalReference = canonicalMatches.find(
    (reference: any) => !reference.deleted,
  );
  if (canonicalReference) {
    return {
      reference: canonicalReference,
      assetId: null,
      reason: "canonical_url" as const,
    };
  }

  const sourceMatches = await ctx.db
    .query("references")
    .withIndex("by_source_url", (q: any) => q.eq("sourceUrl", args.sourceUrl))
    .collect();
  const sourceReference = sourceMatches.find(
    (reference: any) => !reference.deleted,
  );
  return sourceReference
    ? {
        reference: sourceReference,
        assetId: null,
        reason: "source_url" as const,
      }
    : null;
}

async function insertAsset(
  ctx: any,
  referenceId: any,
  assetUrl: string,
  storedAsset: Record<string, any>,
) {
  return await ctx.db.insert("assets", {
    referenceId,
    storageProvider: storedAsset.storageProvider,
    originalUrl: assetUrl,
    ...(storedAsset.storageId
      ? { originalStorageId: storedAsset.storageId }
      : {}),
    ...(storedAsset.mimeType ? { mimeType: storedAsset.mimeType } : {}),
    ...(storedAsset.fileSize ? { fileSize: storedAsset.fileSize } : {}),
    ...(storedAsset.driveFileId
      ? { driveFileId: storedAsset.driveFileId }
      : {}),
    ...(storedAsset.driveFolderId
      ? { driveFolderId: storedAsset.driveFolderId }
      : {}),
    ...(storedAsset.driveWebViewLink
      ? { driveWebViewLink: storedAsset.driveWebViewLink }
      : {}),
    ...(storedAsset.driveWebContentLink
      ? { driveWebContentLink: storedAsset.driveWebContentLink }
      : {}),
    ...(storedAsset.driveThumbnailLink
      ? { driveThumbnailLink: storedAsset.driveThumbnailLink }
      : {}),
    ...(storedAsset.driveMimeType
      ? { driveMimeType: storedAsset.driveMimeType }
      : {}),
    dominantColors: [],
  });
}

async function insertSourceSnapshot(
  ctx: any,
  args: {
    referenceId: any;
    pageTitle?: string;
    postText?: string;
    altText?: string;
    selectedText?: string;
    metadata?: Record<string, any>;
    jsonMetadata?: unknown;
  },
) {
  return await ctx.db.insert("sourceSnapshots", {
    referenceId: args.referenceId,
    ...(args.pageTitle ? { pageTitle: args.pageTitle } : {}),
    ...(args.postText ? { postText: args.postText } : {}),
    ...(args.altText ? { altText: args.altText } : {}),
    ...(args.selectedText ? { selectedText: args.selectedText } : {}),
    ...(args.metadata?.description
      ? { description: args.metadata.description }
      : {}),
    ...(args.metadata?.siteName ? { siteName: args.metadata.siteName } : {}),
    ...(args.metadata?.faviconUrl
      ? { faviconUrl: args.metadata.faviconUrl }
      : {}),
    ...(args.metadata?.previewImageUrl
      ? { previewImageUrl: args.metadata.previewImageUrl }
      : {}),
    ...(args.metadata?.author ? { pageAuthor: args.metadata.author } : {}),
    ...(args.metadata?.canonicalUrl
      ? { canonicalUrl: args.metadata.canonicalUrl }
      : {}),
    ...(args.metadata?.contentType
      ? { contentType: args.metadata.contentType }
      : {}),
    ...(args.metadata?.metadataStatus
      ? { metadataStatus: args.metadata.metadataStatus }
      : {}),
    ...(typeof args.metadata?.httpStatus === "number"
      ? { httpStatus: args.metadata.httpStatus }
      : {}),
    ...(typeof args.metadata?.metadataFetchedAt === "number"
      ? { metadataFetchedAt: args.metadata.metadataFetchedAt }
      : {}),
    ...(args.jsonMetadata !== undefined
      ? { jsonMetadata: JSON.stringify(args.jsonMetadata) }
      : {}),
    createdAt: Date.now(),
  });
}

function isLinkKind(kind: string) {
  return kind === "link" || kind === "page" || kind === "article";
}

function cleanUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).toString();
  } catch {
    return undefined;
  }
}

function safeJsonValue(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
