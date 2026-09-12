import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveAvailability } from './archive-availability.mjs';
test('archive API errors never become negative findings', async () => {
  await assert.rejects(archiveAvailability('https://example.com/art', async () => ({ ok: false, status: 429 })));
  await assert.rejects(archiveAvailability('https://example.com/art', async () => ({ ok: true, json: async () => ({}) })));
});
test('snapshot availability creates a lead, not verified image identity', async () => {
  const result = await archiveAvailability('https://example.com/art?token=private', async url => {
    assert.equal(url.searchParams.get('url'), 'https://example.com/art');
    return { ok: true, json: async () => ({ archived_snapshots: { closest: {
      available: true, status: '200', timestamp: '20200101000000', url: 'http://web.archive.org/web/20200101000000/https://example.com/art'
    } } }) };
  });
  assert.equal(result.outcome, 'lead');
  assert.equal(result.relationship, 'archived_page');
});
test('empty snapshot response records only a narrowly scoped negative check', async () => {
  const result = await archiveAvailability('https://example.com/art', async () => ({ ok: true, json: async () => ({ archived_snapshots: {} }) }));
  assert.equal(result.outcome, 'no_match');
  assert.match(result.evidence, /not proof of deletion/);
});
