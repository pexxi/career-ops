// Parser for the applications tracker (data/applications.md).
// Distinguishes "file missing" (ENOENT — surfaces as a system error) from
// "file present but unreadable as a table" (parse error with warnings) — the
// web/AGENTS.md rule: a missing file is not a malformed file.
import fs from "node:fs";

// Header label aliases — resolved by NAME, column order carries no meaning
// (mirrors merge-tracker.mjs's alias rule).
export const COLUMN_ALIASES = {
  "#": "num",
  no: "num",
  "report #": "num",
  date: "date",
  company: "company",
  role: "role",
  location: "location",
  score: "score",
  status: "status",
  pdf: "pdf",
  report: "report",
  notes: "notes",
  "notes ": "notes",
  via: "via",
  url: "url",
};

const SCORE_SENTINELS = new Set(["n/a", "—", "-", ""]);
const PDF_YES = "✅";
const PDF_NO = "❌";

export function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

/** `[001](reports/001-....md)` → `001`; bare text falls through. */
export function extractReportNum(cell) {
  const link = /^`?\[([^\]]*)\]\(([^)\s]+)\)`?$/.exec(cell.trim())
  if (!link) return null;
  const label = link[1].trim();
  if (/^\d{1,4}$/.test(label)) return label.padStart(3, "0");
  // Label that is not a bare number: keep the href basename tell-tale.
  const m = /\/(\d{3})-/.exec(link[2]);
  return m ? m[1] : null;
}

/** Report/MH hyperlink cell or bare URL → the destination URL, else "". */
export function extractCellUrl(cell) {
  const trimmed = cell.trim();
  const link = /^`?\[([^\]]*)\]\(([^)\s]+)\)`?$/.exec(trimmed);
  return link ? link[2] : trimmed;
}

export function parseScoreCell(cell) {
  const trimmed = cell.trim();
  if (SCORE_SENTINELS.has(trimmed.toLowerCase())) return { score: null, sentinel: trimmed || null };
  const m = /^([\d.]+)\s*\/\s*5(?:\s*\(.*\))?$/.exec(trimmed);
  if (m) {
    const value = Number.parseFloat(m[1]);
    if (Number.isFinite(value)) return { score: value, sentinel: null };
  }
  return { score: null, sentinel: null, unparseable: trimmed };
}

export function parsePdfCell(cell) {
  const trimmed = cell.trim();
  if (trimmed === PDF_YES) return true;
  if (trimmed === PDF_NO) return false;
  return null;
}

/**
 * Parse the whole tracker markdown.
 * Returns { rows, headerLabels, warnings } — a row with a wrong cell count is
 * skipped to `warnings`, never silently merged.
 */
export function parseTracker(md) {
  const lines = md.split(/\r?\n/);
  const warnings = [];

  // Find the header row (first | line whose cells contain "Company") and its
  // separator row, then read data rows until a non-table line.
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    const cells = splitTableRow(lines[i]);
    if (cells.some((c) => c.toLowerCase() === "company")) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    const err = new Error("No tracker table header (a | row containing Company) found");
    err.code = "EBADTRACKER";
    throw err;
  }

  const headerLabels = splitTableRow(lines[headerIndex]);
  const columnNames = headerLabels.map((h) => COLUMN_ALIASES[h.toLowerCase()] ?? h.toLowerCase());

  const separatorIndex = headerIndex + 1;
  const separatorLooksRight =
    separatorIndex < lines.length && /-/.test(lines[separatorIndex]) && lines[separatorIndex].trim().startsWith("|");
  if (!separatorLooksRight) {
    warnings.push(`Row ${headerIndex + 2}: expected a |---| separator under the header`);
  }

  const rows = [];
  for (let i = separatorIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) {
      if (line.trim() !== "") break; // first non-table, non-empty line ends the table
      continue;
    }
    const cells = splitTableRow(line);
    if (cells.length !== columnNames.length) {
      warnings.push(`Row ${i + 1}: ${cells.length} cells, expected ${columnNames.length} — skipped`);
      continue;
    }
    const raw = {};
    columnNames.forEach((name, idx) => {
      raw[name] = cells[idx];
    });
    const { score, sentinel, unparseable } = parseScoreCell(raw.score ?? "");
    if (unparseable) warnings.push(`Row ${i + 1}: score "${unparseable}" does not parse as X.X/5`);
    rows.push({
      num: raw.num.trim(),
      date: raw.date?.trim() ?? "",
      company: raw.company?.trim() ?? "",
      role: raw.role?.trim() ?? "",
      location: raw.location?.trim() ?? "",
      score,
      scoreSentinel: sentinel,
      status: raw.status?.replace(/\*\*/g, "").trim() ?? "",
      pdf: parsePdfCell(raw.pdf ?? ""),
      reportNum: extractReportNum(raw.report ?? ""),
      reportCell: raw.report?.trim() ?? "",
      notes: raw.notes?.trim() ?? "",
      via: raw.via?.trim() ?? "",
      url: extractCellUrl(raw.url ?? ""),
    });
  }

  return { rows, headerLabels, warnings };
}

/** Read + parse the tracker file. fs errors (ENOENT etc.) propagate untouched. */
export async function readTracker(trackerFilePath) {
  const md = await fs.promises.readFile(trackerFilePath, "utf8");
  return parseTracker(md);
}
