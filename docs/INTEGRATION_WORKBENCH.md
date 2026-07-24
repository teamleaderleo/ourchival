# Capture and conversation workbench

This branch is the current integration point for Ourchival's capture, page-preservation, and conversation-archive work.

It includes the stacked work previously reviewed through draft pull requests #46–#52:

- live capture-session reporting and rapid review
- bounded session-wide triage actions
- visible-page screenshot artifacts
- readable page-text artifacts
- structured Reddit thread snapshots
- generic Markdown and JSON conversation import
- versioned conversation records and snapshots
- ChatGPT, Claude, and Gemini browser capture
- provider preflight, canonical identity, retry safety, and message normalization

## Working rules

- Local tests, typechecking, and production builds are the primary automated checks when available.
- Deployment previews are optional and should not block ordinary development.
- Provider capture must fail explicitly rather than silently truncating or mislabeling data.
- New capture adapters must include a live entrypoint, bounded payloads, canonical identity, provenance checks, and a degradation path.
- Changes should receive periodic static reviews for dead code, duplicate API paths, ambiguous retries, unbounded reads, and storage ownership.

## Remaining runtime checks

These require a paired unpacked Clipper and live provider pages:

- capture-session progress and service-worker restart recovery
- screenshot, readable-text, and Reddit artifact upload
- ChatGPT, Claude, and Gemini selector behavior
- revoked-device rejection
- private conversation import, revision, and reader flows

This document describes the active workbench rather than a deployment requirement.
