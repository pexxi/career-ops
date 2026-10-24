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
`active` (history/follow-ups), `closed` (outcome recorded), `all`.

## Funnel

How many Applications ever reached each canonical State, derived from the
status ledger with the row's current status as fallback. "Reached twice ≠ two
applications"; the funnel counts identities, not transitions.

## Write path

How a status change leaves this UI: one delegated call to the core CLI
`set-status.mjs`, never a direct markdown write from any page or route.
Markdown stays the source of truth; derived indexes can be rebuilt from it.
