// Parser for data/status-log.tsv — {tracker#}\t{date}\t{from}\t{to}\t{source}\t{note}.
// The file has no guaranteed header; rows are recognized by a numeric first field.
import fs from "node:fs";

export function parseStatusLog(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const fields = line.split("\t");
    if (!/^\d+.?$/.test(fields[0]?.trim() ?? "")) continue; // header or garbage line
    rows.push({
      num: fields[0].trim().replace(/\D$/, "") || fields[0].trim(),
      date: fields[1]?.trim() ?? "",
      from: fields[2]?.trim() ?? "",
      to: fields[3]?.trim() ?? "",
      source: fields[4]?.trim() ?? "",
      note: fields[5]?.trim() ?? "",
    });
  }
  return rows;
}

export async function readStatusLog(statusLogFilePath) {
  const text = await fs.promises.readFile(statusLogFilePath, "utf8");
  return parseStatusLog(text);
}

/** All transitions for one tracker row, newest first (file order is append). */
export function historyFor(logRows, trackerNum) {
  return logRows
    .filter((r) => r.num === String(trackerNum))
    .slice()
    .reverse();
}

/** Most recent transition date per tracker#, as a Map<string, {date, to}>. */
export function lastTransitionMap(logRows) {
  const map = new Map();
  for (const row of logRows) {
    const prev = map.get(row.num);
    if (!prev || row.date > prev.date) map.set(row.num, { date: row.date, to: row.to });
  }
  return map;
}
