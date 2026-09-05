import vocabulary from "../../../packages/shared/src/reference-facets.json";

export type ReviewTag = {
  name: string;
  category: string;
  confidence: number;
  rejected: boolean;
};

/** A view over saved predictions; never changes assignments or search inclusion. */
export function referenceTagGroups<T extends ReviewTag>(tags: T[]) {
  const mapping: Record<string, string> = vocabulary.tagGroups;
  return vocabulary.groups
    .map((name) => ({
      name,
      tags: tags.filter(
        (tag) => tag.category === "general" && mapping[tag.name] === name,
      ),
    }))
    .filter((group) => group.tags.length > 0);
}

export function filterReviewTags<T extends ReviewTag>(
  tags: T[],
  query: string,
) {
  const needle = query.trim().toLowerCase().replace(/_/g, " ");
  return tags.filter((tag) =>
    `${tag.name.replace(/_/g, " ")} ${tag.category}`
      .toLowerCase()
      .includes(needle),
  );
}
