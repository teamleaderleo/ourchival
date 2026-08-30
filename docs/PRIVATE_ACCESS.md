# Private vault access

Ourchival is intentionally a single-owner vault. The normal web flow is **Continue with Google** using the same Google account that owns Ourchival's Drive storage. The owner recovery key remains available as a fallback, while every paired browser extension receives a separate revocable device token.

## Configure Google owner sign-in

Use the same Google OAuth web client for Google Identity Services and the Drive refresh token:

1. Add `https://app.ourchival.com` as an authorized JavaScript origin in Google Cloud.
2. Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on the production web app. This identifier is public by design.
3. Set the matching `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` only in the Convex environment.

The backend verifies the Google ID token's issuer, audience, verified email, and expiry. It then asks Drive for the configured storage account and requires an exact email match. A different Google account is rejected even when its token is otherwise valid.

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

Open the web app and choose **Continue with Google**. The browser stores the short-lived Google credential locally until **Lock** is selected, and verifies it against `/auth-check` before rendering references. If Google sign-in is unavailable, expand **Use recovery key** and enter the owner key.

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

This release establishes one Google-backed private owner principal, a recovery key, and separately revocable Clipper devices. Records do not carry multiple user identities because the current product is a personal vault.

## Release verification

Before using a deployment:

1. Run tests, workspace typechecking, extension build, and web build.
2. Set both Convex environment variables above.
3. Sign in with a different Google account and confirm rejection.
4. Sign in with the Drive owner Google account and load references.
5. Unlock with a wrong recovery key and confirm rejection.
6. Unlock with the correct recovery key and load references.
7. Create a pairing code and pair the extension.
8. Capture an image and confirm it appears in Inbox.
9. Open a private Drive-backed original when Drive is configured.
10. Revoke the device and confirm the next capture is rejected.
11. Lock the vault and confirm archive requests stop succeeding from the web UI.
