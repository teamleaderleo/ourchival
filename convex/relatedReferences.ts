import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  scoreRelatedReference,
  type RelatedReferenceInput,
  type RelatedNameLookups,
} from "./lib/relatedReferences";

export const find = query({
  args: {
    referenceId: v.id("references"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.referenceId);
    if (!target) throw new Error("Reference not found.");
    const limit = Math.min(16, Math.max(1, Math.floor(args.limit ?? 8)));
    const [targetSnapshot, targetProjects, names] = await Promise.all([
      latestSnapshot(ctx, target._id),
      projectContext(ctx, target._id),
      targetNameLookups(ctx, target),
    ]);

    const targetInput = toRelatedInput(target, targetProjects.targetProjectIds, {
      extraNotes: [
        targetSnapshot?.pageTitle,
        targetSnapshot?.postText,
        targetSnapshot?.altText,
        targetSnapshot?.selectedText,
        targetSnapshot?.description,
        targetSnapshot?.siteName,
      ]
        .filter(Boolean)
        .join(" "),
    });

    const scored: Array<{ reference: any; score: number; reasons: any[] }> = [];
    let cursor: string | null = null;
    let isDone = false;
    let scanned = 0;

    while (!isDone && scanned < 2048) {
      const page = await ctx.db
        .query("references")
        .withIndex("by_captured_at")
        .order("desc")
        .paginate({ numItems: 256, cursor });
      cursor = page.continueCursor;
      isDone = page.isDone;
      scanned += page.page.length;

      for (const candidate of page.page) {
        if (
          candidate._id === target._id ||
          candidate.deleted ||
          candidate.archived
        ) {
          continue;
        }
        const candidateInput = toRelatedInput(
          candidate,
          targetProjects.projectIdsByReference.get(String(candidate._id)) ?? [],
        );
        const result = scoreRelatedReference(targetInput, candidateInput, names);
        if (result.score < 3) continue;
        scored.push({ reference: candidate, ...result });
      }
    }

    const top = scored
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.reference.capturedAt - left.reference.capturedAt,
      )
      .slice(0, limit);

    return await Promise.all(
      top.map(async ({ reference, score, reasons }) => {
        const [snapshot, asset] = await Promise.all([
          latestSnapshot(ctx, reference._id),
          ctx.db
            .query("assets")
            .withIndex("by_reference", (q) =>
              q.eq("referenceId", reference._id),
            )
            .first(),
        ]);
        const storedUrl = asset?.originalStorageId
          ? await ctx.storage.getUrl(asset.originalStorageId)
          : null;
        return {
          reference: {
            _id: reference._id,
            kind: reference.kind,
            title: reference.title,
            notes: reference.notes,
            sourceUrl: reference.sourceUrl,
            platform: reference.platform,
            authorName: reference.authorName,
            authorHandle: reference.authorHandle,
            capturedAt: reference.capturedAt,
          },
          previewUrl:
            storedUrl ??
            asset?.driveThumbnailLink ??
            asset?.originalUrl ??
            snapshot?.previewImageUrl ??
            null,
          description: snapshot?.description ?? snapshot?.postText ?? null,
          siteName: snapshot?.siteName ?? null,
          score,
          reasons,
        };
      }),
    );
  },
});

async function targetNameLookups(ctx: any, target: any): Promise<RelatedNameLookups> {
  const [tags, boards, uses] = await Promise.all([
    Promise.all(target.tagIds.map((tagId: any) => ctx.db.get(tagId))),
    Promise.all(target.boardIds.map((boardId: any) => ctx.db.get(boardId))),
    ctx.db
      .query("projectReferences")
      .withIndex("by_reference", (q: any) => q.eq("referenceId", target._id))
      .collect(),
  ]);
  const projects = await Promise.all(uses.map((use: any) => ctx.db.get(use.projectId)));

  return {
    tags: Object.fromEntries(
      tags.filter(Boolean).map((tag: any) => [String(tag._id), tag.name]),
    ),
    boards: Object.fromEntries(
      boards.filter(Boolean).map((board: any) => [String(board._id), board.name]),
    ),
    projects: Object.fromEntries(
      projects
        .filter(Boolean)
        .map((project: any) => [String(project._id), project.name]),
    ),
  };
}

async function projectContext(ctx: any, referenceId: any) {
  const targetUses = await ctx.db
    .query("projectReferences")
    .withIndex("by_reference", (q: any) => q.eq("referenceId", referenceId))
    .collect();
  const targetProjectIds = targetUses.map((use: any) => String(use.projectId));
  const projectIdsByReference = new Map<string, string[]>();

  for (const use of targetUses) {
    const uses = await ctx.db
      .query("projectReferences")
      .withIndex("by_project", (q: any) => q.eq("projectId", use.projectId))
      .collect();
    for (const candidateUse of uses) {
      const key = String(candidateUse.referenceId);
      const current = projectIdsByReference.get(key) ?? [];
      current.push(String(use.projectId));
      projectIdsByReference.set(key, current);
    }
  }

  return { targetProjectIds, projectIdsByReference };
}

function toRelatedInput(
  reference: any,
  projectIds: string[],
  options: { extraNotes?: string } = {},
): RelatedReferenceInput {
  return {
    _id: String(reference._id),
    tagIds: reference.tagIds.map(String),
    boardIds: reference.boardIds.map(String),
    projectIds,
    title: reference.title,
    notes: [reference.notes, options.extraNotes].filter(Boolean).join(" "),
    authorName: reference.authorName,
    authorHandle: reference.authorHandle,
    sourceUrl: reference.sourceUrl,
    platform: reference.platform,
    kind: reference.kind,
  };
}

async function latestSnapshot(ctx: any, referenceId: any) {
  return await ctx.db
    .query("sourceSnapshots")
    .withIndex("by_reference", (q: any) => q.eq("referenceId", referenceId))
    .order("desc")
    .first();
}
