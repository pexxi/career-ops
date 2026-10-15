# Weighted Location Preference Scoring — Design

**Date:** 2026-08-28
**Status:** Approved design, not yet implemented
**Branch:** `feat/weighted-location-scoring`

## Problem

career-ops knows *whether* a location is acceptable. It never knows *how much* the
candidate prefers one.

- `config/profile.yml → location.target_countries` and `us_target_locations` are flat
  lists. Finland, Sweden, Germany, Spain and Mountain View rank identically. Neither key
  is read by any script or mode — they are prose.
- `portals.yml → location_filter` (applied by `buildLocationFilter`, `scan.mjs:278`) is
  binary: `always_allow` / `allow` / `block` / `block_hard`. Jobs pass or are dropped;
  nothing is ranked.
- `modes/triage.md:67,76` already weights a `location` dimension at **25%** of the triage
  score, but `modes/_brief.md:53` scores it purely on *work mode* (remote / hybrid /
  on-site / travel). Geography contributes nothing.
- The full evaluation (`modes/_shared.md` five dimensions) has no location dimension at
  all. Location appears only in `modes/oferta.md` Block A's Remote row, the work-auth
  tier (`oferta.md:78-93`), and a single flat rule in `modes/_profile.md:164`
  ("hybrid outside your country → 3.0").

## Key insight: work mode is not independent of geography

The obvious design — one desirability weight per geography, combined with a global
work-mode score via `min()` or an average — is wrong. The candidate's stated preferences
prove it:

- In an unlisted geography, **remote is the best available option** (they work from home).
- In the California target cities, **remote is the worst option** — relocation is the
  entire point, and a remote US role delivers none of it.

A single scalar per geography cannot express both. Therefore work mode is scored *within*
a geography tier, as a matrix cell, not scored globally and then combined.

## Goals

1. Express relative geographic preference, not just admissibility.
2. Make work-mode desirability conditional on geography.
3. Feed both the existing triage location dimension and the full A-F evaluation.
4. Keep the candidate's values in the user layer and the mechanism in the system layer,
   per the AGENTS.md Data Contract.
5. No new runtime code. Both consumers are LLM modes that read config directly.

## Non-goals

- **Scan ranking.** `scan.mjs` keeps its binary filter unchanged. Annotating and sorting
  scanned jobs by location preference is explicitly deferred.
- **A sixth scoring dimension.** `modes/_shared.md`'s five dimensions are shared defaults
  for every career-ops user and stay untouched.
- **A `location-score.mjs` helper.** Deferred until a non-LLM consumer needs a
  deterministic number (which only scan ranking would).
- **Drift validation** between `portals.yml` keywords and the new tiers. Documented as a
  known wart; the validator is deferred.

## Data model

New in `config/profile.yml` under the existing `location:` block.

```yaml
location:
  preferences:
    # Ordered, MOST SPECIFIC FIRST. First matching tier wins.
    - name: "Home — Helsinki region"
      match: ["Helsinki", "Espoo", "Vantaa", "Finland"]
      modes: { onsite: 5.0, hybrid: 5.0, remote: 5.0 }

    - name: "Preferred EU relocation cities"
      match: ["Stockholm", "Zurich", "Zürich", "Amsterdam", "Barcelona"]
      modes: { onsite: 5.0, hybrid: 5.0, remote: 4.0 }
      relocation: welcome

    - name: "Other EU target countries"
      match: ["Sweden", "Denmark", "Copenhagen", "Netherlands",
              "Switzerland", "Germany", "France", "Spain"]
      modes: { onsite: 4.0, hybrid: 4.0, remote: 4.5 }
      relocation: acceptable

    - name: "US — California target cities"
      match: ["Mountain View", "Palo Alto", "Sunnyvale"]
      modes: { onsite: 4.5, hybrid: 4.5, remote: 1.0 }
      relocation: required
      requires_sponsorship: true

  default:
    modes: { onsite: 1.5, hybrid: 2.0, remote: 3.0 }
```

### Field semantics

