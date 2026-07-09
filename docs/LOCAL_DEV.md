# Local development

## 1. Pull latest changes

```bash
git pull
pnpm install
```

## 2. Optional: connect Google Drive storage

Follow [`GOOGLE_DRIVE.md`](GOOGLE_DRIVE.md) when you want originals to land in Drive.

Without Drive env vars, Ourchival falls back to Convex Storage when it can fetch image bytes.

## 3. Start Convex

```bash
pnpm convex:dev
```

Keep this terminal open. Convex will print the deployment URL and HTTP Actions site URL.

If `.env.local` does not include the site URL, add it manually:

```bash
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://your-deployment.convex.site
```

The web app derives `.convex.site` from `.convex.cloud` when possible, but the explicit value is clearer.

## 4. Start the web app

In another terminal:

```bash
pnpm dev
```

Open:

```txt
http://localhost:3000
```

## 5. Build the Edge extension

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

## 6. Connect the extension

Open the Ourchival Clipper popup and paste the endpoint shown in the web app:

```txt
https://your-deployment.convex.site/capture
```

Click **Save endpoint**.

## 7. Test saving

Right-click an image in Edge and choose:

```txt
Save image to Ourchival
```

The extension badge will show a checkmark on success. The popup reports whether the image landed in Google Drive, Convex Storage fallback, or linked-only mode.

The Reliquary gallery refreshes every few seconds. Drive-backed originals render through the `/drive-file?id=...` proxy.

## Manual test path

Use the manual form on the Reliquary page:

- Source URL: any webpage/post URL
- Image URL: a direct image URL
- Title: optional

Click **Save reference** and the card should appear in the gallery.
