import { action, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { requireOwnerAccess } from "./lib/privateAccess";
import { getDriveConfig, getAccessToken } from "./lib/drive";
import { assetQuality } from "./lib/assetQuality";
import { drivePath, configuredDriveParent } from "./lib/driveOrganization";
import {
  moveBatchBody,
  verifiedBatchMoves,
  batchHttpStatuses,
  readBatchBody,
  batchFileParents,
} from "./lib/driveBatch";

const endpoint = "https://www.googleapis.com/drive/v3/files";

export const rootPointers = query({
  args: { accessKey: v.string(), paginationOpts: paginationOptsValidator, all: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const page = await ctx.db
      .query("assets")
      .paginate({ ...args.paginationOpts, numItems: 500 });
    const root = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    return {
      cursor: page.continueCursor,
      done: page.isDone,
      items: page.page
        .filter((a) => a.driveFileId && (args.all || a.driveFolderId === root))
        .map((a) => ({ id: a._id, fileId: a.driveFileId!, parent: a.driveFolderId ?? null })),
    };
  },
});

// Reconcile catalog locations with user-managed Drive organization. Never move files.
export const reconcilePointers = action({
  args: {
    accessKey: v.string(),
    files: v.array(v.object({ id: v.string(), parent: v.union(v.string(), v.null()) })),
  },
  handler: async (ctx, args): Promise<{
    changed: Array<{ id: string; parent: string }>;
    unchanged: number;
    unresolved: string[];
    statuses: Record<string, number>;
  }> => {
    await requireOwnerAccess(args.accessKey);
    if (!args.files.length || args.files.length > 100) throw new Error("Expected 1–100 files");
    const { requestRaw } = await driveClient();
    const ids = [...new Set(args.files.map(f => f.id))];
    const boundary = `ourchival_reconcile_${crypto.randomUUID()}`;
    const response = await requestRaw("https://www.googleapis.com/batch/drive/v3", {
      method: "POST",
      headers: { "Content-Type": `multipart/mixed; boundary=${boundary}` },
      body: readBatchBody(ids, boundary),
    });
    const text = await response.text();
    const metadata = batchFileParents(text, response.headers.get("content-type") ?? "", ids);
    const changed = metadata.filter(f => args.files.some(old => old.id === f.id && old.parent !== f.parent));
    for (let start = 0; start < changed.length; start += 25) {
      await ctx.runMutation(makeFunctionReference<"mutation">("driveOrganization:remember"), {
        accessKey: args.accessKey, moves: changed.slice(start, start + 25),
      });
    }
    return { changed, unchanged: metadata.length - changed.length,
      unresolved: ids.filter(id => !metadata.some(f => f.id === id)),
      statuses: batchHttpStatuses(text) };
  },
});

export const repairPointers = action({
  args: { accessKey: v.string(), ids: v.array(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ repaired: number; unresolved: string[] }> => {
    await requireOwnerAccess(args.accessKey);
    if (args.ids.length > 100) throw new Error("Batch too large");
    if (!args.ids.length) return { repaired: 0, unresolved: [] };
    const { root, requestRaw } = await driveClient();
    const boundary = `ourchival_read_${crypto.randomUUID()}`;
    const response = await requestRaw(
      "https://www.googleapis.com/batch/drive/v3",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/mixed; boundary=${boundary}` },
        body: readBatchBody(args.ids, boundary),
      },
    );
    const metadata = batchFileParents(
      await response.text(),
      response.headers.get("content-type") ?? "",
      args.ids,
    ).filter((f) => f.parent !== root);
    await ctx.runMutation(
      makeFunctionReference<"mutation">("driveOrganization:remember"),
      { accessKey: args.accessKey, moves: metadata },
    );
    return {
      repaired: metadata.length,
      unresolved: args.ids.filter((id) => !metadata.some((f) => f.id === id)),
    };
  },
});
async function driveClient() {
  const config = getDriveConfig();
  if (!config?.parentFolderId)
    throw new Error("A vault root folder is required.");
  const token = await getAccessToken(config);
  const requestRaw = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(60000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!response.ok) throw new Error(`Drive HTTP ${response.status}`);
    return response;
  };
  return {
    root: config.parentFolderId,
    requestRaw,
    request: async (url: string, init?: RequestInit) =>
      (await requestRaw(url, init)).json(),
  };
}

export const setup = action({
  args: { accessKey: v.string() },
  handler: async (
    _ctx,
    args,
  ): Promise<{ root: string; folders: Record<string, string> }> => {
    await requireOwnerAccess(args.accessKey);
    const { root, request } = await driveClient();
    const folders: Record<string, string> = {};
    async function ensure(path: string): Promise<string> {
      if (folders[path]) return folders[path];
      const parts = path.split("/");
      const name = parts.pop()!;
      const parent = parts.length ? await ensure(parts.join("/")) : root;
      const params = new URLSearchParams({
        q: `'${parent}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '${name}'`,
        fields: "files(id)",
        pageSize: "10",
      });
      const result = await request(`${endpoint}?${params}`);
      if (result.files.length > 1) throw new Error(`Duplicate folder: ${path}`);
      const file =
        result.files[0] ??
        (await request(endpoint, {
          method: "POST",
          body: JSON.stringify({
            name,
            parents: [parent],
            mimeType: "application/vnd.google-apps.folder",
          }),
        }));
      return (folders[path] = file.id);
    }
    for (const provider of [
      "Twitter (X)",
      "Pinterest",
      "Pixiv",
      "HoYoLAB",
      "Other sources",
    ]) {
      for (const quality of [
        "Originals",
        "Other renditions",
        "Unverified images",
      ])
        await ensure(`${provider}/${quality}`);
      for (const quality of [
        "Posted originals",
        "Other renditions",
        "Unverified images",
      ])
        await ensure(`My Art/${provider}/${quality}`);
    }
    for (const path of [
      "My Art/Editable sources",
      "My Art/Master exports",
      "Other sources/Files",
      "App data",
    ])
      await ensure(path);
    return { root, folders };
  },
});