| Field | Required | Meaning |
|-------|----------|---------|
| `name` | yes | Human-readable tier label. Quoted verbatim in report output so every score is explainable. |
| `match` | yes | Case-insensitive location keywords. Matched on **word boundaries** — the same rule as `compileLocationKeyword` (`scan.mjs:184`), because "Spain" must not match inside another token and city names must not match inside unrelated strings. |
| `modes` | yes | Score (1.0-5.0) for each of `onsite`, `hybrid`, `remote`. All three keys required — an absent key is a config error, not an implicit default, so a half-filled tier fails loudly instead of scoring silently. |
| `relocation` | no | `welcome` / `acceptable` / `required` / `none`. Narrative only — surfaced in Block A, never a score input. |
| `requires_sponsorship` | no | When true, the tier is gated on the work-auth classification (see below). Omitted → no gate. |

`location.default` uses the same `modes` shape and applies to any location that matches no
tier and was not blocked upstream. It has no `match` key.

There is deliberately **no** per-tier `weight` scalar. It would equal `max(modes)` — a
redundant field that can drift out of agreement with the cells it summarizes.

## Scoring algorithm

Given a posting's location string and work mode:

1. **Resolve the tier.** Walk `preferences` in order; the first tier with a
   word-boundary keyword match wins. No match → `location.default`.
2. **Multi-location postings.** When a posting names several locations
   ("Stockholm · London · Bengaluru"), resolve each and take the **best-scoring** tier.
   Name the other locations in Block A. This mirrors the existing `always_allow` rescue
   semantics in `scan.mjs:301`.
3. **Resolve the work mode** to `onsite`, `hybrid` or `remote` and read that cell. This is
   the location dimension score.
4. **Unknown work mode.** `modes/triage.md:65` scores from title, company and location
   only and frequently cannot distinguish hybrid from on-site. In that case score the
   tier's **highest** cell and mark the result provisional. Triage must never fail a role
   on a guessed work mode; the full evaluation resolves it from the JD body plus the
   geo-mismatch cross-check at `oferta.md:63-72`.
5. **Apply the travel deduction** unchanged: high travel (>25%) deducts 0.5-1.0, per the
   existing rule and `modes/_profile.md:181` (travel up to 50% is acceptable).
6. **Apply the sponsorship gate** (below).

No arithmetic beyond the deduction. Every score reduces to one explainable line:
`Location fit: 4.5/5 (US — California target cities, hybrid)`.

### Sponsorship gate — tri-state, delegated

A tier with `requires_sponsorship: true` does **not** re-derive work-authorization logic.
It reads the classification the work-auth block at `modes/oferta.md:78-93` already
produces and reacts:

| Work-auth tier | Effect on the location score |
|----------------|------------------------------|
| ⛔ No sponsorship | **Hard stop.** Recorded as a `hard_stop`, not merely a low score. |
| ⚠️ Unstated | Keep the tier score. Flag the recruiter question. |
| ✅ Sponsors | Score normally. |
| ➖ Not needed | Score normally. |

The ⚠️ row is load-bearing: `modes/_profile.md:162` states that a US role must not be
treated as near-blocked on the H-1B calendar alone, given viable O-1A and EU-then-L-1
routes. A US posting silent on sponsorship must not be auto-failed.

`relocation: required` is a **timeline fact** — visa route, realistic start date — and
belongs in Block A as a note. It is never a score deduction, because deducting for it
would double-count what the sponsorship gate already handles.

## Work-authorization keys (folded in)

`config/profile.yml` currently has no `authorized_in` or `needs_sponsorship` keys, only
free-text `visa_status`. Per `oferta.md:88` the system therefore infers conservatively and
defaults to ⚠️ Unstated for every non-Finnish role. The California tier's gate depends on
a correct classification, so this is load-bearing for the feature rather than a drive-by
fix. Add:

```yaml
location:
  authorized_in: ["Finland", "European Union", "EEA", "Switzerland"]
  needs_sponsorship: true
```

`needs_sponsorship: true` is correct and `false` would be actively wrong: `oferta.md:81`
treats `false` as a blanket "➖ not needed", which would silence the US gate entirely.

## Consumer changes

### Triage (`modes/triage.md`, `modes/_brief.md`)

- `modes/_brief.md` "Location Scoring" (line 53) is rewritten: the work-mode-only bullet
  list becomes the tier matrix plus the resolution rules above. The section must stay
  compact — every line is read once per role during batch triage.
- `modes/triage.md:67` keeps its 25% weight and its `_brief.md` reference, and gains the
  unknown-work-mode rule and the multi-location rule.
- `modes/_brief.template.md` gets the same structure with placeholders, so a new user
  sees the tier shape rather than the old flat bullets.

### Full evaluation (`modes/oferta.md`, `modes/_profile.md`)

