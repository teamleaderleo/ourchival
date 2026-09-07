// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { slugifyTagName } from "./lib/tags";

const modules = import.meta.glob("./**/*.ts");
const accessKey = "owned-review-owner";
const listQueue = makeFunctionReference<"query">(
  "artworkReviewQueue:listUnlinkedOwnedPublications",
);

const ownedNames = [
  "X authored media",
  "Pixiv creator works",
  "HoYoLAB creator works",
] as const;

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
  return convexTest(schema, modules);
}

async function seedTag(t: ReturnType<typeof fixture>, name: string) {
  return await t.run((ctx) =>
    ctx.db.insert("tags", {
      name,
      slug: slugifyTagName(name),
      createdAt: 1,
    }),
  );
}

async function seedReference(
  t: ReturnType<typeof fixture>,
  args: {
    sourceUrl: string;
    platform: "x" | "pixiv" | "generic";
    tagIds: string[];
    capturedAt: number;
    title?: string;
    deleted?: boolean;
  },
) {
  return await t.run(async (ctx) => {
    const referenceId = await ctx.db.insert("references", {
      kind: "image",
      platform: args.platform,
      sourceUrl: args.sourceUrl,
      canonicalUrl: args.sourceUrl,
      title: args.title,
      capturedAt: args.capturedAt,
      publishedAt: args.capturedAt - 1,
      boardIds: [],
      tagIds: args.tagIds,
      favorite: false,
      archived: false,
      deleted: args.deleted ?? false,
    });
    await ctx.db.insert("sourceSnapshots", {
      referenceId,
      pageTitle: args.title ?? "snapshot title",
      postText: `Post text for ${args.sourceUrl}`,
      previewImageUrl: `https://images.example/${referenceId}.png`,
      createdAt: args.capturedAt,
    });
    await ctx.db.insert("assets", {
      referenceId,
      storageProvider: "google_drive",
      driveFileId: `drive-${referenceId}`,
      originalUrl: `https://images.example/${referenceId}.png`,
      sourceIndex: 0,
      sourceCount: 1,
      mimeType: "image/png",
      width: 1600,
      height: 1200,
      contentHash: "a".repeat(64),
      dominantColors: [],
      derivativeStatus: "ready",
    });
    return referenceId;
  });
}

it("returns recent unlinked creator captures and excludes unrelated, deleted, and linked references", async () => {
  const t = fixture();
  const [xTag, pixivTag, hoyolabTag, unrelatedTag] = await Promise.all([
    seedTag(t, ownedNames[0]),
    seedTag(t, ownedNames[1]),
    seedTag(t, ownedNames[2]),
    seedTag(t, "Lighting reference"),
  ]);

  const xReference = await seedReference(t, {
    sourceUrl: "https://x.com/TeamLeaderLeo/status/100",
    platform: "x",
    tagIds: [xTag],
    capturedAt: 500,
    title: "X artwork",
  });
  const pixivReference = await seedReference(t, {
    sourceUrl: "https://www.pixiv.net/en/artworks/200",
    platform: "pixiv",
    tagIds: [pixivTag],
    capturedAt: 450,
    title: "Pixiv artwork",
  });
  const linkedHoYoLab = await seedReference(t, {
    sourceUrl: "https://www.hoyolab.com/article/300",
    platform: "generic",
    tagIds: [hoyolabTag],
    capturedAt: 400,
    title: "HoYoLAB artwork",
  });
  await seedReference(t, {
    sourceUrl: "https://example.com/reference",
    platform: "generic",
    tagIds: [unrelatedTag],
    capturedAt: 600,
  });
  await seedReference(t, {
    sourceUrl: "https://x.com/TeamLeaderLeo/status/101",
    platform: "x",
    tagIds: [xTag],
    capturedAt: 550,
    deleted: true,
  });

  await t.run(async (ctx) => {
    const now = Date.now();
    const artworkId = await ctx.db.insert("artworks", {
      title: "Already linked",
      status: "finished",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("artworkPublications", {
      artworkId,
      referenceId: linkedHoYoLab,
      createdAt: now,
      updatedAt: now,
    });
  });

  const result = (await t.query(listQueue, {
    accessKey,
    limit: 20,
  })) as any;

  expect(result.items.map((item: any) => item.referenceId)).toEqual([
    String(xReference),
    String(pixivReference),
  ]);
  expect(result.items[0]).toMatchObject({
    sourceKind: "X authored media",
    title: "X artwork",
    platform: "x",
    assetCount: 1,
    firstAsset: {
      sourceIndex: 0,
      sourceCount: 1,
      storageProvider: "google_drive",
      hasContentHash: true,
      derivativeStatus: "ready",
    },
  });
  expect(result.items[0].previewImageUrl).toContain("images.example");
  expect(result.items[0].postText).toContain("Post text");
  expect(result.ownedSourceTags).toEqual(ownedNames);
});

it("returns an empty queue when owned-source tags have never been captured", async () => {
  const t = fixture();
  const result = (await t.query(listQueue, {
    accessKey,
    limit: 5,
  })) as any;

  expect(result).toMatchObject({
    items: [],
    scanned: 0,
    candidatesSeen: 0,
    hasMore: false,
  });
});

it("enforces owner access and normalizes unreasonable limits", async () => {
  const t = fixture();
  const xTag = await seedTag(t, ownedNames[0]);
  for (let index = 0; index < 3; index += 1) {
    await seedReference(t, {
      sourceUrl: `https://x.com/TeamLeaderLeo/status/${700 + index}`,
      platform: "x",
      tagIds: [xTag],
      capturedAt: 700 + index,
    });
  }

  const one = (await t.query(listQueue, {
    accessKey,
    limit: 1,
  })) as any;
  expect(one.items).toHaveLength(1);
  expect(one.hasMore).toBe(true);

  await expect(
    t.query(listQueue, { accessKey: "wrong", limit: 10 }),
  ).rejects.toThrow();
});
