# Choosing references for a project

The library now has a direct **Projects** entry. Select a project to browse its
references through the existing archive filter. Other active search/source
filters still apply and remain visible. Create projects inside that drawer.

Select image cards to reveal **Add to shortlist** directly above the grid.
Choose a project and add up to 96 selected references at once. The selection
stays available for another project or for corrections. Existing notes and
confirmed usage survive repeated additions. The receipt reports how many of
the selected references were updated.

In an image's project details, **Mark used** records that it actually served as
a reference for that project. Repeating the same operation does not increment
a counter or move the usage date. **Undo used** corrects the marker. The image
shows the number of projects with confirmed use, not a count of views, clicks,
or repeated requests. Earlier project links have **Usage not recorded**;
historical usage is never fabricated from an attachment date.

Favorites remain a separate expression of liking. Project purposes and notes
can distinguish “palette,” “pose,” “lighting,” and “style.” Those explicit
signals can later support several preferred styles instead of flattening all
favorites into one style profile. This change does not train a preference
model or automatically classify the user's tastes.

## Working with an assistant

From the canonical checkout, `node scripts/project-brief.mjs` lists local
projects. Supply a project ID to get a bounded JSON page containing reference
IDs, source URLs, titles, favorites, project notes, and confirmed usage. Pass
`continueCursor` as the next argument until `isDone` is true. Missing reference
records appear as `reference: null`; deleted records are flagged. Neither is
silently omitted. No image blobs, signed asset URLs, or credentials are exported.

The underlying owner-protected API is `projects:listReferences`. Existing
`projects:upsertReferences` adds a bounded batch to a shortlist; omitted notes
preserve prior notes. `projects:setReferenceUsage` accepts projectId,
referenceId, and an explicit used boolean. Use that mutation only when actual
project use is confirmed, never merely because a candidate was viewed or liked.

The receipt is private archive data and includes source links. Keep exported
briefs with the user's project files. The helper reads the established local
owner key in memory and makes one query per invocation. It does not run a
background scan, invoke a model, or touch the authenticated browser.

New Twitter likes can continue entering the archive through the existing source
sync. They do not automatically become favorites or confirmed project uses.
