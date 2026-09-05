/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { validateLinkBatch, readLinkBatch } from "./lib/linkIntake";
const modules = import.meta.glob("./**/*.ts");

const sessionKey = `saved-links-v1:${"a".repeat(64)}`;
const batch = (
  offset = 0,
  entries = [{ url: "https://example.com/a" }],
  total = 2,
) => ({ sessionKey, source: "url_list", offset, entries, total });

function database() {
  const t = convexTest(schema, modules);
  return {
    t,
    run: (batch: unknown) =>
      t.mutation(internal.httpDb.importLinkBatch, { batch }),
    all: <T extends "references" | "sourceSnapshots" | "captureSessions">(
      table: T,
    ) => t.run((ctx) => ctx.db.query(table).collect()),
    edit: (id: any, patch: any) => t.run((ctx) => ctx.db.patch(id, patch)),
  };
}

describe("saved-link intake transaction", () => {
  it("resumes from the committed cursor after losing a response, without replaying snapshots or counts", async () => {
    const db = database();
    const first = await db.run(batch());
    const replay = await db.run(batch());
    expect(replay).toEqual({ ...first, replayed: true });
    expect((await db.run(batch(0, []))).nextOffset).toBe(1);
    const final = await db.run(batch(1, [{ url: "https://example.com/b" }]));
    expect(final).toMatchObject({
      complete: true,
      saved: 2,
      duplicates: 0,
      nextOffset: 2,
    });
    expect(await db.all("sourceSnapshots")).toHaveLength(2);
  });

  it("deduplicates canonical variants while retaining every original occurrence and user state", async () => {
    const db = database();
    await db.run(
      batch(0, [{ url: "https://example.com/a?utm_source=old#detail" }]),
    );
    const reference = (await db.all("references"))[0]!;
    await db.edit(reference._id, {
      favorite: true,
      archived: true,
      deleted: true,
      title: "Owner title",
    });
    const receipt = await db.run(batch(1, [{ url: "https://example.com/a" }]));
    expect(receipt).toMatchObject({ saved: 1, duplicates: 1 });
    expect((await db.all("references"))[0]).toMatchObject({
      title: "Owner title",
      favorite: true,
      archived: true,
      deleted: true,
    });
    const snapshots = await db.all("sourceSnapshots");
    expect(snapshots.map((s) => JSON.parse(s.jsonMetadata!))).toMatchObject([
      {
        ordinal: 0,
        originalUrl: "https://example.com/a?utm_source=old#detail",
        sessionKey,
      },
      { ordinal: 1, originalUrl: "https://example.com/a", sessionKey },
    ]);
  });

  it("rejects gaps, overlapping retries, and changed manifests", async () => {
    const db = database();
    await expect(db.run(batch(1))).rejects.toThrow("gap");
    expect(await db.all("captureSessions")).toHaveLength(0);
    await db.run(batch());
    await expect(
      db.run(batch(0, [{ url: "https://a.com" }, { url: "https://b.com" }])),
    ).rejects.toThrow("Overlapping");
    await expect(db.run({ ...batch(), total: 3 })).rejects.toThrow("manifest");
  });

  it("bounds receipts independently of batch size and keeps duplicate occurrences within a batch", async () => {
    const db = database();
    const receipt = await db.run(
      batch(
        0,
        Array.from({ length: 50 }, () => ({ url: "https://example.com" })),
        50,
      ),
    );
    expect(receipt).toMatchObject({ saved: 1, duplicates: 49, nextOffset: 50 });
    expect(JSON.stringify(receipt).length).toBeLessThan(300);
    expect(await db.all("sourceSnapshots")).toHaveLength(50);
  });
});

describe("saved-link batch validation", () => {
  it.each([
    { ...batch(), offset: -1 },
    { ...batch(), total: 100_001 },
    {
      ...batch(),
      entries: Array(51).fill({ url: "https://a.com" }),
      total: 51,
    },
    { ...batch(), entries: [{ url: "javascript:alert(1)" }] },
    { ...batch(), entries: [{ url: "https://user:pass@example.com" }] },
    {
      ...batch(),
      entries: [{ url: "https://example.com", title: "x".repeat(1001) }],
    },
  ])("rejects invalid or unbounded input before writes", (input) => {
    expect(() => validateLinkBatch(input)).toThrow();
  });
});

describe("intake transport bound", () => {
  it("rejects an oversized body without trusting Content-Length", async () => {
    await expect(
      readLinkBatch(
        new Request("https://vault.test/capture-links", {
          method: "POST",
          body: "x".repeat(750_001),
        }),
      ),
    ).rejects.toThrow("byte limit");
  });
});

describe("atomic failure recovery", () => {
  it("rolls back inserted references and the new session when statistics fail", async () => {
    const db = database();
    await db.t.run(async (ctx) => {
      const corruptStats = {
        key: "global",
        inbox: 0,
        library: 0,
        later: 0,
        archive: 0,
        trash: 0,
        images: 0,
        links: 0,
        favorites: 0,
        updatedAt: 0,
      };
      await ctx.db.insert("referenceStats", corruptStats);
      await ctx.db.insert("referenceStats", corruptStats);
    });
    await expect(db.run(batch())).rejects.toThrow();
    expect(await db.all("references")).toHaveLength(0);
    expect(await db.all("sourceSnapshots")).toHaveLength(0);
    expect(await db.all("captureSessions")).toHaveLength(0);
  });
});
