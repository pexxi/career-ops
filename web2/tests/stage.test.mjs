// Seam B — stage-model coverage the existing parser tests don't pin down:
// exhaustiveness over ALL ten canonical states plus the unknown/empty fallback;
// and Seam D (ticket 03): drawerContent, the stage-focus model behind the
// detail drawer. One function answers "which facts does this row's stage show,
// and which must NOT appear", so the React layer only renders, never decides.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { stageOfStatus, rowsInStage, drawerContent, STAGE_ORDER, DEFAULT_STAGE, CANONICAL_STATES } from "../lib/stage.mjs";
import { loadCanonicalStates } from "../../tracker-utils.mjs";
import { funnelStageRank } from "../../funnel-stages.mjs";
import { FUNNEL } from "../lib/overview.mjs";

// templates/states.yml is the source of truth; the stage map mirrors it.
const ALL_STATES = loadCanonicalStates(
  path.join(import.meta.dirname, "..", "..", "templates", "states.yml"),
).map((s) => s.label);

test("the stage map mirrors templates/states.yml exactly (parity)", () => {
  assert.deepEqual([...CANONICAL_STATES].sort(), [...ALL_STATES].sort());
});

test("the Overview funnel is canonical states in the core's rank order (parity)", () => {
  for (const stage of FUNNEL) assert.ok(ALL_STATES.includes(stage), `${stage} is not in states.yml`);
  const ranks = FUNNEL.map((stage) => funnelStageRank(stage));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.equal(new Set(ranks).size, FUNNEL.length);
});

test("Offer is a live decision: active, not closed", () => {
  assert.equal(stageOfStatus("Offer"), "active");
});

test("every canonical state maps to a stage in STAGE_ORDER (exhaustive)", () => {
  for (const state of ALL_STATES) {
    const stage = stageOfStatus(state);
    assert.ok(
      STAGE_ORDER.includes(stage),
      `${state} mapped to "${stage}", not in STAGE_ORDER`,
    );
  }
});

test("unknown and empty statuses fall back to closed without crashing", () => {
  assert.equal(stageOfStatus("Bogus"), "closed");
  assert.equal(stageOfStatus(""), "closed");
  assert.equal(stageOfStatus(undefined), "closed");
});

test("DEFAULT_STAGE is a real stage and rowsInStage honors it", () => {
  assert.ok(STAGE_ORDER.includes(DEFAULT_STAGE));
  const rows = [
    { status: "Evaluated" },
    { status: "Interview" },
    { status: "Rejected" },
  ];
  assert.equal(rowsInStage(rows, DEFAULT_STAGE).length, 1);
  assert.equal(rowsInStage(rows, "all").length, 3);
});

// --- drawerContent ---------------------------------------------------------

// historyFor() returns transitions newest-first — the model must expect that.
const DECIDING_ROW = {
  num: "3",
  company: "Google",
  role: "SWE",
  status: "Evaluated",
  score: 4.1,
  url: "https://example.com/job",
  notes: "req job id 123",
  history: [],
};

const FIELDS = {
  legitimacy: "High Confidence",
  final_decision: "Consider",
  hard_stops: ["US-located only"],
  soft_gaps: ["No hyperscale experience"],
};

test("deciding shows the decision card and never process/outcome content", () => {
  const model = drawerContent(DECIDING_ROW, FIELDS);
  assert.equal(model.stage, "deciding");
  assert.equal(model.legitimacy, "High Confidence");
  assert.equal(model.finalDecision, "Consider");
  assert.deepEqual(model.hardStops, ["US-located only"]);
  assert.deepEqual(model.softGaps, ["No hyperscale experience"]);
  assert.equal(model.url, "https://example.com/job");
  // Nothing from the other stages leaks in.
  assert.equal(model.history, undefined);
  assert.equal(model.outcome, undefined);
});

test("active shows history + notes, with decision facts excluded outright", () => {
  const row = {
    ...DECIDING_ROW,
    status: "Interview",
    notes: "recruiter confirmed loop",
    history: [{ date: "2026-08-07", from: "Applied", to: "Interview", source: "set-status", note: "" }],
  };
  // Even a fully populated machine summary must not reach the active card.
  const model = drawerContent(row, FIELDS);
  assert.equal(model.stage, "active");
  assert.equal(model.history.length, 1);
  assert.equal(model.history[0].to, "Interview");
  assert.equal(model.notes, "recruiter confirmed loop");
  assert.equal(model.url, "https://example.com/job");
  assert.equal(model.finalDecision, undefined);
  assert.equal(model.hardStops, undefined);
  assert.equal(model.softGaps, undefined);
  assert.equal(model.outcome, undefined);
});

test("closed condenses to one outcome line + notes", () => {
  const row = {
    ...DECIDING_ROW,
    status: "Rejected",
    notes: "after interview",
    history: [
      { date: "2026-09-01", from: "Interview", to: "Rejected", source: "set-status", note: "" },
      { date: "2026-08-07", from: "Applied", to: "Interview", source: "set-status", note: "" },
    ],
  };
  const model = drawerContent(row, FIELDS);
  assert.equal(model.stage, "closed");
  // Newer-first history: the newest transition is the outcome.
  assert.equal(model.outcome, "Rejected on 2026-09-01");
  assert.equal(model.notes, "after interview");
  assert.equal(model.history, undefined);
  assert.equal(model.finalDecision, undefined);
  assert.equal(model.url, undefined); // closed carries no posting link
});

test("closed without a ledger falls back to the current status as the outcome", () => {
  const model = drawerContent({ ...DECIDING_ROW, status: "Hired", history: [] }, FIELDS);
  assert.equal(model.stage, "closed");
  assert.equal(model.outcome, "Hired");
});

test("an unknown status falls back to the closed bucket, not a crash", () => {
  const model = drawerContent({ ...DECIDING_ROW, status: "Bogus", history: [] }, FIELDS);
  assert.equal(model.stage, "closed");
  assert.equal(model.outcome, "Bogus");
});

test("missing machine summary leaves deciding fields empty, not undefined", () => {
  const model = drawerContent(DECIDING_ROW, {});
  assert.equal(model.stage, "deciding");
  assert.equal(model.finalDecision, "");
  assert.deepEqual(model.hardStops, []);
  assert.deepEqual(model.softGaps, []);
});
