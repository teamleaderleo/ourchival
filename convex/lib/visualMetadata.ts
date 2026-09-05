import type { Doc } from "../_generated/dataModel";
import { normalizedText } from "./searchDocument";

export function tagKey(name: string) {
  return normalizedText(name).replace(/ /g, "_");
}

/** Alias spellings are one prediction, not independent corroboration. */
export function normalizedVisualTags(tags: Doc<"visualEnrichments">["tags"]) {
  const unique = new Map<string, (typeof tags)[number]>();
  for (const tag of tags) {
    const name = tagKey(tag.name);
    if (!name || name.length > 120) throw new Error("Invalid normalized tag.");
    const previous = unique.get(name);
    if (
      !previous ||
      tag.confidence > previous.confidence ||
      (tag.confidence === previous.confidence && tag.category === "general")
    )
      unique.set(name, { ...tag, name });
  }
  return [...unique.values()].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

export function visualResultCurrent(
  asset: Doc<"assets">,
  result: Doc<"visualEnrichments">,
) {
  return (
    [asset.originalStorageId, asset.previewStorageId].includes(
      result.inputStorageId,
    ) && (asset.contentHash ?? null) === (result.originalContentHash ?? null)
  );
}
