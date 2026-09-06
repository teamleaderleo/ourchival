# Automatic source imports and failure history

The extension owns inactive reader tabs for Pixiv, Pinterest, and X. The popup
can close and the user can switch tabs or windows. A one-minute browser alarm
checks persisted jobs; reader heartbeats and capture progress distinguish a
slow image upload from a lost reader. Browser or Mac sleep suspends work;
alarms and checkpoints resume it when the browser runs again.

Temporary interruptions retry after 1, 5, 15, and 60 minutes. Authentication
errors and exhausted retry budgets require attention. An explicit Stop pauses
automatic work for that source. Global Pause stops automatic imports; Enable
acknowledges attention stops and re-enables sources. A new-save check does not
rewrite a stopped historical checkpoint.

Historical intake, new-save checks, and full repair passes retain separate
receipts. Completed sources are eligible for new-save checks every six hours;
sources with recorded gaps are eligible for a repair pass daily. These are
eligibility intervals: active imports finish first, and sleeping or closed
browsers delay execution. Automatic jobs run serially. Pixiv new-save checks
stop at a fully known bookmark page; Pinterest still visits the strict board
grid and skips known memberships; X stops at its known-post boundary. Full
repair revisits existing references, reusing stored originals and fetching
missing pages. A new-save check is not a proof of full historical coverage.

The popup's **Failure history** opens a private extension page with unresolved
and recovered records. Records distinguish request, image storage, metadata,
and reader failures, retaining source/image identity, HTTP status when known,
failed-attempt count, first/latest failure, and recovery history. Successful
metadata does not resolve an image-storage failure. Only a confirmed durable
original resolves that failure; previews and unproven renditions do not.
Repeated attempts update one record per item/page/stage rather than storing
copies of artwork metadata or image bytes. Recovered records are retained.

Existing failures from retained batch checkpoints are imported once. Their
checkpoint timestamps and unknown historical attempt counts are explicitly
labeled. Missing older evidence cannot be reconstructed. New failures retain first/latest observation timestamps and cumulative counts.

History lives in `chrome.storage.local` in the existing extension profile,
restricted to trusted extension contexts. The view displays no artwork
previews. Diagnostic URLs omit userinfo, credentials, and fragments (retaining only safe Pixiv bookmark page/visibility parameters), and
messages redact common credential fields. JSON export is explicit and contains
private source links, so it should stay in the user's archive. Export is also
the backup path: uninstalling the extension or clearing its storage can erase
this local history. No new Convex writes or automatic Drive uploads are added
for the journal itself.

Build from the canonical checkout and reload the existing installed extension
once to activate these changes and the new alarms permission. Importer-owned
tabs are then opened automatically; users should not need to repeatedly reload
pages or click Resume for temporary interruptions.
