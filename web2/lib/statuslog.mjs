// Reader for data/status-log.tsv. Parsing and the ledger's edit rules
// (`-` retractions, `correction` re-dates) come from the core's
// funnel-velocity.mjs, so the drawer shows the same timeline the CLI does.
import fs from "node:fs";
import { parseStatusLog, replayObservations } from "../../funnel-velocity.mjs";

/**
 * Ledger text → Map<tracker# string, history newest first>. The core replay
 * drops `note`, so each surviving entry gets the note of the line that wrote it.
 */
export function historyByRow(text, states) {
  const { observations } = parseStatusLog(text, states);
  const notes = new Map(observations.map((o) => [`${o.num}|${o.to}|${o.date}|${o.source}`, o.note]));
  const byRow = new Map();
  for (const [num, timeline] of replayObservations(observations)) {
    const history = timeline.map((t) => ({
      date: t.date,
      from: t.from ?? "",
      to: t.to,
      source: t.source,
      note: notes.get(`${num}|${t.to}|${t.date}|${t.source}`) ?? "",
    }));
    byRow.set(String(num), history.reverse());
  }
  return byRow;
}

/** Read the ledger; a missing file is "no history yet", any other error surfaces. */
export async function readHistoryByRow(statusLogFilePath, states) {
  try {
    return historyByRow(await fs.promises.readFile(statusLogFilePath, "utf8"), states);
  } catch (err) {
    if (err.code === "ENOENT") return new Map();
    throw err;
  }
}
