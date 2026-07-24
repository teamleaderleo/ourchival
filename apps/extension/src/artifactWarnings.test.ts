import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_WARNINGS_KEY,
  clearArtifactWarnings,
  listArtifactWarnings,
  trackArtifactResult,
} from "./artifactWarnings";

let values: Record<string, unknown>;

beforeEach(() => {
  values = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (next: Record<string, unknown>) => {
          Object.assign(values, next);
        }),
        remove: vi.fn(async (key: string) => {
          delete values[key];
        }),
      },
    },
  });
});

afterEach(async () => {
  await clearArtifactWarnings();
  vi.unstubAllGlobals();
});

describe("artifact warnings", () => {
  it("deduplicates repeated failures for one reference and artifact kind", async () => {
    await trackArtifactResult("reference-1", "page_screenshot", {
      uploaded: false,
      reason: "upload_failed",
      error: "First failure",
    });
    await trackArtifactResult("reference-1", "page_screenshot", {
      uploaded: false,
      reason: "upload_failed",
      error: "Latest failure",
    });

    expect(await listArtifactWarnings()).toMatchObject([
      {
        referenceId: "reference-1",
        kind: "page_screenshot",
        error: "Latest failure",
      },
    ]);
  });

  it("clears a matching warning after a successful recapture", async () => {
    await trackArtifactResult("reference-1", "readable_text", {
      uploaded: false,
      reason: "request_failed",
      error: "Connection lost",
    });
    await trackArtifactResult("reference-1", "readable_text", {
      uploaded: true,
    });

    expect(await listArtifactWarnings()).toEqual([]);
    expect(values[ARTIFACT_WARNINGS_KEY]).toBeUndefined();
  });

  it("keeps only the newest bounded warning set", async () => {
    for (let index = 0; index < 30; index += 1) {
      await trackArtifactResult(`reference-${index}`, "page_snapshot", {
        uploaded: false,
        reason: "request_failed",
        error: `Failure ${index}`,
      });
    }

    const warnings = await listArtifactWarnings();
    expect(warnings).toHaveLength(24);
    expect(warnings[0]?.referenceId).toBe("reference-29");
    expect(warnings.at(-1)?.referenceId).toBe("reference-6");
  });

  it("does not record absent optional artifacts", async () => {
    await trackArtifactResult(undefined, "page_screenshot", {
      uploaded: false,
      reason: "missing_capture",
    });
    await trackArtifactResult("reference-1", "page_screenshot", {
      uploaded: false,
      reason: "missing_capture",
    });

    expect(await listArtifactWarnings()).toEqual([]);
  });
});
