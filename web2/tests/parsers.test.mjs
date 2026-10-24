import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTracker, extractReportNum, extractCellUrl, parseScoreCell } from "../lib/tracker.mjs";
import { parseStatusLog, historyFor, lastTransitionMap } from "../lib/statuslog.mjs";
import { computeStats, FUNNEL_STAGES } from "../lib/stats.mjs";
import { stageOfStatus, rowsInStage } from "../lib/stage.mjs";
import { parseMachineSummaryFields } from "../lib/reportfields.mjs";
import { parseReportMeta } from "../lib/reports.mjs";

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

test("extractCellUrl unwraps links", () => {
  assert.equal(extractCellUrl("[ashby](https://jobs.ashbyhq.com/openai/x)"), "https://jobs.ashbyhq.com/openai/x");
  assert.equal(extractCellUrl("https://example.com"), "https://example.com");
});

test("parseScoreCell sentinels", () => {
  assert.deepEqual(parseScoreCell("N/A"), { score: null, sentinel: "N/A" });
  assert.deepEqual(parseScoreCell("—"), { score: null, sentinel: "—" });
  assert.deepEqual(parseScoreCell("4.2/5"), { score: 4.2, sentinel: null });
});

const LOG = [
  "1\t2026-08-06\tEvaluated\tApplied\tset-status\t",
  "1\t2026-08-07\tApplied\tInterview\tset-status\t",
  "not-a-row\t2026-08-07\tx\ty\tz\t",
  "3\t2026-08-01\t-\tEvaluated\tmanual\t",
].join("\n");

test("parseStatusLog keeps numeric-keyed rows only", () => {
  const rows = parseStatusLog(LOG);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].num, "1");
});

test("historyFor returns newest first for one row", () => {
  const history = historyFor(parseStatusLog(LOG), 1);
  assert.equal(history.length, 2);
  assert.equal(history[0].to, "Interview");
  assert.equal(history[1].to, "Applied");
});

test("lastTransitionMap picks the newest per row", () => {
  const map = lastTransitionMap(parseStatusLog(LOG));
  assert.equal(map.get("1").date, "2026-08-07");
  assert.equal(map.get("1").to, "Interview");
});

test("computeStats honest ever-reached funnel", () => {
  const tracker = parseTracker(TRACKER);
  const logRows = parseStatusLog(LOG);
  const stats = computeStats(tracker.rows, logRows);
  assert.equal(stats.totalRows, 2);
  const applied = stats.funnel.find((f) => f.stage === "Applied");
  const interview = stats.funnel.find((f) => f.stage === "Interview");
  assert.equal(applied.count, 1); // row 1 ever applied
  assert.equal(interview.count, 1); // row 1 reached interview
  assert.equal(stats.statusCounts.Rejected, 1);
});

test("computeStats funnels rows with no ledger from current status", () => {
  const stats = computeStats(parseTracker(TRACKER).rows, []);
  const evaluated = stats.funnel.find((f) => f.stage === "Evaluated");
  assert.equal(evaluated.count, 2);
});

test("stageOfStatus maps the lifecycle", () => {
  assert.equal(stageOfStatus("Evaluated"), "deciding");
  assert.equal(stageOfStatus("Interview"), "active");
  assert.equal(stageOfStatus("Rejected"), "closed");
  assert.equal(stageOfStatus("Hired"), "closed");
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

test("parseMachineSummaryFields pulls stage-relevant facts", () => {
  const fields = parseMachineSummaryFields(REPORT);
  assert.equal(fields.final_decision, "Apply");
  assert.deepEqual(fields.hard_stops, []);
  assert.deepEqual(fields.soft_gaps, ["No Rust evidence", "Travel policy unstated"]);
});
