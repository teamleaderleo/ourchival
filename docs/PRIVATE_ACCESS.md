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

Set the variables separately for development and production deployments. Add `--prod` to the commands when configuring production.

The owner key belongs only in the Convex environment and the owner's browser. Do not put its value in `NEXT_PUBLIC_*` variables, extension source, commits, logs, or screenshots.

## Unlock the web vault

Open the web app and enter the owner key. The browser stores it in local storage until **Lock** is selected. The vault verifies the key against `/auth-check` before rendering references.

The owner key protects the HTTP archive, private Drive proxy, organization panels, saved searches, enrichment controls, related-reference browsing, visual similarity, capture-session records, and owner-side Clipper management.

## Pair Ourchival Clipper

1. Unlock the web vault.
2. Open **Clipper access**.
3. Create a pairing code.
4. Open the Ourchival Clipper popup.
5. Enter the Convex site URL, a recognizable browser name, and the pairing code.
6. Select **Pair browser**.

Use the Convex HTTP Actions site URL without `/capture`, for example:

```txt
https://your-deployment.convex.site
```

Pairing codes expire after ten minutes and work once. The extension exchanges the code for a random device token. Only a SHA-256 digest of that token is stored in Convex.

Every context-menu capture, tab dump, bookmark import, retry, and resumed batch sends the device credential through the `Authorization` header.

## Revoke a browser

Open **Clipper access** in the web vault and revoke the device. Its next capture receives a forbidden response. Disconnecting from the extension removes the local token; revocation remains the correct action for a lost or copied browser profile.

## CORS policy

`OURCHIVAL_ALLOWED_ORIGINS` controls web origins. Chrome extension origins and local development origins are accepted by the private HTTP helper. Responses vary by Origin and allow the `Authorization` header.

## Current release boundary

This release establishes one private owner principal and separately revocable Clipper devices. Records do not yet carry multiple user identities because the current product is a personal vault. A future collaboration phase can replace the owner key with authenticated accounts and owner-scoped data without changing the pairing model's core separation between web access and capture devices.

## Release verification

Before using a deployment:

1. Run tests, workspace typechecking, extension build, and web build.
2. Set both Convex environment variables above.
3. Unlock the web app with a wrong key and confirm rejection.
4. Unlock with the correct key and load references.
5. Create a pairing code and pair the extension.
6. Capture an image and confirm it appears in Inbox.
7. Open a private Drive-backed original when Drive is configured.
8. Revoke the device and confirm the next capture is rejected.
9. Lock the vault and confirm archive requests stop succeeding from the web UI.
