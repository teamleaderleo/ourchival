import { expect, test } from "vitest";
import { diagnoseFailure } from "./failureDiagnosis";
const base = { stage: "metadata" as const, attempts: 1 };
test("distinguishes retryable errors, missing sources and access refusals", () => {
  expect(diagnoseFailure({...base, message:"HTTP 429"}).category).toBe("temporary");
  expect(diagnoseFailure({...base, message:"HTTP 403"}).label).toBe("Access refused");
  expect(diagnoseFailure({...base, message:"HTTP 404"}).category).toBe("unavailable");
  expect(diagnoseFailure({...base, message:"Internal Server Error"}).category).toBe("temporary");
  expect(diagnoseFailure({...base, message:"Internal Server Error", attempts:5}).category).toBe("attention");
  expect(diagnoseFailure({...base, message:"Unexpected response shape"}).category).toBe("attention");
});
