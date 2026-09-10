# Archive-wide artists and tags

The sidebar reads a persistent directory, independent of the current page, sort, or scrolling position. Counts are unique active saved references: unreviewed, kept, and review-later items; archived, trashed, and linked My Art references are excluded. Images in a multi-page work do not inflate its count.

Artist identity comes from the saved source profile URL, falling back to a platform-qualified handle/name. Equal display names are not evidence that artists are the same person. This directory does not infer cross-provider identity or use predicted artists. Tags are assigned reference tags, with importer/container labels excluded; model predictions do not automatically become accepted tags.

The directory has separate total and non-sealed counters. Hidden sensitivity mode neither lists nor resolves entries whose only memberships are sealed. Facet browsing applies the same visibility restriction. Other source, text, and collection filters still apply to results, so their counts can be smaller than the global directory count.

## Index and recovery

- `archiveFacets` stores labels, search text, and counters, indexed by kind/count and searchable text.
- `archiveFacetMembers` stores one membership per facet/reference with saved/publication dates. Artist/tag selection paginates this index before hydrating references, rather than scanning the archive or running a broad artist-name text search.
- Initial indexing processes 24 references per transaction. Cursor and counts commit together. Replayed and stale jobs do not increase counts. The directory is published after the complete scan.
- `archiveDiscovery:ensure` starts an absent build or resumes a stale checkpoint after 60 seconds. A completed build is not re-run on page load.
- Existing search refresh jobs update memberships and counters idempotently for new captures, tagging, metadata edits, sensitivity changes, archiving, removal, and own-art linkage. Updates are eventually consistent with that queue. No image bytes are read or copied.
- Browser reads fetch only ranked or searched choices. A ready directory refreshes once per minute; a building directory checks every ten seconds. Search is debounced and bounded to twenty displayed matches per kind; refine a search to narrow it.
- The selected facet is preserved in search/sort/view position state but hidden from free-text input. Its human-readable label and clear control appear in the sidebar.

On Air Blue, `node scripts/archive-discovery.mjs start` starts/resumes the local build. `node scripts/archive-discovery.mjs status` reports progress and writes a completion receipt to `.convex/reconciliation/archive-discovery.json`. The script reads the existing local owner key in memory and only uses the canonical local backend.
