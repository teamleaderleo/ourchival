import { oneTabFixtureChunks } from "../packages/parsers/src/importFixture.ts";
import { digestImport, parseImport } from "../packages/parsers/src/imports.ts";
import { getHeapStatistics } from "node:v8";

const recordCount = 50_000;
const batchLimit = 50;
const simulatedCheckpoint = 19_999;
const retainedHeapCeilingBytes = 24 * 1024 * 1024;

if (typeof global.gc !== "function") {
  throw new Error(
    "Run with --expose-gc so the bounded-memory measurement has a stable baseline.",
  );
}

global.gc();
const baselineRetainedHeapBytes = getHeapStatistics().used_heap_size;
let peakRetainedHeapBytes = baselineRetainedHeapBytes;

function sampleRetainedHeap() {
  global.gc();
  peakRetainedHeapBytes = Math.max(
    peakRetainedHeapBytes,
    getHeapStatistics().used_heap_size,
  );
}

async function identifySource() {
  const identity = await digestImport(
    "onetab",
    parseImport("onetab", oneTabFixtureChunks(recordCount)),
  );
  sampleRetainedHeap();
  return {
    ...identity,
    sessionKey: `onetab:${identity.parserVersion}:${identity.digest}`,
  };
}

const firstIdentity = await identifySource();
sampleRetainedHeap();
const reselectedIdentity = await identifySource();
if (firstIdentity.sessionKey !== reselectedIdentity.sessionKey) {
  throw new Error("Reselection produced a different session identity.");
}

let batch = [];
let maxBatchRecords = 0;
let submittedRecords = 0;
for await (const record of parseImport(
  "onetab",
  oneTabFixtureChunks(recordCount),
)) {
  if (record.ordinal <= simulatedCheckpoint) continue;
  batch.push(record);
  maxBatchRecords = Math.max(maxBatchRecords, batch.length);
  if (batch.length === batchLimit) {
    submittedRecords += batch.length;
    batch = [];
  }
  if (record.ordinal % 500 === 0) {
    sampleRetainedHeap();
  }
}
submittedRecords += batch.length;
batch = [];
sampleRetainedHeap();

const compactCheckpoint = {
  version: 1,
  sessionKey: firstIdentity.sessionKey,
  source: "onetab",
  parserVersion: firstIdentity.parserVersion,
  importDigest: firstIdentity.digest,
  filenameHint: "onetab-50000.txt",
  expectedCount: recordCount,
  checkpointOrdinal: simulatedCheckpoint,
  savedCount: simulatedCheckpoint + 1,
  duplicateCount: 0,
  skippedCount: 0,
  failedCount: 0,
  failedOrdinals: [],
  status: "paused",
  updatedAt: "2026-08-31T00:00:00.000Z",
};
const checkpointBytes = Buffer.byteLength(JSON.stringify(compactCheckpoint));
const retainedHeapDeltaBytes =
  peakRetainedHeapBytes - baselineRetainedHeapBytes;

if (firstIdentity.count !== recordCount) {
  throw new Error(
    `Expected ${recordCount} records, got ${firstIdentity.count}.`,
  );
}
if (maxBatchRecords > batchLimit) {
  throw new Error(`Batch retained ${maxBatchRecords} records.`);
}
if (submittedRecords !== recordCount - simulatedCheckpoint - 1) {
  throw new Error("Resume submitted the wrong ordinal range.");
}
if (checkpointBytes > 2_048) {
  throw new Error(`Checkpoint grew to ${checkpointBytes} bytes.`);
}
if (retainedHeapDeltaBytes > retainedHeapCeilingBytes) {
  throw new Error(
    `Retained heap delta ${retainedHeapDeltaBytes} exceeded ${retainedHeapCeilingBytes} bytes.`,
  );
}

console.log(
  JSON.stringify(
    {
      recordCount,
      digest: firstIdentity.digest,
      reselectionSessionMatch: true,
      simulatedCheckpoint,
      submittedRecords,
      maxBatchRecords,
      checkpointBytes,
      baselineRetainedHeapBytes,
      peakRetainedHeapBytes,
      retainedHeapDeltaBytes,
      retainedHeapCeilingBytes,
      scope:
        "Node retained-heap samples after forced GC for the streaming parser/digest/batch/reselection harness; allocation peaks, Chromium heap, and service-worker suspension remain browser-verification work.",
    },
    null,
    2,
  ),
);
