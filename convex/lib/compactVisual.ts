import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { allocateTagCode } from "./tagIdentity";
import { decodeTags, encodeTags } from "./tagCodec";
import { normalizedVisualTags } from "./visualMetadata";

type Tags = NonNullable<Doc<"visualEnrichments">["tags"]>;
type Models = NonNullable<Doc<"visualEnrichments">["models"]>;

export async function compactVisual(
  ctx: MutationCtx,
  tags: Tags,
  models: Models,
  fingerprint: string,
) {
  // Keep the model array order: compact storage must preserve the public result exactly.
  const recipe = await ctx.db
    .query("visualRecipes")
    .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
    .unique();
  const modelKey = (value: Models) =>
    JSON.stringify(value.map((m) => [m.id, m.revision, m.sha256, m.task]));
  if (recipe && modelKey(recipe.models) !== modelKey(models))
    throw new Error("Pipeline fingerprint has conflicting model provenance");
  const recipeId =
    recipe?._id ??
    (await ctx.db.insert("visualRecipes", { fingerprint, models }));
  const entries: Array<[number, number]> = [];
  for (const tag of normalizedVisualTags(tags)) {
    let term = await ctx.db
      .query("visualTerms")
      .withIndex("by_category_and_name", (q) =>
        q.eq("category", tag.category).eq("name", tag.name),
      )
      .unique();
    if (!term) {
      const id = await ctx.db.insert("visualTerms", {
        name: tag.name,
        category: tag.category,
        code: await allocateTagCode(ctx),
      });
      term = (await ctx.db.get(id))!;
    }
    entries.push([term.code, tag.confidence]);
  }
  return { recipeId, tagPayload: encodeTags(entries) };
}

export async function expandVisual(
  ctx: QueryCtx | MutationCtx,
  row: Doc<"visualEnrichments">,
): Promise<{ tags: Tags; models: Models }> {
  if (row.tagPayload !== undefined && row.recipeId) {
    const recipe = await ctx.db.get(row.recipeId);
    if (!recipe || recipe.fingerprint !== row.pipelineFingerprint)
      throw new Error("Missing or mismatched visual recipe");
    const tags: Tags = [];
    for (const [code, confidence] of decodeTags(row.tagPayload)) {
      const term = await ctx.db
        .query("visualTerms")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (!term) throw new Error("Missing visual term");
      tags.push({ name: term.name, category: term.category, confidence });
    }
    return { tags: normalizedVisualTags(tags), models: recipe.models };
  }
  if (!row.tags || !row.models) throw new Error("Incomplete visual metadata");
  return { tags: normalizedVisualTags(row.tags), models: row.models };
}
