// Seam F (ticket 04): CSV export of the current filtered row set. Pure string
// building — quoting is the only subtle part (RFC 4180).
import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, csvFilename, localDateIso, toCsv } from "../lib/csv.mjs";

test("plain cells pass through untouched", () => {
  assert.equal(csvCell("OpenAI"), "OpenAI");
  assert.equal(csvCell("3.5"), "3.5");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("cells with a comma, quote or newline are quoted, quotes doubled", () => {
  assert.equal(csvCell("Acme, Inc."), '"Acme, Inc."');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell(" padded "), " padded ", "spaces alone are not a reason to quote");
});

test("toCsv writes a header line then one line per row", () => {
  const csv = toCsv(["#", "Company"], [["1", "Acme, Inc."], ["2", "Globex"]]);
  assert.equal(csv, '#,Company\n1,"Acme, Inc."\n2,Globex\n');
});

test("a header-only export is still a valid file", () => {
  assert.equal(toCsv(["#", "Company"], []), "#,Company\n");
});

test("filename carries lens and date", () => {
  assert.equal(csvFilename("deciding", "2026-10-24"), "applications-deciding-2026-10-24.csv");
  assert.equal(csvFilename("all", "2026-01-02"), "applications-all-2026-01-02.csv");
});

test("localDateIso reads the LOCAL day, not the UTC one", () => {
  // 23:30 local is already the next day in some timezones (UTC+…) — the export
  // must be dated by the user's calendar day.
  assert.equal(localDateIso(new Date(2026, 9, 24, 23, 30)), "2026-10-24");
  assert.equal(localDateIso(new Date(2026, 0, 2, 0, 15)), "2026-01-02");
});
