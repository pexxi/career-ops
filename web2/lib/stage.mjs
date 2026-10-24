// Stage focus — the UI lens over the application lifecycle.
// Three stages, each defining which facts are relevant *right now*:
//   deciding — you're evaluating whether to apply (score, decision, gaps)
//   active   — you're in the process (history, follow-ups)
//   closed   — outcome recorded (row is reference material)
export const STAGE_ORDER = ["deciding", "active", "closed", "all"];

/** The lens the Applications page opens in. */
export const DEFAULT_STAGE = "deciding";

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

/**
 * drawerContent(row, fields) — the stage-focus model behind the detail drawer
 * (ticket 03, ADR 0003). One fixed shape; fields outside the row's CURRENT
 * stage stay undefined, so a stage can never leak into the card: deciding
 * never shows process history, active never shows decision content, closed
 * collapses to one outcome line. `fields` is the client-parsed Machine Summary
 * (see lib/reportfields.mjs) — a deciding-lane input, ignored by the other
 * stages. `row.history` is newest-first, per historyFor().
 */
export function drawerContent(row, fields = {}) {
  const stage = stageOfStatus(row.status);
  const model = {
    stage,
    url: row.url ?? "",
    legitimacy: undefined,
    finalDecision: undefined,
    hardStops: undefined,
    softGaps: undefined,
    history: undefined,
    outcome: undefined,
    notes: undefined,
  };
  if (stage === "deciding") {
    Object.assign(model, {
      legitimacy: fields.legitimacy ?? "",
      finalDecision: fields.final_decision ?? "",
      hardStops: fields.hard_stops ?? [],
      softGaps: fields.soft_gaps ?? [],
    });
  } else if (stage === "active") {
    Object.assign(model, { history: row.history ?? [], notes: row.notes ?? "" });
  } else {
    const newest = (row.history ?? [])[0];
    Object.assign(model, {
      notes: row.notes ?? "",
      outcome: newest ? `${newest.to} on ${newest.date}` : String(row.status ?? ""),
    });
  }
  return model;
}
