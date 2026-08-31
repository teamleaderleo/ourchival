import { once } from "node:events";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createFixtureCategories,
  generateOneTabFixture,
  FIXTURE_RESULT_ORACLE_VERSION,
  ONE_TAB_FIXTURE_COUNT,
  oneTabFixtureLine,
  runOneTabFixtureOracle,
} from "../packages/parsers/src/importFixture.ts";

const source = "onetab";
const parserVersion = "onetab-1";
const categories = createFixtureCategories();
const fileHasher = createHash("sha256");
const digestHasher = createHash("sha256");
const resultHasher = createHash("sha256");
const outputArgument = process.argv.indexOf("--write-corpus");
const corpusPath =
  outputArgument >= 0
    ? resolve(process.argv[outputArgument + 1] ?? "onetab-50000.txt")
    : undefined;
const output = corpusPath ? createWriteStream(corpusPath) : undefined;

digestHasher.update(`ourchival-import\0${source}\0${parserVersion}\0`);
for (const record of generateOneTabFixture(ONE_TAB_FIXTURE_COUNT, categories)) {
  const line = oneTabFixtureLine(record);
  fileHasher.update(line);
  if (output && !output.write(line)) await once(output, "drain");
  for (const field of [
    String(record.ordinal),
    record.submittedUrl,
    record.submittedTitle ?? "",
    record.sourceGroup ?? "",
  ]) {
    const bytes = Buffer.from(field);
    digestHasher.update(`${bytes.length}:`);
    digestHasher.update(bytes);
    digestHasher.update(Buffer.from([0]));
  }
}
if (output) {
  output.end();
  await once(output, "finish");
}

resultHasher.update(
  `ourchival-import-result\0${FIXTURE_RESULT_ORACLE_VERSION}\0`,
);
const resultOracle = runOneTabFixtureOracle(
  ONE_TAB_FIXTURE_COUNT,
  (receipt) => {
    for (const field of [
      String(receipt.ordinal),
      receipt.outcome,
      receipt.duplicateReason ?? "",
      receipt.matchedOrdinal === undefined
        ? ""
        : String(receipt.matchedOrdinal),
      receipt.errorClass ?? "",
    ]) {
      const bytes = Buffer.from(field);
      resultHasher.update(`${bytes.length}:`);
      resultHasher.update(bytes);
      resultHasher.update(Buffer.from([0]));
    }
  },
);

const manifest = {
  schemaVersion: 3,
  generator: "scripts/generate-import-fixture.mjs",
  source,
  parserVersion,
  recordCount: ONE_TAB_FIXTURE_COUNT,
  importDigest: digestHasher.digest("hex"),
  generatedFileSha256: fileHasher.digest("hex"),
  categories,
  resultOracle: {
    ...resultOracle,
    resultDigest: resultHasher.digest("hex"),
  },
  corpusPolicy:
    "Generated on demand; the 50,000-line derivative is intentionally excluded from git.",
  hosts: "Reserved .test domains; fixture performs no network requests.",
};

const verifyArgument = process.argv.indexOf("--verify-manifest");
if (verifyArgument >= 0) {
  const manifestPath = resolve(
    process.argv[verifyArgument + 1] ??
      "packages/parsers/fixtures/onetab-50000.manifest.json",
  );
  const expected = JSON.parse(await readFile(manifestPath, "utf8"));
  if (JSON.stringify(expected) !== JSON.stringify(manifest)) {
    throw new Error(
      `Generated input/result oracle does not match ${manifestPath}. Run with --write-manifest to refresh it.`,
    );
  }
}

const manifestArgument = process.argv.indexOf("--write-manifest");
if (manifestArgument >= 0) {
  const manifestPath = resolve(
    process.argv[manifestArgument + 1] ??
      "packages/parsers/fixtures/onetab-50000.manifest.json",
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(JSON.stringify(manifest));
