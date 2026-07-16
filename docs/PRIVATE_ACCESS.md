# Private vault access

Ourchival's first production access model is intentionally single-owner. The web vault uses one owner access key, while every paired browser extension receives a separate revocable device token.

## Configure the owner key

Generate a long random value and store it in Convex:

```bash
npx convex env set OURCHIVAL_OWNER_ACCESS_KEY <long-random-value>
```

Allow the web app origins that should call Convex HTTP actions:

```bash
npx convex env set OURCHIVAL_ALLOWED_ORIGINS "http://localhost:3000,https://app.ourchival.com"
```

The owner key belongs only in the Convex environment and the owner's browser. Do not put its value in `NEXT_PUBLIC_*` variables, extension source, commits, logs, or screenshots.

## Unlock the web vault

Open the web app and enter the owner key. The browser stores it in local storage until **Lock** is selected. The vault verifies the key against `/auth-check` before rendering references.

The access key currently protects the HTTP archive surface:

- `/references`
- `/reference`
- `/reference-metadata`
- `/drive-file`
- owner-side Clipper pairing and device management

## Pair Ourchival Clipper

1. Unlock the web vault.
2. Open **Clipper access**.
3. Create a pairing code.
4. Open the Ourchival Clipper popup.
5. Enter the Convex site URL, a recognizable browser name, and the pairing code.

Pairing codes expire after ten minutes and work once. The extension exchanges the code for a random device token. Only a SHA-256 digest of that token is stored in Convex.

Every context-menu capture, tab dump, bookmark import, retry, and resumed batch sends the device credential through the `Authorization` header.

## Revoke a browser

Open **Clipper access** in the web vault and revoke the device. Its next capture receives a forbidden response. Disconnecting from the extension removes the local token; revocation remains the correct action for a lost or copied browser profile.

## CORS policy

`OURCHIVAL_ALLOWED_ORIGINS` controls web origins. Chrome extension origins and local development origins are accepted by the private HTTP helper. Responses vary by Origin and allow the `Authorization` header.

## Current migration boundary

This is the first security slice. HTTP reads, edits, metadata refreshes, Drive-file proxying, captures, pairing, and revocation use private credentials.

Several web panels still call public Convex query and mutation functions directly. Those functions need an owner access argument or a future authenticated Convex identity before this issue can be considered complete. Keep the pull request in draft until those calls are covered and the production smoke test passes.

## Release verification

Before deployment:

1. Run tests, workspace typechecking, extension build, and web build.
2. Set both Convex environment variables above.
3. Unlock the web app with a wrong key and confirm rejection.
4. Unlock with the correct key and load references.
5. Create a pairing code and pair the extension.
6. Capture an image and confirm it appears in Inbox.
7. Revoke the device and confirm the next capture is rejected.
8. Lock the vault and confirm archive requests stop succeeding from the web UI.
