# 05: Reports browser

**What to build:** A Reports page listing `reports/*.md` (number, company, role, score, date, legitimacy) with a text filter, opening the **same stage-aware drawer** as the Applications rows when report numbers match a tracker row; unmatched reports open on the full-report tab directly.

**Blocked by:** 03 (Stage-focused position detail drawer)

**Status:** done

- [x] List renders from `/api/reports` with search on company/role
- [x] Click-through reuses the drawer; report open from this page does not duplicate parsing logic

## Comments

- 2026-10-24 (implement session): `GET /api/reports` (`listReports()` in `web2/lib/reports.mjs`, reusing `parseReportMeta`) returns header facts only, newest number first, no bodies. The page filters on company/role client-side. Click-through: a report whose number matches a tracker row's `reportNum` opens the existing `ApplicationDrawer`; otherwise a plain drawer renders `FullReport`. `FullReport` is the drawer's former "Full report" panel extracted into one component on the same `["report", num]` query key, so there is one fetch and one render path for report text. When two rows link the same report (the smoke fixture has rows 1 and 4 → 001) the first row wins. Verified: route test (Seam C), typecheck, smoke 17/17 (3 new steps: filter, linked → stage drawer, unlinked → full report).
