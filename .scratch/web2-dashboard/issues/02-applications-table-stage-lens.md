# 02: Applications table + stage lens

**What to build:** The Applications page shows the parsed tracker as a sortable, filterable table with a **stage lens** — SegmentedControl `Deciding / Active process / Closed / All`, defaulting to Deciding — so the default view only shows applications you are deciding whether to pursue. Status badges carry the canonical-state colors; a status filter chip narrows within the lens. This is a complete vertical slice: API already exists, this ticket wires table UI to it.

**Blocked by:** 01 (Foundation: make the dev shell run)

**Status:** done

- [x] Table renders every tracker row with #, date, company, role, score, status, last transition; malformed rows appear as a visible warning, never silently
- [x] Lens defaults to Deciding and filters rows via the stage model (`stageOfStatus`); All shows everything
- [x] Sorting on date/company/score columns; score sentinels (—/N/A) sort last, not as NaN
- [x] Malformed-file case surfaces as an error state with the parse warning text (missing file ≠ broken file)
