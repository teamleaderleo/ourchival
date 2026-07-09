# Domain plan

The owned domain is:

```txt
ourchival.com
```

## Recommended layout

```txt
ourchival.com          marketing / landing page later
www.ourchival.com      redirect to ourchival.com
app.ourchival.com      Reliquary web app
clip.ourchival.com     optional extension install/help page later
api.ourchival.com      optional custom API/capture domain later
```

For the current build, use:

```txt
app.ourchival.com
```

for the Next.js app and keep the Convex `.convex.site` URL for HTTP actions until custom API routing is worth setting up.

## Vercel setup

Deploy `apps/web` to Vercel, then add these domains to the Vercel project:

```txt
app.ourchival.com
ourchival.com
www.ourchival.com
```

Recommended behavior:

```txt
app.ourchival.com      private app
ourchival.com          landing page / redirect / future public home
www.ourchival.com      redirect to ourchival.com
```

Vercel will show the DNS records to add at the domain registrar. Subdomains usually use a CNAME record. Apex/root domains usually use an A record or Vercel nameservers.

## Environment variables

For production web hosting:

```bash
NEXT_PUBLIC_APP_URL=https://app.ourchival.com
NEXT_PUBLIC_CONVEX_URL=https://your-production-deployment.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://your-production-deployment.convex.site
```

For the extension popup, paste the production capture endpoint when you want saves to go to production:

```txt
https://your-production-deployment.convex.site/capture
```

Later, if `api.ourchival.com` is wired to Convex or a proxy, the extension endpoint can become:

```txt
https://api.ourchival.com/capture
```

## Security note

Do not expose the vault publicly. The domain is for a nicer URL, not a public gallery by default.

The app should eventually require sign-in before loading references, Drive files, source metadata, boards, projects, or export history.
