export const archiveSorts = [
  { value: "saved-desc", label: "Saved · newest first" },
  { value: "saved-asc", label: "Saved · oldest first" },
  { value: "published-desc", label: "Published · newest first" },
  { value: "published-asc", label: "Published · oldest first" },
] as const;
export type ArchiveSort = (typeof archiveSorts)[number]["value"];
export function isArchiveSort(value: unknown): value is ArchiveSort {
  return archiveSorts.some((sort) => sort.value === value);
}
