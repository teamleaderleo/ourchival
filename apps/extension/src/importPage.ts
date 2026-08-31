import {
  digestImport,
  parseImport,
  type ImportRecord,
  type ImportSourceKind,
} from "@ourchival/parsers";
import {
  getSettings,
  getStreamImportState,
  normalizeSiteRoot,
  saveStreamImportState,
  type StreamImportState,
} from "./storage";

const root = document.getElementById("root")!;
let selectedFile: File | undefined;
let selectedSource: ImportSourceKind = "onetab";
let activeState: StreamImportState | undefined;
let pauseRequested = false;

void initialize();

async function initialize() {
  activeState = await getStreamImportState();
  render();
}

function render() {
  const state = activeState;
  root.innerHTML = `
    <header><p class="eyebrow">Ourchival importer</p><h1>Bring a link collection into Inbox</h1><p class="lede">Choose a OneTab export, browser bookmarks file, or newline URL list. Ourchival checkpoints every 50 records, so the same file can continue after a refresh.</p></header>
    <section>
      <label>Source format<select id="source"><option value="onetab" ${selectedSource === "onetab" ? "selected" : ""}>OneTab text</option><option value="bookmarks" ${selectedSource === "bookmarks" ? "selected" : ""}>Browser bookmarks HTML</option><option value="url_list" ${selectedSource === "url_list" ? "selected" : ""}>URL list</option></select></label>
      <label>${state && !selectedFile && state.status !== "completed" ? "Select the same file to continue" : "Choose export file"}<input id="file" type="file" accept=".txt,.html,.htm,text/plain,text/html" /></label>
      ${state ? renderState(state) : '<p class="hint">The file stays in this tab. Local storage keeps only the digest, checkpoint, aggregate counts, and a bounded failure list.</p>'}
      <div class="actions">
        ${selectedFile && state?.status === "ready" ? '<button id="start">Start import</button>' : ""}
        ${selectedFile && state?.status === "paused" ? '<button id="start">Continue import</button>' : ""}
        ${state?.status === "running" ? '<button id="pause" class="secondary">Pause after this batch</button>' : ""}
        ${state?.status === "completed" ? '<button id="another" class="secondary">Import another file</button>' : ""}
      </div>
    </section>`;
  bindEvents();
}

function renderState(state: StreamImportState) {
  const completed = Math.max(0, state.checkpointOrdinal + 1);
  const progress = state.expectedCount
    ? Math.min(100, (completed / state.expectedCount) * 100)
    : 0;
  return `<div><p><strong>${statusHeading(state)}</strong></p><p class="hint">${escapeHtml(state.message ?? `${completed.toLocaleString()} of ${state.expectedCount.toLocaleString()} acknowledged`)}</p></div>
    <progress max="100" value="${progress}"></progress>
    <div class="counts"><div><strong>${state.savedCount}</strong>saved</div><div><strong>${state.duplicateCount}</strong>existing</div><div><strong>${state.skippedCount}</strong>skipped</div><div><strong>${state.failedCount}</strong>failed</div></div>
    ${state.failedOrdinals.length ? `<p class="hint">Failed ordinals: ${state.failedOrdinals.join(", ")}${state.failedCount > state.failedOrdinals.length ? " …" : ""}</p>` : ""}`;
}

function bindEvents() {
  document.getElementById("source")?.addEventListener("change", (event) => {
    selectedSource = (event.currentTarget as HTMLSelectElement)
      .value as ImportSourceKind;
  });
  document.getElementById("file")?.addEventListener("change", (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void inspectFile(file);
  });
  document.getElementById("start")?.addEventListener("click", () => {
    if (selectedFile && activeState) void runImport(selectedFile, activeState);
  });
  document.getElementById("pause")?.addEventListener("click", () => {
    pauseRequested = true;
  });
  document.getElementById("another")?.addEventListener("click", () => {
    selectedFile = undefined;
    activeState = undefined;
    render();
  });
}

async function inspectFile(file: File) {
  selectedFile = file;
  activeState = undefined;
  root
    .querySelector("section")
    ?.insertAdjacentHTML(
      "beforeend",
      '<p class="hint">Reading and identifying the source…</p>',
    );
  try {
    const identity = await digestImport(
      selectedSource,
      parseImport(selectedSource, fileChunks(file)),
    );
    if (identity.count === 0)
      throw new Error("This file contains no HTTP or HTTPS links.");
    const sessionKey = `${selectedSource}:${identity.parserVersion}:${identity.digest}`;
    const previous = await getStreamImportState();
    if (
      previous &&
      previous.sessionKey !== sessionKey &&
      previous.status !== "completed"
    ) {
      throw new Error(
        `This differs from the pending ${previous.filenameHint} import. Choose that source to continue it.`,
      );
    }
    activeState = {
      version: 1,
      sessionKey,
      source: selectedSource,
      parserVersion: identity.parserVersion,
      importDigest: identity.digest,
      filenameHint: file.name,
      expectedCount: identity.count,
      checkpointOrdinal:
        previous?.sessionKey === sessionKey ? previous.checkpointOrdinal : -1,
      savedCount: previous?.sessionKey === sessionKey ? previous.savedCount : 0,
      duplicateCount:
        previous?.sessionKey === sessionKey ? previous.duplicateCount : 0,
      skippedCount:
        previous?.sessionKey === sessionKey ? previous.skippedCount : 0,
      failedCount:
        previous?.sessionKey === sessionKey ? previous.failedCount : 0,
      failedOrdinals:
        previous?.sessionKey === sessionKey ? previous.failedOrdinals : [],
      status: "ready",
      updatedAt: new Date().toISOString(),
      message:
        previous?.sessionKey === sessionKey
          ? "Source identity matched. Start to reconcile the saved server checkpoint."
          : `${identity.count.toLocaleString()} records ready to import.`,
    };
    await saveStreamImportState(activeState);
  } catch (error) {
    activeState = errorState(error);
  }
  render();
}

