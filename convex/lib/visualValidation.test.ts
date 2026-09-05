import { describe, expect, it } from "vitest";
import { validateVisualResult, type VisualResult } from "./visualValidation";
const valid = (): VisualResult => ({
  inputSha256: "a".repeat(64),
  pipelineFingerprint: "b".repeat(64),
  models: [
    {
      id: "local/test",
      revision: "pinned",
      sha256: "c".repeat(64),
      task: "tags",
    },
  ],
  tags: [{ name: "blue_hair", category: "general", confidence: 0.9 }],
  ratings: [],
});
describe("worker result validation", () => {
  it("accepts a bounded result", () =>
    expect(() => validateVisualResult(valid())).not.toThrow());
  it.each([NaN, Infinity, -1, 1.01])(
    "rejects invalid confidence %s",
    (confidence) => {
      const result = valid();
      result.tags[0]!.confidence = confidence;
      expect(() => validateVisualResult(result)).toThrow();
    },
  );
  it("requires model provenance", () => {
    const result = valid();
    result.models = [];
    expect(() => validateVisualResult(result)).toThrow();
  });
  it("requires content and model digests", () => {
    const result = valid();
    result.inputSha256 = "unverified";
    expect(() => validateVisualResult(result)).toThrow();
  });
  it("rejects an artist attribution tag", () => {
    const result = valid();
    result.tags[0]!.category = "artist";
    expect(() => validateVisualResult(result)).toThrow();
  });
  it("limits text size", () => {
    const result = valid();
    result.ocrText = "x".repeat(16001);
    expect(() => validateVisualResult(result)).toThrow();
  });
});
