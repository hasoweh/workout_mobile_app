# Workout Tracker

Offline-first workout logger, built as a PWA. All data stays on the device in IndexedDB. See [PROJECT_BRIEF.md](PROJECT_BRIEF.md).

**Stack:** Vite + TypeScript, Dexie (IndexedDB), Chart.js, vite-plugin-pwa (manifest + Workbox service worker).

## Commands

```sh
npm install
npm run dev        # dev server, also exposed on the LAN (--host)
npm run build      # typecheck + production build to dist/
npm run preview    # serve dist/ (service worker active)
npm run icons      # regenerate PNG icons from public/icon.svg
```

## Layout

```
src/
  main.ts          entry: registers service worker, requests persistent storage, starts router
  db.ts            Dexie schema + types (exercises, workouts, sets), default exercise seed
  router.ts        hash router (#/log, #/history, ...)
  views/           one module per tab
  styles.css       theme tokens (auto dark mode), large tap targets
public/            icons (generated from icon.svg)
```

## Testing on the phone

Service workers only run over HTTPS or on `localhost`, so a plain `http://<pc-ip>:5173` on the phone loads the app but **won't install it or work offline**. Options:

- **GitHub Pages (simplest):** push to `main` on GitHub, then set Settings → Pages → Source to "GitHub Actions". The workflow in `.github/workflows/deploy.yml` builds and deploys. Open the URL in Chrome on the phone, then use ⋮ → "Install app".
- **USB port forwarding:** enable USB debugging, open `chrome://inspect` → Port forwarding on the PC, forward `5173` → `localhost:5173`, then open `localhost:5173` on the phone.

WSL note: the dev server runs inside WSL, so LAN access may need port forwarding from Windows or WSL mirrored networking.
