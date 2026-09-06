import { createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const sha = (data, algorithm = "sha256") =>
  createHash(algorithm).update(data).digest("hex");
const categories = ["general", "artist", "character", "copyright", "meta"];
const safeErrors = new Set([
  "Unconfirmed receipt",
  "Receipt bytes changed",
  "Reference binding changed",
  "No current durable input matches receipt bytes",
  "Invalid exact-match count",
  "Source MD5 does not match image",
  "Unsupported tag count",
  "Missing source revision",
  "Missing archive identity",
]);

/** The owner worker bridges SHA-256-bound archive inputs to Danbooru's MD5. */
export function publicationPayloads(image, receipt, bytes, work) {
  if (receipt.state !== "md5_match") throw new Error("Unconfirmed receipt");
  const inputSha256 = sha(bytes),
    inputMd5 = sha(bytes, "md5");
  if (
    inputSha256 !== image.sha256 ||
    inputSha256 !== receipt.inputSha256 ||
    inputMd5 !== receipt.md5
  )
    throw new Error("Receipt bytes changed");
  if (work.referenceId !== image.referenceId)
    throw new Error("Reference binding changed");
  const input = work.inputs.find((i) => i.sha256 === inputSha256);
  if (!input) throw new Error("No current durable input matches receipt bytes");
  if (!receipt.matches?.length || receipt.matches.length > 4)
    throw new Error("Invalid exact-match count");
  return receipt.matches.map((post) => {
    if (post.md5 !== inputMd5)
      throw new Error("Source MD5 does not match image");
    const tags = categories.flatMap((category) =>
      (post[`tag_string_${category}`] ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((name) => ({ name, category })),
    );
    if (!tags.length || tags.length > 512)
      throw new Error("Unsupported tag count");
    const sourceUpdatedAt = Date.parse(post.updated_at),
      retrievedAt = Math.round(receipt.retrievedAt * 1000);
    if (
      !Number.isSafeInteger(sourceUpdatedAt) ||
      !Number.isSafeInteger(retrievedAt)
    )
      throw new Error("Missing source revision");
    return {
      assetId: image.assetId,
      referenceId: image.referenceId,
      ...(input.storageId
        ? { inputStorageId: input.storageId }
        : { inputDriveFileId: input.driveFileId }),
      inputSha256,
      originalContentHash: work.originalContentHash,
      evidence: "exact_md5",
      inputMd5,
      postMd5: post.md5,
      postId: post.id,
      sourceUpdatedAt,
      retrievedAt,
      tags,
      ...(post.source ? { sourceUrl: post.source } : {}),
      ...(post.pixiv_id ? { pixivId: String(post.pixiv_id) } : {}),
    };
  });
}

export async function publishReceipts({
  images,
  receipts,
  imageRoot,
  client,
  accessKey,
  apply,
  checkpoint,
}) {
  if (
    new Set(receipts.images.map((r) => r.file)).size !== receipts.images.length
  )
    throw new Error("Duplicate receipt file identity");
  const identities = new Map();
  for (const image of images) {
    if (identities.has(image.file))
      throw new Error("Ambiguous manifest file identity");
    identities.set(image.file, image);
  }
  const report = {
    observed: 0,
    confirmedImages: 0,
    unconfirmed: 0,
    publishedMatches: 0,
    existingMatches: 0,
    failures: 0,
    items: [],
  };
  for (const receipt of receipts.images) {
    const item = { file: receipt.file, state: "unconfirmed", matches: [] };
    report.observed++;
    if (receipt.state !== "md5_match") report.unconfirmed++;
    else {
      report.confirmedImages++;
      try {
        const image = identities.get(receipt.file);
        if (!image?.assetId || !image.referenceId)
          throw new Error("Missing archive identity");
        const bytes = await readFile(
          resolve(imageRoot, image.localPath ?? image.file),
        );
        const work = await client.query(
          makeFunctionReference("communityTags:workItem"),
          { accessKey, assetId: image.assetId },
        );
        const payloads = publicationPayloads(image, receipt, bytes, work);
        for (const payload of payloads) {
          const result = apply
            ? await client.mutation(
                makeFunctionReference("communityTags:publish"),
                { ...payload, accessKey },
              )
            : null;
          const state = !apply
            ? "dry_run"
            : result.replayed
              ? "existing"
              : "published";
          if (state === "published") report.publishedMatches++;
          if (state === "existing") report.existingMatches++;
          item.matches.push({
            postId: payload.postId,
            state,
            tagCount: payload.tags.length,
          });
        }
        item.state = apply ? "verified" : "dry_run";
      } catch (error) {
        // Do not serialize transport errors: they may contain request arguments.
        item.state = "failed";
        item.error =
          error instanceof Error && safeErrors.has(error.message)
            ? error.message
            : "Publication failed; inspect the local function error";
        report.failures++;
      }
    }
    report.items.push(item);
    await checkpoint(report);
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2),
    option = (name) => args[args.indexOf(name) + 1];
  for (const name of ["--images", "--receipts", "--output"])
    if (!args.includes(name) || !option(name) || option(name).startsWith("--"))
      throw new Error(`Missing ${name}`);
  const imagePath = resolve(option("--images")),
    receiptPath = resolve(option("--receipts")),
    output = resolve(option("--output"));
  if ([imagePath, receiptPath].includes(output))
    throw new Error("Output must not overwrite input");
  const rawImages = await readFile(imagePath),
    rawReceipts = await readFile(receiptPath);
  const url = args.includes("--url")
    ? option("--url")
    : "http://127.0.0.1:3210";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))
    throw new Error("Publisher requires an explicit local vault URL");
  const accessKey = (await readFile(".convex/local-owner-key", "utf8")).trim();
  const client = new ConvexHttpClient(url);
  const hashes = {
    imagesSha256: sha(rawImages),
    receiptsSha256: sha(rawReceipts),
  };
  const checkpoint = async (report) => {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(
      output + ".tmp",
      JSON.stringify({ ...hashes, ...report }, null, 2) + "\n",
      { mode: 0o600 },
    );
    await rename(output + ".tmp", output);
  };
  const report = await publishReceipts({
    images: JSON.parse(rawImages),
    receipts: JSON.parse(rawReceipts),
    imageRoot: dirname(imagePath),
    client,
    accessKey,
    apply: args.includes("--apply"),
    checkpoint,
  });
  const { items, ...summary } = report;
  console.log(JSON.stringify(summary));
  if (report.failures) process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error("Publication aborted; no credentials were logged.");
    process.exitCode = 1;
  });
