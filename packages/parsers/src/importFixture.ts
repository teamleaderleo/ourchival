import type { ImportRecord } from "./imports";

export const ONE_TAB_FIXTURE_COUNT = 50_000;

export type OneTabFixtureCategories = {
  exactDuplicates: number;
  normalizedDuplicates: number;
};

export function createFixtureCategories(): OneTabFixtureCategories {
  return {
    exactDuplicates: 0,
    normalizedDuplicates: 0,
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
      submittedUrl = `https://fixture-${ordinal % 37}.example.test/reference/${String(ordinal).padStart(5, "0")}`;
    }
    previousUrl = submittedUrl;
    yield {
      ordinal,
      submittedUrl,
      submittedTitle: `Fixture reference ${String(ordinal).padStart(5, "0")}`,
    };
  }
}

export const FIXTURE_RESULT_ORACLE_VERSION = "fixture-result-oracle-1";
export const FIXTURE_FAILED_EVIDENCE_LIMIT = 16;

export type FixtureOracleReceipt = {
  ordinal: number;
  outcome: "saved" | "duplicate" | "failed";
  duplicateReason?: "source_url" | "normalized_url";
  matchedOrdinal?: number;
  errorClass?: "deterministic_fixture_failure";
};

export type FixtureResultOracle = {
  version: typeof FIXTURE_RESULT_ORACLE_VERSION;
  processedCount: number;
  savedCount: number;
  duplicateCount: number;
  failedCount: number;
  failedEvidence: Array<{
    ordinal: number;
    errorClass: "deterministic_fixture_failure";
  }>;
  failedEvidenceTruncated: boolean;
};

/**
 * A deterministic, network-free verification adapter. It intentionally models
 * only outcomes it actually produces: exact URL duplicates, normalized URL
 * duplicates, and an explicit per-item failure schedule.
 */
export function runOneTabFixtureOracle(
  count = ONE_TAB_FIXTURE_COUNT,
  onReceipt?: (receipt: FixtureOracleReceipt) => void,
): FixtureResultOracle {
  const failedEvidence: FixtureResultOracle["failedEvidence"] = [];
  let previousSubmittedUrl: string | undefined;
  let previousNormalizedUrl: string | undefined;
  let previousReferenceOrdinal: number | undefined;
  let savedCount = 0;
  let duplicateCount = 0;
  let failedCount = 0;

  for (const record of generateOneTabFixture(count)) {
    let receipt: FixtureOracleReceipt;
    if (record.ordinal % 997 === 0) {
      failedCount += 1;
      receipt = {
        ordinal: record.ordinal,
        outcome: "failed",
        errorClass: "deterministic_fixture_failure",
      };
      if (failedEvidence.length < FIXTURE_FAILED_EVIDENCE_LIMIT) {
        failedEvidence.push({
          ordinal: record.ordinal,
          errorClass: "deterministic_fixture_failure",
        });
      }
    } else {
      const normalizedUrl = normalizeFixtureUrl(record.submittedUrl);
      if (
        previousReferenceOrdinal !== undefined &&
        record.submittedUrl === previousSubmittedUrl
      ) {
        duplicateCount += 1;
        receipt = {
          ordinal: record.ordinal,
          outcome: "duplicate",
          duplicateReason: "source_url",
          matchedOrdinal: previousReferenceOrdinal,
        };
      } else if (
        previousReferenceOrdinal !== undefined &&
        normalizedUrl === previousNormalizedUrl
      ) {
        duplicateCount += 1;
        receipt = {
          ordinal: record.ordinal,
          outcome: "duplicate",
          duplicateReason: "normalized_url",
          matchedOrdinal: previousReferenceOrdinal,
        };
      } else {
        savedCount += 1;
        receipt = { ordinal: record.ordinal, outcome: "saved" };
      }
      previousReferenceOrdinal = receipt.matchedOrdinal ?? record.ordinal;
      previousSubmittedUrl = record.submittedUrl;
      previousNormalizedUrl = normalizedUrl;
    }
    if (receipt.outcome === "failed") {
      previousSubmittedUrl = undefined;
      previousNormalizedUrl = undefined;
      previousReferenceOrdinal = undefined;
    }
    onReceipt?.(receipt);
  }

  return {
    version: FIXTURE_RESULT_ORACLE_VERSION,
    processedCount: count,
    savedCount,
    duplicateCount,
    failedCount,
    failedEvidence,
    failedEvidenceTruncated: failedCount > failedEvidence.length,
  };
}

function normalizeFixtureUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  }
  return url.toString();
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
