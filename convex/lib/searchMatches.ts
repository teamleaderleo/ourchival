export type SearchMatch = {
  field: string;
  label: string;
  excerpt: string;
};

export type ReferenceSearchContext = {
  tags?: Array<{ name?: string; slug?: string; aliases?: string[] }>;
  boards?: Array<{ name?: string; description?: string }>;
  projectUses?: Array<{
    reason?: string;
    notes?: string;
    project?: {
      name?: string;
      description?: string;
      status?: string;
    } | null;
  }>;
};

type SearchField = {
  field: string;
  label: string;
  value?: string | null;
};

export function findReferenceSearchMatches(
  reference: any,
  snapshot: any | null | undefined,
  context: ReferenceSearchContext,
  query: string,
): SearchMatch[] {
  const needle = normalizeSearchText(query);
  if (!needle) return [];

  const fields: SearchField[] = [
    { field: "title", label: "Title", value: reference.title },
    { field: "notes", label: "Notes", value: reference.notes },
    { field: "sourceUrl", label: "Source URL", value: reference.sourceUrl },
    {
      field: "canonicalUrl",
      label: "Canonical URL",
      value: reference.canonicalUrl,
    },
    { field: "platform", label: "Platform", value: reference.platform },
    { field: "kind", label: "Type", value: reference.kind },
    { field: "authorName", label: "Author", value: reference.authorName },
    {
      field: "authorHandle",
      label: "Author handle",
      value: reference.authorHandle,
    },
    { field: "postId", label: "Post ID", value: reference.postId },
    { field: "pageTitle", label: "Page title", value: snapshot?.pageTitle },
    { field: "postText", label: "Post text", value: snapshot?.postText },
    { field: "altText", label: "Alt text", value: snapshot?.altText },
    {
      field: "selectedText",
      label: "Selected text",
      value: snapshot?.selectedText,
    },
    {
      field: "description",
      label: "Description",
      value: snapshot?.description,
    },
    { field: "siteName", label: "Site", value: snapshot?.siteName },
    { field: "pageAuthor", label: "Page author", value: snapshot?.pageAuthor },
    {
      field: "snapshotCanonicalUrl",
      label: "Page canonical URL",
      value: snapshot?.canonicalUrl,
    },
    {
      field: "contentType",
      label: "Content type",
      value: snapshot?.contentType,
    },
    ...(context.tags ?? []).flatMap((tag) => [
      { field: "tag", label: "Tag", value: tag.name },
      { field: "tagSlug", label: "Tag slug", value: tag.slug },
      {
        field: "tagAlias",
        label: "Previous tag name",
        value: tag.aliases?.join(" "),
      },
    ]),
    ...(context.boards ?? []).flatMap((board) => [
      { field: "board", label: "Board", value: board.name },
      {
        field: "boardDescription",
        label: "Board description",
        value: board.description,
      },
    ]),
    ...(context.projectUses ?? []).flatMap((use) => [
      { field: "project", label: "Project", value: use.project?.name },
      {
        field: "projectDescription",
        label: "Project description",
        value: use.project?.description,
      },
      {
        field: "projectStatus",
        label: "Project status",
        value: use.project?.status,
      },
      { field: "reuseReason", label: "Reuse reason", value: use.reason },
      { field: "projectNotes", label: "Project notes", value: use.notes },
    ]),
  ];

  const matches: SearchMatch[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (typeof field.value !== "string") continue;
    const value = compactWhitespace(field.value);
    if (!normalizeSearchText(value).includes(needle)) continue;
    const key = `${field.field}:${normalizeSearchText(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      field: field.field,
      label: field.label,
      excerpt: excerptForMatch(value, needle),
    });
    if (matches.length >= 8) break;
  }
  return matches;
}

export function excerptForMatch(value: string, normalizedQuery: string) {
  const compact = compactWhitespace(value);
  const normalized = normalizeSearchText(compact);
  const index = normalized.indexOf(normalizedQuery);
  if (index < 0 || compact.length <= 150) return compact.slice(0, 150);

  const start = Math.max(0, index - 55);
  const end = Math.min(compact.length, index + normalizedQuery.length + 75);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function normalizeSearchText(value: string) {
  return compactWhitespace(value).toLocaleLowerCase();
}

function compactWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
