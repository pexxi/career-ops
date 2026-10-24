// Seam C — server routes via Hono app.request(); no listening socket.
// CAREER_OPS_ROOT is read at call time, so each request points at a fixture
// dir; env vars are saved and restored around every alteration.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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
