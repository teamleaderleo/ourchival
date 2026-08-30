export type ReviewDecision = "yes" | "maybe" | "no";
export type ExportedTriageState = "kept" | "later" | "archived";

export type ReviewPreferencePayload = {
  referenceId: string;
  decision: ReviewDecision;
  triageState: ExportedTriageState;
  reviewedAt: number;
  title?: string;
  sourceUrl: string;
  canonicalUrl?: string;
  character?: string;
  authorName?: string;
  authorHandle?: string;
  platform: "x" | "pinterest" | "pixiv" | "discord" | "manual" | "generic";
  sourceKind?: string;
};

type PreferenceReference = {
  _id: unknown;
  _creationTime?: number;
  title?: string;
  sourceUrl: string;
  canonicalUrl?: string;
  authorName?: string;
  authorHandle?: string;
  platform: ReviewPreferencePayload["platform"];
  triageState?: "inbox" | "kept" | "later";
  reviewedAt?: number;
  archived: boolean;
  deleted: boolean;
};

type PreferenceSnapshot = {
  jsonMetadata?: string;
} | null | undefined;

export function reviewPreferenceFromReference(
  reference: PreferenceReference,
  snapshot: PreferenceSnapshot,
): ReviewPreferencePayload | undefined {
  if (reference.deleted || typeof reference.reviewedAt !== "number") return undefined;

  const decision = decisionForReference(reference);
  if (!decision) return undefined;
  const seedMetadata = seedMetadataFromSnapshot(snapshot);

  return compactObject({
    referenceId: String(reference._id),
    decision: decision.decision,
    triageState: decision.triageState,
    reviewedAt: reference.reviewedAt,
    title: cleanOptional(reference.title),
    sourceUrl: reference.sourceUrl,
    canonicalUrl: cleanOptional(reference.canonicalUrl),
    character: cleanOptional(seedMetadata.character),
    authorName: cleanOptional(reference.authorName ?? seedMetadata.artist),
    authorHandle: cleanOptional(reference.authorHandle),
    platform: reference.platform,
    sourceKind: cleanOptional(seedMetadata.sourceKind),
  });
}

export function preferenceSnapshotJson(
  items: ReviewPreferencePayload[],
  updatedAt: number,
) {
  return JSON.stringify({
    schemaVersion: 1,
    updatedAt,
    items: items.map(({ authorName, authorHandle, ...item }) =>
      compactObject({
        ...item,
        artist: authorName,
        handle: authorHandle,
      }),
    ),
  });
}

function decisionForReference(reference: PreferenceReference):
  | { decision: ReviewDecision; triageState: ExportedTriageState }
  | undefined {
  if (reference.archived) return { decision: "no", triageState: "archived" };
  if (reference.triageState === "later") {
    return { decision: "maybe", triageState: "later" };
  }
  if (reference.triageState === "kept") {
    return { decision: "yes", triageState: "kept" };
  }
  return undefined;
}

function seedMetadataFromSnapshot(snapshot: PreferenceSnapshot) {
  const metadata = parseObject(snapshot?.jsonMetadata);
  const rawMetadata = parseObject(metadata?.rawMetadata);
  return {
    character: stringValue(rawMetadata?.character ?? metadata?.character),
    artist: stringValue(rawMetadata?.artist ?? metadata?.artist),
    sourceKind: stringValue(rawMetadata?.sourceKind ?? metadata?.sourceKind),
  };
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return parseObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function cleanOptional(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
