import { test } from "node:test";
import assert from "node:assert/strict";
import { sortRows } from "../lib/sortrows.mjs";

const ROWS = [
  { date: "2026-08-25", company: "openai", score: 3.5 },
  { date: "2026-07-28", company: "Apple", score: null },
  { date: "2026-09-01", company: "banana", score: 1.2 },
  { date: "2026-07-01", company: "Zebra", score: 4.0 },
];

test("score sorts numerically with nulls LAST in ascending", () => {
  const out = sortRows(ROWS, { key: "score", dir: "asc" });
  assert.deepEqual(
    out.map((r) => r.score),
    [1.2, 3.5, 4.0, null],
  );
});

test("score sorts numerically with nulls LAST in descending", () => {
  const out = sortRows(ROWS, { key: "score", dir: "desc" });
  assert.deepEqual(
    out.map((r) => r.score),
    [4.0, 3.5, 1.2, null],
  );
});

test("date compares ISO-ish strings ascending and descending", () => {
  const asc = sortRows(ROWS, { key: "date", dir: "asc" });
  assert.deepEqual(
    asc.map((r) => r.date),
    ["2026-07-01", "2026-07-28", "2026-08-25", "2026-09-01"],
  );
  const desc = sortRows(ROWS, { key: "date", dir: "desc" });
  assert.deepEqual(
    desc.map((r) => r.date),
    ["2026-09-01", "2026-08-25", "2026-07-28", "2026-07-01"],
  );
});

test("company uses locale-aware collation, not string code points", () => {
  // Plain string comparison puts "Zebra" (0x5A) before "banana" (0x62);
  // a collator compares them case-insensitively.
  const out = sortRows(ROWS, { key: "company", dir: "asc" });
  assert.deepEqual(
    out.map((r) => r.company),
    ["Apple", "banana", "openai", "Zebra"],
  );
});

test("sortRows returns a new array and never mutates the input", () => {
  const input = [...ROWS];
  const out = sortRows(input, { key: "score", dir: "desc" });
  assert.notEqual(out, input);
  assert.deepEqual(input, ROWS);
});

test("unknown keys fall back to date; dir defaults to asc", () => {
  const out = sortRows(ROWS, { key: "nope" });
  assert.deepEqual(
    out.map((r) => r.date),
    ["2026-07-01", "2026-07-28", "2026-08-25", "2026-09-01"],
  );
});
