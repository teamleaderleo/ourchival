// Metadata-only lookup. Never opens an archived page or downloads its media.
export async function archiveAvailability(sourceUrl, request = fetch) {
  const source = new URL(sourceUrl);
  if (!/^https?:$/.test(source.protocol) || source.username || source.password)
    throw new Error('Invalid public source URL.');
  source.search = ''; source.hash = '';
  const endpoint = new URL('https://archive.org/wayback/available');
  endpoint.searchParams.set('url', source.href);
  const response = await request(endpoint, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Archive lookup HTTP ${response.status}; no negative finding recorded.`);
  const data = await response.json();
  if (!data || typeof data.archived_snapshots !== 'object' || data.archived_snapshots === null)
    throw new Error('Unrecognized archive response.');
  const snapshot = data.archived_snapshots.closest;
  if (!snapshot) return { url: endpoint.href, outcome: 'no_match', relationship: 'archived_page',
    evidence: `Wayback availability API returned no accessible snapshot for ${source.href}. This is not proof of deletion or absence from other archives. No archived content inspected.` };
  if (snapshot.available !== true || String(snapshot.status) !== '200' || !/^\d{14}$/.test(snapshot.timestamp))
    throw new Error('Archive snapshot is not confirmed accessible.');
  const url = new URL(snapshot.url);
  if (url.hostname !== 'web.archive.org' || !/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error('Unexpected archive destination.');
  url.protocol = 'https:';
  return { url: url.href, outcome: 'lead', relationship: 'archived_page',
    evidence: `Wayback availability API reports an HTTP 200 snapshot at ${snapshot.timestamp} for ${source.href}. Candidate page only; image identity and image availability have not been inspected.` };
}
