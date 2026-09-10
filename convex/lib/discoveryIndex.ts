import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type Facet = { key: string; kind: "artist" | "tag"; label: string; detail: string; searchText: string };
const ownTags = new Set(["X authored media", "Pixiv creator works", "HoYoLAB creator works"]);
const importLabel = /^(pixiv bookmarks|pinterest|twitter likes|x likes|own[- :]|import[- :]|capture[- :])/i;

/** Update memberships and counters atomically. Replays never add another count. */
export async function refreshDiscoveryReference(ctx: MutationCtx, referenceId: Id<"references">) {
  const ref = await ctx.db.get(referenceId);
  const old = await ctx.db.query("archiveFacetMembers").withIndex("by_reference_id", q => q.eq("referenceId", referenceId)).collect();
  const tags = ref ? await Promise.all([...new Set(ref.tagIds)].map(id => ctx.db.get(id))) : [];
  const owned = tags.some(tag => tag && ownTags.has(tag.name)) || Boolean(await ctx.db.query("artworkPublications").withIndex("by_reference_id", q => q.eq("referenceId", referenceId)).first());
  const desired = new Map<string, Facet>();
  if (ref && !ref.deleted && !ref.archived && !owned) {
    const label = ref.authorName?.trim() || ref.authorHandle?.trim();
    if (label && !/^[-—\s]+$/.test(label)) {
      let identity = `${ref.platform}:${ref.authorHandle || label}`;
      if (ref.authorUrl) {
        try { const url = new URL(ref.authorUrl); url.search = ""; url.hash = ""; identity = url.toString().replace(/\/$/, ""); } catch { /* Keep platform-qualified source wording. */ }
      }
      desired.set(`artist:${identity}`, { key: `artist:${identity}`, kind: "artist", label, detail: ref.authorHandle || ref.platform, searchText: `${label} ${ref.authorHandle || ""} ${ref.platform}` });
    }
    for (const tag of tags) {
      if (!tag || importLabel.test(tag.name)) continue;
      desired.set(`tag:${tag._id}`, { key: `tag:${tag._id}`, kind: "tag", label: tag.name, detail: "Saved tag", searchText: `${tag.name} ${tag.slug} ${(tag.aliases || []).join(" ")}` });
    }
  }
  const oldByFacet = new Map(old.map(member => [String(member.facetId), member]));
  for (const facet of desired.values()) {
    let row = await ctx.db.query("archiveFacets").withIndex("by_key", q => q.eq("key", facet.key)).unique();
    if (!row) {
      const id = await ctx.db.insert("archiveFacets", { ...facet, total: 0, visible: 0 });
      row = (await ctx.db.get(id))!;
    }
    const member = oldByFacet.get(String(row._id));
    const sealed = Boolean(ref!.sealed);
    const payload = { facetId: row._id, referenceId, capturedAt: ref!.capturedAt, publishedAt: ref!.publishedAt, sealed };
    if (!member) await ctx.db.insert("archiveFacetMembers", payload);
    else if (member.sealed !== sealed || member.capturedAt !== payload.capturedAt || member.publishedAt !== payload.publishedAt) await ctx.db.patch(member._id, payload);
    const total = row.total + (member ? 0 : 1);
    const visible = row.visible + (sealed ? 0 : 1) - (member && !member.sealed ? 1 : 0);
    if (total !== row.total || visible !== row.visible || row.label !== facet.label || row.detail !== facet.detail || row.searchText !== facet.searchText)
      await ctx.db.patch(row._id, { ...facet, total, visible });
    oldByFacet.delete(String(row._id));
  }
  for (const member of oldByFacet.values()) {
    const row = await ctx.db.get(member.facetId);
    if (row) await ctx.db.patch(row._id, { total: Math.max(0, row.total - 1), visible: Math.max(0, row.visible - (member.sealed ? 0 : 1)) });
    await ctx.db.delete(member._id);
  }
}
