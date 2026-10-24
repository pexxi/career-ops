# 0003 — Stage focus in the detail view

The application detail drawer answers "what do I need right now", not "show me
everything about this application": dumping a whole evaluation on open buries
the answer. Each application therefore shows only the facts its current
**Stage** (GLOSSARY) can use — deciding (score, legitimacy, `final_decision`,
hard stops, soft gaps), active (status-log timeline + notes), closed (one
outcome line) — and the full report, including its archived JD, stays behind a
separate, deliberate "Full report" tab.

**Decision:** the stage-to-facts mapping lives in one tested seam,
`web2/lib/stage.mjs` → `drawerContent(row, fields)`, which returns a fixed
model shape with the other stages' fields left `undefined` — a stage cannot
leak into the card because the React layer only renders what the model carries,
never decides. Machine Summary fields come with the report payload, parsed
server-side by the core's `parseMachineSummary` (`analyze-patterns.mjs`), so the
project has one YAML parser for them; the report payload itself is fetched
lazily (deciding rows, or the full-report tab). (Revised: the first version
parsed client-side with a hand-written line parser, which missed list items
written at column 0, the shape real reports use.) Status changes stay on the one write path: the drawer posts to
`/api/status`, which delegates to the core's `set-status.mjs` with `--row N` —
the explicit tracker-row selector, because a bare `#N` becomes ambiguous once
row IDs and report links have diverged.
