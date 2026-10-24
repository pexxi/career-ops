# 06: Overview: KPIs + funnel

**What to build:** The Overview page as the cockpit landing: KPI cards (Deciding count, Active-process count, ever-Hired, average score), the ever-reached funnel as a bar chart (@mantine/charts), and a compact recent status-activity feed from the status ledger. All numbers computed from the same parsed files (no second engine, no guessing).

**Blocked by:** 01 (Foundation: make the dev shell run)

**Status:** done

- [x] Funnel shows ever-reached counts per canonical stage; a Deciding-only tracker still renders a sensible funnel (not zeros)
- [x] Activity feed shows the newest 30 transitions with from → to and dates
- [x] Cards click through to the Applications page pre-filtered to that lens

## Comments

- 2026-10-24 (implement session): `GET /api/overview` → `overview()` in `web2/lib/overview.mjs`, fed by the same `loadApplications()` join `/api/applications` uses plus the raw ledger. The funnel is the core's cumulative-stage contract (`recoverFunnelStages` + `parseStatusLogStages` from `funnel-stages.mjs`, ranks 0-6), so a row now Rejected that the ledger shows came from Interview counts through Interview. "Evaluated" is rank 0 (every non-SKIP row), which is why a Deciding-only tracker shows one full bar instead of zeros. KPIs: Deciding/Active counts by stage lens, Ever hired = rank 6, average score over parsed scores (sentinels excluded). Activity = the newest 30 ledger transitions across rows. Cards link to `#applications/{lens}`; the App now derives the page from the hash and keys the Applications page on it, so the lens follows the hash. The overview query key is `["applications","overview"]`, so a status change's `["applications"]` invalidation refreshes it too. Verified: 2 route tests (smoke fixture + a deciding-only temp tracker), typecheck, smoke 19/19.

- 2026-10-24 (review fix, two-axis review): the "Ever hired" card no longer links. It counts rows that ever reached Hired, while `#applications/closed/Hired` listed only rows Hired now, so the number and the list could disagree. The `closed/{status}` hash segment that pre-set a status filter is gone with it.
