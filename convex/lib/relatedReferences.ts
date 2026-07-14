export type RelatedReferenceInput = {
  _id: string;
  tagIds: string[];
  boardIds: string[];
  projectIds: string[];
  title?: string;
  notes?: string;
  authorName?: string;
  authorHandle?: string;
  sourceUrl: string;
  platform: string;
  kind: string;
};

export type RelatedNameLookups = {
  tags?: Record<string, string>;
  boards?: Record<string, string>;
  projects?: Record<string, string>;
};

export type RelatedReason = {
  type:
    | "project"
    | "tag"
    | "board"
    | "author"
    | "domain"
    | "keyword"
    | "platform"
    | "kind";
  label: string;
  detail: string;
  weight: number;
};

export function scoreRelatedReference(
  target: RelatedReferenceInput,
  candidate: RelatedReferenceInput,
  names: RelatedNameLookups = {},
) {
  if (target._id === candidate._id) return { score: 0, reasons: [] as RelatedReason[] };

  const reasons: RelatedReason[] = [];
  const sharedProjects = intersection(target.projectIds, candidate.projectIds);
  for (const projectId of sharedProjects.slice(0, 2)) {
    reasons.push({
      type: "project",
      label: "Shared project",
      detail: names.projects?.[projectId] ?? "Same project",
      weight: 8,
    });
  }

  const sharedTags = intersection(target.tagIds, candidate.tagIds);
  for (const tagId of sharedTags.slice(0, 3)) {
    reasons.push({
      type: "tag",
      label: "Shared tag",
      detail: names.tags?.[tagId] ? `#${names.tags[tagId]}` : "Same tag",
      weight: 6,
    });
  }

  const sharedBoards = intersection(target.boardIds, candidate.boardIds);
  for (const boardId of sharedBoards.slice(0, 2)) {
    reasons.push({
      type: "board",
      label: "Shared board",
      detail: names.boards?.[boardId] ?? "Same board",
      weight: 5,
    });
  }

  const targetAuthor = normalizeAuthor(target);
  const candidateAuthor = normalizeAuthor(candidate);
  if (targetAuthor && candidateAuthor && targetAuthor === candidateAuthor) {
    reasons.push({
      type: "author",
      label: "Same author",
      detail: candidate.authorHandle || candidate.authorName || targetAuthor,
      weight: 4,
    });
  }

  const targetDomain = sourceDomain(target.sourceUrl);
  const candidateDomain = sourceDomain(candidate.sourceUrl);
  if (targetDomain && candidateDomain && targetDomain === candidateDomain) {
    reasons.push({
      type: "domain",
      label: "Same source",
      detail: targetDomain,
      weight: 3,
    });
  }

  const targetKeywords = meaningfulKeywords(`${target.title ?? ""} ${target.notes ?? ""}`);
  const candidateKeywords = meaningfulKeywords(
    `${candidate.title ?? ""} ${candidate.notes ?? ""}`,
  );
  for (const keyword of intersection(targetKeywords, candidateKeywords).slice(0, 3)) {
    reasons.push({
      type: "keyword",
      label: "Shared phrase",
      detail: keyword,
      weight: 2,
    });
  }

  if (target.platform === candidate.platform) {
    reasons.push({
      type: "platform",
      label: "Same platform",
      detail: target.platform,
      weight: 1,
    });
  }
  if (referenceLane(target.kind) === referenceLane(candidate.kind)) {
    reasons.push({
      type: "kind",
      label: "Same format",
      detail: referenceLane(target.kind),
      weight: 1,
    });
  }

  const sorted = reasons.sort((left, right) => right.weight - left.weight);
  return {
    score: sorted.reduce((total, reason) => total + reason.weight, 0),
    reasons: sorted.slice(0, 8),
  };
}

export function meaningfulKeywords(value: string) {
  const stopWords = new Set([
    "about",
    "after",
    "again",
    "also",
    "another",
    "before",
    "being",
    "from",
    "have",
    "into",
    "just",
    "keep",
    "more",
    "only",
    "other",
    "reference",
    "save",
    "saved",
    "study",
    "than",
    "that",
    "their",
    "there",
    "these",
    "this",
    "through",
    "under",
    "very",
    "what",
    "when",
    "where",
    "which",
    "while",
    "with",
    "would",
    "your",
  ]);

  return Array.from(
    new Set(
      value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase()
        .replace(/https?:\/\/\S+/g, " ")
        .split(/[^a-z0-9]+/)
        .filter(
          (token) =>
            token.length >= 4 && !stopWords.has(token) && !/^\d+$/.test(token),
        ),
    ),
  );
}

function intersection(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return Array.from(new Set(left)).filter((value) => rightSet.has(value));
}

function normalizeAuthor(reference: RelatedReferenceInput) {
  return (reference.authorHandle || reference.authorName || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/^@/, "");
}

function sourceDomain(value: string) {
  try {
    return new URL(value).hostname.toLocaleLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function referenceLane(kind: string) {
  return kind === "link" || kind === "page" || kind === "article"
    ? "links"
    : "images";
}