- `modes/oferta.md` Block A gains one line after the Role Summary table:
  `**Location fit:** {score}/5 ({tier name}, {resolved work mode})`, plus the
  multi-location and provisional-mode notes when they apply. Structural only — harmless
  for users with no `preferences` block.
- `modes/_profile.md` "Your Location Policy" (line 164) replaces its flat
  "hybrid outside your country → 3.0" rule with the tier-driven rule. The candidate's
  values live here and in `profile.yml`; `modes/_shared.md` is not touched.

**How the location score reaches the Global score.** `modes/_shared.md` states the Global
score is holistic with no arithmetic formula, so the location score is not averaged in.
It acts as a **cap**, in the same shape as the existing Cultural-signals capping rule
(`_shared.md:85` and rule 7):

| Location fit | Effect on Global |
|--------------|------------------|
| ≤ 2.0 | Cap Global at **3.0** (below the apply threshold) and state the reason explicitly |
| 2.5 – 3.0 | Cap Global at **4.0** and name the location concern in the recommendation |
| ≥ 3.5 | No cap |

A hard stop from the sponsorship gate overrides all three rows. A provisional score from an
unresolved work mode never caps — the full evaluation resolves the mode before scoring, so
a provisional value only ever appears in triage output.

### Absent-config behavior

No `location.preferences` block → behavior is byte-identical to today. The Block A line is
omitted and `_brief.md`'s work-mode rules apply as before. This keeps the change
backward-compatible for every other career-ops user.

## Removals

`config/profile.yml`: delete `location.target_countries`, `location.us_target_locations`
and `compensation.location_flexibility`. No script or mode reads any of them (verified by
grep across `*.mjs` and `*.md`); `preferences` supersedes all three, and two competing
geography lists drifting apart is the problem this feature exists to fix. The tier `name:`
fields preserve their human-readable value.

`config/profile.example.yml` keeps documented equivalents only where they still teach
something — the example file documents the new `preferences` schema instead.

## Known duplication (accepted)

Geography now lives in two places: `portals.yml → location_filter` (binary keywords, for
scanning) and `profile.yml → location.preferences` (weights, for scoring). They can drift
— a geography scoring 5.0 that no scan ever surfaces, or vice versa. Documented in
`DATA_CONTRACT.md`. A `validate-portals.mjs` check warning on unreachable `preferences`
keywords is deferred until drift actually costs a missed role.

## Testing

`test-all.mjs` asserts mode-file content (e.g. line 2904 asserts an `oferta.md` string), so
the mode changes are testable in the existing style:

1. `modes/oferta.md` contains the `**Location fit:**` line template.
2. `modes/oferta.md` retains the ⚠️-Unstated-is-neutral rule after editing (regression
   guard on `_profile.md:162`'s intent).
3. `modes/_brief.md` and `modes/_brief.template.md` contain the tier matrix headings.
4. `modes/triage.md` retains the 25% location weight and the global-score formula.
5. `config/profile.example.yml` parses as YAML and its `location.preferences` entries each
   carry `name`, `match`, and all three `modes` keys.
6. `config/profile.yml` no longer references the three removed keys.

## Files touched

| File | Layer | Change |
|------|-------|--------|
| `config/profile.yml` | user | Add `preferences`, `default`, `authorized_in`, `needs_sponsorship`; remove three dead keys |
| `config/profile.example.yml` | system | Document the new schema |
| `modes/_brief.md` | user | Rewrite Location Scoring as the tier matrix |
| `modes/_brief.template.md` | system | Same structure, placeholders |
| `modes/triage.md` | system | Unknown-mode + multi-location rules |
| `modes/_profile.md` | user | Tier-driven Location Policy |
| `modes/oferta.md` | system | Block A `Location fit:` line |
| `DATA_CONTRACT.md` | system | New keys; note the portals.yml duplication |
| `docs/CUSTOMIZATION.md` | system | Document `preferences` alongside the location block |
| `test-all.mjs` | system | Assertions above |

## Open questions

None. All resolved during design:

- US remote → 1.0, low score rather than a hard DQ.
- EU on-site/hybrid outside the four preferred cities → 4.0, not equal to them.
- Remote in a preferred city → 4.0; fine, just less exciting. No anomaly flag.
- Flat lists → replaced by `preferences`.
- Drift check → deferred.
- Work-auth keys → folded in.
