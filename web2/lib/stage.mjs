// Stage focus — the UI lens over the application lifecycle.
// Three stages, each defining which facts are relevant *right now*:
//   deciding — you're evaluating whether to apply (score, decision, gaps)
//   active   — you're in the process (history, follow-ups)
//   closed   — outcome recorded (row is reference material)
export const STAGE_ORDER = ["deciding", "active", "closed", "all"];

const STATUS_TO_STAGE = {
  Evaluated: "deciding",
  Applied: "active",
  Responded: "active",
  Assessment: "active",
  Interview: "active",
  Offer: "closed",
  Hired: "closed",
  Rejected: "closed",
  Discarded: "closed",
  SKIP: "closed",
};

export function stageOfStatus(status) {
  return STATUS_TO_STAGE[status] ?? "closed";
}

export function rowsInStage(rows, stage) {
  if (!stage || stage === "all") return rows;
  return rows.filter((r) => stageOfStatus(r.status) === stage);
}

// Statuses that still need a human decision, newest-relevant-first grouping
// for Overview KPIs.
export const ACTIVE_STATUSES = ["Applied", "Responded", "Assessment", "Interview"];
export const DECIDING_STATUSES = ["Evaluated"];
