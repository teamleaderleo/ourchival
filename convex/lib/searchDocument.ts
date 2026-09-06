/** Rebuildable search text. Source claims, owner metadata and model output retain provenance. */
export type SearchField = {
  field: string;
  label: string;
  value: string;
  origin: "source" | "catalog" | "owner" | "machine";
};
export type SearchMatch = { field: string; label: string; excerpt: string };
export type VisualSearchInput = {
  assetId: string;
  tags: Array<{ name: string; category: string; confidence: number }>;
  rejectedTags?: string[];
  ocrText?: string;
  caption?: string;
  hideOcr?: boolean;
  hideCaption?: boolean;
};
export type SearchContext = {
  community?: Array<{
    assetId: string;
    postId: number;
    tags: Array<{ name: string; category: string }>;
  }>;
  assets?: Array<{
    assetId: string;
    notes?: string;
    altText?: string;
    tags: Array<{ name: string; slug: string; aliases?: string[] }>;
  }>;
  tags: Array<{ name: string; slug: string; aliases?: string[] }>;
  boards: Array<{ name: string; description?: string }>;
  uses: Array<{
    reason?: string;
    notes?: string;
    project: {
      name: string;
      description?: string;
      status: string;
    } | null;
  }>;
  visual: VisualSearchInput[];
};

export function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Convex allows at most 16 query terms; retain text as data, never query-language syntax. */
export function indexQuery(value: string): string {
  return (normalizedText(value).match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, 16)
    .join(" ");
}

export function buildSearchDocument(
  reference: Record<string, unknown>,
  snapshot: Record<string, unknown> | null,
  context: SearchContext,
): { text: string; fields: SearchField[]; truncated: boolean } {
  const fields: SearchField[] = [];
  let remaining = 32_000;
  let truncated = false;
  const add = (
    field: string,
    label: string,
    value: unknown,
    origin: SearchField["origin"],
    limit = 2_000,
  ) => {
    if (typeof value !== "string" || !value.trim()) return;
    const clean = value.normalize("NFKC").replace(/\s+/g, " ").trim();
    const take = Math.min(remaining, limit);
    if (clean.length > take || fields.length >= 256) truncated = true;
    if (take <= 0 || fields.length >= 256) return;
    const kept = clean.slice(0, take);
    fields.push({ field, label, value: kept, origin });
    remaining -= kept.length;
  };
  add("title", "Title", reference.title, "catalog");
  add("notes", "Notes", reference.notes, "owner", 8_000);
  for (const [key, label] of [
    ["sourceUrl", "Source URL"],
    ["canonicalUrl", "Canonical URL"],
    ["authorName", "Source author"],
    ["authorHandle", "Source handle"],
    ["postId", "Post ID"],
    ["platform", "Platform"],
    ["kind", "Type"],
  ])
    add(key!, label!, reference[key!], "source");
  // These are editable catalog fields; original title/credit claims also remain in snapshots.
  add(
    "tag",
    "Saved tags",
    context.tags
      .map((t) => `${t.name} ${t.slug} ${(t.aliases ?? []).join(" ")}`)
      .join(" "),
    "catalog",
    4_000,
  );
  for (const board of context.boards) {
    add("board", "Board", board.name, "owner");
    add("boardDescription", "Board description", board.description, "owner");
  }
  for (const use of context.uses) {
    add("project", "Project", use.project?.name, "owner");
    add(
      "projectDescription",
      "Project description",
      use.project?.description,
      "owner",
    );
    add("projectStatus", "Project status", use.project?.status, "owner");
    add("reuseReason", "Reuse reason", use.reason, "owner");
    add("projectNotes", "Project notes", use.notes, "owner");
  }
  for (const [key, label] of [
    ["pageTitle", "Page title"],
    ["postText", "Post text"],
    ["altText", "Alt text"],
    ["selectedText", "Selected text"],
    ["description", "Source description"],
    ["siteName", "Site"],
    ["pageAuthor", "Page author"],
    ["canonicalUrl", "Page canonical URL"],
    ["contentType", "Content type"],
  ])
    add(`source.${key}`, label!, snapshot?.[key!], "source", 4_000);
  for (const asset of context.assets ?? []) {
    add(
      `asset.${asset.assetId}.notes`,
      "Image notes",
      asset.notes,
      "owner",
      4_000,
    );
    add(
      `asset.${asset.assetId}.altText`,
      "Image alt text",
      asset.altText,
      "source",
      4_000,
    );
    add(
      `asset.${asset.assetId}.tags`,
      "Saved image tags",
      asset.tags
        .map((t) => `${t.name} ${t.slug} ${(t.aliases ?? []).join(" ")}`)
        .join(" "),
      "catalog",
      4_000,
    );
  }
  for (const source of context.community ?? [])
    add(
      `community:${source.assetId}:${source.postId}`,
      "Danbooru tags",
      source.tags.map((t) => t.name.replaceAll("_", " ")).join(" "),
      "source",
      4000,
    );
  for (const visual of context.visual) {
    const rejected = new Set((visual.rejectedTags ?? []).map(normalizedText));
    // Ratings and predicted artists never become search tags or factual attribution here.
    const tags = visual.tags.filter(
      (t) =>
        ["general", "character"].includes(t.category) &&
        Number.isFinite(t.confidence) &&
        t.confidence >= 0 &&
        t.confidence <= 1 &&
        !rejected.has(normalizedText(t.name)),
    );
    add(
      `visual.${visual.assetId}.tags`,
      "Visual tags · machine",
      tags.map((t) => t.name).join(" "),
      "machine",
      4_000,
    );
    if (!visual.hideOcr)
      add(
        `visual.${visual.assetId}.ocr`,
        "OCR · machine",
        visual.ocrText,
        "machine",
        8_000,
      );
    if (!visual.hideCaption)
      add(
        `visual.${visual.assetId}.caption`,
        "Description · machine",
        visual.caption,
        "machine",
        2_000,
      );
  }
  return {
    text: fields.map((f) => normalizedText(f.value)).join("\n"),
    fields,
    truncated,
  };
}

/** Explain indexed matches without imposing a second, incompatible whole-phrase filter. */
export function searchMatchReasons(
  fields: SearchField[],
  query: string,
): SearchMatch[] {
  const terms = indexQuery(query).split(" ").filter(Boolean);
  if (!terms.length) return [];
  return fields
    .flatMap((field) => {
      const haystack = normalizedText(field.value);
      if (!terms.some((term) => haystack.includes(term))) return [];
      const positions = terms
        .map((term) => haystack.indexOf(term))
        .filter((i) => i >= 0);
      const start = Math.max(0, Math.min(...positions) - 45);
      return [
        {
          field: field.field,
          label: field.label,
          excerpt: `${start ? "…" : ""}${field.value.slice(start, start + 150)}${field.value.length > start + 150 ? "…" : ""}`,
        },
      ];
    })
    .slice(0, 8);
}

export function collectionOf(reference: Record<string, unknown>): string {
  if (reference.deleted) return "trash";
  if (reference.archived) return "archive";
  if (reference.triageState === "inbox") return "inbox";
  if (reference.triageState === "later") return "later";
  return "library";
}
export function laneOf(kind: string): string {
  return ["link", "article", "page"].includes(kind) ? "links" : "images";
}
