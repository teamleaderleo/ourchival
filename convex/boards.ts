import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";

export const list = query({
  args: { accessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const [boards, counts] = await Promise.all([
      ctx.db.query("boards").order("desc").collect(),
      countBoardReferences(ctx),
    ]);

    return boards.map((board) => ({
      ...board,
      referenceCount: counts.get(String(board._id)) ?? 0,
    }));
  },
});

export const create = mutation({
  args: {
    accessKey: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const name = cleanName(args.name);
    if (!name) throw new Error("Board name is required.");
    await assertUniqueName(ctx, name);

    const now = Date.now();
    const boardId = await ctx.db.insert("boards", {
      name,
      ...(args.description?.trim()
        ? { description: args.description.trim().slice(0, 280) }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(boardId);
  },
});

export const update = mutation({
  args: {
    accessKey: v.string(),
    boardId: v.id("boards"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const board = await ctx.db.get(args.boardId);
    if (!board) throw new Error("Board not found.");

    const name = cleanName(args.name);
    if (!name) throw new Error("Board name is required.");
    await assertUniqueName(ctx, name, args.boardId);

    await ctx.db.patch(args.boardId, {
      name,
      ...(args.description?.trim()
        ? { description: args.description.trim().slice(0, 280) }
        : { description: undefined }),
      updatedAt: Date.now(),
    });
    return await ctx.db.get(args.boardId);
  },
});

export const remove = mutation({
  args: {
    accessKey: v.string(),
    boardId: v.id("boards"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const board = await ctx.db.get(args.boardId);
    if (!board) return { removed: false, referencesUpdated: 0 };

    let cursor: string | null = null;
    let isDone = false;
    let referencesUpdated = 0;

    while (!isDone) {
      const page = await ctx.db
        .query("references")
        .withIndex("by_captured_at")
        .paginate({ numItems: 256, cursor });
      cursor = page.continueCursor;
      isDone = page.isDone;

      for (const reference of page.page) {
        if (!reference.boardIds.some((boardId) => boardId === args.boardId)) continue;
        await ctx.db.patch(reference._id, {
          boardIds: reference.boardIds.filter((boardId) => boardId !== args.boardId),
        });
        referencesUpdated += 1;
      }
    }

    await ctx.db.delete(args.boardId);
    return { removed: true, referencesUpdated };
  },
});

export const updateReference = mutation({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
    addBoardIds: v.array(v.id("boards")),
    removeBoardIds: v.array(v.id("boards")),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const reference = await ctx.db.get(args.referenceId);
    if (!reference) throw new Error("Reference not found.");

    const nextBoardIds = updateBoardIds(
      reference.boardIds,
      args.addBoardIds,
      args.removeBoardIds,
    );
    await ctx.db.patch(reference._id, { boardIds: nextBoardIds });
    return nextBoardIds;
  },
});

export const updateReferences = mutation({
  args: {
    accessKey: v.string(),
    referenceIds: v.array(v.id("references")),
    boardId: v.id("boards"),
    mode: v.union(v.literal("add"), v.literal("remove")),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const referenceIds = Array.from(new Set(args.referenceIds)).slice(0, 96);
    if (args.mode === "add" && !(await ctx.db.get(args.boardId))) {
      throw new Error("Board not found.");
    }

    let updated = 0;
    for (const referenceId of referenceIds) {
      const reference = await ctx.db.get(referenceId);
      if (!reference) continue;
      const nextBoardIds = updateBoardIds(
        reference.boardIds,
        args.mode === "add" ? [args.boardId] : [],
        args.mode === "remove" ? [args.boardId] : [],
      );
      if (
        nextBoardIds.length === reference.boardIds.length &&
        nextBoardIds.every((boardId, index) => boardId === reference.boardIds[index])
      ) {
        continue;
      }
      await ctx.db.patch(referenceId, { boardIds: nextBoardIds });
      updated += 1;
    }
    return { updated };
  },
});

function updateBoardIds(
  currentBoardIds: any[],
  addBoardIds: any[],
  removeBoardIds: any[],
) {
  const removals = new Set(removeBoardIds.map(String));
  return Array.from(
    new Set([
      ...currentBoardIds.filter((boardId) => !removals.has(String(boardId))),
      ...addBoardIds,
    ]),
  );
}

async function countBoardReferences(ctx: any) {
  const counts = new Map<string, number>();
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const page = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .paginate({ numItems: 256, cursor });
    cursor = page.continueCursor;
    isDone = page.isDone;

    for (const reference of page.page) {
      if (reference.deleted) continue;
      for (const boardId of reference.boardIds) {
        const key = String(boardId);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  return counts;
}

async function assertUniqueName(ctx: any, name: string, ignoredId?: any) {
  const normalized = name.toLocaleLowerCase();
  const boards = await ctx.db.query("boards").collect();
  const duplicate = boards.find(
    (board: any) =>
      board._id !== ignoredId && board.name.trim().toLocaleLowerCase() === normalized,
  );
  if (duplicate) throw new Error("A board with that name already exists.");
}

function cleanName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}
