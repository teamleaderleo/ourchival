# Local development

## 1. Pull latest changes

Use Node 22.11 or newer, then install the workspace:

```bash
git pull
pnpm install
```

## 2. Configure WorkOS AuthKit

Follow [`WORKOS_AUTH.md`](WORKOS_AUTH.md) to connect a WorkOS environment and enable Google.

Add the local web values to `.env.local`:

```bash
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY=sk_...
WORKOS_COOKIE_PASSWORD=<at-least-32-random-characters>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
```

Keep the API key and cookie password outside commits, logs, screenshots, and `NEXT_PUBLIC_*` variables.

## 3. Start Convex

```bash
pnpm convex:dev
```

Keep this terminal open. Convex will configure or link the WorkOS development environment and print the deployment URL and HTTP Actions site URL.

If `.env.local` does not include the Convex URLs, add them manually:

```bash
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://your-deployment.convex.site
```

Configure short-lived vault sessions, recovery access, and local HTTP origins:

```bash
npx convex env set OURCHIVAL_SESSION_SIGNING_SECRET <long-random-value>
npx convex env set OURCHIVAL_OWNER_ACCESS_KEY <different-long-random-value>
npx convex env set OURCHIVAL_ALLOWED_ORIGINS "http://localhost:3000"
```

Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 4. Start the web app

In another terminal:

```bash
pnpm dev
```

Open:

```txt
http://localhost:3000
```

Select **Continue with Google**. On the first sign-in, the vault shows the exact WorkOS user ID until it is allowlisted.

Set that ID in Convex:

```bash
npx convex env set OURCHIVAL_ALLOWED_WORKOS_USER_IDS "user_01H..."
```

Reload the page. The allowed account should enter the vault without typing the recovery key.

## 5. Optional: connect Google Drive storage

Follow [`GOOGLE_DRIVE.md`](GOOGLE_DRIVE.md) when you want originals to land in Drive.

Without Drive environment variables, Ourchival falls back to Convex Storage when it can fetch image bytes.

## 6. Build the Edge extension

For active extension work:

```bash
pnpm extension:dev
```

For a one-off build:

```bash
pnpm extension:build
```

Then open Edge:

```txt
edge://extensions
```

Turn on Developer mode, choose **Load unpacked**, and select:

```txt
apps/extension/dist
```

Reload the unpacked extension after rebuilding it.

## 7. Pair the extension

1. In the signed-in web vault, open **Clipper access**.
2. Create a one-time pairing code.
3. Open the Ourchival Clipper popup.
4. Enter the Convex site URL without `/capture`:

```txt
https://your-deployment.convex.site
```

5. Enter a recognizable browser name and the pairing code.
6. Select **Pair browser**.

The extension stores a separate revocable device credential. It never stores the WorkOS session, vault token, or recovery key.

## 8. Test saving

Right-click an image in Edge and choose:

```txt
Save image to Ourchival
```

The extension badge will show a checkmark on success. The popup reports whether the image landed in Google Drive, Convex Storage fallback, or linked-only mode.

The Reliquary gallery refreshes every few seconds. Drive-backed originals render through the authenticated `/drive-file?id=...` proxy.

Then open **Clipper access**, revoke the browser, and confirm its next capture is rejected. Pair it again to continue testing.

## Manual test path

Use the manual form on the Reliquary page:

- Source URL: any webpage/post URL
- Image URL: a direct image URL
- Title: optional

Click **Save reference** and the card should appear in the gallery.
