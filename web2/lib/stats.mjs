// Statistics computed from the parsed tracker + status ledger. No guessing: the
// funnel is "ever reached stage X" per row, derived from status-log transitions
// (falling back to the row's current status when it has no ledger history).
export const FUNNEL_STAGES = ["Evaluated", "Applied", "Responded", "Assessment", "Interview", "Offer", "Hired"];
const STAGE_INDEX = new Map(FUNNEL_STAGES.map((s, i) => [s, i]));
const NON_STAGE = new Set(["Rejected", "Discarded", "SKIP", ""]);

function stageOf(status) {
  return STAGE_INDEX.get(status) ?? -1;
}

export function computeStats(rows, logRows) {
  const statusCounts = {};
  for (const row of rows) statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;

  // Ever-reached stage per tracker row number.
  const everReached = new Map();
  for (const row of logRows) {
    const stage = stageOf(row.to);
    if (stage < 0) continue;
    const prev = everReached.get(row.num) ?? -1;
    if (stage > prev) everReached.set(row.num, stage);
  }
  for (const row of rows) {
    // A row carrying a score OR an evaluation report has been evaluated even
    // if the ledger never shows it — SKIP rows (never valued) stay out.
    const stage =
      stageOf(row.status) >= 0
        ? stageOf(row.status)
        : (row.score != null || row.reportNum) && row.status !== "SKIP"
          ? 0
          : -1;
    if (stage < 0) continue;
    const prev = everReached.get(row.num) ?? -1;
    if (stage > prev) everReached.set(row.num, stage);
  }

  const funnel = FUNNEL_STAGES.map((stage, idx) => ({
    stage,
    count: [...everReached.values()].filter((s) => s >= idx).length,
  }));

  // Newest transitions last in the append-only file → reverse for display.
  const recentActivity = logRows.slice(-30).reverse();

  const scored = rows.filter((r) => r.score != null);
  return {
    totalRows: rows.length,
    statusCounts,
    funnel,
    everApplied: funnel[1].count,
    everHired: funnel[6].count,
    avgScore: scored.length
      ? Math.round((scored.reduce((sum, r) => sum + r.score, 0) / scored.length) * 10) / 10
      : null,
    recentActivity,
  };
}
