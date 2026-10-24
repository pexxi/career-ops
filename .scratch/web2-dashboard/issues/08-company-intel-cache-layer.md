# 08: Company intel — cache layer + drawer panel

**What to build:** A local, file-backed company-intel cache the drawer can show: Glassdoor-style review highlights (rating, review counts, notable pros/cons) and levels.fyi-style salary aggregates (median totals, level ranges, location) per company, stored as JSON snapshots under a gitignored `web2/data/company-intel/` (user data, not repo content). The drawer's intel panel renders whatever exists with **source + fetch date stamped on every item**; a graceful "no intel yet — capture it" state when a company has no snapshot. The app itself never scrapes live.

**Blocked by:** 03 (Stage-focused position detail drawer)

**Status:** done

- [x] Snapshot schema: `{ company, sources: [{ source, url, fetchedAt, kind: reviews|salaries, data }] }`; old snapshots never silently overwritten (fetch adds a dated entry)
- [x] Drawer panel keyed on tracker company name with normalization; missing company → friendly empty state
- [x] ADR: web2/docs/adr/0004-company-intel-is-a-local-cache.md (no live scraping from the app; provenance stamps mandatory)

## Comments

- 2026-10-24 (implement session): `web2/lib/intel.mjs` holds the cache: `readIntel(dir, company)` (null when absent, or for a keyless name like the tracker's `?` marker) and `addIntel(dir, company, entry)` (refuses missing provenance or an unknown kind, appends, writes via tmp + rename). Files are keyed by the core's `normalizeCompanyName()` from invite-match.mjs, which strips legal suffixes and keeps non-Latin scripts. `WEB2_DATA_DIR` overrides `web2/data`, and `web2/.gitignore` now ignores `data/`. `GET /api/intel?company=` is read-only. The drawer gets a lazy third tab, "Company intel", newest capture first, each item stamped `source · fetched DATE` (plus `data as of` for dataset entries), with the empty state pointing at `web2/scripts/capture-intel.md` (ticket 09). ADR 0004 written. Verified: 4 lib tests + 1 route test, typecheck, smoke (Google fixture snapshot shows both stamps, OpenAI shows the empty state).

- 2026-10-24 (review fix, two-axis review): the cache moved to `{data root}/data/web2/company-intel/` so it follows `CAREER_OPS_ROOT` (AGENTS.md: scripts resolve the data root through `getCareerOpsRoot()`); `WEB2_DATA_DIR` remains as a test override and the real Google snapshot was moved there. Writes go through the core's `replaceUserFile`, and `median` comes from `funnel-velocity.mjs`.