export const classify = query({
  args: {
    accessKey: v.string(),
    files: v.array(v.object({ id: v.string(), sourceUrl: v.string() })),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (args.files.length > 100) throw new Error("Batch too large");
    return await Promise.all(
      args.files.map(async (file) => {
        const representation = await ctx.db
          .query("artworkRepresentations")
          .withIndex("by_drive_file_id", (q) => q.eq("driveFileId", file.id))
          .first();
        if (representation?.kind === "editable_source")
          return { id: file.id, path: "My Art/Editable sources" };
        if (representation?.kind === "master_export")
          return { id: file.id, path: "My Art/Master exports" };
        const assets = await ctx.db
          .query("assets")
          .withIndex("by_drive_file_id", (q) => q.eq("driveFileId", file.id))
          .take(100);
        let owned = Boolean(representation),
          sourceUrl = file.sourceUrl;
        for (const asset of assets) {
          const reference = await ctx.db.get(asset.referenceId);
          if (reference) sourceUrl = reference.sourceUrl;
          if (
            await ctx.db
              .query("artworkPublications")
              .withIndex("by_reference_id", (q) =>
                q.eq("referenceId", asset.referenceId),
              )
              .first()
          )
            owned = true;
        }
        const qualities = assets.map(assetQuality);
        const quality =
          qualities.length &&
          qualities.length < 100 &&
          qualities.every((q) => q === "original")
            ? "original"
            : qualities.length && qualities.every((q) => q === "degraded")
              ? "degraded"
              : "unknown";
        return { id: file.id, path: drivePath(sourceUrl, quality, owned) };
      }),
    );
  },
});
export const remember = mutation({
  args: {
    accessKey: v.string(),
    moves: v.array(v.object({ id: v.string(), parent: v.string() })),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (args.moves.length > 100) throw new Error("Batch too large");
    for (const move of args.moves) {
      const rows = await ctx.db
        .query("assets")
        .withIndex("by_drive_file_id", (q) => q.eq("driveFileId", move.id))
        .take(100);
      for (const row of rows)
        await ctx.db.patch(row._id, { driveFolderId: move.parent });
    }
  },
});
export const batch = action({
  args: { accessKey: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    moved: number;
    done: boolean;
    receipts: Array<{ id: string; parent: string; path: string }>;
    failures?: string[];
    statuses?: Array<Record<string, number>>;
  }> => {
    await requireOwnerAccess(args.accessKey);
    const { root, request, requestRaw } = await driveClient();
    if (!process.env.GOOGLE_DRIVE_FOLDER_MAP)
      throw new Error("Run setup first");
    const params = new URLSearchParams({
      q: `'${root}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: "files(id,name,mimeType,parents,appProperties),nextPageToken",
      pageSize: "400",
    });
    const page = await request(`${endpoint}?${params}`);
    const files = page.files as Array<{
      id: string;
      name: string;
      mimeType: string;
      parents: string[];
      appProperties?: { sourceUrl?: string };
    }>;
    const classified: Array<{ id: string; path: string }> = [];
    for (let start = 0; start < files.length; start += 25)
      classified.push(
        ...(await ctx.runQuery(
          makeFunctionReference<"query">("driveOrganization:classify"),
          {
            accessKey: args.accessKey,
            files: files.slice(start, start + 25).map((f) => ({
              id: f.id,
              sourceUrl: f.appProperties?.sourceUrl ?? "",
            })),
          },
        )),
      );
    if (!files.length) return { moved: 0, done: true, receipts: [] };
    const planned = files.map((file) => {
      const classifiedPath = classified.find((c) => c.id === file.id)!.path;
      const path =
        /^(image|video)\//.test(file.mimeType) ||
        classifiedPath.startsWith("My Art/")
          ? classifiedPath
          : file.name === "ourchival-preferences.json" ||
              /^(ourchival|vault).*(backup|snapshot)/i.test(file.name)
            ? "App data"
            : "Other sources/Files";
      const parent = configuredDriveParent(root, path)!;
      return { id: file.id, parent, path };
    });
    const groups = [];
    for (let start = 0; start < planned.length; start += 100)
      groups.push(planned.slice(start, start + 100));
    const results = await Promise.allSettled(
      groups.map(async (group) => {
        const boundary = `ourchival_moves_${crypto.randomUUID()}`;
        const response = await requestRaw(
          "https://www.googleapis.com/batch/drive/v3",
          {
            method: "POST",
            headers: {
              "Content-Type": `multipart/mixed; boundary=${boundary}`,
            },
            body: moveBatchBody(group, root, boundary),
          },
        );
        const text = await response.text();
        return {
          statuses: batchHttpStatuses(text),
          moves: verifiedBatchMoves(
            text,
            response.headers.get("content-type") ?? "",
            group,
            root,
          ),
        };
      }),
    );
    const successful = results.flatMap((r) =>
      r.status === "fulfilled" ? r.value.moves : [],
    );
    const receipts = planned.filter((m) =>
      successful.some((s) => s.id === m.id),
    );
    for (let start = 0; start < successful.length; start += 25)
      await ctx.runMutation(
        makeFunctionReference<"mutation">("driveOrganization:remember"),
        {
          accessKey: args.accessKey,
          moves: successful
            .slice(start, start + 25)
            .map(({ id, parent }) => ({ id, parent })),
        },
      );
    const failures = planned
      .filter((m) => !successful.some((s) => s.id === m.id))
      .map((m) => m.id);
    const statuses = results.map((r) =>
      r.status === "fulfilled" ? r.value.statuses : { transportFailure: 1 },
    );
    return {
      moved: receipts.length,
      done: false,
      receipts,
      failures,
      statuses,
    };
  },
});
