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
