import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(root, "packages/parsers/fixtures/onetab-50000.txt");
const manifestPath = resolve(
  root,
  "packages/parsers/fixtures/onetab-50000.manifest.json",
);
const source = "onetab";
const parserVersion = "onetab-1";
const recordCount = 50_000;
const records = [];
const categories = {
  exactDuplicates: 0,
  normalizedDuplicates: 0,
  canonicalCollisionCandidates: 0,
  slowMetadata: 0,
  blockedMetadata: 0,
  failedMetadata: 0,
};

for (let ordinal = 0; ordinal < recordCount; ordinal += 1) {
  let url;
  if (ordinal % 100 === 99) {
    url = records[ordinal - 1].url;
    categories.exactDuplicates += 1;
  } else if (ordinal % 250 === 249) {
    url = `${records[ordinal - 1].url}?utm_source=fixture#resume`;
    categories.normalizedDuplicates += 1;
  } else {
    const outcome =
      ordinal % 97 === 0
        ? "slow"
        : ordinal % 89 === 0
          ? "blocked"
          : ordinal % 83 === 0
            ? "failed"
            : "ok";
    if (outcome === "slow") categories.slowMetadata += 1;
    if (outcome === "blocked") categories.blockedMetadata += 1;
    if (outcome === "failed") categories.failedMetadata += 1;
    if (ordinal % 211 === 0) categories.canonicalCollisionCandidates += 1;
    url = `https://fixture-${ordinal % 37}.example.test/metadata/${outcome}/reference/${String(ordinal).padStart(5, "0")}`;
  }
  records.push({
    ordinal,
    url,
    title: `Fixture reference ${String(ordinal).padStart(5, "0")}`,
  });
}

const text = `${records.map((record) => `${record.url} | ${record.title}`).join("\n")}\n`;
const digestHasher = createHash("sha256");
digestHasher.update(`ourchival-import\0${source}\0${parserVersion}\0`);
for (const record of records) {
  for (const field of [String(record.ordinal), record.url, record.title, ""]) {
    const bytes = Buffer.from(field);
    digestHasher.update(`${bytes.length}:`);
    digestHasher.update(bytes);
    digestHasher.update(Buffer.from([0]));
  }
}

const manifest = {
  schemaVersion: 1,
  generator: "scripts/generate-import-fixture.mjs",
  source,
  parserVersion,
  recordCount,
  importDigest: digestHasher.digest("hex"),
  fileSha256: createHash("sha256").update(text).digest("hex"),
  categories,
  hosts: "Reserved .test domains; fixture performs no network requests.",
};

await mkdir(dirname(fixturePath), { recursive: true });
await writeFile(fixturePath, text);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest));
