# 10: Profile page

**What to build:** Cockpit view over the Candidate profile (web2/GLOSSARY.md — the four files: `config/profile.yml`, `cv.md`, `modes/_profile.md`, `voice-dna.md`). Reference part: identity block, target roles + archetype table, comp targets, work preferences from the parsed YAML, plus rendered views of the three markdown files (tabs or stacked sections; a missing file is an empty-state badge, never an error — `article-digest.md` doesn't exist in this install, for example). Editing part: **Profile apply** — edits arrive as a unified text patch shown against a diff of the file, confirmed in the UI, then applied to the file. Nothing is re-serialized, so comments in `profile.yml` survive; the applied patch touches only the confirmed lines.

**Blocked by:** none (shell shipped in 01)

**Status:** done

- [x] `GET /api/profile`: the four files + parsed `config/profile.yml` (borrow the core's js-yaml via `lib/yaml-document.mjs`; resolve paths through the core resolver like `lib/paths.mjs` does — orchestrate, don't reimplement)
- [x] Page rendering + missing-file empty states; new fifth nav item "Profile" (hash `#profile`)
- [x] `POST /api/profile/apply`: apply a unified text patch to exactly one named candidate profile file under the resolved data root; reject files outside that set
- [x] Diff-confirm UI (before/after; explicit Apply button)
- [x] Parser/patcher tests in `web2/tests/` following the existing pattern, including "comments survive an apply" and "patch applies cleanly only where shown"

## Comments

- 2026-10-24 (implement session): `web2/lib/profile.mjs` holds the four-file read (`readProfile()`) and Profile apply.
  - Paths: `profile.yml` resolves through the core's `getProfilePath()`, so `CAREER_OPS_PROFILE` is honoured; the other three files sit under the data root. Parsing uses the core's `lib/yaml-document.mjs`. A missing file comes back as `exists:false` and gets a "missing" badge on its tab.
  - `applyPatch()` is a strict unified-diff applier with no fuzz. Each hunk's context and removed lines must sit exactly at the stated line (adjusted for earlier hunks' offsets); if a hunk matches only somewhere else, the whole patch is refused. `---`/`+++` headers are ignored: the target is chosen by name from a closed set (`profile`, `cv`, `modeProfile`, `voice`), so a client path can never reach the filesystem.
  - Responses from `POST /api/profile/apply`: 400 for an unknown name, 409 `PATCH_REJECTED` for a patch that does not apply, and `dryRun` returns before/after without writing. Writes go through tmp + rename.
  - UI: new `src/profile.tsx` and a fifth nav item "Profile" (`#profile`). The page shows identity, compensation, work preferences, target roles with the archetype table, then one tab per file (markdown rendered, `profile.yml` raw). `ProfileApply` has Paste → Preview (dry run, diff shown in red/green) → Apply. Apply stays disabled until that exact file+patch has previewed cleanly, and it is exported for the coach (ticket 11).
  - The glossary's Write path / Candidate profile entries from planning are committed with this ticket.
  - Verified: 5 patcher tests (comments survive; a hunk at the wrong line is refused even when its context exists elsewhere; mismatch; multi-hunk offsets; no hunks), 2 route tests, typecheck, smoke (profile render + missing badge + preview-then-apply landing exactly one line on disk), and the real profile parses (5 archetypes, all four files present).

- 2026-10-24 (review fix, two-axis review): Profile apply writes through the core's `replaceUserFile` (keeps a symlinked `cv.md` a symlink and its permissions) instead of a local tmp + rename. The unrequested Location card is removed.
