import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const arguments_ = process.argv.slice(2);
if (arguments_[0] === "--") arguments_.shift();
if (arguments_.length < 5) {
  throw new Error(
    "Usage: verify-import-browser.mjs EXTENSION_DIST PROFILE_DIR CORPUS DB SCREENSHOTS",
  );
}
const [
  extensionArgument,
  profileArgument,
  corpusArgument,
  databaseArgument,
  screenshotArgument,
] = arguments_;
const extensionPath = resolve(extensionArgument);
const profilePath = resolve(profileArgument);
const corpusPath = resolve(corpusArgument);
const databasePath = resolve(databaseArgument);
const screenshotPath = resolve(screenshotArgument);
mkdirSync(screenshotPath, { recursive: true });
const token = "deterministic-local-verification-token";
const expectedCount = 50_000;
const expectedInputDigest =
  "e6f133f7b662864fcb70e7766fbe1af493510dc4d467f3261249774942a8580e";
const expectedResultDigest =
  "2fd6322791df94a0ea876bd596f7c5d6bb10ef93aa9d86eb21702382b5e457fc";
const restartCheckpoint = 9_999;

const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA cache_size=-2048;
  CREATE TABLE sessions (
    session_key TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    import_digest TEXT NOT NULL,
    expected_count INTEGER NOT NULL,
    checkpoint_ordinal INTEGER NOT NULL DEFAULT -1,
    completed_count INTEGER NOT NULL DEFAULT 0,
    saved_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running'
  );
  CREATE TABLE occurrences (
    session_key TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    submitted_url TEXT NOT NULL,
    submitted_title TEXT,
    source_group TEXT,
    outcome TEXT NOT NULL,
    duplicate_reason TEXT,
    error_class TEXT,
    PRIMARY KEY (session_key, ordinal)
  );
  CREATE INDEX occurrence_failures ON occurrences(session_key, outcome, ordinal);
  CREATE TABLE refs (
    id INTEGER PRIMARY KEY,
    source_url TEXT NOT NULL,
    normalized_url TEXT NOT NULL
  );
  CREATE UNIQUE INDEX refs_source ON refs(source_url);
  CREATE INDEX refs_normalized ON refs(normalized_url);
