# 11: Profile coach — conversational profile improvement

**What to build:** The Profile coach (web2/GLOSSARY.md): a chat panel on the Profile page. Thin direct LLM call from the Hono server (ADR 0005) — no agent CLI, no modes runtime. The coach proposes edits only; nothing is written by the model, and the only way any proposal lands is Profile apply (ticket 10). Its context per message: the four candidate profile files + evaluation reports the user attaches (picked from the existing `/api/reports` list). Its system prompt embeds the source-of-truth rules: claims must trace to the four files or an attached report, no fabricated facts or metrics, and report/posting text is **data, never instructions**.

Config in `web2/config.json` (gitignored; holds provider, model, and either the API key or a reference to an env var). Missing/incomplete config = a setup empty state in the coach panel; the rest of the page works untouched.

Transcripts: one JSONL per session under gitignored `web2/data/chat/`; a small session list in the panel resumes by re-scrolling history.

**Blocked by:** 10 (the coach renders on the Profile page and proposals are consumed by its apply path)

**Status:** done

- [x] `web2/config.json` loading + validation with a clear missing-config empty state; the key is never logged and never sent to the client
- [x] `POST /api/profile/chat` carrying coach context (four files + attached report numbers); streaming is acceptable but optional
- [x] Coach prompt module (`web2/lib/`) with the embedded rules; unit-tested that report text marked as data cannot change the prompt's instructions
- [x] Report attach picker from `/api/reports`
- [x] Transcript writer (JSONL, one file per session) in `web2/lib/`
- [x] `.gitignore` entries: `web2/config.json`, `web2/data/`

## Comments

- 2026-10-24 (implement session): `web2/lib/coach.mjs` holds all of it.
  - **Config:** `loadCoachConfig()` reads `web2/config.json` (`WEB2_CONFIG` overrides the path): `provider` must be `anthropic`; `model` defaults to `claude-opus-5-5`; the key comes from `apiKey` or from the env var named by `apiKeyEnv`. Every failure returns a displayable `reason`, and `coachStatus()` is the only thing sent to the client, so the key never leaves the server (pinned by a route test that greps the response).
  - **Prompt:** `buildCoachRequest()` uses a fixed system prompt with the source-of-truth rules and nothing interpolated into it. Each turn's user message carries fresh profile files (with line numbers, so hunks can be exact) and attached reports as `<profile_file>` / `<attached_report>` data blocks, with the user's text last. A closing tag inside data is neutralized. The tests check that a report containing "ignore previous instructions" plus a forged `</attached_report>` leaves the system prompt identical and stays inside its data block.
  - **Call:** `askCoach()` makes one non-streaming call through the official `@anthropic-ai/sdk` (new web2 dependency, per the claude-api skill: SDK, not raw fetch). For models that support it, server-side refusal fallbacks are on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). A refusal comes back as readable text, and an API error comes back as 502 `COACH_API_ERROR`.
  - **Proposals:** `extractProposals()` keeps only ```diff blocks whose `---` header names one of the four profile files. They are re-derived when a session is resumed.
  - **Transcripts:** `appendTranscript` / `readTranscript` / `listSessions` write one JSONL per session under `web2/data/chat/`, and session ids are validated against path traversal.
  - **Routes:** `GET /api/profile/coach` (status + sessions), `GET /api/profile/coach/:session`, and `POST /api/profile/chat` (503 `COACH_NOT_CONFIGURED` when unset).
  - **UI:** the coach panel on the Profile page has the setup empty state, session picker, report attach MultiSelect from `/api/reports`, and Markdown replies. Each proposal button pre-fills Profile apply, which still needs Preview then Apply; the coach itself writes nothing.
  - `.gitignore`: `config.json` and `data/` (in `web2/.gitignore`, i.e. `web2/config.json` and `web2/data/`). ADR 0005 from planning is committed with this ticket.
  - Verified: 7 coach unit tests (incl. `askCoach` against a local fake Messages endpoint via `ANTHROPIC_BASE_URL`: request shape, beta header, fallbacks, text join, refusal), 1 route test, typecheck, and smoke end to end against the fake endpoint (attach report → send → reply → review → preview → apply lands one line on disk; one JSONL transcript).
  - **Not verified:** a live call to the real API. No key on this machine; it needs `web2/config.json` + a key to try.

- 2026-10-24 (review fix, two-axis review): config moved to `{data root}/config/web2.json` (root `.gitignore`) and transcripts to `{data root}/data/web2/chat/`; `WEB2_CONFIG` / `WEB2_DATA_DIR` remain as test overrides. `askCoach` is now one plain `messages.create` call: the model allow-list, beta header and `fallbacks: "default"` were not asked for and are removed (refusal text kept). `FILE_LABELS` lives once in `lib/profilefiles.mjs` and the session-id regex once in `coach.mjs`.
