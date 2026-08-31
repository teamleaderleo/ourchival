import type { ImportRecord } from "./imports";

export const ONE_TAB_FIXTURE_COUNT = 50_000;

export type OneTabFixtureCategories = {
  exactDuplicates: number;
  normalizedDuplicates: number;
  canonicalCollisionCandidates: number;
  slowMetadata: number;
  blockedMetadata: number;
  failedMetadata: number;
};

export function createFixtureCategories(): OneTabFixtureCategories {
  return {
    exactDuplicates: 0,
    normalizedDuplicates: 0,
    canonicalCollisionCandidates: 0,
    slowMetadata: 0,
    blockedMetadata: 0,
    failedMetadata: 0,
  };
}

export function* generateOneTabFixture(
  count = ONE_TAB_FIXTURE_COUNT,
  categories = createFixtureCategories(),
): Generator<ImportRecord> {
  let previousUrl = "";
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    let submittedUrl: string;
    if (ordinal % 100 === 99) {
      submittedUrl = previousUrl;
      categories.exactDuplicates += 1;
    } else if (ordinal % 250 === 249) {
      submittedUrl = `${previousUrl}?utm_source=fixture#resume`;
      categories.normalizedDuplicates += 1;
    } else {
      const outcome =
        ordinal % 97 === 0
          ? "slow"
          : ordinal % 89 === 0
            ? "blocked"
            : ordinal % 83 === 0
              ? "failed"
              : "ok";
      if (outcome === "slow") categories.slowMetadata += 1;
      if (outcome === "blocked") categories.blockedMetadata += 1;
      if (outcome === "failed") categories.failedMetadata += 1;
      if (ordinal % 211 === 0) categories.canonicalCollisionCandidates += 1;
      submittedUrl = `https://fixture-${ordinal % 37}.example.test/metadata/${outcome}/reference/${String(ordinal).padStart(5, "0")}`;
    }
    previousUrl = submittedUrl;
    yield {
      ordinal,
      submittedUrl,
      submittedTitle: `Fixture reference ${String(ordinal).padStart(5, "0")}`,
    };
  }
}

export function oneTabFixtureLine(record: ImportRecord) {
  return `${record.submittedUrl} | ${record.submittedTitle ?? ""}\n`;
}

export async function* oneTabFixtureChunks(
  count = ONE_TAB_FIXTURE_COUNT,
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for (const record of generateOneTabFixture(count)) {
    yield encoder.encode(oneTabFixtureLine(record));
  }
}
