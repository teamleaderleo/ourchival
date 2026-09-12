# Missing works research

Open `/missing` in the local vault, or choose **Research missing works** in
Capture sessions. This is a research queue, not another importer.

The queue scans 48 references per request and includes X, Pinterest, and Pixiv
image/post records with no durable images, linked-only pages, or fewer durable
pages than the recorded page count. Deleted references and linked own-art
publications are excluded. A missing expected count stays unknown. It does not
audit rendition quality or discover missing pages when no count was recorded.

Select a work to read up to eight saved metadata snapshots. Record the URL of a
place checked, an outcome, and evidence. Artist galleries, mirrors, booru records,
and archive pages are leads; the app does not fetch them automatically.

`missingWorkChecks` stores checks in the local Convex database. Checks are
append-only, owner-protected, and retain corrections as later entries. Repeating
the same latest check is idempotent. The UI displays the latest 100 checks per
work; older entries remain stored. No browser credentials or source response
bodies are copied into research records.

**Confirmed identity** is an owner's research assessment. It never overwrites a
canonical source, links an asset, asserts original resolution, or clears a
capture failure. Image recovery and quality verification remain separate work.
Do not infer an exact match merely because an artist appears in a gallery.

## Command-line operation

From the canonical checkout, run `node scripts/missing-works.mjs scan 10`.
This inspects at most ten pages of 48 references and saves candidate details,
saved metadata snapshots, and research history under the ignored local
`.convex/reconciliation/missing-works/queue.json`. Repeat to resume. Use
`status` for counts or `detail REFERENCE_ID` to inspect one current record.
Use `report` for aggregate counts of candidates with saved identity text,
ID-only placeholders, partial images, unknown page counts, and prior research.
These categories overlap; available identity text is not a verified match.
The export is a dated research snapshot, not a live completeness receipt.
It contains private library metadata; keep it local. No cookies are accessed.

`record EVIDENCE_JSON_FILE` appends a finding through the same validated API as
the UI. The JSON fields are `referenceId`, `url`, `outcome`, and `evidence`;
outcome is `lead`, `no_match`, `confirmed_identity`, or `ruled_out`.
An optional `relationship` is `same_artist`, `possible_same_image`, or
`archived_page`. These are typed research connections, not deduplication edges.
Changing a relationship appends a correction, preserving the old assessment.

`archive REFERENCE_ID` performs one metadata-only request to the Internet
Archive's documented Wayback availability API, with a 15-second timeout and
no automatic retries. It records a candidate snapshot URL or a narrowly scoped
negative result. HTTP failures and malformed responses do not become negative
findings. It does not open the snapshot or assert the artwork is preserved.
Only the public source URL is sent; query parameters and fragments are stripped.

In the research panel, **Find alternate sources** provides exact-source,
artwork-ID, artist-name, and Wayback search destinations. Merely displaying a
link makes no external request and records no finding. These are generated
search destinations, not discovered matching pages. Automated aggregator
search, reverse-image matching, and a cross-reference graph remain separate
from this first set of typed research connections.
Only record evidence actually inspected. Scanning alone does not create findings,
search external sites, download images, or mark work recovered.

Each completed page replaces the checkpoint atomically. Failed pages replay;
duplicate candidates are keyed by reference ID. Concurrent scans are blocked
by `scan.lock`. After a forcibly terminated process, verify no scan is running
before removing that lock. Once a scan is complete, retain or rename the old
`queue.json` before starting a fresh inventory; it does not automatically rescan.
