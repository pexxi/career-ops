// Seam C — server routes via Hono app.request(); no listening socket.
// CAREER_OPS_ROOT is read at call time, so each request points at a fixture
// dir; env vars are saved and restored around every alteration.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Import once — the module must NOT bind a port on import (serve() guard).
const { app } = await import("../server/index.mjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = (name) => path.join(here, "fixtures", name);

const envKeys = ["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER"];
let saved = {};

beforeEach(() => {
  saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_TRACKER;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const pointAt = (name) => {
  process.env.CAREER_OPS_ROOT = fixtureRoot(name);
};

test("GET /api/applications parses the tracker from a valid fixture root", async () => {
  pointAt("tracker-ok");
  const res = await app.request("/api/applications");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.warnings.length, 0);
  assert.equal(body.rows.length, 3);
  assert.equal(body.rows[0].company, "OpenAI");
  assert.equal(body.rows[0].num, "1");
  assert.equal(body.rows[1].score, null); // sentinel row parses to null score
  assert.equal(body.rows[1].status, "Interview");
  assert.ok(body.trackerPath.includes("data/applications.md"));
});

test("missing tracker file → 404, NOT the malformed-file error", async () => {
  pointAt("tracker-missing");
  const res = await app.request("/api/applications");
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "ENOENT");
});

test("malformed tracker (no header row) → 500 with code EBADTRACKER", async () => {
  pointAt("tracker-broken");
  const res = await app.request("/api/applications");
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error.code, "EBADTRACKER");
});

test("POST /api/status rejects a bad num with 400 USAGE (no write attempted)", async () => {
  pointAt("tracker-ok");
  const res = await app.request("/api/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ num: "abc", state: "Applied" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "USAGE");
});

test("POST /api/status rejects an unknown state with 400 USAGE (no write attempted)", async () => {
  pointAt("tracker-ok");
  const res = await app.request("/api/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ num: 1, state: "Bogus" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "USAGE");
});

// Seam D (ticket 03): the drawer's one write action. The server must address
// the tracker ROW (--row), not a bare "#N": on this fixture row 2 links report
// #001, exactly the divergence the core's bare-numeric guard rejects — and
// real trackers diverge the same way. The write must land, not reroute.
test("POST /api/status changes a diverged row through --row, not a bare #N", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "web2-status-"));
  try {
    await fs.cp(fixtureRoot("tracker-report-mismatch"), tmp, { recursive: true });
    process.env.CAREER_OPS_ROOT = tmp;
    const res = await app.request("/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ num: 2, state: "Applied" }),
    });
    assert.equal(res.status, 200);
    const tracker = await fs.readFile(path.join(tmp, "data", "applications.md"), "utf8");
    const row = tracker.split(/\r?\n/).find((line) => line.startsWith("| 2 |"));
    assert.ok(row, "row 2 not found in the written tracker");
    assert.match(row, /\| Applied \|/, `row 2 was not changed: ${row}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// A rejected write must come back as an explicit error the drawer can surface
// — never a silent success and never a reroute to a different row.
test("POST /api/status surfaces a set-status.mjs rejection as SET_STATUS_FAILED", async () => {
  pointAt("tracker-ok");
  const res = await app.request("/api/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ num: 99, state: "Applied" }),
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error.code, "SET_STATUS_FAILED");
  assert.match(body.error.message, /No tracker row with #99/);
});

// Ticket 05: the Reports page lists every reports/*.md with its header facts.
test("GET /api/reports lists reports with number, company, role, score, date, legitimacy", async () => {
  pointAt("smoke");
  const res = await app.request("/api/reports");
  assert.equal(res.status, 200);
  const { reports } = await res.json();
  assert.equal(reports.length, 3);
  assert.deepEqual(reports.map((r) => r.num), ["003", "002", "001"]);
  const openai = reports.find((r) => r.num === "001");
  assert.equal(openai.company, "OpenAI");
  assert.equal(openai.role, "Forward Deployed Engineer");
  assert.equal(openai.score, 4.2);
  assert.equal(openai.date, "2026-08-25");
  assert.equal(openai.legitimacy, "High Confidence");
  assert.equal(openai.markdown, undefined, "the list must not ship every report body");
});
