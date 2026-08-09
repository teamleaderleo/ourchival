import type { SourcePlatform } from "@ourchival/shared";

export type SourceAssertionEvidence =
  | "source_native_tag"
  | "source_native_category";

export type SourceAssertion = {
  origin: "source";
  platform: SourcePlatform;
  sourceUrl: string;
  evidence: SourceAssertionEvidence;
  field: string;
  value: string;
  normalizedValue: string;
  namespace?: string;
  observedAt: number;
};

export type SourceTagInput = {
  name: string;
  namespace?: string;
};

export type SourceCategoryInput = {
  field: string;
  value: string;
  namespace?: string;
};

export function buildSourceAssertions(args: {
  platform: SourcePlatform;
  sourceUrl: string;
  observedAt: number;
  tags?: SourceTagInput[];
  categories?: SourceCategoryInput[];
}) {
  const assertions: SourceAssertion[] = [];
  const seen = new Set<string>();

  for (const tag of args.tags ?? []) {
    const assertion = makeAssertion({
      platform: args.platform,
      sourceUrl: args.sourceUrl,
      observedAt: args.observedAt,
      evidence: "source_native_tag",
      field: "tag",
      value: tag.name,
      namespace: tag.namespace,
    });
    if (!assertion) continue;
    appendUnique(assertions, seen, assertion);
  }

  for (const category of args.categories ?? []) {
    const assertion = makeAssertion({
      platform: args.platform,
      sourceUrl: args.sourceUrl,
      observedAt: args.observedAt,
      evidence: "source_native_category",
      field: category.field,
      value: category.value,
      namespace: category.namespace,
    });
    if (!assertion) continue;
    appendUnique(assertions, seen, assertion);
  }

  return assertions;
}

export function sourceAssertionIdentity(assertion: SourceAssertion) {
  return [
    assertion.platform,
    assertion.evidence,
    normalizeLookup(assertion.field),
    normalizeLookup(assertion.namespace ?? ""),
    assertion.normalizedValue,
  ].join(":");
}

function makeAssertion(args: {
  platform: SourcePlatform;
  sourceUrl: string;
  observedAt: number;
  evidence: SourceAssertionEvidence;
  field: string;
  value: string;
  namespace?: string;
}): SourceAssertion | undefined {
  const field = cleanText(args.field);
  const value = cleanText(args.value);
  const sourceUrl = cleanHttpUrl(args.sourceUrl);
  if (!field || !value || !sourceUrl || !Number.isFinite(args.observedAt)) {
    return undefined;
  }
  const normalizedValue = normalizeLookup(value);
  if (!normalizedValue) return undefined;
  const namespace = cleanText(args.namespace);

  return {
    origin: "source",
    platform: args.platform,
    sourceUrl,
    evidence: args.evidence,
    field,
    value,
    normalizedValue,
    ...(namespace ? { namespace } : {}),
    observedAt: args.observedAt,
  };
}

function appendUnique(
  assertions: SourceAssertion[],
  seen: Set<string>,
  assertion: SourceAssertion,
) {
  const identity = sourceAssertionIdentity(assertion);
  if (seen.has(identity)) return;
  seen.add(identity);
  assertions.push(assertion);
}

function normalizeLookup(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function cleanText(value: string | undefined) {
  return value?.normalize("NFKC").replace(/\s+/g, " ").trim() || undefined;
}

function cleanHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
