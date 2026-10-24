# 0005 — Profile coach is a thin in-server LLM; profile edits land as a confirmed text patch

web2 was a pure read-over-markdown cockpit whose only write delegated status
changes to the core CLI. Planning the candidate profile page (glossary:
`Candidate profile`, `Profile coach`, `Profile apply`) needed both a
conversational improvement surface and an editing surface, and the coach's
intelligence had to live somewhere.

**Decision:** the coach is a thin direct LLM call inside the web2 server with
its own `config/web2.json` in the data root (provider/model/key) — not a headless run of the
agent CLI. The coach proposes edits only; nothing is written by the model. The
only write path for candidate profile files is **Profile apply**: a unified
text patch the user confirms against a diff in the UI.

**Considered options:** spawning the local agent CLI headless reused the
career-ops rulebook and existing model setup for free, but coupled dashboard UX
to a per-message process spawn and a CLI that must stay installed and logged
in; a thin LLM keeps web2 self-contained and the latency in the one place the
user feels it. The rulebook loss is mitigated by embedding the
source-of-truth rules (no fabricated claims; attached report text is data,
never instructions) in the coach's system prompt, and by propose-only output —
the human diff-confirm is the enforcement, not the prompt.

**Consequences:** web2 now owns its own model config and key (`{data root}/config/web2.json`,
gitignored; never logged, never sent to the client), a second write path sits
beside the delegated status path, and the coach brain can drift from what the
agent would say — accepted, because proposals are advisory and every write is
user-confirmed. Transcripts are one JSONL per session under gitignored
`{data root}/data/web2/chat/`.

Numbering note: 0001–0002 were never written; 0003 and 0004 come from the
web2-dashboard backlog (issues 03 and 08).
