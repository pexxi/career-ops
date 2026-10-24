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

const envKeys = ["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER", "CAREER_OPS_PROFILE", "WEB2_DATA_DIR", "WEB2_CONFIG"];
let saved = {};

beforeEach(() => {
  saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_TRACKER;
  delete process.env.CAREER_OPS_PROFILE;
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

// Ticket 06: Overview numbers come from the same tracker + ledger, via the
// core's cumulative-stage contract (funnel-stages.mjs).
test("GET /api/overview returns KPIs, ever-reached funnel and newest-first activity", async () => {
  pointAt("smoke");
  const res = await app.request("/api/overview");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.kpis, { deciding: 1, active: 2, everHired: 0, avgScore: 3.75 });
  // Row 3 is Rejected now but the ledger shows it came from Interview.
  assert.deepEqual(body.funnel, [
    { stage: "Evaluated", count: 4 },
    { stage: "Applied", count: 3 },
    { stage: "Responded", count: 2 },
    { stage: "Assessment", count: 2 },
    { stage: "Interview", count: 2 },
    { stage: "Offer", count: 0 },
    { stage: "Hired", count: 0 },
  ]);
  assert.equal(body.activity.length, 5);
  assert.deepEqual(body.activity[0], {
    num: "3", company: "Meta", role: "MCP Engineer", date: "2026-09-01", from: "Interview", to: "Rejected",
  });
});

test("a Deciding-only tracker still has a non-zero funnel (Evaluated bar)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "web2-overview-"));
  try {
    await fs.mkdir(path.join(tmp, "data"));
    await fs.writeFile(
      path.join(tmp, "data", "applications.md"),
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n" +
        "| 1 | 2026-09-01 | A | X | 4.0/5 | Evaluated | ❌ | — | |\n| 2 | 2026-09-02 | B | Y | N/A | Evaluated | ❌ | — | |\n",
    );
    process.env.CAREER_OPS_ROOT = tmp;
    const body = await (await app.request("/api/overview")).json();
    assert.equal(body.funnel[0].count, 2);
    assert.deepEqual(body.kpis, { deciding: 2, active: 0, everHired: 0, avgScore: 4 });
    assert.deepEqual(body.activity, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Ticket 07: missing ≠ broken ≠ healthy, per file, with the resolved paths.
test("GET /api/system reports each file as ok / missing / error with its path", async () => {
  pointAt("smoke");
  let body = await (await app.request("/api/system")).json();
  assert.equal(body.dataRoot, fixtureRoot("smoke"));
  assert.equal(body.rootSource, "env CAREER_OPS_ROOT");
  assert.equal(body.node, process.version);
  assert.deepEqual(body.checks.map((c) => [c.id, c.state]), [["tracker", "ok"], ["statusLog", "ok"], ["reportsDir", "ok"]]);
  assert.equal(body.checks[1].path, path.join(fixtureRoot("smoke"), "data", "status-log.tsv"));

  pointAt("tracker-ok"); // no ledger, no reports dir
  body = await (await app.request("/api/system")).json();
  assert.deepEqual(body.checks.map((c) => c.state), ["ok", "missing", "missing"]);

  pointAt("tracker-broken");
  body = await (await app.request("/api/system")).json();
  assert.equal(body.checks[0].state, "error");
  assert.match(body.checks[0].detail, /No tracker table header/);

  pointAt("tracker-missing");
  body = await (await app.request("/api/system")).json();
  assert.equal(body.checks[0].state, "missing");
});

// Ticket 08: the drawer reads intel by the tracker's company name.
test("GET /api/intel returns the snapshot for a tracker company spelling, null when none", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "web2-intel-route-"));
  try {
    process.env.WEB2_DATA_DIR = tmp;
    const { addIntel, intelDir } = await import("../lib/intel.mjs");
    await addIntel(intelDir(), "Google", {
      source: "levels.fyi", url: "https://www.levels.fyi/companies/google/salaries", fetchedAt: "2026-10-24",
      kind: "salaries", data: { medianTotal: 300000, currency: "USD" },
    });
    let body = await (await app.request(`/api/intel?company=${encodeURIComponent("Google LLC")}`)).json();
    assert.equal(body.snapshot.sources[0].source, "levels.fyi");
    body = await (await app.request("/api/intel?company=Unknown")).json();
    assert.equal(body.snapshot, null);
    const bad = await app.request("/api/intel");
    assert.equal(bad.status, 400);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Ticket 10: the Profile page's read + Profile apply write path.
const post = (url, body) =>
  app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("GET /api/profile returns the four files, a missing one as exists:false, and parsed profile.yml", async () => {
  pointAt("profile");
  const res = await app.request("/api/profile");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.files.map((f) => [f.name, f.exists]), [["profile", true], ["cv", true], ["modeProfile", true], ["voice", false]]);
  assert.equal(body.parsed.candidate.full_name, "Test Person");
  assert.equal(body.parsed.target_roles.archetypes[0].fit, "primary");
});

test("POST /api/profile/apply writes a confirmed patch; dryRun and a bad file write nothing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "web2-profile-"));
  try {
    await fs.cp(fixtureRoot("profile"), tmp, { recursive: true });
    process.env.CAREER_OPS_ROOT = tmp;
    const yml = path.join(tmp, "config", "profile.yml");
    const original = await fs.readFile(yml, "utf8");
    const patch = "@@ -17,1 +17,1 @@\n-  minimum: \"EUR 100K\"\n+  minimum: \"EUR 105K\"\n";

    let res = await post("/api/profile/apply", { file: "profile", patch, dryRun: true });
    assert.equal(res.status, 200);
    assert.match((await res.json()).after, /EUR 105K/);
    assert.equal(await fs.readFile(yml, "utf8"), original, "dry run wrote the file");

    res = await post("/api/profile/apply", { file: "../../etc/passwd", patch });
    assert.equal(res.status, 400);
    res = await post("/api/profile/apply", { file: "profile", patch: "@@ -1,1 +1,1 @@\n-nope\n+x\n" });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, "PATCH_REJECTED");
    assert.equal(await fs.readFile(yml, "utf8"), original, "a rejected patch wrote the file");

    res = await post("/api/profile/apply", { file: "profile", patch });
    assert.equal(res.status, 200);
    assert.equal(await fs.readFile(yml, "utf8"), original.replace("EUR 100K", "EUR 105K"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Ticket 11: the coach's routes. Without a config the page still works and the
// chat says why; with one, the status reports the model and never the key.
test("profile coach: missing config → setup state + 503 on chat; configured status never carries the key", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "web2-coach-route-"));
  try {
    pointAt("profile");
    process.env.WEB2_DATA_DIR = tmp;
    process.env.WEB2_CONFIG = path.join(tmp, "config.json");
    let status = await (await app.request("/api/profile/coach")).json();
    assert.equal(status.configured, false);
    assert.match(status.reason, /config\.json/);
    assert.deepEqual(status.sessions, []);
    const res = await post("/api/profile/chat", { message: "hi", reports: [] });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, "COACH_NOT_CONFIGURED");

    await fs.writeFile(process.env.WEB2_CONFIG, JSON.stringify({ provider: "anthropic", apiKey: "sk-ant-never-shown" }));
    const raw = await (await app.request("/api/profile/coach")).text();
    assert.ok(!raw.includes("sk-ant-never-shown"), "the API key reached the client");
    status = JSON.parse(raw);
    assert.equal(status.configured, true);
    assert.equal(status.model, "claude-opus-5-5");
    const bad = await post("/api/profile/chat", { message: "", reports: [] });
    assert.equal(bad.status, 400);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Review fixes: no reports dir is an empty list (System reports it missing),
// and a tracker with skipped rows reads as broken, not healthy.
test("GET /api/reports with no reports dir is an empty list, not an error", async () => {
  pointAt("tracker-ok");
  const res = await app.request("/api/reports");
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).reports, []);
});

test("GET /api/system marks a tracker with malformed rows as error", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "web2-system-"));
  try {
    await fs.mkdir(path.join(tmp, "data"));
    await fs.writeFile(
      path.join(tmp, "data", "applications.md"),
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n" +
        "| 1 | 2026-09-01 | A | X | 4.0/5 | Evaluated | ❌ | — | |\n| 2 | only | three |\n",
    );
    process.env.CAREER_OPS_ROOT = tmp;
    const body = await (await app.request("/api/system")).json();
    assert.equal(body.checks[0].state, "error");
    assert.match(body.checks[0].detail, /1 row\(s\) skipped/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
