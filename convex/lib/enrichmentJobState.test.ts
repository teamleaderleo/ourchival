import { describe, expect, it } from "vitest";
import {
  canDismissEnrichmentJob,
  canRetryEnrichmentJob,
  isActiveEnrichmentJob,
} from "./enrichmentJobState";

describe("enrichment job transitions", () => {
  it("keeps queued and running jobs active", () => {
    expect(isActiveEnrichmentJob("queued")).toBe(true);
    expect(isActiveEnrichmentJob("running")).toBe(true);
    expect(isActiveEnrichmentJob("failed")).toBe(false);
  });

  it("allows completed jobs to retry while protecting active jobs", () => {
    expect(canRetryEnrichmentJob("failed")).toBe(true);
    expect(canRetryEnrichmentJob("dismissed")).toBe(true);
    expect(canRetryEnrichmentJob("succeeded")).toBe(true);
    expect(canRetryEnrichmentJob("queued")).toBe(false);
    expect(canRetryEnrichmentJob("running")).toBe(false);
  });

  it("prevents dismissing a running or already dismissed job", () => {
    expect(canDismissEnrichmentJob("queued")).toBe(true);
    expect(canDismissEnrichmentJob("succeeded")).toBe(true);
    expect(canDismissEnrichmentJob("failed")).toBe(true);
    expect(canDismissEnrichmentJob("running")).toBe(false);
    expect(canDismissEnrichmentJob("dismissed")).toBe(false);
  });
});
