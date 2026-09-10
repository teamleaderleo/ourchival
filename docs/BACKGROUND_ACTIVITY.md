# Background activity and quiet operation

Audit on Air Blue, 2026-09-10. This is a bounded audit, not an installed monitor.

## What stays running

- The canonical local vault is a launchd service, with Next development mode and Convex's development watcher. It needs to be reachable for browsing and direct original uploads. Process snapshots showed the Ourchival server processes near 0% CPU; replacing this service is not supported by evidence as the first heat fix.
- The extension keeps account synchronization at six-hour intervals and bounded repair/retry behavior. Its watchdog checks each minute while imports/recovery are active, but only every fifteen minutes when idle. This adds up to fifteen minutes of scheduling delay to an idle source. A disabled/paused source does not start importing.
- Active reader heartbeats run every twenty seconds and stop when the reader exits. These guard ongoing downloads and are retained.
- Convex's indexed missing-preview queue checks four candidates' worth of work per minute (up to sixteen candidates read); the optional compact-preview migration has a checkpoint guard and self-scheduling. These are bounded archive work, not full-archive listing loops. They are unchanged here.
- Capture sessions are fetched on mount or explicit refresh, not a recurring timer. Visual metadata is mounted only when its disclosure is opened.

## Reductions made

- Artist/tag discovery polls every five minutes only while the page is visible and online. Initial index progress checks every thirty seconds. Returning to a visible/online page refreshes it.
- Active enrichment jobs and tag suggestions poll every ten seconds, only while visible and online. Requests are serialized, so a slow response cannot start an accumulating queue of requests. Hidden pages abort cancellable requests and stop scheduling new ones.
- Drive catalog/file-store backups run every six hours instead of hourly, with a cheap due check at login/reinstall. The local launchd configuration was updated without restarting the vault or interrupting an active backup. Original-image uploads continue during capture; local metadata recovery can lag by up to six hours plus runtime or downtime.
- An orphaned Convex log follower was stopped. Older Node helpers with live IPC paths were retained because ownership/activity could not be established safely.

## Evidence and limits

Two initial process snapshots showed WindowServer around 54–71% CPU, Google Drive around 20–26%, with iCloud file-provider activity, Idlesse/video decoding, and Codex also active. These are observations, not a sustained temperature diagnosis or a claim that Ourchival caused their activity. No unrelated apps or system services were disabled.

The capture ledger contained 21 recent sessions: 11 completed, 4 interrupted, and 6 marked running. Those six had last updates between 2026-09-08 21:35 UTC and 2026-09-10 04:52 UTC, so the receipt label alone cannot establish live browser-worker activity. No receipt was rewritten or job cancelled based on that label.

The last backup was verified; 92 backup parts covered 52,249 stored files. Its latest upload was approximately 72 MB, while five retained local export blobs totaled approximately 20.4 GB. The backup constructs a full local export before packing an incremental upload, so lowering its cadence removes twenty potential full exports per day. Existing backup parts and original images were retained.

The browser security policy blocked access to Edge's extension-management page. The canonical build updates the installed extension files, but the new idle watchdog requires a user reload of Ourchival Clipper. No cookies or credentials were copied or printed. The web polling and six-hour backup schedule can take effect independently of that reload.

## Follow-up choices

The highest-value next heat investigation is a sustained idle comparison of WindowServer, Idlesse/video decoding, and cloud file-provider activity, with user-controlled app changes. A production-mode local vault would remove development watchers, but requires a separate deployment workflow so edits and backend/schema changes do not silently stop reaching the running app.
