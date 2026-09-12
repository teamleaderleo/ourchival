#!/usr/bin/env node
// Local vault only. Never prints the owner/admin credentials or catalog content.
import { readFile } from 'node:fs/promises';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
const client = new ConvexHttpClient('http://127.0.0.1:3210');
const config = JSON.parse(await readFile(new URL('../.convex/local/default/config.json', import.meta.url), 'utf8'));
client.setAdminAuth(config.adminKey);
const command = process.argv[2] ?? 'status';
if (command === 'inventory') {
  let cursor = null, done = false;
  const counts = {};
  while (!done) {
    const page = await client.query(makeFunctionReference('previewMigration:inventory'), { paginationOpts: { cursor, numItems: 500 } });
    for (const [key, value] of Object.entries(page.counts)) counts[key] = (counts[key] ?? 0) + value;
    cursor = page.cursor; done = page.done;
  }
  console.log(JSON.stringify(counts));
} else if (['start', 'pause'].includes(command)) {
  const result = await client.mutation(makeFunctionReference(`previewMigration:${command}`), {});
  console.log(JSON.stringify(result ? { status: result.status } : { status: command }));
} else if (command === 'status') {
  const state = await client.query(makeFunctionReference('previewMigration:status'), {});
  if (!state) console.log(JSON.stringify({ status: 'not-started' }));
  else {
    const { status, scanned, upgraded, alreadyCurrent, skipped, failed, reclaimedBytes, startedAt, updatedAt, message } = state;
    console.log(JSON.stringify({ status, scanned, upgraded, alreadyCurrent, skipped, failed, reclaimedBytes, startedAt, updatedAt, message, pending: state.pending.length, sampleErrors: state.failures.map(f => f.reason).slice(0, 3) }));
  }
} else throw new Error('Use inventory, status, start, or pause.');
