# Fork architecture and feature inventory

This checkout is a fork of [career-ops-hq/career-ops](https://github.com/career-ops-hq/career-ops).
Upstream's own architecture is in `docs/ARCHITECTURE.md`. This file covers only
what the fork adds: what each feature is for, where it lives, and how to keep it
on top of upstream.

## Branch model

| Branch | Contents |
|---|---|
| `main` | Exactly `upstream/main`. Never commit here. |
| `feat/local-fork` | `main` plus the fork commits, one per feature (below). |

Remotes: `upstream` = career-ops-hq/career-ops, `origin` = pexxi/career-ops.
User data (`cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml`,
`data/`, `reports/`, ...) is gitignored, so switching or rebasing branches
never touches it.

### Updating from upstream

Use git, not `update-system.mjs apply`. The updater copies files over the
checkout and keeps any file you changed at its old version. Git rebases the
fork commits on top of the new upstream code.

```bash
git switch main && git fetch upstream && git reset --hard upstream/main && git push --force-with-lease origin main
git switch feat/local-fork && git rebase main
# resolve conflicts per feature (see "Where it hooks in"), then:
node test-all.mjs && (cd dashboard && go test ./...) && (cd web && npm test)
npm install && node build-dashboard.mjs
git push --force-with-lease origin feat/local-fork
```

When a rebase conflict is large, re-implement the feature from its description
below rather than forcing the old code in. That is how this fork was rebuilt on
2026-10-15.

### Keeping fork code out of upstream's way

- New files where possible. Root files are declared in `config/local-paths.txt`
  (the updater never writes them; the coverage guard accepts them). New files
  inside upstream directories (`dashboard/`, `providers/`, `tests/`, `web/`,
  `docs/`) cannot be declared there and need no declaration.
- Edits to upstream files are small hooks marked with a `Fork:` comment.

## Features

### 1. Bulk status changes (dashboard and web)

**Need:** set one status on many tracker rows at once, safely.
- **Atomic.** Every row is written or none: one tracker lock, one write. If any row id is unknown or duplicated, nothing is written.
- **No Hired in bulk.** A landed job is one row, so Hired is never offered for more than one row.
- **Discarded and SKIP need a reason.** It is appended to each row's notes as `DISCARD: …` or `SKIP: …`.
- **Bookkeeping matches single-row changes.** Every row that really changed gets a status-log line, and rows that became Applied get their first follow-up seeded.

**Where:**
- `set-status-bulk.mjs` (root, fork-owned). Usage: `--rows N,N <state> [--note] [--on] [--source set-status|web] [--dry-run] [--json]`.
  - Exit codes: 0 applied, 1 usage, 2 or 3 when a single named row is not found or ambiguous, 4 lock busy, 5 batch rejected.
  - The JSON output carries per-row `outcomes` (changed, unchanged, notFound, ambiguous).
  - Tests: `tests/set-status-bulk.test.mjs`.
- Dashboard (TUI pipeline):
  - Keys: space toggles a row, `A` toggles all visible rows, Esc clears, `c` opens the bulk status picker (Discarded and SKIP open the reason picker).
  - Code: `internal/ui/screens/pipeline_bulk.go` and `internal/data/status_bulk.go`.
  - Hooks: `pipeline.go` (the `selected` and `bulkRows` fields, preserving them on reload, keys, the picker branches, the `✓` marker, the help line) and `main.go` (the `PipelineBulkStatusMsg` handler).
- Web (pipeline table, built on upstream's own bulk bar):
  - `src/lib/status-bulk.mjs` parses `{ns, status, reason}` and maps exit codes to HTTP: 0 → 200, 5 → 409 (with the document), 2 → 404, 3 → 409, 4 → 503.
  - `src/lib/pipeline-status-bulk.mjs` is the client side: one request per bulk change, plus the shift-range helper.
  - Hooks:
    - `src/app/api/status/route.ts`: an `ns` branch.
    - `src/components/pipeline-view.tsx`: the reason field, Hired filtered out, shift-click ranges, Esc to clear, a sticky bar, the changed/unchanged notice, deselecting failed rows on a rejected batch, and checkboxes disabled for rows without a numeric #.
  - Tests: `web/tests/lib/status-bulk.test.mjs`.

### 2. Google Careers scan provider

**Need:** scan Google's own careers site, which no ATS API covers.
- Query and locations come from `portals.yml` (`provider: google-careers`, `google.query`, `google.location`).
- Paginates up to the "Showing X to Y of Z" total and sends at most four locations per request.
- Dedups jobs across location batches.

**Where:** `providers/google-careers.mjs`, which upstream's registry loads automatically. It uses the shared `sleep` from `_http.mjs`, as upstream requires.
- Offline test: `tests/providers/google-careers.test.mjs`.
- Live check: `node scan.mjs --company Google --dry-run`.

### 3. Batch prescreen gate

**Need:** skip clearly out-of-scope postings before an LLM worker runs, at zero token cost.
- Checks the location scope and the tech stack against `config/profile.yml`.
- Fail-open: only positive evidence of a mismatch skips a posting, and thin or ambiguous JDs pass through.
- Every skip is recorded in `batch-state.tsv` and `logs/discard.log`.

**Where:** `batch-prescreen.mjs` (root, fork-owned), plus one hook in `batch/batch-runner.sh` after upstream's JD fetch and ATS API fallback.
- The fork's old ATS JSON-API prefetch was dropped: upstream's `fetch-jd.mjs` (#4246) covers the same boards and more.

### 4. Dashboard location priority

**Need:** show the posting's real location.
- Notes often mention other cities (for example "row #4 (Stockholm FDE) already used a slot"), so a regex over the notes can pick the wrong one.
- Priority: the tracker Location column, then the ATS location from `data/scan-history.tsv` (matched by normalized posting URL), then the notes regex.
- "Remote DE" and "Hybrid NY" are work mode plus region, not a US city and state.

**Where:** `dashboard/internal/data/location_fork.go`, with tests in `location_fork_test.go`.
- Hooks: `career.go` (`locFromColumn` and `preferScanHistoryLocations`) and `stats.go` (the work-mode rule in `isFalseCityState`).
- Upstream already had the Location-column tier.

### 5. Wider web layouts

**Need:** use the screen width on the working pages.

**Where:** Apply (including `apply-view.tsx`), Jobs, Job detail and Portals use `max-w-6xl`, like upstream's `PageFrame`. Their `loading.tsx` skeletons match.
- Analytics and the report view are already wide upstream.

### 6. Housekeeping

- `AGENTS.md`: a neutral intro instead of the upstream author's origin story.
- `package.json`: `npm run dashboard` builds and serves the TUI.
- `.gitignore`: a fork section at the end (`scratch/`, and `config/local-paths.txt` tracked).

## Planned, not implemented

- **Weighted location preference scoring.** The design is in `docs/superpowers/specs/2026-08-28-weighted-location-scoring-design.md`: ranked location preferences instead of a flat accept list.

## Dropped (covered upstream)

- `tracker-utils.mjs` exports (`CONTROL_CHARS`, `resolveWorkspaceRootFor`): upstream has them.
- The dashboard spawning `set-status.mjs` for single rows: upstream does it, with lifecycle repair.
- The ATS JSON-API JD prefetch: upstream's `fetch-jd.mjs`.
- The web tracker `location` field: upstream has it.
