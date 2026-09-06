When changing user-facing UI, read `docs/UI_DESIGN_GUIDELINES.md` first.
Treat its hierarchy, first-viewport, progressive-disclosure, and state-specific
requirements as acceptance criteria. A technically complete surface that makes
the user hunt for its next required action is not complete.

On Air Blue, use `/Users/leoli/Projects/ourchival` for the running vault and
extension build. Group other worktrees under `/Users/leoli/Projects/worktrees/ourchival`.
Never install a separate worktree's extension build into the persistent browser.
The legacy `ourchival-air-blue-runtime` path contains only a managed compiled extension
installation, preserving the installed extension ID and its local state.
See `docs/LOCAL_CHECKOUT.md` before changing the browser's installed path.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
