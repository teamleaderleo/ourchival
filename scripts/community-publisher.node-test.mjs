import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  publicationPayloads,
  publishReceipts,
} from "./publish-community-tags.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bytes = Buffer.from("exact bytes"),
  sha = createHash("sha256").update(bytes).digest("hex"),
  md5 = createHash("md5").update(bytes).digest("hex");
const image = { assetId: "asset", referenceId: "reference", sha256: sha };
const work = {
  referenceId: "reference",
  originalContentHash: null,
  inputs: [{ storageId: "file", sha256: sha }],
};
const receipt = {
  state: "md5_match",
  inputSha256: sha,
  md5,
  retrievedAt: 1700000000,
  matches: [
    {
      id: 123,
      md5,
      updated_at: "2023-01-01T00:00:00Z",
      tag_string_general: "line_art hands",
      tag_string_artist: "artist_name",
      pixiv_id: 456,
    },
  ],
};

test("publisher preserves community categories and source identity without making up scores", () => {
  const [payload] = publicationPayloads(image, receipt, bytes, work);
  assert.equal(payload.inputStorageId, "file");
  assert.equal(payload.pixivId, "456");
  assert.deepEqual(payload.tags, [
    { name: "line_art", category: "general" },
    { name: "hands", category: "general" },
    { name: "artist_name", category: "artist" },
  ]);
  assert.ok(payload.tags.every((tag) => !("confidence" in tag)));
});
test("candidates, wrong bytes, mismatched source hashes and stale input bindings cannot publish", () => {
  for (const state of [
    "source_candidate",
    "artist_candidate",
    "no_match",
    "lookup_error",
  ])
    assert.throws(() =>
      publicationPayloads(image, { ...receipt, state }, bytes, work),
    );
  assert.throws(() =>
    publicationPayloads(image, receipt, Buffer.from("changed"), work),
  );
  assert.throws(() =>
    publicationPayloads(
      image,
      { ...receipt, matches: [{ ...receipt.matches[0], md5: "0".repeat(32) }] },
      bytes,
      work,
    ),
  );
  assert.throws(() =>
    publicationPayloads(image, receipt, bytes, { ...work, inputs: [] }),
  );
  assert.throws(() =>
    publicationPayloads(image, receipt, bytes, {
      ...work,
      referenceId: "another",
    }),
  );
});

test("partial publication checkpoints safely and replay recovers without duplicate matches or leaked errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-publisher-"));
  try {
    await writeFile(join(root, "image.jpg"), bytes);
    let fail = true;
    const stored = new Set(),
      checkpoints = [];
    const client = {
      query: async () => work,
      mutation: async (_, args) => {
        if (args.postId === 124 && fail) {
          fail = false;
          throw new Error("private-token-never-print");
        }
        const replayed = stored.has(args.postId);
        stored.add(args.postId);
        return { replayed };
      },
    };
    const args = {
      images: [{ ...image, file: "image.jpg" }],
      receipts: {
        images: [
          {
            ...receipt,
            file: "image.jpg",
            matches: [...receipt.matches, { ...receipt.matches[0], id: 124 }],
          },
        ],
      },
      imageRoot: root,
      client,
      accessKey: "private-token-never-print",
      apply: true,
      checkpoint: async (r) => checkpoints.push(JSON.stringify(r)),
    };
    const first = await publishReceipts(args);
    assert.equal(first.failures, 1);
    assert.equal(first.publishedMatches, 1);
    assert.ok(
      checkpoints.every((text) => !text.includes("private-token-never-print")),
    );
    const second = await publishReceipts(args);
    assert.equal(second.failures, 0);
    assert.equal(second.publishedMatches, 1);
    assert.equal(second.existingMatches, 1);
    assert.equal(stored.size, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
