# Local development

## 1. Pull latest changes

```bash
git pull
pnpm install
```

## 2. Start Convex

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

## 3. Start the web app

In another terminal:

```bash
pnpm dev
```

Open:

```txt
http://localhost:3000
```

## 4. Build the Edge extension

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

## 5. Connect the extension

Open the Ourchival Clipper popup and paste the endpoint shown in the web app:

```txt
https://your-deployment.convex.site/capture
```

Click **Save endpoint**.

## 6. Test saving

Right-click an image in Edge and choose:

```txt
Save image to Ourchival
```

The extension badge will show a checkmark on success. The popup reports whether Convex stored the image file or only captured the source URL.

The Reliquary gallery refreshes every few seconds. It prefers stored Convex file URLs and falls back to the original image URL.

## Manual test path

Use the manual form on the Reliquary page:

- Source URL: any webpage/post URL
- Image URL: a direct image URL
- Title: optional

Click **Save reference** and the card should appear in the gallery.
