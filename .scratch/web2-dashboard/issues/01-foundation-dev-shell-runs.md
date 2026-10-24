# 01: Foundation: make the dev shell run

**What to build:** Open `npm run dev` in `web2/` and get the full-width app shell — header (app name, refresh, light/dark toggle), left side nav (Overview / Applications / Reports / System), footer (loopback + "nothing submitted for you" line) — with stub pages so the app builds and routes by hash. Seed `web2/GLOSSARY.md` with the terms the UI is already named by (Application, State, Stage, Funnel, Write path).

**Blocked by:** None (can start immediately).

**Status:** done

- [x] `npm run dev` starts API (:4001) + Vite (:3001) with one command and no build error
- [x] All four nav items render stub pages; hash nav + refresh button work
- [x] Color scheme defaults to system preference; toggle persists via localStorage
- [x] `web2/GLOSSARY.md` exists with the five seeded terms
- [x] `npm test` (15 parser tests) still passes; `npm run typecheck` clean

## Comments

- 2026-10-24 (implement session): claimed and closed. What was already in the tree did the work; the gaps were tooling and wiring: vite/@vitejs/plugin-react/@tabler/icons-react/typescript were never installed, `localStorageColorSchemeManager` got `{ key: ... }` (Mantine v9 API), `serveStatic` moved to the `@hono/node-server/serve-static` subpath export in v2, a `styles.d.ts` for the CSS side-effect imports, `src/pages.tsx` with the four stubs, and `GLOSSARY.md` seeded. Verified by smoke test (:3001 → 200, :4001 → 404-on-bare-root = listening), `vite build` clean, 15/15 parser tests, typecheck clean. Committed as the first web2 commit on feat/local-fork: 72e81714. Hash route + refresh via queryClient.invalidateQueries were already wired in App.tsx.
- 2026-10-24 (implement session, verification): re-verified after tickets 05-11 and closed. `npm run dev` brings up the API on :4001 and Vite on :3001 with no build error. `localhost:3001/` returns 200, and `/api/system` through the Vite proxy returns 200. Vite binds `localhost` (IPv6 on this machine), so `127.0.0.1:3001` refuses in dev; the production server binds 127.0.0.1. In Playwright: `#reports` deep-links to Reports; with system preference dark the app starts dark, and the toggle persists across a reload (light); all five nav items (Overview, Applications, Reports, System, Profile) route by hash and render their page heading; the refresh button runs without error. GLOSSARY.md has the five seeded terms plus later additions. `npm test` 75/75, typecheck clean, smoke all green.
