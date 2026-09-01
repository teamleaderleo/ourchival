export type TagRecord = {
  _id: any;
  name: string;
  slug: string;
  createdAt: number;
};

export async function listTags(ctx: any): Promise<TagRecord[]> {
  const tags = await ctx.db.query("tags").collect();
  return tags.sort((left: TagRecord, right: TagRecord) =>
    left.name.localeCompare(right.name),
  );
}

export async function getTagsByIds(
  ctx: any,
  tagIds: any[],
): Promise<TagRecord[]> {
  const tags = await Promise.all(tagIds.map((tagId) => ctx.db.get(tagId)));
  return tags
    .filter((tag): tag is TagRecord => Boolean(tag))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function ensureTag(ctx: any, rawName: string): Promise<TagRecord> {
  const name = normalizeTagName(rawName);
  if (!name) throw new Error("Tag name is required.");
  const slug = slugifyTagName(name);
  if (!slug) throw new Error("Tag name must include a letter or number.");

  const existing = await ctx.db
    .query("tags")
    .withIndex("by_slug", (q: any) => q.eq("slug", slug))
    .unique();
  if (existing) return existing;

  const tagId = await ctx.db.insert("tags", {
    name,
    slug,
    createdAt: Date.now(),
  });
  return await ctx.db.get(tagId);
}

export async function updateReferenceTags(
  ctx: any,
  referenceId: any,
  args: { addNames?: string[]; removeIds?: string[] },
) {
  const reference = await ctx.db.get(referenceId);
  if (!reference) throw new Error("Reference not found.");

  const additions = await Promise.all(
    uniqueNames(args.addNames ?? []).map((name) => ensureTag(ctx, name)),
  );
  const removed = new Set(args.removeIds ?? []);
  const nextTagIds = Array.from(
    new Set([
      ...reference.tagIds.filter((tagId: any) => !removed.has(String(tagId))),
      ...additions.map((tag) => tag._id),
    ]),
  );

  await ctx.db.patch(reference._id, { tagIds: nextTagIds });
  return await getTagsByIds(ctx, nextTagIds);
}

export async function updateAssetTags(
  ctx: any,
  assetId: any,
  args: { addNames?: string[]; removeIds?: string[] },
) {
  const asset = await ctx.db.get(assetId);
  if (!asset) throw new Error("Asset not found.");

  const additions = await Promise.all(
    uniqueNames(args.addNames ?? []).map((name) => ensureTag(ctx, name)),
  );
  const removed = new Set(args.removeIds ?? []);
  const nextTagIds = Array.from(
    new Set([
      ...(asset.tagIds ?? []).filter(
        (tagId: any) => !removed.has(String(tagId)),
      ),
      ...additions.map((tag) => tag._id),
    ]),
  );

  await ctx.db.patch(asset._id, { tagIds: nextTagIds });
  return await getTagsByIds(ctx, nextTagIds);
}

export function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 48);
}

export function slugifyTagName(value: string) {
  return normalizeTagName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function uniqueNames(values: string[]) {
  const bySlug = new Map<string, string>();
  for (const value of values) {
    const name = normalizeTagName(value);
    const slug = slugifyTagName(name);
    if (name && slug && !bySlug.has(slug)) bySlug.set(slug, name);
  }
  return Array.from(bySlug.values());
}
