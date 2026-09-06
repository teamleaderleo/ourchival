import { expect, test } from "vitest";
import { readerIsStalled, retryPlan } from "./importAutomation";

test("temporary failures back off and stop after bounded retries", () => {
  expect(
    [0, 1, 2, 3].map((n) => retryPlan("Internal Server Error", n, 0).retryAt),
  ).toEqual([60000, 300000, 900000, 3600000]);
  expect(retryPlan("Internal Server Error", 4, 0)).toEqual({
    attention: true,
    retryAt: undefined,
  });
  expect(retryPlan("Reader did not reconnect", 0, 0).attention).toBe(false);
  expect(retryPlan("invalid_grant", 0, 0).attention).toBe(true);
  expect(retryPlan("Capture failed with status 401", 0, 0).attention).toBe(
    true,
  );
});

test("active downloads and matching reader heartbeats prevent false recovery", () => {
  const base = {
    now: 600000,
    updatedAt: new Date(0).toISOString(),
    workerTabId: 7,
    activeBatch: false,
  };
  expect(readerIsStalled(base)).toBe(true);
  expect(readerIsStalled({ ...base, activeBatch: true })).toBe(false);
  expect(
    readerIsStalled({
      ...base,
      heartbeat: { at: 590000, tabId: 7, phase: "reading" },
    }),
  ).toBe(false);
  expect(
    readerIsStalled({
      ...base,
      heartbeat: { at: 590000, tabId: 8, phase: "reading" },
    }),
  ).toBe(true);
  expect(
    readerIsStalled({
      ...base,
      heartbeat: { at: 590000, tabId: 7, phase: "saving" },
    }),
  ).toBe(true);
  expect(
    readerIsStalled({
      ...base,
      batchUpdatedAt: new Date(590000).toISOString(),
    }),
  ).toBe(false);
});