`);

let requestCount = 0;
let maxBatchRecords = 0;
let maxRequestBytes = 0;
let maxResponseBytes = 0;
if (global.gc) global.gc();
const backendBaselineHeapBytes = process.memoryUsage().heapUsed;
let backendPeakHeapBytes = backendBaselineHeapBytes;
let backendRetainedHeapBytes = backendBaselineHeapBytes;
let milestoneResolve;
const milestone = new Promise((resolvePromise) => {
  milestoneResolve = resolvePromise;
});
let completedResolve;
const completed = new Promise((resolvePromise) => {
  completedResolve = resolvePromise;
});
let failNextResponse = false;

function normalizeUrl(value) {
  const url = new URL(value.trim());
  url.hash = "";
  url.hostname = [
    "m.twitter.com",
    "mobile.twitter.com",
    "twitter.com",
    "www.twitter.com",
    "www.x.com",
    "x.com",
  ].includes(url.hostname.toLowerCase())
    ? "x.com"
    : url.hostname.toLowerCase();
  const globalTracking = new Set([
    "dclid",
    "fbclid",
    "gclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "msclkid",
  ]);
  const xTracking = new Set(["ref_src", "ref_url", "s", "t"]);
  for (const name of [...url.searchParams.keys()]) {
    const lower = name.toLowerCase();
    if (
      lower.startsWith("utm_") ||
      globalTracking.has(lower) ||
      (url.hostname === "x.com" && xTracking.has(lower))
    ) {
      url.searchParams.delete(name);
    }
  }
  const sorted = [...url.searchParams.entries()].sort(
    ([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv),
  );
  url.search = "";
  for (const [key, valuePart] of sorted)
    url.searchParams.append(key, valuePart);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function rowSession(key) {
  const row = db
    .prepare("SELECT * FROM sessions WHERE session_key = ?")
    .get(key);
  if (!row) return undefined;
  return {
    sessionKey: row.session_key,
    source: row.source,
    parserVersion: row.parser_version,
    importDigest: row.import_digest,
    expectedCount: row.expected_count,
    checkpointOrdinal: row.checkpoint_ordinal,
    completedCount: row.completed_count,
    savedCount: row.saved_count,
    duplicateCount: row.duplicate_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    status: row.status,
    reviewState: "unreviewed",
  };
}

function formatReceipt(row, replayed) {
  return {
    ordinal: row.ordinal,
    outcome: row.outcome,
    ...(row.duplicate_reason ? { duplicateReason: row.duplicate_reason } : {}),
    ...(row.error_class ? { errorClass: row.error_class } : {}),
    replayed,
  };
}

function submit(body) {
  db.exec("BEGIN IMMEDIATE");
  try {
    let session = rowSession(body.sessionKey);
    if (!session) {
      db.prepare(
        `INSERT INTO sessions(session_key, source, parser_version, import_digest, expected_count)
      VALUES (?, ?, ?, ?, ?)`,
      ).run(
        body.sessionKey,
        body.source,
        body.parserVersion,
        body.importDigest,
        body.expectedCount,
      );
      session = rowSession(body.sessionKey);
    }
    if (
      session.source !== body.source ||
      session.parserVersion !== body.parserVersion ||
      session.importDigest !== body.importDigest ||
      session.expectedCount !== body.expectedCount
    )
      throw new Error(
        "Import session identity does not match its saved receipt.",
      );

    const newRecords = [];
    const receipts = [];
    let saved = 0;
    let duplicate = 0;
    let skipped = 0;
    let failed = 0;
    for (const record of body.records) {
      const replay = db
        .prepare(
          "SELECT * FROM occurrences WHERE session_key = ? AND ordinal = ?",
        )
        .get(body.sessionKey, record.ordinal);
      if (replay) {
        if (
          replay.submitted_url !== record.submittedUrl ||
          (replay.submitted_title ?? null) !==
            (record.submittedTitle ?? null) ||
          (replay.source_group ?? null) !== (record.sourceGroup ?? null)
        )
          throw new Error(
            `Import ordinal ${record.ordinal} conflicts with its saved source record.`,
          );
        receipts.push(formatReceipt(replay, true));
        continue;
      }
      newRecords.push(record);
    }
    if (newRecords.length) {
      if (newRecords[0].ordinal !== session.checkpointOrdinal + 1) {
        throw new Error(
          "New import records must begin at the next checkpoint ordinal.",
        );
      }
      for (let index = 1; index < newRecords.length; index += 1) {
        if (newRecords[index].ordinal !== newRecords[index - 1].ordinal + 1) {
          throw new Error("New import records must be contiguous.");
        }
      }
    }

    for (const record of newRecords) {
      let outcome;
      let duplicateReason;
      let errorClass;
      const clean = record.submittedUrl.trim();
      if ((record.ordinal + 1) % 9_973 === 0) {
        outcome = "failed";
        errorClass = "injected_verification_fault";
        failed += 1;
      } else {
        const normalized = normalizeUrl(clean);
        const exact = db
          .prepare("SELECT id FROM refs WHERE source_url = ?")
          .get(clean);
        const normalizedMatch = exact
          ? undefined
          : db
              .prepare("SELECT id FROM refs WHERE normalized_url = ? LIMIT 1")
              .get(normalized);
        const canonicalInjected =
          !exact && !normalizedMatch && record.ordinal % 211 === 0;
        if (exact || normalizedMatch || canonicalInjected) {
          outcome = "duplicate";
          duplicateReason = exact
            ? "source_url"
            : normalizedMatch
              ? "normalized_url"
              : "canonical_url";
          duplicate += 1;
        } else {
          outcome = "saved";
          db.prepare(
            "INSERT INTO refs(source_url, normalized_url) VALUES (?, ?)",
          ).run(clean, normalized);
          saved += 1;
        }
      }
      db.prepare(
        `INSERT INTO occurrences(
      session_key, ordinal, submitted_url, submitted_title, source_group,
      outcome, duplicate_reason, error_class
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        body.sessionKey,
        record.ordinal,
        record.submittedUrl,
        record.submittedTitle ?? null,
        record.sourceGroup ?? null,
        outcome,
        duplicateReason ?? null,
        errorClass ?? null,
      );
      receipts.push({
        ordinal: record.ordinal,
        outcome,
        ...(duplicateReason ? { duplicateReason } : {}),
        ...(errorClass ? { errorClass } : {}),
        replayed: false,
      });
    }

    const checkpointOrdinal = newRecords.length
      ? newRecords.at(-1).ordinal
      : session.checkpointOrdinal;
    const completedCount =
      session.completedCount + saved + duplicate + skipped + failed;
    const status =
      checkpointOrdinal + 1 >= session.expectedCount ? "completed" : "running";
    db.prepare(
      `UPDATE sessions SET
    checkpoint_ordinal = ?, completed_count = ?, saved_count = saved_count + ?,
    duplicate_count = duplicate_count + ?, skipped_count = skipped_count + ?,
    failed_count = failed_count + ?, status = ? WHERE session_key = ?`,
    ).run(
      checkpointOrdinal,
      completedCount,
      saved,
      duplicate,
      skipped,
      failed,
      status,
      body.sessionKey,
    );
    const failedEvidence = body.records.length
      ? undefined
      : db
          .prepare(
            `SELECT ordinal, error_class AS errorClass
        FROM occurrences WHERE session_key = ? AND outcome = 'failed'
        ORDER BY ordinal LIMIT 100`,
          )
          .all(body.sessionKey);
    const result = {
      session: rowSession(body.sessionKey),
      ...(failedEvidence ? { failedEvidence } : {}),
      receipts,
      replayedCount: receipts.filter((item) => item.replayed).length,
      batchReceipt: {
        saved,
        duplicate,
        skipped,
        failed,
        replayed: receipts.filter((item) => item.replayed).length,
        failedOrdinals: receipts
          .filter((item) => item.outcome === "failed")
          .map((item) => item.ordinal),
      },
    };
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const server = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,content-type",
  );
  response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    try {
      if (request.method !== "POST" || request.url !== "/imports/batch")
        throw new Error("not found");
      if (request.headers.authorization !== `Bearer ${token}`)
        throw new Error("unauthorized");
      const raw = Buffer.concat(chunks);
      maxRequestBytes = Math.max(maxRequestBytes, raw.length);
      const body = JSON.parse(raw.toString("utf8"));
      if (!Array.isArray(body.records) || body.records.length > 50)
        throw new Error("batch exceeds 50 records");
      maxBatchRecords = Math.max(maxBatchRecords, body.records.length);
      if (failNextResponse) {
        failNextResponse = false;
        requestCount += 1;
        const payload = Buffer.from(
          JSON.stringify({
            ok: false,
            error:
              "Injected transient verification failure. Progress is preserved.",
          }),
        );
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(payload);
        return;
      }
      const result = submit(body);
      requestCount += 1;
      backendPeakHeapBytes = Math.max(
        backendPeakHeapBytes,
        process.memoryUsage().heapUsed,
      );
      if (requestCount % 100 === 0 && global.gc) {
        global.gc();
        backendRetainedHeapBytes = Math.max(
          backendRetainedHeapBytes,
          process.memoryUsage().heapUsed,
        );
      }
      if (result.session.checkpointOrdinal >= restartCheckpoint)
        milestoneResolve(result.session);
      if (result.session.status === "completed")
        completedResolve(result.session);
      const payload = Buffer.from(JSON.stringify({ ok: true, ...result }));
      maxResponseBytes = Math.max(maxResponseBytes, payload.length);
      response.writeHead(200, { "Content-Type": "application/json" });
      const responseDelay =
        result.session.checkpointOrdinal === restartCheckpoint ? 750 : 1;
      setTimeout(() => response.end(payload), responseDelay);
    } catch (error) {
      const payload = Buffer.from(
        JSON.stringify({ ok: false, error: error.message }),
      );
      response.writeHead(error.message === "not found" ? 404 : 400, {
        "Content-Type": "application/json",
      });
      response.end(payload);
    }
  });
});

