# Deploying GymGo

The app is a static single page app. There is no server, no API routes and no
build-time secrets — a plain static host is all it needs.

## Vercel, once

1. **Import the repo.** Vercel → Add New → Project → import `liamdaly122/GymGo`.
2. **Framework preset: Vite.** It should be detected automatically; `vercel.json`
   pins the build command and output directory regardless.
3. **Environment variables.** None are required for the local-only build. When
   Supabase is added, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for
   both Production and Preview. Only ever the **anon public** key — the service
   role key stays in the Supabase dashboard.
4. **Deploy.** Pushes to `main` deploy production; branches get preview URLs.

## Installing on the phone

Open the **production domain** in Safari, then Share → Add to Home Screen.

> Install the production URL only. Installing a preview URL as well would give
> you two service workers and two separate local databases on the same phone,
> with your history split between them and no way to merge it.

To verify the install worked:

- The app should open without Safari's address bar.
- Turn on aeroplane mode and reopen it. It must load and log a workout normally.
  If it does not, the service worker did not install — reopen in Safari, wait a
  few seconds and re-add.

## Caching

`vercel.json` sets long immutable caching on hashed assets and no-cache on
`sw.js` and the manifest. That combination is what lets a new deploy actually
reach an installed app: the service worker is re-checked on every launch, and it
pulls the new hashed assets. `registerType: 'autoUpdate'` then swaps them in.

## Verifying a build before it reaches the phone

```bash
npm run build      # typecheck + production build
npm run preview    # serve dist/ locally on :4173
npm run test       # domain rules
npm run test:e2e   # drives a real browser through the whole flow
npm run test:offline  # installs the service worker, cuts the network, logs a workout
```

`test:offline` is the one that matters most: it is the gym-basement case the
whole architecture exists for.
