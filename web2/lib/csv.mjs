// CSV export of the current filtered row set (ticket 04). Client-side, built
// from the same rows the table renders — no second query, no server column set
// that could drift from what the user sees.

/** One CSV field, RFC 4180: quote only when needed, double embedded quotes. */
export function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Header line + one line per row, newline-terminated. */
export function toCsv(header, rows) {
  return [header, ...rows].map((cells) => cells.map(csvCell).join(",")).join("\n") + "\n";
}

/** `applications-{lens}-{YYYY-MM-DD}.csv` — the lens the user was looking at. */
export function csvFilename(lens, date) {
  return `applications-${lens}-${date}.csv`;
}
