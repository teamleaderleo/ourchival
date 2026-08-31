import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_FAILED_EVIDENCE_LIMIT,
  generateOneTabFixture,
  runOneTabFixtureOracle,
} from "./importFixture";

describe("deterministic import fixture oracle", () => {
  it("claims only generated duplicate categories", () => {
    const categories = { exactDuplicates: 0, normalizedDuplicates: 0 };
    for (const _record of generateOneTabFixture(50_000, categories)) {
      // Exhaust the generated stream without retaining its derivative.
    }
    expect(categories).toEqual({
      exactDuplicates: 500,
      normalizedDuplicates: 100,
    });
  });

  it("reconciles deterministic outcomes with bounded failure evidence", () => {
    const onReceipt = vi.fn();
    const oracle = runOneTabFixtureOracle(50_000, onReceipt);

    expect(onReceipt).toHaveBeenCalledTimes(50_000);
    expect(oracle.processedCount).toBe(
      oracle.savedCount + oracle.duplicateCount + oracle.failedCount,
    );
    expect(oracle.failedEvidence).toHaveLength(FIXTURE_FAILED_EVIDENCE_LIMIT);
    expect(oracle.failedEvidence.slice(0, 3)).toEqual([
      { ordinal: 0, errorClass: "deterministic_fixture_failure" },
      { ordinal: 997, errorClass: "deterministic_fixture_failure" },
      { ordinal: 1_994, errorClass: "deterministic_fixture_failure" },
    ]);
    expect(oracle.failedEvidenceTruncated).toBe(true);
    expect(oracle).toMatchObject({
      processedCount: 50_000,
      savedCount: 49_350,
      duplicateCount: 599,
      failedCount: 51,
    });
  });
});
