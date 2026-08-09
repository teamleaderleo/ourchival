# Local reference cache

Related: #63, #37

The local reference cache exists to make Ourchival's visual library feel resident on a device the owner already uses. It is a read-through performance cache, not another archive database.

## Authority

Convex and the configured original-asset storage remain authoritative.

The browser cache may paint a recent last-known page before the matching server request finishes. Once the server response settles, it replaces the cached read model and refreshes the cache.

Reference edits, triage, favorites, tags, boards, projects, deletion, restore, capture, and other mutations never write to the archive through IndexedDB.

## Storage

The first cache format stores recent reference-page responses in same-origin IndexedDB.

- cache identity: vault view + normalized query
- explicit schema version
- default maximum age: seven days
- maximum cached view/query pages: 24
- oldest pages pruned first
- IndexedDB failure behaves like a cache miss
- the entire cache can be cleared without affecting archive data

Future thumbnail/preview byte caching should use a separate bounded policy so metadata invalidation and media eviction can evolve independently.

## Reconciliation rule

Every cache/network load belongs to one generation and cache key.

A cached page may paint only while:

1. its generation is still current;
2. the user has not changed to another view/query; and
3. the matching server request has not already settled.

A late IndexedDB read therefore cannot overwrite newer server data or a newer navigation state.

## Privacy boundary

Cached data remains in the browser profile's origin storage on the owner's device. It should never be exposed to captured page scripts or copied into public browser storage.

The cache contains read models needed for the vault UI. It should avoid becoming a second repository for full originals or unrelated raw capture artifacts.

Sign-out/account-switch work should clear or namespace cache state before Ourchival supports multiple owners in one browser profile.

## Next slice

After this cache foundation passes CI:

1. wire the first-page vault load to start cache and network reads together;
2. paint a usable cache hit immediately;
3. let the existing server response replace it normally;
4. persist the fresh first page;
5. instrument warm-open paint timing and cache hit rate;
6. only then start the virtualized endless-gallery work.
