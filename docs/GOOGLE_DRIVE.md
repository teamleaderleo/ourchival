# Google Drive storage

Ourchival uses Google Drive as the preferred home for original image files.

Convex remains the catalog:

- references
- assets
- source snapshots
- tags
- boards
- projects
- project reuse notes

Drive stores the original file bytes. Ourchival renders private Drive files through the Convex `/drive-file?id=...` proxy, so the files do not need to be made public.

Drive also holds `ourchival-preferences.json`, a compact private review snapshot for connected tools. It contains reference IDs, decisions, triage state, review timestamps, titles, source/canonical URLs, character, artist/handle, platform, and source kind. It contains no image bytes or credentials.

## 1. Create Google OAuth credentials

In Google Cloud Console:

1. Create or select a project.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen.
4. Create a Web application OAuth client.
5. Add the production JavaScript origin:

```txt
https://app.ourchival.com
```

6. Add this local token-generation redirect URI:

```txt
http://127.0.0.1:53682/oauth2callback
```

The app uses the `https://www.googleapis.com/auth/drive.file` scope. That scope lets Ourchival create and manage files that Ourchival creates or that the user opens with the app.

## 2. Generate a refresh token

For an existing configured project, use the non-printing Convex update mode:

```bash
OURCHIVAL_GOOGLE_AUTH_USE_CONVEX=1 pnpm google:drive-auth
```

It reads the existing client credentials from the development deployment and writes the new refresh token directly to both development and production through stdin. It never prints the client secret or refresh token. The browser begins at a localhost redirect so the one-time OAuth state also stays out of terminal output. The backend `GOOGLE_CLIENT_ID` must match the public `NEXT_PUBLIC_GOOGLE_CLIENT_ID` configured for the web app.

## 3. Optional: choose a Drive folder

Create a folder in Google Drive, such as:

```txt
Ourchival/originals
```

Copy the folder ID from the URL and set it:

```bash
npx convex env set GOOGLE_DRIVE_PARENT_FOLDER_ID 'your-folder-id'
```

If this is omitted, Ourchival uploads to the root of your Drive.

## 4. Restart Convex

```bash
pnpm convex:dev
```

## 5. Test

Use the manual form or Edge extension to save an image. The status should say:

```txt
stored original asset in Google Drive
```

The inspector should show:

```txt
Asset: Google Drive original
```

and expose an **Open in Drive** action.

## Preference snapshot

`POST /preference-export` queues a bounded, paginated rebuild of the review projection. Subsequent Yes/Maybe/No reviews update only the affected projection row and schedule a coalesced Drive write. `GET /preference-export` reports queued, running, ready, or error status without exposing the Drive file ID.

The snapshot is updated in place so its Drive identity remains stable and connected Drive search can discover it by the exact name `ourchival-preferences.json`.

## Fallback behavior

If Drive env vars are missing or upload fails, Ourchival falls back to Convex Storage when it can fetch the image bytes. If the image cannot be fetched server-side, it still records the source URL and metadata.
