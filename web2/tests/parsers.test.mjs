import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseTracker, extractReportNum, parseScoreCell } from "../lib/tracker.mjs";
import { historyByRow } from "../lib/statuslog.mjs";
import { loadCanonicalStates } from "../../tracker-utils.mjs";
import { stageOfStatus, rowsInStage } from "../lib/stage.mjs";
import { parseReportMeta } from "../lib/reports.mjs";

const STATES = loadCanonicalStates(path.join(import.meta.dirname, "..", "..", "templates", "states.yml"));

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|----------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-07-28 | Google | AI Customer Engineer | Helsinki | 4.2/5 | Rejected | ✅ | [001](../reports/001-google-2026-07-28.md) | req job id 722146 | https://example.com/1 |
| 2 | 2026-08-25 | OpenAI | FDE | — | — | Discarded | ❌ | [214](../reports/214-openai-2026-08-25.md) | no score | [ashby](https://jobs.ashbyhq.com/openai/x) |
`;

test("parseTracker reads every named column", () => {
  const { rows, warnings } = parseTracker(TRACKER);
  assert.equal(warnings.length, 0);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].num, "1");
  assert.equal(rows[0].score, 4.2);
  assert.equal(rows[0].status, "Rejected");
  assert.equal(rows[0].pdf, true);
  assert.equal(rows[0].reportNum, "001");
  assert.equal(rows[0].url, "https://example.com/1");
  // score sentinel row
  assert.equal(rows[1].score, null);
  assert.equal(rows[1].url, "https://jobs.ashbyhq.com/openai/x");
});

test("parseTracker skips malformed rows loudly", () => {
  const bad = TRACKER.replace(
    "| 2 | 2026-08-25 | OpenAI | FDE |",
    "| 2 | 2026-08-25 |",
  );
  const { warnings } = parseTracker(bad);
  assert.ok(warnings.some((w) => w.includes("expected")));
});

test("parseTracker distinguishes missing header from ENOENT", () => {
  assert.throws(() => parseTracker("nothing here"), /EBADTRACKER|header/i);
});

test("extractReportNum handles padded and link forms", () => {
  assert.equal(extractReportNum("[001](../reports/001-google.md)"), "001");
  assert.equal(extractReportNum("[64](reports/64-x.md)"), "064");
  assert.equal(extractReportNum("—"), null);
});

test("parseScoreCell sentinels", () => {
  assert.deepEqual(parseScoreCell("N/A"), { score: null, sentinel: "N/A" });
  assert.deepEqual(parseScoreCell("—"), { score: null, sentinel: "—" });
  assert.deepEqual(parseScoreCell("4.2/5"), { score: 4.2, sentinel: null });
});

const LOG = [
  "1\t2026-08-06\tEvaluated\tApplied\tset-status\t",
  "1\t2026-08-07\tApplied\tInterview\tset-status\tloop booked",
  "not-a-row\t2026-08-07\tx\ty\tz\t",
  "12x\t2026-08-07\tApplied\tInterview\tset-status\t",
  "3\t2026-08-01\t-\tEvaluated\tmanual\t",
].join("\n");

test("historyByRow keeps valid rows only, newest first, with notes", () => {
  const byRow = historyByRow(LOG, STATES);
  assert.deepEqual([...byRow.keys()].sort(), ["1", "3"]);
  const history = byRow.get("1");
  assert.equal(history.length, 2);
  assert.equal(history[0].to, "Interview");
  assert.equal(history[0].note, "loop booked");
  assert.equal(history[1].to, "Applied");
});

test("historyByRow honors retractions and corrections like the core", () => {
  const log = [
    LOG,
    "1\t2026-08-08\tInterview\t-\tset-status\tnever happened",
    "1\t2026-08-05\tEvaluated\tApplied\tcorrection\twrong day",
  ].join("\n");
  const history = historyByRow(log, STATES).get("1");
  assert.equal(history.length, 1);
  assert.equal(history[0].to, "Applied");
  assert.equal(history[0].date, "2026-08-05");
});

test("stageOfStatus maps the lifecycle", () => {
  assert.equal(stageOfStatus("Evaluated"), "deciding");
  assert.equal(stageOfStatus("Interview"), "active");
  assert.equal(stageOfStatus("Rejected"), "closed");
  assert.equal(stageOfStatus("Hired"), "closed");
  assert.equal(stageOfStatus("Offer"), "active");
});

test("rowsInStage filters the lens", () => {
  const rows = parseTracker(TRACKER).rows;
  assert.equal(rowsInStage(rows, "closed").length, 2);
  assert.equal(rowsInStage(rows, "deciding").length, 0);
  assert.equal(rowsInStage(rows, "all").length, 2);
});

const REPORT = `# Evaluation: OpenAI — Forward Deployed Engineer

**Date:** 2026-08-02
**URL:** https://jobs.ashbyhq.com/openai/x
**Score:** 4.6/5
**Legitimacy:** Proceed with Caution

## Machine Summary

\`\`\`yaml
company: "OpenAI"
role: "Forward Deployed Engineer"
score: 4.6
final_decision: "Apply"
hard_stops: []
soft_gaps:
  - "No Rust evidence"
  - "Travel policy unstated"
\`\`\`

## Blocks...

text
`;

test("parseReportMeta reads header facts", () => {
  const meta = parseReportMeta(REPORT);
  assert.equal(meta.company, "OpenAI");
  assert.equal(meta.role, "Forward Deployed Engineer");
  assert.equal(meta.url, "https://jobs.ashbyhq.com/openai/x");
  assert.equal(meta.score, 4.6);
});
