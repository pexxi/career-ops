// Seam B — stage-model coverage the existing parser tests don't pin down:
// exhaustiveness over ALL ten canonical states plus the unknown/empty fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stageOfStatus, rowsInStage, STAGE_ORDER, DEFAULT_STAGE } from "../lib/stage.mjs";

// templates/states.yml — the canonical set, mirrored in the server's STATES list.
const ALL_STATES = [
  "Evaluated",
  "Applied",
  "Responded",
  "Assessment",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
  "Discarded",
  "SKIP",
];

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
