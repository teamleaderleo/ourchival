#!/usr/bin/env node
// Uses the local vault owner key in memory; never accesses browser credentials.
import { readFile, mkdir, writeFile, rename, open, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { archiveAvailability } from './archive-availability.mjs';

const directory = fileURLToPath(new URL('../.convex/reconciliation/missing-works/', import.meta.url));
const statePath = resolve(directory, 'queue.json');
export function summarize(state) {
  const useful = value => typeof value === 'string' &&
    Boolean(value.trim().replace(/[-—_\s]/g, '')) &&
    !/^(untitled|unknown)$/i.test(value.trim());
  const counts = { identityAvailable: 0, sourceIdOnly: 0, partialImages: 0,
    unknownPageCount: 0, previouslyResearched: 0 };
  const platforms = {};
  for (const item of Object.values(state.items)) {
    platforms[item.platform] = (platforms[item.platform] ?? 0) + 1;
    const detail = item.detail ?? {};
    const identity = useful(item.title) || useful(item.artist) ||
      (detail.snapshots ?? []).some(s => useful(s.title) || useful(s.description));
    counts[identity ? 'identityAvailable' : 'sourceIdOnly']++;
    if (item.durablePages > 0) counts.partialImages++;
    if (item.expectedPages == null) counts.unknownPageCount++;
    if (detail.checks?.length) counts.previouslyResearched++;
  }
  return { scanned: state.scanned, candidates: Object.keys(state.items).length,
    inventoryComplete: state.done, updatedAt: state.updatedAt, platforms, ...counts,
    note: 'Snapshot of missing-byte candidates, not confirmed deletions or an original-quality audit. Identity means saved text is available, not verified.' };
}
export function pageLimit(value = '10') {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100)
    throw new Error('Page limit must be an integer from 1 to 100.');
  return Number(value);
}
export async function scanBatch(state, limit, query, save) {
  for (let page = 0; page < limit && !state.done; page++) {
    const result = await query('list', { paginationOpts: { cursor: state.cursor, numItems: 48 } });
    const items = { ...state.items };
    for (const item of result.items) {
      const detail = await query('detail', { referenceId: item.id });
      items[item.id] = { ...item, detail, inspectedAt: new Date().toISOString() };
    }
    const next = { version: 1, cursor: result.cursor, done: result.done,
      scanned: state.scanned + result.scanned, items, updatedAt: new Date().toISOString() };
    // Advance only after all details and the checkpoint are durable. Failed pages replay.
    await save(next);
    state = next;
  }
  return state;
}
async function main() {
  const [command = 'help', argument] = process.argv.slice(2);
  if (!['scan', 'status', 'report', 'detail', 'archive', 'record'].includes(command)) {
    console.log('Usage: node scripts/missing-works.mjs scan [1..100 pages] | status | report | detail REFERENCE_ID | archive REFERENCE_ID | record EVIDENCE_JSON_FILE');
    return;
  }
  const limit = command === 'scan' ? pageLimit(argument) : null;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (command === 'status' || command === 'report') {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    if (command === 'report') {
      console.log(JSON.stringify(summarize(state), null, 2));
      return;
    }
    console.log(JSON.stringify({ scanned: state.scanned, candidates: Object.keys(state.items).length, done: state.done, updatedAt: state.updatedAt }));
    return;
  }
  const accessKey = (await readFile(new URL('../.convex/local-owner-key', import.meta.url), 'utf8')).trim();
  const client = new ConvexHttpClient('http://127.0.0.1:3210');
  const query = (name, args) => client.query(makeFunctionReference(`missingWorks:${name}`), { ...args, accessKey });
  if (command === 'archive') {
    if (!argument) throw new Error('A reference ID is required.');
    const detail = await query('detail', { referenceId: argument });
    const finding = await archiveAvailability(detail.sourceUrl);
    await client.mutation(makeFunctionReference('missingWorks:recordCheck'), { accessKey, referenceId: argument, ...finding });
    console.log(JSON.stringify(finding));
    return;
  }
  if (command === 'detail') {
    if (!argument) throw new Error('A reference ID is required.');
    console.log(JSON.stringify(await query('detail', { referenceId: argument }), null, 2));
    return;
  }
  if (command === 'record') {
    if (!argument) throw new Error('An evidence JSON file is required.');
    const { referenceId, url, outcome, evidence, relationship } = JSON.parse(await readFile(argument, 'utf8'));
    await client.mutation(makeFunctionReference('missingWorks:recordCheck'), { accessKey, referenceId, url, outcome, evidence,
      ...(relationship ? { relationship } : {}) });
    console.log('Research evidence recorded; image recovery status is unchanged.');
    return;
  }
  const lockPath = resolve(directory, 'scan.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    let state;
    try { state = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { version: 1, cursor: null, done: false, scanned: 0, items: {} };
    }
    if (state.version !== 1) throw new Error('Unsupported checkpoint version.');
    state = await scanBatch(state, limit, query, async next => {
      const temporary = `${statePath}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(temporary, statePath);
    });
    console.log(JSON.stringify({ scanned: state.scanned, candidates: Object.keys(state.items).length, done: state.done, checkpoint: statePath }));
  } finally { await lock.close(); await unlink(lockPath); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Client errors may contain arguments: do not echo credentials or payloads.
    console.error('Command failed. Check local vault availability, arguments, and scan.lock. The last completed checkpoint is preserved.');
    process.exitCode = 1;
  });
}
