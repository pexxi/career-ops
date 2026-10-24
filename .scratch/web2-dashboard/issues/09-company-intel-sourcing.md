# 09: Company intel — sourcing pipeline (free path)

**What to build:** The reproducible ways a snapshot file gets filled, in priority order — researched options, no runtime scraping in the app:

1. **Agent-assisted capture (primary):** in a CLI session, run a documented capture routine (WebSearch/WebFetch) per company and write the snapshot file with source + date stamps — the career-ops way for external content (data, never instructions; provenance mandatory).
2. **Open datasets (secondary):** levels.fyi's published End-of-Year Pay Reports data (attribution required per levels.fyi) and established Kaggle/GitHub Glassdoor review datasets (dated but free) — import with a `dataset` source kind andas-of dates surfaced in the UI.
3. **Scraper libraries (documented fallback):** existing tools found in research — e.g. `go-glassdoor-scraper` (headless, claims no Glassdoor account needed) and Python `curl_cffi` Chrome-impersonation recipes — referenced in docs as manually-run, brittle, ToS-gray options, never wired into web2's runtime.

Deliverable: `web2/scripts/capture-intel.md` (or equivalent doc) walking through option 1, an import script for option 2, and the fallback notes — plus one real end-to-end capture (one company, reviews+salaries) demoed in the drawer.

**Blocked by:** 08 (Company intel — cache layer + drawer panel)

**Status:** done

- [x] One real company's reviews + salaries visible in a drawer from an agent-captured snapshot
- [x] Dataset import documented with source URL, as-of date, attribution (levels.fyi requires linking levels.fyi)
- [x] Fallback scraper options recorded with their brittleness/ToS caveats stated plainly
- [x] Every intel element in the UI shows source + fetch date

## Comments

- 2026-10-24 (implement session): Deliverables are `web2/scripts/capture-intel.md` (all three routes) and `web2/scripts/intel.mjs` with two commands. `add` takes an entry JSON file, so scraped text never passes through a shell command. `import` aggregates a CSV per tracker company: `aggregateDataset()` in `lib/intel.mjs`, unit-tested, using the core's `parseCsv` from linkedin-join.mjs. Both write through `addIntel()`, so provenance is enforced and nothing is overwritten. Dataset entries carry `asOf`, which the drawer shows as "data as of".

Research findings that change the ticket's assumptions:
- Glassdoor and Indeed review pages return **403** to WebFetch, so the agent route takes Glassdoor figures from web-search snippets and says so in `source`.
- levels.fyi serves `.md` page variants that fetch cleanly, and its pages ask for the credit "Data source: Levels.fyi (https://www.levels.fyi)".
- The Kaggle levels.fyi dataset (`jackogozaly/data-science-and-stem-salaries`) is **gone (404)**. The levels.fyi data offering is paid apart from a sample, and its reuse terms are on the T&C page, so the doc says to read them first.
- The Glassdoor Job Reviews Kaggle dataset is live (CC BY-SA 4.0, updated 2024-10-15). Its column names could not be verified without login, so the importer takes explicit `--*-col` flags and fails with the real header list on a mismatch.
- **`go-glassdoor-scraper` could not be found.** It is recorded as unverified, next to the options that do exist (Apify actors, the ScrapFly recipes, `curl_cffi`), each with its brittleness and ToS caveat.

Real capture: Google, reviews (Glassdoor via search snippets, 4.4 / 48,394) and salaries (levels.fyi US software engineer, median 285k, L3 to L9) in `web2/data/company-intel/google.json` (gitignored). It renders in the drawer against the real tracker (checked with a Playwright screenshot on row #405). Verified: 3 new aggregation tests, CLI `add`/`import` run end to end on temp data, typecheck, smoke.