await new Promise((resolvePromise) =>
  server.listen(0, "127.0.0.1", resolvePromise),
);
const { port } = server.address();
const endpoint = `http://127.0.0.1:${port}`;
let browserPeakHeapBytes = 0;
let browserBaselineHeapBytes;
const browserErrors = [];

async function launch() {
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto(`chrome-extension://${extensionId}/import.html`);
  await page.locator("h1").waitFor();
  const cdp = await context.newCDPSession(page);
  const initialUsage = await cdp.send("Runtime.getHeapUsage");
  browserBaselineHeapBytes =
    browserBaselineHeapBytes === undefined
      ? initialUsage.usedSize
      : Math.min(browserBaselineHeapBytes, initialUsage.usedSize);
  browserPeakHeapBytes = Math.max(browserPeakHeapBytes, initialUsage.usedSize);
  let stopped = false;
  const sampler = setInterval(async () => {
    if (stopped) return;
    try {
      const usage = await cdp.send("Runtime.getHeapUsage");
      browserPeakHeapBytes = Math.max(browserPeakHeapBytes, usage.usedSize);
    } catch {}
  }, 40);
  return {
    context,
    page,
    extensionId,
    stopSampling() {
      stopped = true;
      clearInterval(sampler);
    },
  };
}

async function storageState(page) {
  return await page.evaluate(async () => {
    const values = await chrome.storage.local.get("streamImportV1");
    return values.streamImportV1;
  });
}

