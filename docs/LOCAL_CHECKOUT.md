# Air Blue's active checkout

Use `/Users/leoli/Projects/ourchival` for development, the local vault, and
`pnpm extension:build`. The unpacked extension is built into
`apps/extension/dist`. Its cat artwork comes from the web app's existing
`archive-cat.png`; the build generates the toolbar and extension-manager sizes.

Edge's existing extension ID is `jeoelhigjmcgojbpbfgefdjpaedgmgjd`. It was
installed from `/Users/leoli/Projects/ourchival-air-blue-runtime/apps/extension/dist`.
That legacy root now contains only compiled extension output, not another
checkout. Canonical builds automatically refresh it through
`scripts/sync-installed-extension.mjs`. It must remain a physical directory:
Edge resolves symlinks and can assign a different extension ID. Keep it while this extension installation exists: removing
and reinstalling an unpacked extension from another path can change its ID and
lose access to its existing pairing and checkpoints.

The old independent runtime checkout was at commit `a9c75e2`, so reloading it
could not activate newer code built in the canonical checkout. Version 0.1.1
and the cat toolbar icon make the corrected build recognizable. Reload the
installed extension after building; existing website tabs need a page reload
before their old content scripts are replaced. Do not start imports merely to
verify which extension build is installed.

Seven older worktrees, including the former runtime checkout, are grouped under
`/Users/leoli/Projects/worktrees/ourchival`. Their branches, source files,
local configuration, and any old local databases are preserved. They are
historical working copies, not alternate live vaults. The older search-delivery
artifact directory is also retained in that group.

Do not merge or overwrite old `.convex` databases into the canonical vault.
Do not create more top-level `ourchival-*` folders or independently installed
extension copies for routine work.
