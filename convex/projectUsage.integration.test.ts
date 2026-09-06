// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
const accessKey = "fixture-owner";
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
  const t = convexTest(schema, modules);
  const project = await t.mutation(api.projects.create, {
    accessKey,
    name: "Character study",
  });
  const referenceId = await t.run((ctx) =>
    ctx.db.insert("references", {
      kind: "image",
      platform: "pixiv",
      sourceUrl: "https://www.pixiv.net/artworks/42",
      capturedAt: 1,
      boardIds: [],
      tagIds: [],
      favorite: true,
      archived: false,
      deleted: false,
    }),
  );
  return { t, projectId: project!._id, referenceId };
}
it("shortlisting and actual use are separate; retries don't inflate history or clear notes", async () => {
  const { t, projectId, referenceId } = await fixture();
  const args = { accessKey, projectId, referenceId };
  const added = await t.mutation(api.projects.upsertReference, {
    ...args,
    reason: "Lighting",
    notes: "Warm rim light",
  });
  expect(added).toMatchObject({ usageStatus: "shortlisted" });
  expect(added?.usedAt).toBeUndefined();
  const used = await t.mutation(api.projects.setReferenceUsage, {
    ...args,
    used: true,
  });
  const repeated = await t.mutation(api.projects.setReferenceUsage, {
    ...args,
    used: true,
  });
  expect(repeated?.usedAt).toBe(used?.usedAt);
  await t.mutation(api.projects.upsertReferences, {
    accessKey,
    projectId,
    referenceIds: [referenceId, referenceId],
  });
  const rows = await t.query(api.projects.listForReference, {
    accessKey,
    referenceId,
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    usageStatus: "used",
    reason: "Lighting",
    notes: "Warm rim light",
    usedAt: used?.usedAt,
  });
  const corrected = await t.mutation(api.projects.setReferenceUsage, {
    ...args,
    used: false,
  });
  expect(corrected?.usageStatus).toBe("shortlisted");
  expect(corrected?.usedAt).toBeUndefined();
  expect((await t.run((ctx) => ctx.db.get(referenceId)))?.favorite).toBe(true);
  await t.mutation(api.projects.upsertReference, { ...args, notes: "" });
  expect(
    (
      await t.query(api.projects.listForReference, { accessKey, referenceId })
    )[0]?.notes,
  ).toBeUndefined();
});
it("legacy attachments remain unconfirmed and missing references stay visible in a paginated receipt", async () => {
  const { t, projectId, referenceId } = await fixture();
  await t.run((ctx) =>
    ctx.db.insert("projectReferences", {
      projectId,
      referenceId,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const before = await t.query(api.projects.listReferences, {
    accessKey,
    projectId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(before.page[0]?.usageStatus).toBeUndefined();
  expect(before.page[0]?.reference?.favorite).toBe(true);
  await t.run((ctx) => ctx.db.delete(referenceId));
  const after = await t.query(api.projects.listReferences, {
    accessKey,
    projectId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(after.page).toHaveLength(1);
  expect(after.page[0]?.reference).toBeNull();
});
it("requires owner access and refuses oversized batches instead of silently truncating", async () => {
  const { t, projectId, referenceId } = await fixture();
  await expect(
    t.mutation(api.projects.setReferenceUsage, {
      accessKey: "wrong",
      projectId,
      referenceId,
      used: true,
    }),
  ).rejects.toThrow();
  await expect(
    t.query(api.projects.listReferences, {
      accessKey: "wrong",
      projectId,
      paginationOpts: { numItems: 1, cursor: null },
    }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.projects.upsertReferences, {
      accessKey,
      projectId,
      referenceIds: Array(97).fill(referenceId),
    }),
  ).rejects.toThrow("96");
  expect(
    await t.query(api.projects.listForReference, { accessKey, referenceId }),
  ).toEqual([]);
});