async function configure(page) {
  await page.evaluate(
    async ({ endpointValue, tokenValue }) => {
      await chrome.storage.local.set({
        ourchivalSettings: {
          captureEndpoint: endpointValue,
          deviceToken: tokenValue,
          deviceName: "deterministic MV3 verifier",
        },
      });
    },
    { endpointValue: endpoint, tokenValue: token },
  );
}

async function selectReady(page, readyScreenshot) {
  const source = page.locator("#source");
  if (await source.isEnabled()) {
    await source.selectOption("onetab");
  } else if ((await source.inputValue()) !== "onetab") {
    throw new Error("locked source format does not match the selected corpus");
  }
  await page.locator("#file").setInputFiles(corpusPath);
  await page.locator("#start").waitFor({ state: "visible", timeout: 30_000 });
  if (readyScreenshot)
    await page.screenshot({ path: readyScreenshot, fullPage: true });
}

async function selectAndStart(page, readyScreenshot) {
  await selectReady(page, readyScreenshot);
  await page.locator("#start").click();
}

async function assertSourceChangeSafe(page) {
  await page.locator("#source").selectOption("url_list");
  await page.waitForFunction(
    async () => {
      const start = document.querySelector("#start");
      if (!start) return true;
      const values = await chrome.storage.local.get("streamImportV1");
      const visibleSource = document.querySelector("#source")?.value;
      return values.streamImportV1?.source === visibleSource;
    },
    undefined,
    { timeout: 30_000 },
  );
  const state = await storageState(page);
  const startVisible = await page
    .locator("#start")
    .isVisible()
    .catch(() => false);
  if (startVisible && state?.source !== "url_list") {
    throw new Error(
      "visible source format differs from runnable session source",
    );
  }
}

async function waitForLocalStatus(page, status, timeout = 120_000) {
  await page.waitForFunction(
    async (wanted) => {
      const values = await chrome.storage.local.get("streamImportV1");
      return values.streamImportV1?.status === wanted;
    },
    status,
    { timeout },
  );
}

async function waitUntil(predicate, label, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`${label} timeout`);
}

