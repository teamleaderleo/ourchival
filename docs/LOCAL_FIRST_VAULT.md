# Local-first vault and provider boundary

## Decision

Ourchival must remain usable when a hosted catalog provider is unavailable.
Authentication, archive operations, and provider storage are separate jobs:

```txt
owner identity -> Ourchival session -> archive contract -> provider adapters
                                                |-> local catalog
                                                |-> Convex
                                                |-> Neon / D1
                                                `-> Drive / R2 objects
```

Convex is the current complete catalog adapter. It is not the permanent owner
of Ourchival login. The Air Blue local deployment is an immediate recovery and
development mode; it removes the hosted Convex account from the availability
path but does not yet remove the Convex runtime from the local adapter.

## Run locally

Use Node 22. `pnpm local:vault` automatically re-executes through an installed
NVM Node 20, 22, or 24 when the active Node is unsupported by Convex local
actions.

```sh
pnpm local:vault
```

The command:

1. creates an ignored `.env.local-vault.local` deployment configuration;
2. generates an ignored, mode-0600 local owner key under `.convex/`;
3. deploys the current functions to the local catalog;
4. starts the local catalog and web app;
5. reports the local app and Clipper addresses without printing credentials.

Use `pnpm local:vault:status` for a bounded health receipt. Production
credentials and data are not copied. The Convex CLI briefly writes its local
selection to `.env.local` during setup; the runner snapshots the file and
restores it byte-for-byte before serving the app.

To make new local captures use the already-configured private Google Drive
originals folder, copy the existing cloud Drive configuration into the local
Convex deployment without printing credentials:

```sh
pnpm local:vault:drive
```

This is an explicit, one-time setup step for each local deployment. The vault
continues to fall back to local Convex Storage when Drive is not configured or
temporarily unavailable.

## Sync contract

Local writes are authoritative occurrences until acknowledged by a configured
cloud adapter. Synchronization must use the same idempotent import semantics as
large imports:

- stable source/session identity;
- ordered records with parser version and input digest;
- batches of at most 50;
- idempotency on session plus ordinal/source identity;
- highest contiguous acknowledged checkpoint;
- aggregate saved, duplicate, skipped, and failed receipt;
- immutable raw payload/object digests where applicable.

Sync is explicit and resumable. It is not a timestamp-based last-write-wins
copy and it never treats two providers as independent sources of truth. User
decisions use versioned mutations with conflict evidence; generated metadata
and indexes remain rebuildable projections.

## Next provider-independent slice

Move owner identity/session exchange to the Ourchival application boundary,
then expose a small archive interface owned by Ourchival:

- `capture.batch`
- `imports.resume`
- `find`
- `get`
- `changes.pull`
- `changes.ack`

Convex, local SQLite, Neon, and D1 adapters implement that interface. Drive and
R2 remain object adapters. The UI and Clipper depend on the Ourchival contract,
not a provider hostname or provider-issued session.
