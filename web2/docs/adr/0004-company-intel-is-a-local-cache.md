# 0004 — Company intel is a local cache, never a live scrape

The application drawer is more useful with outside context on the employer:
review highlights (Glassdoor-style) and salary aggregates (levels.fyi-style).
Neither source has a free API, and both forbid or resist automated scraping.

**Decision:** web2 only *reads* company intel from a local, file-backed cache:
one JSON snapshot per company under `{data root}/data/web2/company-intel/`
(gitignored user data, so it follows `CAREER_OPS_ROOT`; `WEB2_DATA_DIR` overrides
it in tests). Shape:
`{ company, sources: [{ source, url, fetchedAt, kind: reviews|salaries, data, asOf? }] }`.
The file is keyed by the core's `normalizeCompanyName()` (invite-match.mjs), so
"OpenAI, Inc." and "openai" share one snapshot. Entries are added by the
capture routines in `web2/scripts/` (ticket 09), outside the app's runtime,
through `addIntel()` in `web2/lib/intel.mjs`.

Two rules are enforced in code, not left to convention:

- **Provenance is mandatory.** `addIntel()` refuses an entry without `source`,
  `url` and a `fetchedAt` date, and the drawer prints source + fetch date (and
  `asOf` for dataset imports) on every item.
- **Nothing is overwritten.** A new fetch appends a dated entry; earlier
  entries stay and render below the newest.

**Considered options:** fetching on drawer open (live scraping) was rejected:
it ties the UI to brittle, ToS-gray scrapers, leaks browsing to third parties
on every click, and produces numbers with no stable provenance. A shared
database was rejected as more machinery than a per-company JSON file needs.

**Consequences:** intel is only as fresh as its last capture, which the fetch
date makes visible. Captured text is external content, so it is rendered as
plain text and treated as data, never as instructions.
