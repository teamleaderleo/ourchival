# Capture and conversation workbench

This branch is the current integration point for Ourchival's capture, page-preservation, conversation-archive, and related Workbench UI.

It consolidates the focused implementation history from pull requests #46–#52 into active integration pull request #53.

Included work:

- live capture-session reporting and rapid review
- bounded session-wide triage actions
- visible-page screenshot artifacts
- readable page-text artifacts
- structured Reddit thread snapshots
- generic Markdown and JSON conversation import
- versioned conversation records and snapshots
- ChatGPT, Claude, and Gemini browser capture
- provider preflight, canonical identity, retry safety, message normalization, and diagnostics
- one Workbench dock for capture sessions and conversations
- bounded conversation rendering and recent-list filtering
- cross-view and cross-page one-level reference undo
- guarded cleanup for authoritatively rejected artifact uploads
- persisted preservation warnings in the Clipper popup

## Working rules

- Local tests, typechecking, and production builds are the primary automated checks when available.
- Deployment previews are optional and should not block ordinary development.
- A workflow failure with no steps, logs, or artifacts is runner noise rather than evidence about the code.
- Provider capture must fail explicitly rather than silently truncating or mislabeling data.
- New capture adapters must include a live entrypoint, bounded payloads, canonical identity, provenance checks, diagnostics, and a degradation path.
- Direct-upload commit mutations must be safe to retry with the same storage ID.
- Duplicate handling must never delete the blob already referenced by the saved record.
- Authoritative upload rejection may request cleanup only through an indexed ownership check.
- Large readers must mount bounded pages rather than every archived item at once.
- One-level undo must retain enough before/after state to work after navigation.
- Changes should receive periodic static reviews for dead code, duplicate API paths, ambiguous retries, unbounded reads, storage ownership, focus behavior, and misleading counts.

## Active follow-up issues

- #56 — add artifact-specific retry and richer batch association to the new preservation-warning ledger
- #57 — track edited conversation messages with separate identity and content fingerprints

## Completed review issues

- #54 — reference undo now survives view and page changes
- #55 — rejected browser artifact uploads use indexed guarded cleanup

## Remaining runtime checks

These require a paired unpacked Clipper and live provider pages:

- capture-session progress and service-worker restart recovery
- screenshot, readable-text, Reddit artifact upload, warnings, and guarded cleanup
- ChatGPT, Claude, and Gemini selector behavior and preflight diagnostics
- revoked-device rejection
- private conversation import, revision, search, and bounded reader flows
- cross-view undo selection restoration
- Workbench focus trapping and mobile drawer behavior in a real browser

This document describes the active workbench rather than a deployment requirement.
