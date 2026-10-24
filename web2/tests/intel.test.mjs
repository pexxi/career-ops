// Ticket 08 seam: the company-intel cache (lib/intel.mjs) — one JSON snapshot
// per company, keyed by the core's company normalization; adds never overwrite.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addIntel, readIntel } from "../lib/intel.mjs";

const entry = (over = {}) => ({
  source: "Glassdoor",
  url: "https://www.glassdoor.com/Reviews/OpenAI-Reviews-E2210885.htm",
  fetchedAt: "2026-10-24",
  kind: "reviews",
  data: { rating: 4.1, reviewCount: 120, pros: ["mission"], cons: ["pace"] },
  ...over,
});

async function withDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "web2-intel-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("a company with no snapshot reads as null, not an error", () =>
  withDir(async (dir) => {
    assert.equal(await readIntel(dir, "Nobody Ltd"), null);
    assert.equal(await readIntel(dir, "?"), null); // the tracker's unknown-employer marker
  }));

test("tracker spellings of one company resolve to the same snapshot", () =>
  withDir(async (dir) => {
    await addIntel(dir, "OpenAI, Inc.", entry());
    const snap = await readIntel(dir, "openai");
    assert.equal(snap.company, "OpenAI, Inc.");
    assert.equal(snap.sources.length, 1);
    assert.equal(snap.sources[0].data.rating, 4.1);
  }));

test("a second fetch adds a dated entry; the earlier one survives", () =>
  withDir(async (dir) => {
    await addIntel(dir, "OpenAI", entry());
    await addIntel(dir, "OpenAI", entry({ fetchedAt: "2026-11-01", data: { rating: 4.0 } }));
    const snap = await readIntel(dir, "OpenAI");
    assert.deepEqual(snap.sources.map((s) => s.fetchedAt), ["2026-10-24", "2026-11-01"]);
    assert.equal(snap.sources[0].data.rating, 4.1);
  }));

test("an entry without provenance (source, url, fetchedAt) or with an unknown kind is refused", () =>
  withDir(async (dir) => {
    for (const bad of [{ source: "" }, { url: "" }, { fetchedAt: "yesterday" }, { kind: "gossip" }]) {
      await assert.rejects(addIntel(dir, "OpenAI", entry(bad)), /provenance|kind/);
    }
    assert.equal(await readIntel(dir, "OpenAI"), null);
  }));

// Ticket 09 seam: dataset import aggregates a CSV per tracker company.
import { aggregateDataset } from "../lib/intel.mjs";

test("a reviews dataset aggregates to rating, count and sample pros/cons per tracker company only", () => {
  const rows = [
    ["firm", "overall_rating", "pros", "cons"],
    ["Google", "5", "smart people", ""],
    ["Google", "3", "", "slow promos"],
    ["Google", "4", "food", "big org"],
    ["Initech", "1", "none", "tps reports"],
  ];
  const out = aggregateDataset(rows, { kind: "reviews", companyCol: "firm", valueCol: "overall_rating", prosCol: "pros", consCol: "cons" }, ["Google LLC"]);
  assert.deepEqual(out, [
    { company: "Google LLC", data: { rating: 4, reviewCount: 3, pros: ["smart people", "food"], cons: ["slow promos", "big org"] } },
  ]);
});

test("a salaries dataset aggregates to median total and per-level medians", () => {
  const rows = [
    ["company", "level", "totalyearlycompensation"],
    ["Google", "L4", "200000"],
    ["Google", "L4", "220000"],
    ["Google", "L5", "300000"],
    ["google", "L6", "not a number"],
  ];
  const out = aggregateDataset(rows, { kind: "salaries", companyCol: "company", valueCol: "totalyearlycompensation", levelCol: "level", currency: "USD" }, ["Google"]);
  assert.deepEqual(out, [
    {
      company: "Google",
      data: { medianTotal: 220000, currency: "USD", levels: [{ level: "L4", total: 210000 }, { level: "L5", total: 300000 }] },
    },
  ]);
});

test("a column name that is not in the header fails loudly with the real headers", () => {
  assert.throws(
    () => aggregateDataset([["firm", "rating"]], { kind: "reviews", companyCol: "firm", valueCol: "overall_rating" }, ["X"]),
    /overall_rating.*firm, rating/,
  );
});
