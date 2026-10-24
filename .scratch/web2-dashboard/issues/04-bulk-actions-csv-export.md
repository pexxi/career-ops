# 04: Bulk actions + CSV export

**What to build:** Manage-the-batch tools on the Applications table: multi-row selection (per-lens scope visible in the header, e.g. "3 selected"), bulk state change in a confirm modal (sequential `set-status.mjs` calls with per-row progress and a partial-failure report), and CSV export of the current filtered row set (client-side, includes the visible columns).

**Blocked by:** 03 (Stage-focused position detail drawer)

**Status:** done

- [x] Selection survives lens/filter changes (or is cleared loudly — pick one and note it in the PR)
- [x] Bulk change runs one row at a time; a row failing mid-batch stops and reports which rows applied, which didn't
- [x] CSV matches what the table shows, filename `applications-{lens}-{date}.csv`

## Comments

**Selection policy — cleared loudly (the ticket's pick-one, taken the safe way).**
A lens or status-filter change drops the selection and says so in a
notification ("Selection cleared — …"). Carrying a selection into a view that
no longer shows those rows invites a batch the user cannot see. The count is
rendered from the rows in view (`selectedRows`), not from the raw set, so a row
that leaves the lens (a drawer status change, a refetch) can never be batched
silently. A checkbox tick does not open the row's drawer
(`stopPropagation`), and "select all" means all rows in view.

**Bulk change goes through the same write path, one row at a time.**
`runSequential()` (`web2/lib/bulk.mjs`, unit-tested) calls `POST /api/status`
per row → `set-status.mjs --row N`. No bulk server route: a second write path
would be a second place for validation to drift. The loop stops at the first
failure (nothing is written past an unseen error) and returns
`{applied, failed, notAttempted}`, which the modal renders in full and a
notification summarises. Rows that applied leave the selection; the failed row
and the untouched ones stay selected so a corrected retry is one click away.
Progress is per-row (`Row #N — 2 of 5` + a Progress bar) because the loop runs
in the client, not behind one long request.

**CSV is built client-side from the rows the table shows**, in the table's
order, with the visible columns (`#, Date, Company, Role, Score, Status, Last
transition`). `web2/lib/csv.mjs` (unit-tested) does RFC 4180 quoting and the
`applications-{lens}-{date}.csv` filename — the date is the user's LOCAL
calendar day, since `toISOString()` would date a 23:30 export as tomorrow.
Score cells print with the table's own `scoreText()` rule, so sentinels stay
`—`/`N/A` instead of turning into `0` or `NaN`.

**Verification:** 48 unit tests (11 new across `tests/bulk.test.mjs` and
`tests/csv.test.mjs`), typecheck clean, smoke 14/14 — the three new smoke
steps prove the header count, a two-row bulk write landing on disk, and a
downloaded CSV matching the visible rows. The mid-batch failure path is unit
tested, not smoke tested (no fixture row fails on demand).
