import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageLimit, scanBatch, summarize } from './missing-works.mjs';
test('report distinguishes placeholder identity from saved evidence without asserting deletion', () => {
  const report = summarize({ scanned: 48, done: false, items: {
    a: { platform: 'pixiv', title: '-----', artist: '—', expectedPages: null, durablePages: 0 },
    b: { platform: 'pixiv', title: 'Untitled', durablePages: 1, expectedPages: 2,
      detail: { snapshots: [{ title: 'Earlier title' }], checks: [{ outcome: 'lead' }] } }
  } });
  assert.equal(report.sourceIdOnly, 1);
  assert.equal(report.identityAvailable, 1);
  assert.equal(report.partialImages, 1);
  assert.equal(report.unknownPageCount, 1);
  assert.equal(report.previouslyResearched, 1);
  assert.equal(report.inventoryComplete, false);
});
test('scan is bounded and resumes only after completed evidence pages', async () => {
  const initial = { cursor: null, done: false, scanned: 0, items: {} };
  let saved;
  const query = async (name, args) => name === 'detail' ? { title: 'saved title' } :
    { items: [{ id: 'a' }], cursor: 'next', done: false, scanned: 48 };
  const state = await scanBatch(initial, 1, query, async s => { saved = s; });
  assert.equal(saved.cursor, 'next');
  assert.equal(state.scanned, 48);
  assert.equal(state.items.a.detail.title, 'saved title');
  await assert.rejects(scanBatch(state, 1, async name => {
    if (name === 'detail') throw new Error('temporary failure');
    return { items: [{ id: 'b' }], cursor: 'bad', scanned: 48 };
  }, async () => assert.fail('must not checkpoint failed details')));
  assert.equal(state.cursor, 'next');
  assert.equal(state.items.b, undefined);
});
test('page limit rejects unbounded or malformed input', () => {
  assert.equal(pageLimit(), 10);
  for (const value of ['0', '101', '-1', '1.5', '2junk']) assert.throws(() => pageLimit(value));
});
