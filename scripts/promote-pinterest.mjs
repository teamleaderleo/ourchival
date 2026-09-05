#!/usr/bin/env node
// Targeted, idempotent promotion of an existing asset identity. No browser profile access.
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2)
  options.set(process.argv[i], process.argv[i + 1]);
const sourceUrl = options.get("--source-url");
const assetUrl = options.get("--asset-url");
const originalUrl = options.get("--original-url");
if (!sourceUrl || !assetUrl || !originalUrl) {
  throw new Error(
    "Usage: node scripts/promote-pinterest.mjs --source-url PIN --asset-url EXISTING_ASSET_URL --original-url PIN_IMAGES_ORIG_URL",
  );
}
const source = new URL(sourceUrl);
if (
  source.protocol !== "https:" ||
  !/(^|\.)pinterest\.[a-z.]+$/.test(source.hostname) ||
  !/^\/pin\/\d+\/?$/.test(source.pathname)
) {
  throw new Error("Expected a Pinterest pin source URL");
}
for (const value of [assetUrl, originalUrl]) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/(^|\.)pinimg\.com$/.test(url.hostname) ||
    !url.pathname.startsWith("/originals/")
  ) {
    throw new Error("Expected a Pinterest original asset URL");
  }
}
const localEnv = await readFile(
  resolve(root, ".env.local-vault.local"),
  "utf8",
);
const endpoint = new URL(
  localEnv.match(/^CONVEX_SITE_URL=(.+)$/m)?.[1]?.trim() ??
    "http://127.0.0.1:3211",
);
if (
  endpoint.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(endpoint.hostname)
) {
  throw new Error("This command only operates on the canonical local vault");
}
const key = (
  await readFile(resolve(root, ".convex/local-owner-key"), "utf8")
).trim();
const response = await fetch(new URL("/capture", endpoint), {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({
    kind: "post",
    sourceUrl,
    canonicalUrl: sourceUrl,
    assetUrl,
    assetOriginalUrl: originalUrl,
    promoteOriginal: true,
    assetIndex: 0,
    assetCount: 1,
    deferMetadata: true,
    capturedAt: new Date().toISOString(),
  }),
});
const body = await response.json();
if (!response.ok || !body.ok)
  throw new Error(body.error ?? `Local capture HTTP ${response.status}`);
console.log(
  JSON.stringify({
    referenceId: body.referenceId,
    assetId: body.assetId,
    alreadySaved: body.alreadySaved,
    quality: body.assetQuality,
    storageProvider: body.storageProvider,
    storedBytes: body.storedBytes,
    newStoredBytes: body.newStoredBytes,
    status: body.storageStatus,
  }),
);
if (body.assetQuality !== "original" || body.storageProvider !== "google_drive")
  process.exitCode = 2;