let first = await launch();
await first.page.screenshot({
  path: `${screenshotPath}/01-setup.png`,
  fullPage: true,
});
await configure(first.page);
await selectReady(first.page, `${screenshotPath}/02-ready.png`);
await assertSourceChangeSafe(first.page);
await selectAndStart(first.page);
const milestoneSession = await Promise.race([
  milestone,
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("restart milestone timeout")), 120_000),
  ),
]);
await first.page.screenshot({
  path: `${screenshotPath}/03-active.png`,
  fullPage: true,
});
first.stopSampling();
await first.context.close();

let resumed = await launch();
const stateAfterRestart = await storageState(resumed.page);
if (await resumed.page.locator("#source").isEnabled()) {
  throw new Error("resumable checkpoint did not lock the source format");
}
if (!(await resumed.page.locator("#file").isEnabled())) {
  throw new Error("interrupted import did not allow same-file reselection");
}
failNextResponse = true;
await selectAndStart(resumed.page);
await waitForLocalStatus(resumed.page, "error");
await resumed.page
  .locator("#start")
  .waitFor({ state: "visible", timeout: 30_000 });
const retryLabel = (await resumed.page.locator("#start").innerText()).trim();
await resumed.page.screenshot({
  path: `${screenshotPath}/04-error-retry.png`,
  fullPage: true,
});
await resumed.page.locator("#start").click();
const completedSession = await Promise.race([
  completed,
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("completion timeout")), 180_000),
  ),
]);
await waitForLocalStatus(resumed.page, "completed");
await resumed.page.waitForFunction(
  async ({ checkpointOrdinal, failedCount }) => {
    const values = await chrome.storage.local.get("streamImportV1");
    const state = values.streamImportV1;
    return (
      state?.status === "completed" &&
      state.checkpointOrdinal === checkpointOrdinal &&
      state.failedCount === failedCount
    );
  },
  { checkpointOrdinal: 49_999, failedCount: 5 },
  { timeout: 30_000 },
);
const completedState = await storageState(resumed.page);
const completedBody = await resumed.page.locator("body").innerText();
await resumed.page.screenshot({
  path: `${screenshotPath}/05-success.png`,
  fullPage: true,
});
resumed.stopSampling();
await resumed.context.close();

let replay = await launch();
const replayRequestStart = requestCount;
await selectAndStart(replay.page);
await waitUntil(
  () => requestCount > replayRequestStart,
  "completed client replay",
);
await waitForLocalStatus(replay.page, "completed");
const replayedState = await storageState(replay.page);
replay.stopSampling();
await replay.context.close();

const firstRecords = readFileSync(corpusPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .slice(0, 50)
  .map((line, ordinal) => {
    const separator = line.indexOf(" | ");
    return {
      ordinal,
      submittedUrl: line.slice(0, separator),
      submittedTitle: line.slice(separator + 3),
    };
  });
const countersBeforeReplay = rowSession(completedSession.sessionKey);
const replayResponse = await fetch(`${endpoint}/imports/batch`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    sessionKey: completedSession.sessionKey,
    source: completedSession.source,
    parserVersion: completedSession.parserVersion,
    importDigest: completedSession.importDigest,
    expectedCount: completedSession.expectedCount,
    records: firstRecords,
  }),
}).then((response) => response.json());
const countersAfterReplay = rowSession(completedSession.sessionKey);

