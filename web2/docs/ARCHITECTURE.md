# web2 architecture

web2 is a local-first cockpit over the career-ops markdown files. It runs on
loopback only, and the markdown stays the source of truth. Vocabulary:
`../GLOSSARY.md`. Decisions: `adr/`.

## Processes

- `npm run dev` (`dev.mjs`): Hono API on :4001 plus Vite on :3001 (proxying `/api`).
- `npm start`: one Hono server that also serves the built SPA from `dist/`.
- `server/index.mjs` binds a port only when it is the entrypoint, so tests
  import the `app` and call `app.request()` with no socket.

## Layers

```
src/ (React + Mantine + TanStack Query)   pages.tsx, profile.tsx, App.tsx (hash routing)
   │  fetch /api/*  (src/lib/api.ts: typed fetchers)
server/index.mjs (Hono routes; thin: validate, call lib, map errors to status codes)
   │
lib/*.mjs (plain, unit-tested modules; browser-safe ones are imported by src/ too)
   │
core career-ops modules (../../*.mjs): path-resolver, tracker-parse, funnel-stages,
funnel-velocity, invite-match, linkedin-join, lib/yaml-document, set-status.mjs
```

Rule: **orchestrate the core, never reimplement it.** Paths, tracker parsing,
the status ledger, the funnel, company-name normalization, CSV and YAML parsing
all come from the core modules.

## Data the app reads

| Data | Where | Reader |
|---|---|---|
| Tracker | `{data root}/data/applications.md` (core resolver) | `lib/tracker.mjs` |
| Status ledger | `status-log.tsv` beside the tracker | `lib/statuslog.mjs` (core replay) |
| Reports | `{data root}/reports/NNN-*.md` | `lib/reports.mjs` |
| Candidate profile | `config/profile.yml`, `cv.md`, `modes/_profile.md`, `voice-dna.md` | `lib/profile.mjs` |
| Company intel | `web2/data/company-intel/*.json` (gitignored) | `lib/intel.mjs` |
| Coach transcripts | `web2/data/chat/*.jsonl` (gitignored) | `lib/coach.mjs` |
| Coach config | `web2/config.json` (gitignored) | `lib/coach.mjs` |

Env overrides: `CAREER_OPS_ROOT` / `CAREER_OPS_DATA_DIR` / `CAREER_OPS_TRACKER` /
`CAREER_OPS_PROFILE` (core), `WEB2_DATA_DIR`, `WEB2_CONFIG`, `WEB2_PORT`.

Error contract: a missing file (ENOENT → 404, "missing") is a different state
from a malformed one (parse error → 500, "broken"). The System page shows both.

## Pages and routes

| Page | Routes | Notes |
|---|---|---|
| Overview | `GET /api/overview` | KPIs, ever-reached funnel (`funnel-stages.mjs` ranks), newest 30 transitions. Cards link to `#applications/{lens}`. |
| Applications | `GET /api/applications`, `POST /api/status` | Stage lens, drawer (ADR 0003), bulk change, CSV. |
| Reports | `GET /api/reports`, `GET /api/reports/:num` | Linked report opens the application drawer; unlinked opens `FullReport`. |
| Drawer intel tab | `GET /api/intel?company=` | Read-only cache view (ADR 0004). |
| System | `GET /api/system` | Data root, which precedence rung chose it, node version, three file checks. |
| Profile | `GET /api/profile`, `POST /api/profile/apply` | Four-file view plus Profile apply. |
| Profile coach | `GET /api/profile/coach[/:session]`, `POST /api/profile/chat` | Thin Claude call (ADR 0005). |

## Write paths (the only ways web2 changes user files)

1. **Status change**: `POST /api/status` spawns the core `set-status.mjs --row N`.
   Bulk changes call it row by row from the client.
2. **Profile apply**: `POST /api/profile/apply` with `{file, patch, dryRun}`.
   The file is one of four names, never a client path. `applyPatch()` is strict:
   each hunk must match exactly at its stated line, and the text is patched,
   never re-serialized. The UI requires a clean dry-run preview before Apply.
3. **Company intel**: only `scripts/intel.mjs` (`add`, `import`) writes, outside
   the server, through `addIntel()`: provenance required, append-only.
4. **Coach transcripts**: append-only JSONL. The coach never writes profile files;
   its diff proposals pre-fill Profile apply.

## Untrusted content

Report text, captured intel and coach replies are external content. React
renders them as text or markdown, and the coach's system prompt is fixed: attached
reports go in tagged data blocks with closing tags neutralized.

## Tests

- `npm test`: `node --test tests/*.test.mjs`. Lib seams plus server routes via `app.request()`.
- `npm run typecheck`: `tsc --noEmit`.
- `npm run smoke`: builds, serves against a temp copy of `tests/fixtures/smoke`,
  and drives every page in Playwright. The coach runs against a local fake
  Messages endpoint (`ANTHROPIC_BASE_URL`).
