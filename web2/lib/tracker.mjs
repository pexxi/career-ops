// Parser for the applications tracker (data/applications.md).
// Column mapping, row splitting, URL and report-link extraction come from the
// core's tracker-parse.mjs (web/AGENTS.md rule 1: never reimplement the core).
// This module only adds the web2 contract on top: "file missing" (ENOENT)
// stays distinct from "file present but no tracker table" (EBADTRACKER), and a
// row that does not fit the header is skipped to `warnings`, never dropped silently.
import fs from "node:fs";
import {
  detectColumns,
  isSeparatorRow,
  linkedReportNumbers,
  looksLikeScoreCell,
  parseScore,
  parseTrackerRow,
  SCORE_CELL_RE,
} from "../../tracker-parse.mjs";

/** Score cell → { score, sentinel } using the core's score-cell rule. */
export function parseScoreCell(cell) {
  const trimmed = String(cell ?? "").replace(/\*\*/g, "").trim();
  if (SCORE_CELL_RE.test(trimmed)) return { score: parseScore(trimmed), sentinel: null };
  if (!trimmed || looksLikeScoreCell(trimmed)) return { score: null, sentinel: trimmed || null };
  return { score: null, sentinel: null, unparseable: trimmed };
}

/** Report cell → padded report number ("001"), or null when it links no single local report. */
export function extractReportNum(reportCell, notesCell = "") {
  const nums = linkedReportNumbers(reportCell, notesCell);
  return nums.length === 1 ? String(nums[0]).padStart(3, "0") : null;
}

export function parsePdfCell(cell) {
  const trimmed = String(cell ?? "").trim();
  if (trimmed === "✅") return true;
  if (trimmed === "❌") return false;
  return null;
}

/** Parse the whole tracker markdown → { rows, warnings }. */
export function parseTracker(md) {
  const lines = md.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => detectColumns([line]));
  if (headerIndex === -1) {
    const err = new Error("No tracker table header (a | row with the tracker columns) found");
    err.code = "EBADTRACKER";
    throw err;
  }
  const colmap = detectColumns([lines[headerIndex]]);
  const warnings = [];
  if (!isSeparatorRow(lines[headerIndex + 1] ?? "")) {
    warnings.push(`Row ${headerIndex + 2}: expected a |---| separator under the header`);
  }

  const rows = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) {
      if (line.trim() !== "") break; // first non-table, non-empty line ends the table
      continue;
    }
    if (isSeparatorRow(line)) continue;
    const row = parseTrackerRow(line, colmap);
    if (!row) {
      warnings.push(`Row ${i + 1}: does not match the header (expected every column) — skipped`);
      continue;
    }
    const { score, sentinel, unparseable } = parseScoreCell(row.score);
    if (unparseable) warnings.push(`Row ${i + 1}: score "${unparseable}" does not parse as X.X/5`);
    rows.push({
      num: String(row.num),
      date: row.date,
      company: row.company,
      role: row.role,
      location: row.location ?? "",
      score,
      scoreSentinel: sentinel,
      status: row.status.replace(/\*\*/g, "").trim(),
      pdf: parsePdfCell(row.pdf),
      reportNum: extractReportNum(row.report, row.notes),
      reportCell: row.report,
      notes: row.notes,
      via: row.via ?? "",
      url: row.url,
    });
  }

  return { rows, warnings };
}

/** Read + parse the tracker file. fs errors (ENOENT etc.) propagate untouched. */
export async function readTracker(trackerFilePath) {
  const md = await fs.promises.readFile(trackerFilePath, "utf8");
  return parseTracker(md);
}
