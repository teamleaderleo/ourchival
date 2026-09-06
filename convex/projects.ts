import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { requireOwnerAccess } from "./lib/privateAccess";
import { scheduleReferenceSearch, startSearchRebuild } from "./lib/searchIndex";

const projectStatus = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("finished"),
  v.literal("archived"),
);

export const list = query({
  args: { accessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const [projects, uses] = await Promise.all([
      ctx.db.query("projects").collect(),
      ctx.db.query("projectReferences").collect(),
    ]);
    const counts = new Map<string, number>();
    for (const use of uses) {
      const key = String(use.projectId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return projects
      .map((project) => ({
        ...project,
        referenceCount: counts.get(String(project._id)) ?? 0,
      }))
      .sort(compareProjects);
  },
});

export const create = mutation({
  args: {
    accessKey: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    status: v.optional(projectStatus),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const name = cleanProjectName(args.name);
    if (!name) throw new Error("Project name is required.");
    await assertUniqueName(ctx, name);

    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      name,
      ...(cleanOptional(args.description, 500)
        ? { description: cleanOptional(args.description, 500) }
        : {}),
      status: args.status ?? "active",
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(projectId);
  },
});

export const update = mutation({
  args: {
    accessKey: v.string(),
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    status: projectStatus,
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found.");

    const name = cleanProjectName(args.name);
    if (!name) throw new Error("Project name is required.");
    await assertUniqueName(ctx, name, args.projectId);

    await ctx.db.patch(args.projectId, {
      name,
      description: cleanOptional(args.description, 500),
      status: args.status,
      updatedAt: Date.now(),
    });
    await startSearchRebuild(ctx);
    return await ctx.db.get(args.projectId);
  },
});

export const remove = mutation({
  args: {
    accessKey: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const project = await ctx.db.get(args.projectId);
    if (!project) return { removed: false, usesRemoved: 0 };

    const uses = await ctx.db
      .query("projectReferences")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const use of uses) await ctx.db.delete(use._id);
    await ctx.db.delete(args.projectId);
    await startSearchRebuild(ctx);
    return { removed: true, usesRemoved: uses.length };
  },
});

export const listForReference = query({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const uses = await ctx.db
      .query("projectReferences")
      .withIndex("by_reference", (q) => q.eq("referenceId", args.referenceId))
      .collect();
    const hydrated = await Promise.all(
      uses.map(async (use) => ({
        ...use,
        project: await ctx.db.get(use.projectId),
      })),
    );
    return hydrated
      .filter((use) => Boolean(use.project))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  },
});

export const upsertReference = mutation({
  args: {
    accessKey: v.string(),
    projectId: v.id("projects"),
    referenceId: v.id("references"),
    assetId: v.optional(v.id("assets")),
    reason: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const [project, reference] = await Promise.all([
      ctx.db.get(args.projectId),
      ctx.db.get(args.referenceId),
    ]);
    if (!project) throw new Error("Project not found.");
    if (!reference) throw new Error("Reference not found.");
    return await upsertProjectReference(ctx, args);
  },
});

export const upsertReferences = mutation({
  args: {
    accessKey: v.string(),
    projectId: v.id("projects"),
    referenceIds: v.array(v.id("references")),
    reason: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (!(await ctx.db.get(args.projectId)))
      throw new Error("Project not found.");
    if (args.referenceIds.length > 96)
      throw new Error("Choose at most 96 references per batch.");
    const referenceIds = Array.from(new Set(args.referenceIds));
    let updated = 0;

    for (const referenceId of referenceIds) {
      if (!(await ctx.db.get(referenceId))) continue;
      await upsertProjectReference(ctx, {
        projectId: args.projectId,
        referenceId,
        reason: args.reason,
        notes: args.notes,
      });
      updated += 1;
    }
    return { updated };
  },
});

