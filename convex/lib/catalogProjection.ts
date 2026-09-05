export const catalogFields = [
  "title",
  "sourceUrl",
  "canonicalUrl",
  "platform",
  "kind",
  "capturedAt",
  "publishedAt",
  "authorName",
  "authorHandle",
  "captureSessionId",
  "triageState",
  "favorite",
  "archived",
] as const;
export type CatalogField = (typeof catalogFields)[number];
export const defaultCatalogFields: CatalogField[] = [
  "title",
  "sourceUrl",
  "platform",
  "capturedAt",
  "triageState",
];
export type CatalogRow = { id: string; truncatedFields?: string[] } & Record<
  string,
  string | number | boolean | string[] | undefined
>;

// A projection for model context, never a lossless backup. Source documents stay intact.
export function projectCatalogRow(
  document: { _id: string } & Record<string, unknown>,
  fields: CatalogField[],
): CatalogRow {
  const row: CatalogRow = { id: document._id };
  const truncated: string[] = [];
  for (const field of catalogFields) {
    if (!fields.includes(field)) continue;
    const value =
      field === "triageState" ? (document[field] ?? "inbox") : document[field];
    if (typeof value === "string") {
      // Array.from preserves Unicode code points when shortening source text.
      const points = Array.from(value);
      row[field] = points.slice(0, 1024).join("");
      if (points.length > 1024) truncated.push(field);
    } else if (typeof value === "number" || typeof value === "boolean") {
      row[field] = value;
    }
  }
  if (truncated.length) row.truncatedFields = truncated;
  return row;
}
