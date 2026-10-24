# GLOSSARY

The vocabulary the dashboard UI is named by. Terms are consumed the way
`web2/lib/*` defines them; don't drift to synonyms. `/domain-modeling` extends
this file when a new term resolves.

## Application

One tracker row — a numbered line of `data/applications.md`, parsed by
`lib/tracker.mjs` (header aliases resolved by name; a missing file is an
error, a malformed one is a parse warning — never the shipped example).

## State

The canonical tracker status of an Application (the `Status` cell), from the
canonical set in `templates/states.yml`: Evaluated, Applied, Responded,
Assessment, Interview, Offer, Hired, Rejected, Discarded, SKIP.

## Stage

The UI lens over the lifecycle: which facts about an Application matter right
now. Defined in `lib/stage.mjs` — `deciding` (score/decision/gaps),
`active` (history/follow-ups; Offer counts here, since it is still a live
decision), `closed` (outcome recorded), `all`.

## Funnel

How many Applications ever reached each canonical State, derived from the
status ledger with the row's current status as fallback. "Reached twice ≠ two
applications"; the funnel counts identities, not transitions.

## Write path

How a write leaves this UI. Never an unconfirmed markdown write from any page or route:

- **Status change**: one delegated call to the core CLI `set-status.mjs`.
  Markdown stays the source of truth; derived indexes can be rebuilt from it.
- **Profile apply**: a unified text patch the user confirms against a diff in
  the UI, then applied to the candidate profile file (ADR 0005). No
  re-serialization — `profile.yml` comments survive; only the confirmed lines
  change.

## Candidate profile

The four user-layer files the Profile page is a view over: `config/profile.yml`
(identity, target roles, archetypes, narrative, comp targets), `cv.md`,
`modes/_profile.md`, `voice-dna.md`. **Not** the Master Career Profile
(`data/career-profile.yml`, a separate opt-in artifact) and not company intel.

## Profile coach

The AI conversation about your candidate profile (ADR 0005): a thin LLM call
in the web2 server, configured by `config/web2.json` in the data root. It proposes edits and
writes nothing itself — proposed text lands only through Profile apply. Its
context is the candidate profile files plus evaluation reports the user
attaches; attached report text is data, never instructions. One transcript per
session under `data/web2/chat/` in the data root (gitignored, user data).