const resultHasher = createHash("sha256");
for (const row of db
  .prepare(
    `SELECT ordinal, submitted_url, submitted_title, source_group,
  outcome, duplicate_reason, error_class FROM occurrences ORDER BY ordinal`,
  )
  .iterate()) {
  for (const field of [
    row.ordinal,
    row.submitted_url,
    row.submitted_title ?? "",
    row.source_group ?? "",
    row.outcome,
    row.duplicate_reason ?? "",
    row.error_class ?? "",
  ]) {
    const bytes = Buffer.from(String(field));
    resultHasher.update(`${bytes.length}:`);
    resultHasher.update(bytes);
    resultHasher.update(Buffer.from([0]));
  }
}
const resultDigest = resultHasher.digest("hex");
const outcomeCounts = Object.fromEntries(
  db
    .prepare(
      "SELECT outcome, count(*) AS count FROM occurrences GROUP BY outcome",
    )
    .all()
    .map((row) => [row.outcome, row.count]),
);
const duplicateCounts = Object.fromEntries(
  db
    .prepare(
      "SELECT duplicate_reason, count(*) AS count FROM occurrences WHERE duplicate_reason IS NOT NULL GROUP BY duplicate_reason",
    )
    .all()
    .map((row) => [row.duplicate_reason, row.count]),
);
const failed = db
  .prepare(
    "SELECT ordinal, error_class FROM occurrences WHERE outcome = 'failed' ORDER BY ordinal",
  )
  .all();
if (global.gc) {
  global.gc();
  backendRetainedHeapBytes = Math.max(
    backendRetainedHeapBytes,
    process.memoryUsage().heapUsed,
  );
}

const persistedStateBytes = Buffer.byteLength(JSON.stringify(completedState));
const expectedTransientBrowserErrors = browserErrors.filter((message) =>
  /status of 503/i.test(message),
);
const unexpectedBrowserErrors = browserErrors.filter(
  (message) => !/status of 503/i.test(message),
);
function clientCounterProjection(state) {
  return {
    sessionKey: state.sessionKey,
    checkpointOrdinal: state.checkpointOrdinal,
    savedCount: state.savedCount,
    duplicateCount: state.duplicateCount,
    skippedCount: state.skippedCount,
    failedCount: state.failedCount,
    failedOrdinals: state.failedOrdinals,
    failedEvidence: state.failedEvidence,
    status: state.status,
  };
}
const receipt = {
  schema: "ourchival-mv3-import-verification/v1",
  adapter:
    "SQLite catalog with deterministic canonical-collision and per-item-fault injection; not Convex",
  extensionId: first.extensionId,
  serviceWorkerRestarted:
    first.extensionId === resumed.extensionId &&
    resumed.extensionId === replay.extensionId,
  recordCount: db.prepare("SELECT count(*) AS count FROM occurrences").get()
    .count,
  inputDigest: completedSession.importDigest,
  resultDigest,
  restart: {
    serverCheckpoint: milestoneSession.checkpointOrdinal,
    localCheckpointAfterBrowserRestart: stateAfterRestart?.checkpointOrdinal,
    sourceReselected: true,
    retryLabel,
  },
  completed: completedSession,
  outcomeCounts,
  duplicateCounts,
  failed,
  browser: {
    baselineJsHeapBytes: browserBaselineHeapBytes,
    peakJsHeapBytes: browserPeakHeapBytes,
    peakJsHeapDeltaBytes: browserPeakHeapBytes - browserBaselineHeapBytes,
    persistedStateBytes,
    visibleCounts:
      completedBody.match(/\d[\d,]*\s*(?:saved|existing|skipped|failed)/g) ??
      [],
    expectedTransientErrors: expectedTransientBrowserErrors,
    errors: unexpectedBrowserErrors,
    screenshots: [
      `${screenshotPath}/01-setup.png`,
      `${screenshotPath}/02-ready.png`,
      `${screenshotPath}/03-active.png`,
      `${screenshotPath}/04-error-retry.png`,
      `${screenshotPath}/05-success.png`,
    ],
  },
  backend: {
    requestCount,
    maxBatchRecords,
    maxRequestBytes,
    maxResponseBytes,
    baselineJsHeapBytes: backendBaselineHeapBytes,
    peakJsHeapBytes: backendPeakHeapBytes,
    peakJsHeapDeltaBytes: backendPeakHeapBytes - backendBaselineHeapBytes,
    retainedJsHeapHighWaterBytes: backendRetainedHeapBytes,
    retainedJsHeapDeltaBytes:
      backendRetainedHeapBytes - backendBaselineHeapBytes,
    sqliteBytes: readFileSync(databasePath).byteLength,
  },
  replays: {
    completedClientCountersStable:
      JSON.stringify(clientCounterProjection(completedState)) ===
      JSON.stringify(clientCounterProjection(replayedState)),
    acknowledgedBatchReplayed: replayResponse.replayedCount,
    countersStable:
      JSON.stringify(countersBeforeReplay) ===
      JSON.stringify(countersAfterReplay),
  },
};

