# WorkOS Google authentication

Ourchival uses WorkOS AuthKit for the normal web sign-in and keeps the owner recovery key as a break-glass path during the migration.

The browser signs in through WorkOS, Convex verifies the WorkOS JWT, and an allowlisted WorkOS user may mint a short-lived Ourchival vault token. The vault token lasts fifteen minutes, refreshes while the app is open, and stays in browser memory rather than local storage.

Ourchival Clipper continues to use its own revocable device token.

## 1. Connect WorkOS to Convex

Open the Convex dashboard, choose the Ourchival project and deployment, then open **Settings → Integrations → WorkOS Authentication**.

Create or link the WorkOS environment for the deployment. The `authKit` section in `convex.json` declares the local, preview, and production URLs:

- local callback: `http://localhost:3000/callback`
- production callback: `https://app.ourchival.com/callback`
- production homepage: `https://app.ourchival.com`

The Convex deployment needs `WORKOS_CLIENT_ID` so `convex/auth.config.ts` can validate WorkOS access tokens.

## 2. Enable Google in WorkOS

Open the WorkOS dashboard and select the environment connected to Ourchival.

Under AuthKit authentication methods or social connections, enable **Google**. Keep the callback and sign-in endpoint aligned with the URLs above. The app starts login at:

```txt
https://app.ourchival.com/sign-in
```

For local development, use:

```txt
http://localhost:3000/sign-in
```

## 3. Configure the web environment

Set these server-side values in `.env.local` and in the Vercel project:

```bash
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY=sk_...
WORKOS_COOKIE_PASSWORD=<long-random-value>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
```

Use the production callback in Vercel:

```bash
NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://app.ourchival.com/callback
```

Generate the cookie password with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`WORKOS_API_KEY` and `WORKOS_COOKIE_PASSWORD` are server-only. Do not put them in `NEXT_PUBLIC_*` variables, commits, logs, or screenshots.

## 4. Configure the Convex owner boundary

Generate a separate vault-session signing secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set it in the Convex deployment:

```bash
npx convex env set OURCHIVAL_SESSION_SIGNING_SECRET <long-random-value>
```

Keep the recovery key during rollout:

```bash
npx convex env set OURCHIVAL_OWNER_ACCESS_KEY <different-long-random-value>
```

Set the allowed web origins:

```bash
npx convex env set OURCHIVAL_ALLOWED_ORIGINS "http://localhost:3000,https://app.ourchival.com"
```

## 5. Add the owner account

Sign in with Google once. Until the account is allowlisted, Ourchival shows the exact WorkOS user ID, such as `user_01H...`.

Add that ID to Convex:

```bash
npx convex env set OURCHIVAL_ALLOWED_WORKOS_USER_IDS "user_01H..."
```

Multiple owners may be listed with commas:

```bash
npx convex env set OURCHIVAL_ALLOWED_WORKOS_USER_IDS "user_first,user_second"
```

Reload Ourchival and sign in again.

## 6. Production variables

Repeat the Convex settings against production with `--prod`:

```bash
npx convex env set --prod OURCHIVAL_SESSION_SIGNING_SECRET <long-random-value>
npx convex env set --prod OURCHIVAL_OWNER_ACCESS_KEY <different-long-random-value>
npx convex env set --prod OURCHIVAL_ALLOWED_WORKOS_USER_IDS "user_01H..."
npx convex env set --prod OURCHIVAL_ALLOWED_ORIGINS "https://app.ourchival.com"
```

Confirm that the production WorkOS client ID is also available to the production Convex deployment.

## Release verification

1. Sign in with an account outside the allowlist and confirm the vault stays closed.
2. Add the intended WorkOS user ID and sign in with Google.
3. Confirm references, private originals, tags, boards, projects, searches, sessions, and enrichment panels load.
4. Create a Clipper pairing code and pair a browser.
5. Capture an image and confirm it appears in Inbox.
6. Revoke the browser and confirm its next capture is rejected.
7. Sign out and confirm the vault closes.
8. Unlock with the recovery key and confirm the break-glass path still works.

After this flow is stable in production, the recovery-key form can be hidden from normal UI while the server-side key remains available for emergency recovery.
