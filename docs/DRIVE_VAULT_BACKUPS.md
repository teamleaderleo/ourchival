# Working vault and durable backups

Air Blue's canonical checkout is the working archive. The deployed home page
opens `http://127.0.0.1:3000/` on that Mac. `/hosted` explicitly preserves the
earlier, separate hosted catalog; it is not a synchronized view. Opening the
deployed home page makes no hosted Convex archive queries.

`scripts/install-local-services.mjs`, run with Node 22 on Air Blue, installs two
user LaunchAgents: the canonical local vault starts at login and restarts after
exit; a Drive backup runs at login and once an hour while the Mac is awake.
Neither service prevents sleep. Missed backup intervals are handled by launchd
after wake. No browser profile data or credentials are read or copied.

The backup uses Ourchival's existing local Drive configuration. It exports a
consistent local Convex snapshot including file storage. Each backup contains
all current catalog tables, with only new or changed local stored files added
after the first full backup. Existing Drive originals retain their file IDs and
are not downloaded or uploaded again. Tags, provenance, organization, import
checkpoints, machine results, and local previews are included. Model weights,
browser-only checkpoints, environment secrets, and the recovery key are not in
the snapshot. Device credential hashes in the app catalog are preserved.

Uploads use resumable chunks and a private checkpoint. A retry checks for an
already completed object before creating another, and success requires Drive's
reported size and MD5 to match the local part. Each chain part also has a SHA-256.
Parts are private files in the existing Ourchival Drive folder. No backup parts
are automatically deleted: older parts can contain images needed by newer
incremental snapshots. These are point-in-time backups, not continuous sync;
edits since the last successful backup remain local.

Status is in `.convex/drive-backup/progress.json`; `verified` records the last
successful upload. A failed or interrupted attempt never advances the verified
chain. `.convex/drive-backup/pending.json` contains a sensitive upload capability
and must not be printed or committed. Credentials are obtained in memory from
the local deployment, not from browser storage. The hourly export and upload
do not use hosted Convex database/storage bandwidth.

## Recovery

When Ourchival's local Drive configuration is available, download, hash-check,
and assemble the latest backup automatically:

```sh
python3 scripts/vault_backup.py --restore-latest --output /private/restored.zip
```

This writes only a recovery ZIP and never imports it. If rebuilding after loss
of the Mac, reconnect Ourchival to the existing Drive folder first, or use the
manual download workflow below. Keep recovery credentials separately from the
Mac; they are deliberately not included in these backups.

Download the desired latest `ourchival-backup-*.zip` from Drive. Its
`_ourchival_backup/manifest.json` lists the earlier parts required, including
their Drive IDs, names, and SHA-256 values. Download those parts too, then run:

```sh
python3 scripts/vault_backup.py --assemble /private/first.zip /private/next.zip /private/latest.zip --output /private/restored.zip
```

Put the desired latest part last. Assembly checks that all chain parts match
their hashes and every required stored file is present. It writes an ordinary
Convex snapshot ZIP and does not modify a database. Restore into a fresh local
deployment first and verify counts, representative images, tags, and source
origins before selecting it as the working vault. Never import blindly over
the current catalog. Drive-linked originals still require authorized access
to the original Drive folder.

Manual backup: `python3 scripts/vault_backup.py`. Concurrent invocations share
a lock. After interruption, the next invocation resumes the pending part before
exporting another snapshot. An expired Drive session is cleared for the next
bounded retry. Network failures retry at the next scheduled run rather than
looping against Drive.
