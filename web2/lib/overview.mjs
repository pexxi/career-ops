// Overview numbers (ticket 06), derived from the same parsed tracker rows and
// status ledger the Applications page reads. The ever-reached funnel uses the
// core's cumulative-stage contract (funnel-stages.mjs) — no second engine.
import { parseStatusLogStages, recoverFunnelStages } from "../../funnel-stages.mjs";
import { stageOfStatus } from "./stage.mjs";

// [canonical stage, funnelStageRank] — Evaluated is rank 0, so every
// non-SKIP row counts there and a Deciding-only tracker is never all zeros.
const FUNNEL = [
  ["Evaluated", 0],
  ["Applied", 1],
  ["Responded", 2],
  ["Assessment", 3],
  ["Interview", 4],
  ["Offer", 5],
  ["Hired", 6],
];

/** rows = /api/applications rows (with newest-first `history`); ledgerText = raw status-log.tsv. */
export function overview(rows, ledgerText) {
  const statusByNum = new Map(rows.map((r) => [Number(r.num), r.status]));
  const ranks = [...recoverFunnelStages(statusByNum, parseStatusLogStages(ledgerText)).values()];
  const scores = rows.map((r) => r.score).filter((s) => s != null);
  const count = (stage) => rows.filter((r) => stageOfStatus(r.status) === stage).length;
  return {
    kpis: {
      deciding: count("deciding"),
      active: count("active"),
      everHired: ranks.filter((r) => r >= 6).length,
      avgScore: scores.length ? Math.round((100 * scores.reduce((a, b) => a + b, 0)) / scores.length) / 100 : null,
    },
    funnel: FUNNEL.map(([stage, rank]) => ({ stage, count: ranks.filter((r) => r >= rank).length })),
    activity: rows
      .flatMap((r) =>
        (r.history ?? []).map((h) => ({ num: r.num, company: r.company, role: r.role, date: h.date, from: h.from, to: h.to })),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30),
  };
}
