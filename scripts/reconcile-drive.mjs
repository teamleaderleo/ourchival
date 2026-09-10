#!/usr/bin/env node
// Read actual Drive locations and repair catalog pointers. Never move or download files.
import { readFile, writeFile, rename, mkdir, open, unlink } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";

const directory = new URL("../.convex/reconciliation/drive-organization/", import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
const path = new URL("reconcile.json", directory);
const lockPath = new URL("run.lock", directory);
const lock = await open(lockPath, "wx", 0o600);
const accessKey = (await readFile(new URL("../.convex/local-owner-key", import.meta.url), "utf8")).trim();
const client = new ConvexHttpClient("http://127.0.0.1:3210", { logger: false });
async function save(state) {
  const temp = new URL("reconcile.tmp", directory);
  await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
  await rename(temp, path);
}
try {
  let state;
  try { state = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!state || process.argv.includes("--fresh")) {
    state = { startedAt: new Date().toISOString(), cursor: null, inventoried: false,
      files: {}, offset: 0, changed: [], unchanged: 0, unresolved: [], done: false };
  }
  while (!state.inventoried) {
    const page = await client.query("driveOrganization:rootPointers", {
      accessKey, all: true, paginationOpts: { cursor: state.cursor, numItems: 500 },
    });
    for (const file of page.items) {
      const prior = state.files[file.fileId];
      // A null expected parent forces all duplicate rows to be repaired if they disagree.
      state.files[file.fileId] = { id: file.fileId,
        parent: prior && prior.parent !== file.parent ? null : file.parent };
    }
    state.cursor = page.cursor;
    state.inventoried = page.done;
    await save(state);
  }
  const files = Object.values(state.files);
  while (state.offset < files.length) {
    const batch = files.slice(state.offset, state.offset + 100);
    const result = await client.action("driveOrganization:reconcilePointers", { accessKey, files: batch });
    state.changed.push(...result.changed);
    state.unchanged += result.unchanged;
    state.unresolved.push(...result.unresolved.map(id => ({ id, statuses: result.statuses })));
    state.offset += batch.length;
    state.updatedAt = new Date().toISOString();
    await save(state);
    console.log(JSON.stringify({ checked: state.offset, total: files.length,
      changed: state.changed.length, unresolved: state.unresolved.length }));
  }
  state.done = true;
  await save(state);
  console.log(JSON.stringify({ done: true, checked: files.length, changed: state.changed.length,
    unchanged: state.unchanged, unresolved: state.unresolved.length }));
} catch (error) {
  console.error(String(error).replaceAll(accessKey, "[redacted]"));
  process.exitCode = 1;
} finally {
  await lock.close();
  await unlink(lockPath);
}
