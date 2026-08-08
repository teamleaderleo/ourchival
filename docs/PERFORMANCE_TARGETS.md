# Ourchival performance targets

Ourchival should feel resident and immediate for a single-owner visual archive, including very large libraries.

## Product target

Opening the app should show previously seen library content immediately from local cache, then reconcile changes from the server. Browsing should avoid visible page-boundary pauses. Common metadata filtering should feel local. Full-resolution originals should stay off the hot path.

## Working budgets

These are product budgets to benchmark and refine, not guarantees:

- warm app open to visible cached gallery: <= 100 ms after app shell is ready
- cached view/filter switch: <= 50 ms perceived response
- thumbnail arrival for the next viewport: before it enters view during ordinary scrolling
- selected cached 1600 px preview: <= 100 ms to display
- previous/next through prefetched previews: one frame to swap once decoded
- common local text/tag/project filtering: <= 50 ms for 10k references, <= 100 ms for 100k
- scroll should remain smooth while thumbnail decode, sync, and prefetch run

## Image ladder

- gallery: 384 px WebP thumbnail
- lightbox / rapid reference review: 1600 px WebP preview
- studio handoff: preview by default, original on explicit request
- original: archival or deliberate full-resolution use

## Direction

- local metadata/index cache in IndexedDB
- persistent thumbnail cache and bounded preview cache
- delta sync instead of reloading known pages
- virtualized endless gallery
- aggressive next-viewport and next-item prefetch
- background image decode where supported
- archive-wide indexed retrieval on the server, with local handling for common already-cached filters
- 10k / 50k / 100k reference fixtures and repeatable profiling

The user experience should resemble opening a local visual library more than navigating a conventional paginated web app.
