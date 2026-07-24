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

## Working rules

- Local tests, typechecking, and production builds are the primary automated checks when available.
- Deployment previews are optional and should not block ordinary development.
- A workflow failure with no steps, logs, or artifacts is runner noise rather than evidence about the code.
- Provider capture must fail explicitly rather than silently truncating or mislabeling data.
- New capture adapters must include a live entrypoint, bounded payloads, canonical identity, provenance checks, diagnostics, and a degradation path.
- Direct-upload commit mutations must be safe to retry with the same storage ID.
- Duplicate handling must never delete the blob already referenced by the saved record.
- Large readers must mount bounded pages rather than every archived item at once.
- Changes should receive periodic static reviews for dead code, duplicate API paths, ambiguous retries, unbounded reads, storage ownership, focus behavior, and misleading counts.

## Active follow-up issues

- #54 — make reference undo survive view and page changes
- #55 — clean up authoritatively rejected browser artifact uploads through a storage-ID index
- #56 — report partial page-artifact failures without marking saved references as failed

## Remaining runtime checks

These require a paired unpacked Clipper and live provider pages:

- capture-session progress and service-worker restart recovery
- screenshot, readable-text, and Reddit artifact upload
- ChatGPT, Claude, and Gemini selector behavior and preflight diagnostics
- revoked-device rejection
- private conversation import, revision, search, and bounded reader flows
- Workbench focus trapping and mobile drawer behavior in a real browser

This document describes the active workbench rather than a deployment requirement.
