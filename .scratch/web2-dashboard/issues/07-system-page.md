# 07: System page

**What to build:** Honest health surface: which files the app reads (tracker, status ledger, reports dir), each marked ok / missing / error with its resolved path and data root, plus the distinction the data layer already makes — a missing file (ENOENT) and a malformed file (parse error) are different states the user can act on. Show the resolved CAREER_OPS_ROOT precedence result so a wrong env var is diagnosable in one look.

**Blocked by:** 01 (Foundation: make the dev shell run)

**Status:** done

- [x] Three check cards from `/api/system`; missing ≠ broken ≠ healthy
- [x] Data root + status-log path shown verbatim; node version shown

## Comments

- 2026-10-24 (implement session): `GET /api/system` returns `{dataRoot, rootSource, node, checks[]}`. Each check (tracker, status ledger, reports dir) runs its real reader: ENOENT → `missing`, any other throw → `error` with the message, otherwise `ok` with a count. The ledger is parsed with the core's `parseStatusLog`, and any unparseable line marks it broken with the first line and reason, which is stricter than the Applications page (that one skips such lines). `rootSource()` in `web2/lib/paths.mjs` only labels which precedence rung applied (env CAREER_OPS_ROOT / env CAREER_OPS_DATA_DIR / marker / repo default). The path itself still comes from the core resolver. Verified: route test across smoke / tracker-ok / tracker-broken / tracker-missing fixtures, typecheck, smoke (System step now checks the data root, rootSource, 3 OK badges and the ledger path).
