# Private vault access

Ourchival uses three separate credentials with separate responsibilities:

- WorkOS AuthKit authenticates the web owner through Google.
- Convex mints a short-lived signed vault token for an allowlisted WorkOS user.
- Each paired Ourchival Clipper receives its own revocable device token.

The owner recovery key remains available as a break-glass path during rollout.

## Web owner access

Follow [`WORKOS_AUTH.md`](WORKOS_AUTH.md) to connect WorkOS, enable Google, configure the owner allowlist, and set the vault-session signing secret.

A successful WorkOS session does not expose the recovery key. Convex verifies the WorkOS identity and returns a fifteen-minute Ourchival vault token. The browser keeps that token in memory and refreshes it while the vault is open.

The WorkOS owner boundary protects the HTTP archive, private Drive proxy, organization panels, saved searches, enrichment controls, related-reference browsing, visual similarity, capture-session records, and owner-side Clipper management.

## Recovery access

Generate a different long random value and keep it in the Convex environment:

```bash
npx convex env set OURCHIVAL_OWNER_ACCESS_KEY <long-random-value>
```

The recovery key is optional for normal Google sign-in and recommended during migration. Do not put it in `NEXT_PUBLIC_*` variables, extension source, commits, logs, or screenshots.

The recovery form stores the key in that browser until **Lock** is selected. Normal WorkOS sessions are not stored in local storage.

## Pair Ourchival Clipper

1. Sign in to the web vault or use recovery access.
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

## Release verification

Before using a deployment:

1. Run tests, workspace typechecking, extension build, and web build.
2. Configure WorkOS, the WorkOS user-ID allowlist, the session signing secret, and allowed origins.
3. Sign in with an account outside the allowlist and confirm rejection.
4. Sign in with the allowed Google account and load references.
5. Create a pairing code and pair the extension.
6. Capture an image and confirm it appears in Inbox.
7. Open a private Drive-backed original when Drive is configured.
8. Revoke the device and confirm the next capture is rejected.
9. Sign out and confirm archive access stops.
10. Confirm the separate recovery key still opens the vault.
