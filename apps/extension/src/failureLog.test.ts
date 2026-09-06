import { afterEach, expect, test, vi } from "vitest";
import {
  FAILURE_LOG_KEY,
  recordFailure,
  recordFailureIn,
  resolveFailures,
  safeFailureMessage,
  type FailureInput,
  type FailureRecord,
} from "./failureLog";
const input: FailureInput = {
  provider: "pixiv_bookmarks",
  importId: "pass-1",
  sourceUrl: "https://www.pixiv.net/en/artworks/112058420",
  imagePage: 4,
  imageCount: 6,
  stage: "storage",
  message: "Internal Server Error",
};
afterEach(() => vi.unstubAllGlobals());
test("retries retain first failure and distinguish image pages and stages", () => {
  const log: Record<string, FailureRecord> = {};
  recordFailureIn(log, input, "first");
  const next = recordFailureIn(log, { ...input, importId: "pass-2" }, "last");
  expect(next).toMatchObject({
    attempts: 2,
    firstAt: "first",
    lastAt: "last",
    importId: "pass-2",
  });
  recordFailureIn(log, { ...input, imagePage: 5 });
  recordFailureIn(log, { ...input, stage: "request" });
  expect(Object.keys(log)).toHaveLength(3);
  recordFailureIn(log, {
    ...input,
    imagePage: undefined,
    stage: "metadata",
    itemKey: "missing-1",
  });
  recordFailureIn(log, {
    ...input,
    imagePage: undefined,
    stage: "metadata",
    itemKey: "missing-2",
  });
  expect(Object.keys(log)).toHaveLength(5);
});
test("journal strips URL credentials and secret parameters", () => {
  expect(safeFailureMessage("Authorization: Bearer secret")).not.toContain(
    "secret",
  );
  const record = recordFailureIn(
    {},
    {
      ...input,
      assetUrl:
        "https://user:password@i.pximg.net/image.jpg?token=secret#private",
      message:
        "Bearer secret token=secret https://host.test/file?access_token=secret",
    },
  );
  expect(record.assetUrl).toBe("https://i.pximg.net/image.jpg");
  const bookmark = recordFailureIn(
    {},
    {
      ...input,
      sourceUrl:
        "https://www.pixiv.net/en/users/42/bookmarks/artworks?rest=hide&p=18&token=secret",
    },
  );
  expect(bookmark.sourceUrl).toBe(
    "https://www.pixiv.net/en/users/42/bookmarks/artworks?rest=hide&p=18",
  );
  expect(record.message).not.toContain("secret");
  expect(safeFailureMessage("x".repeat(2000))).toHaveLength(1000);
});
test("concurrent failures persist; recovery survives a later failure without erasing history", async () => {
  let db: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async () => structuredClone(db),
        set: async (value: Record<string, unknown>) => {
          db = structuredClone({ ...db, ...value });
        },
      },
    },
  });
  await Promise.all([
    recordFailure(input),
    recordFailure({ ...input, imagePage: 5 }),
  ]);
  await resolveFailures(input, ["storage"]);
  let records = Object.values(
    db[FAILURE_LOG_KEY] as Record<string, FailureRecord>,
  );
  expect(records).toHaveLength(2);
  expect(records.find((r) => r.imagePage === 4)?.resolvedAt).toBeTruthy();
  expect(records.find((r) => r.imagePage === 5)?.resolvedAt).toBeUndefined();
  await recordFailure(input);
  records = Object.values(db[FAILURE_LOG_KEY] as Record<string, FailureRecord>);
  expect(records.find((r) => r.imagePage === 4)).toMatchObject({
    attempts: 2,
    recoveries: 1,
  });
  expect(records.find((r) => r.imagePage === 4)?.lastRecoveredAt).toBeTruthy();
  expect(records.find((r) => r.imagePage === 4)?.resolvedAt).toBeUndefined();
});
