# 03: Stage-focused position detail drawer

**What to build:** Clicking a row opens the position detail drawer showing **only facts relevant to the row's current stage** — the answer to "I don't need interview sections while deciding whether to apply":

- **Deciding** → decision card: score, legitimacy, `final_decision`, hard stops, soft gaps (parsed from the report's Machine Summary), external posting link.
- **Active** → status history timeline + notes + posting link; no decision content.
- **Closed** → one outcome line + notes.

The full report and its JD archive are available on a second, deliberate click (tab/expand), never dumped on-screen by default. Single-row status change with optional note works (sequential write via the core's `set-status.mjs`, the single write path). Record the stage-focus model as ADR 0003.

**Blocked by:** 02 (Applications table + stage lens)

**Status:** done

- [x] Drawer content differs per stage per the mapping above; full report hidden behind an explicit tab
- [x] Machine Summary fields parse client-side from the report payload (no second server parse layer)
- [x] Status change updates tracker via set-status.mjs; on success the table + drawer reflect the new state (query invalidation); on failure the error is surfaced, nothing silently reroutes
- [x] ADR written: web2/docs/adr/0003-stage-focus-in-detail-view.md

## Comments

- 2026-10-24 (implement session): claimed and closed. `drawerContent` in `web2/lib/stage.mjs` is the stage-focus seam — one fixed model shape per stage, with the cross-stage leaks pinned by `web2/tests/stage.test.mjs` (deciding has no history, active has no decision content, closed collapses to one outcome line). Drawer **content** is keyed by row, never the Mantine `Drawer` itself: remounting the Drawer per row hands the old instance's exit transition to the shared portal, and every drawer after the first mounts hidden — found by the new smoke suite, fixed in `src/pages.tsx`. Machine Summary parses client-side via the existing `lib/reportfields.mjs`; the report payload is fetched lazily (deciding card, or the "Full report" tab) from `/api/reports/:num`. A deciding row with no linked report, or a failed report fetch, now says so instead of rendering a card of em-dashes. Rows are reachable by keyboard (Enter opens the drawer), not mouse-only.

Status writes go through `POST /api/status` → `set-status.mjs`; success invalidates `applications`+`stats` (the drawer re-derives its row by num from the fresh payload), failure surfaces `SET_STATUS_FAILED`'s explanatory stderr in a notification. **Review fix:** the route had been passing the bare numeric selector (`<num> <state>`); the core's own guard rejects that once tracker # and report link diverge — which is the normal state of the real tracker (row 2 → report 214) — so the drawer's primary action would have failed on most rows. It now passes `--row N`, the explicit tracker-row selector. Both sides are pinned in `web2/tests/server-routes.test.mjs`: a diverged row (`tracker-report-mismatch` fixture, only meaningful when written under `--row`) must change, and a missing row must come back as `SET_STATUS_FAILED` with the CLI's message, never a silent success.

New `npm run smoke` (`web2/smoke.mjs`, requested by the maintainer mid-ticket; Playwright resolved from the repo-root install): builds the SPA, serves production Hono against a throwaway copy of `tests/fixtures/smoke`, walks all four screens + deciding/active/closed drawer content + the full-report tab + a real status write on a row whose report link disagrees with its #, and fails on any page/console error. Verified: 37/37 unit tests, typecheck clean, smoke 11/11.

- 2026-10-24 (review fix, two-axis review): Machine Summary fields now come with `GET /api/reports/:num` as `summary`, parsed server-side by the core's `parseMachineSummary` (analyze-patterns.mjs). This reverses "parse client-side, no second server parse layer": the hand-written client parser (`lib/reportfields.mjs`, deleted) missed list items written at column 0, which is how real reports write `hard_stops` / `soft_gaps`, so those cards came up empty. ADR 0003 updated. Pages split out of `src/pages.tsx` into one file per page plus `src/drawer.tsx`.
