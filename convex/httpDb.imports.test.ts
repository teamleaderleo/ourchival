/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const digest = "a".repeat(64);

function batchArgs(
  records: Array<{
    ordinal: number;
    submittedUrl: string;
    submittedTitle?: string;
    sourceGroup?: string;
  }>,
  expectedCount = records.length,
) {
  return {
    sessionKey: `url_list:url-list-1:${digest}`,
    source: "url_list" as const,
    parserVersion: "url-list-1",
    importDigest: digest,
    expectedCount,
    records,
    now: 1_800_000_000_000,
  };
}

function reference(sourceUrl: string, canonicalUrl: string) {
  return {
    kind: "page" as const,
    sourceUrl,
    canonicalUrl,
    platform: "generic" as const,
    capturedAt: 1_700_000_000_000,
    triageState: "inbox" as const,
    boardIds: [],
    tagIds: [],
    favorite: false,
    archived: false,
    deleted: false,
  };
}

describe("resumable import receipts", () => {
  it("rejects a conflicting expected count for a digest-bound session", async () => {
    const t = convexTest(schema, modules);
    const args = batchArgs(
      [{ ordinal: 0, submittedUrl: "https://count.example.test/one" }],
      2,
    );
    await t.mutation(internal.httpDb.submitImportBatch, args);

    await expect(
      t.mutation(internal.httpDb.submitImportBatch, {
        ...args,
        expectedCount: 3,
        records: [],
      }),
    ).rejects.toThrow("identity does not match");
  });

  it("rejects altered submitted provenance when replaying an ordinal", async () => {
    const t = convexTest(schema, modules);
    const original = {
      ordinal: 0,
      submittedUrl: "https://replay.example.test/one",
      submittedTitle: "Original title",
      sourceGroup: "Original group",
    };
    const args = batchArgs([original]);
    await t.mutation(internal.httpDb.submitImportBatch, args);

    for (const altered of [
      { ...original, submittedUrl: "https://replay.example.test/two" },
      { ...original, submittedTitle: "Altered title" },
      { ...original, sourceGroup: "Altered group" },
    ]) {
      await expect(
        t.mutation(internal.httpDb.submitImportBatch, {
          ...args,
          records: [altered],
        }),
      ).rejects.toThrow("conflicts with its saved source record");
    }

    const replay = await t.mutation(internal.httpDb.submitImportBatch, args);
    expect(replay.batchReceipt).toMatchObject({
      saved: 0,
      duplicate: 0,
      replayed: 1,
    });
  });

  it("distinguishes exact, normalized, and true canonical duplicates", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "references",
        reference(
          "https://exact.example.test/a",
          "https://exact.example.test/a",
        ),
      );
      await ctx.db.insert("references", {
        ...reference(
          "https://normalized.example.test/a?utm_source=old",
          "https://normalized.example.test/a",
        ),
        normalizedSourceUrl: "https://normalized.example.test/a",
      });
      await ctx.db.insert("references", {
        ...reference(
          "https://origin.example.test/a",
          "https://canonical.example.test/a",
        ),
        normalizedSourceUrl: "https://origin.example.test/a",
      });
    });

    const result = await t.mutation(
      internal.httpDb.submitImportBatch,
      batchArgs([
        { ordinal: 0, submittedUrl: "https://exact.example.test/a" },
        {
          ordinal: 1,
          submittedUrl:
            "https://normalized.example.test/a?utm_source=new#fragment",
        },
        { ordinal: 2, submittedUrl: "https://canonical.example.test/a" },
      ]),
    );

    expect(result.receipts.map((receipt) => receipt.duplicateReason)).toEqual([
      "source_url",
      "normalized_url",
      "canonical_url",
    ]);
    expect(result.session).toMatchObject({
      savedCount: 0,
      duplicateCount: 3,
      checkpointOrdinal: 2,
    });
  });

  it("records one item failure and continues the batch", async () => {
    const t = convexTest(schema, modules);
    const longUrl = `https://large.example.test/${"a".repeat(4_100)}`;
    const result = await t.mutation(
      internal.httpDb.submitImportBatch,
      batchArgs([
        { ordinal: 0, submittedUrl: longUrl },
        { ordinal: 1, submittedUrl: "https://valid.example.test/after" },
      ]),
    );

    expect(result.receipts).toMatchObject([
      {
        ordinal: 0,
        outcome: "failed",
        errorClass: "invalid_record",
        replayed: false,
      },
      { ordinal: 1, outcome: "saved", replayed: false },
    ]);
    expect(result.session).toMatchObject({
      completedCount: 2,
      savedCount: 1,
      failedCount: 1,
      checkpointOrdinal: 1,
      status: "completed",
    });
    expect(result.batchReceipt.failedOrdinals).toEqual([0]);
  });
});
