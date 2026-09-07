// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const accessKey = "publication-intake-owner";
const createArtwork = makeFunctionReference<"mutation">("artworks:create");
const linkByUrl = makeFunctionReference<"mutation">(
  "artworkPublicationIntake:linkByUrl",
);

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
  return convexTest(schema, modules);
}

async function insertReference(
  t: ReturnType<typeof fixture>,
  args: { sourceUrl: string; canonicalUrl?: string; deleted?: boolean },
) {
  return await t.run((ctx) =>
    ctx.db.insert("references", {
      kind: "post",
      platform: "x",
      sourceUrl: args.sourceUrl,
      ...(args.canonicalUrl ? { canonicalUrl: args.canonicalUrl } : {}),
      capturedAt: 10,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: args.deleted ?? false,
    }),
  );
}

it("links a captured publication by ordinary source URL and stays idempotent", async () => {
  const t = fixture();
  const artwork = await t.mutation(createArtwork, {
    accessKey,
    title: "Publication-linked artwork",
  });
  const referenceId = await insertReference(t, {
    sourceUrl: "https://x.com/TeamLeaderLeo/status/131",
  });

  const first = await t.mutation(linkByUrl, {
    accessKey,
    artworkId: artwork!._id,
    url: "https://x.com/TeamLeaderLeo/status/131",
  });
  const second = await t.mutation(linkByUrl, {
    accessKey,
    artworkId: artwork!._id,
    url: "https://x.com/TeamLeaderLeo/status/131",
  });

  expect(first.reference).toMatchObject({ id: referenceId, platform: "x" });
  expect(second.publication?._id).toBe(first.publication?._id);
  const rows = await t.run((ctx) => ctx.db.query("artworkPublications").collect());
  expect(rows).toHaveLength(1);
});

it("matches canonical URLs and rejects uncaptured, trashed, and ambiguous publications", async () => {
  const t = fixture();
  const artwork = await t.mutation(createArtwork, {
    accessKey,
    title: "Publication-linked artwork",
  });
  await insertReference(t, {
    sourceUrl: "https://example.com/share/one",
    canonicalUrl: "https://www.pixiv.net/artworks/131",
  });

  const canonical = await t.mutation(linkByUrl, {
    accessKey,
    artworkId: artwork!._id,
    url: "https://www.pixiv.net/artworks/131",
  });
  expect(canonical.reference).toMatchObject({
    canonicalUrl: "https://www.pixiv.net/artworks/131",
  });

  await expect(
    t.mutation(linkByUrl, {
      accessKey,
      artworkId: artwork!._id,
      url: "https://x.com/TeamLeaderLeo/status/does-not-exist",
    }),
  ).rejects.toThrow("Capture this publication");

  await insertReference(t, {
    sourceUrl: "https://x.com/TeamLeaderLeo/status/trashed",
    deleted: true,
  });
  await expect(
    t.mutation(linkByUrl, {
      accessKey,
      artworkId: artwork!._id,
      url: "https://x.com/TeamLeaderLeo/status/trashed",
    }),
  ).rejects.toThrow("Restore this publication");

  await insertReference(t, { sourceUrl: "https://x.com/shared/status/1" });
  await insertReference(t, { sourceUrl: "https://x.com/shared/status/1" });
  await expect(
    t.mutation(linkByUrl, {
      accessKey,
      artworkId: artwork!._id,
      url: "https://x.com/shared/status/1",
    }),
  ).rejects.toThrow("More than one captured reference");
});

it("requires owner access and an absolute http(s) URL", async () => {
  const t = fixture();
  const artwork = await t.mutation(createArtwork, { accessKey, title: "Artwork" });

  await expect(
    t.mutation(linkByUrl, {
      accessKey: "wrong",
      artworkId: artwork!._id,
      url: "https://example.com/post",
    }),
  ).rejects.toThrow();

  await expect(
    t.mutation(linkByUrl, {
      accessKey,
      artworkId: artwork!._id,
      url: "not-a-url",
    }),
  ).rejects.toThrow("absolute http(s) URL");
});