async function runImport(file: File, state: StreamImportState) {
  pauseRequested = false;
  state.status = "running";
  state.message = "Reconciling the durable checkpoint…";
  await checkpoint(state);
  render();
  try {
    const preflight = await submitBatch(state, []);
    applyServerSession(state, preflight.session);
    await checkpoint(state);
    render();
    let batch: ImportRecord[] = [];
    for await (const record of parseImport(state.source, fileChunks(file))) {
      if (record.ordinal <= state.checkpointOrdinal) continue;
      batch.push(record);
      if (batch.length < 50) continue;
      await sendAndCheckpoint(state, batch);
      batch = [];
      if (pauseRequested) break;
    }
    if (!pauseRequested && batch.length) await sendAndCheckpoint(state, batch);
    state.status = pauseRequested ? "paused" : "completed";
    state.message = pauseRequested
      ? "Progress is preserved. Continue while this file remains selected."
      : "Import complete. The session is ready for review in Ourchival.";
  } catch (error) {
    state.status = "error";
    state.message =
      error instanceof Error
        ? error.message
        : "Import failed. Progress is preserved.";
  }
  await checkpoint(state);
  render();
}

async function sendAndCheckpoint(
  state: StreamImportState,
  records: ImportRecord[],
) {
  const response = await submitBatch(state, records);
  applyServerSession(state, response.session);
  for (const receipt of response.receipts ?? []) {
    if (
      receipt.outcome === "failed" &&
      state.failedOrdinals.length < 100 &&
      !state.failedOrdinals.includes(receipt.ordinal)
    )
      state.failedOrdinals.push(receipt.ordinal);
  }
  state.message = `${state.checkpointOrdinal + 1} of ${state.expectedCount} acknowledged`;
  await checkpoint(state);
  render();
}

async function submitBatch(state: StreamImportState, records: ImportRecord[]) {
  const settings = await getSettings();
  const siteRoot = normalizeSiteRoot(settings.captureEndpoint);
  if (!siteRoot || !settings.deviceToken)
    throw new Error("Connect this Clipper from the popup, then retry.");
  const response = await fetch(`${siteRoot}/imports/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.deviceToken}`,
    },
    body: JSON.stringify({
      sessionKey: state.sessionKey,
      source: state.source,
      parserVersion: state.parserVersion,
      importDigest: state.importDigest,
      expectedCount: state.expectedCount,
      records,
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.ok)
    throw new Error(
      body.error || `Import failed with status ${response.status}.`,
    );
  return body;
}

function applyServerSession(state: StreamImportState, session: any) {
  state.checkpointOrdinal = session.checkpointOrdinal ?? -1;
  state.savedCount = session.savedCount;
  state.duplicateCount = session.duplicateCount;
  state.skippedCount = session.skippedCount;
  state.failedCount = session.failedCount;
}

async function checkpoint(state: StreamImportState) {
  state.updatedAt = new Date().toISOString();
  await saveStreamImportState({
    ...state,
    failedOrdinals: state.failedOrdinals.slice(0, 100),
  });
}

async function* fileChunks(file: File): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function errorState(error: unknown): StreamImportState {
  const now = new Date().toISOString();
  return {
    version: 1,
    sessionKey: "",
    source: selectedSource,
    parserVersion: "",
    importDigest: "",
    filenameHint: selectedFile?.name ?? "selected file",
    expectedCount: 0,
    checkpointOrdinal: -1,
    savedCount: 0,
    duplicateCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failedOrdinals: [],
    status: "error",
    updatedAt: now,
    message:
      error instanceof Error ? error.message : "Could not read that file.",
  };
}

function statusHeading(state: StreamImportState) {
  if (state.status === "ready")
    return state.checkpointOrdinal >= 0
      ? "Ready to continue"
      : "Ready to import";
  if (state.status === "running") return "Importing links";
  if (state.status === "paused") return "Import paused";
  if (state.status === "completed") return "Import complete";
  return "Import needs attention";
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}