// Explicit, idempotent evidence of use. Attaching a reference is only a shortlist.
export const setReferenceUsage = mutation({
  args: {
    accessKey: v.string(),
    projectId: v.id("projects"),
    referenceId: v.id("references"),
    used: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const membership = await ctx.db
      .query("projectReferences")
      .withIndex("by_project_reference", (q) =>
        q.eq("projectId", args.projectId).eq("referenceId", args.referenceId),
      )
      .unique();
    if (!membership)
      throw new Error("Add this reference to the project shortlist first.");
    const usageStatus = args.used
      ? ("used" as const)
      : ("shortlisted" as const);
    if (membership.usageStatus === usageStatus) return membership;
    await ctx.db.patch(membership._id, {
      usageStatus,
      usedAt: args.used ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(membership._id);
  },
});

// A bounded source of truth for assistants and project exports: no image blobs or signed URLs.
export const listReferences = query({
  args: {
    accessKey: v.string(),
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (!(await ctx.db.get(args.projectId)))
      throw new Error("Project not found.");
    if (args.paginationOpts.numItems > 96)
      throw new Error("Request at most 96 references per page.");
    const result = await ctx.db
      .query("projectReferences")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      result.page.map(async (membership) => {
        const reference = await ctx.db.get(membership.referenceId);
        return {
          ...membership,
          reference: reference
            ? {
                id: reference._id,
                title: reference.title ?? null,
                sourceUrl: reference.sourceUrl,
                authorName: reference.authorName ?? null,
                favorite: reference.favorite,
                deleted: reference.deleted,
              }
            : null,
        };
      }),
    );
    return { ...result, page };
  },
});

export const removeReference = mutation({
  args: {
    accessKey: v.string(),
    projectId: v.id("projects"),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await removeProjectReference(ctx, args.projectId, args.referenceId);
  },
});

export const removeReferences = mutation({
  args: {
    accessKey: v.string(),
    projectId: v.id("projects"),
    referenceIds: v.array(v.id("references")),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (args.referenceIds.length > 96)
      throw new Error("Choose at most 96 references per batch.");
    const referenceIds = Array.from(new Set(args.referenceIds));
    let updated = 0;
    for (const referenceId of referenceIds) {
      if (await removeProjectReference(ctx, args.projectId, referenceId))
        updated += 1;
    }
    return { updated };
  },
});

async function upsertProjectReference(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    referenceId: Id<"references">;
    assetId?: Id<"assets">;
    reason?: string;
    notes?: string;
  },
) {
  const existing = await ctx.db
    .query("projectReferences")
    .withIndex("by_project_reference", (q) =>
      q.eq("projectId", args.projectId).eq("referenceId", args.referenceId),
    )
    .unique();
  const now = Date.now();
  const patch = {
    ...(args.assetId ? { assetId: args.assetId } : {}),
    ...(args.reason !== undefined
      ? { reason: cleanOptional(args.reason, 120) }
      : {}),
    ...(args.notes !== undefined
      ? { notes: cleanOptional(args.notes, 1000) }
      : {}),
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    await scheduleReferenceSearch(ctx, args.referenceId);
    return await ctx.db.get(existing._id);
  }

  const useId = await ctx.db.insert("projectReferences", {
    usageStatus: "shortlisted",
    projectId: args.projectId,
    referenceId: args.referenceId,
    ...(args.assetId ? { assetId: args.assetId } : {}),
    ...(cleanOptional(args.reason, 120)
      ? { reason: cleanOptional(args.reason, 120) }
      : {}),
    ...(cleanOptional(args.notes, 1000)
      ? { notes: cleanOptional(args.notes, 1000) }
      : {}),
    createdAt: now,
    updatedAt: now,
  });
  await scheduleReferenceSearch(ctx, args.referenceId);
  return await ctx.db.get(useId);
}

async function removeProjectReference(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  referenceId: Id<"references">,
) {
  const use = await ctx.db
    .query("projectReferences")
    .withIndex("by_project_reference", (q) =>
      q.eq("projectId", projectId).eq("referenceId", referenceId),
    )
    .unique();
  if (!use) return false;
  await ctx.db.delete(use._id);
  await scheduleReferenceSearch(ctx, referenceId);
  return true;
}

export function cleanProjectName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 100);
}

function cleanOptional(value: string | undefined, maxLength: number) {
  const cleaned = value?.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return cleaned || undefined;
}

async function assertUniqueName(ctx: any, name: string, ignoredId?: any) {
  const normalized = name.toLocaleLowerCase();
  const projects = await ctx.db.query("projects").collect();
  const duplicate = projects.find(
    (project: any) =>
      project._id !== ignoredId &&
      project.name.trim().toLocaleLowerCase() === normalized,
  );
  if (duplicate) throw new Error("A project with that name already exists.");
}

function compareProjects(left: any, right: any) {
  const rank: Record<string, number> = {
    active: 0,
    paused: 1,
    finished: 2,
    archived: 3,
  };
  return (
    (rank[left.status] ?? 4) - (rank[right.status] ?? 4) ||
    right.updatedAt - left.updatedAt
  );
}
