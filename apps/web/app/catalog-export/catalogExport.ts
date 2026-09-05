import type {
  CatalogField,
  CatalogRow,
} from "../../../../convex/lib/catalogProjection";

export type CatalogPage = {
  schemaVersion: number;
  mode: "live-projection";
  filters: {
    sessionKey: string | null;
    platform: string | null;
    collection: string | null;
  };
  fields: CatalogField[];
  rows: CatalogRow[];
  scanned: number;
  returned: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export async function buildCatalogExport(
  page: CatalogPage,
  fromCursor: string | null,
) {
  const ndjson =
    page.rows.map((row) => JSON.stringify(row)).join("\n") +
    (page.rows.length ? "\n" : "");
  const bytes = new TextEncoder().encode(ndjson);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    manifest: {
      schemaVersion: 1,
      mode: page.mode,
      filters: page.filters,
      fields: page.fields,
      scanned: page.scanned,
      returned: page.returned,
      bytes: bytes.length,
      sha256,
      fromCursor,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      textLimit: 1024,
      warning:
        "Live catalog projection, not a backup. Text shortening is marked per row; source snapshots, assets and occurrences are not included.",
    },
    ndjson,
  };
}