const expectedOutcomes = { saved: 49_164, duplicate: 831, failed: 5 };
if (receipt.recordCount !== expectedCount)
  throw new Error(`expected ${expectedCount} occurrences`);
if (receipt.inputDigest !== expectedInputDigest)
  throw new Error(`input digest drifted: ${receipt.inputDigest}`);
if (receipt.resultDigest !== expectedResultDigest)
  throw new Error(`result digest drifted: ${receipt.resultDigest}`);
for (const [outcome, count] of Object.entries(expectedOutcomes)) {
  if (outcomeCounts[outcome] !== count)
    throw new Error(`${outcome} count ${outcomeCounts[outcome]} != ${count}`);
}
if (
  duplicateCounts.source_url !== 497 ||
  duplicateCounts.normalized_url !== 100 ||
  duplicateCounts.canonical_url !== 234
) {
  throw new Error(
    `duplicate classes drifted: ${JSON.stringify(duplicateCounts)}`,
  );
}
if (
  completedState.checkpointOrdinal !== 49_999 ||
  completedState.failedCount !== 5
) {
  throw new Error(
    `client completion state drifted: ${JSON.stringify(clientCounterProjection(completedState))}`,
  );
}
const completedFailedEvidence = completedState.failedEvidence?.map(
  ({ ordinal, errorClass }) => ({ ordinal, errorClass }),
);
if (
  JSON.stringify(completedFailedEvidence) !==
  JSON.stringify(
    failed.map(({ ordinal, error_class: errorClass }) => ({
      ordinal,
      errorClass,
    })),
  )
) {
  throw new Error(
    `bounded client failure evidence drifted: client=${JSON.stringify(completedState.failedEvidence)} server=${JSON.stringify(failed)}`,
  );
}
if (
  !(stateAfterRestart.checkpointOrdinal < milestoneSession.checkpointOrdinal)
) {
  throw new Error(
    "restart did not exercise a server-ahead-of-client checkpoint",
  );
}
if (persistedStateBytes > 2_048)
  throw new Error(`persisted state grew to ${persistedStateBytes}`);
if (maxBatchRecords > 50) throw new Error(`batch grew to ${maxBatchRecords}`);
if (!/retry/i.test(retryLabel))
  throw new Error(`error action is not an explicit retry: ${retryLabel}`);
if (browserPeakHeapBytes > 96 * 1024 * 1024)
  throw new Error(`browser heap grew to ${browserPeakHeapBytes}`);
if (backendRetainedHeapBytes - backendBaselineHeapBytes > 32 * 1024 * 1024) {
  throw new Error(
    `retained verifier heap delta grew to ${backendRetainedHeapBytes - backendBaselineHeapBytes}`,
  );
}
if (
  expectedTransientBrowserErrors.length !== 1 ||
  unexpectedBrowserErrors.length
) {
  throw new Error(`browser errors drifted: ${JSON.stringify(browserErrors)}`);
}
if (!receipt.serviceWorkerRestarted)
  throw new Error("extension identity changed across restart");
if (
  !receipt.replays.completedClientCountersStable ||
  !receipt.replays.countersStable ||
  receipt.replays.acknowledgedBatchReplayed !== 50
) {
  console.error(
    JSON.stringify({
      replays: receipt.replays,
      completed: clientCounterProjection(completedState),
      replayed: clientCounterProjection(replayedState),
    }),
  );
  throw new Error("replay invariants failed");
}

console.log(JSON.stringify(receipt, null, 2));
await new Promise((resolvePromise, reject) => {
  server.close((error) => (error ? reject(error) : resolvePromise()));
});
db.close();
process.exit(0);
