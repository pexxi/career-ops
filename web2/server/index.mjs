// Hono API + (production) static SPA server for web2.
// Loopback-only local tool: reads the career-ops markdown files, writes status
// changes ONLY through the core's set-status.mjs (single write path).
import { Hono } from "hono";
import { serve } from "@hono/node-server";
// v2 moved static serving to a subpath export.
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { locateFiles } from "../lib/paths.mjs";
import { readTracker } from "../lib/tracker.mjs";
import { readStatusLog, historyFor } from "../lib/statuslog.mjs";
import { listReports, readReport } from "../lib/reports.mjs";
import { computeStats } from "../lib/stats.mjs";

// Canonical states — mirrored from templates/states.yml (set-status.mjs is the
// real validator; this list only rejects obviously-bad requests early).
const STATES = [
  "Evaluated",
  "Applied",
  "Responded",
  "Assessment",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
  "Discarded",
  "SKIP",
];

const app = new Hono();

app.onError((err, c) => {
  const status = err.code === "ENOENT" ? 404 : 500;
  const code = err.code === "ENOENT" ? "ENOENT" : err.code === "EBADTRACKER" ? "EBADTRACKER" : err.code || "ERROR";
  return c.json({ error: { code, message: err.message } }, status);
});

app.get("/api/applications", async (c) => {
  const files = await locateFiles();
  const tracker = await readTracker(files.tracker);
  let logRows = [];
  try {
    logRows = await readStatusLog(files.statusLog);
  } catch {
    // No ledger yet — the tracker alone still drives the UI.
  }
  const rows = tracker.rows.map((row) => {
    const history = historyFor(logRows, row.num);
    return {
      ...row,
      history,
      lastTransition: history[0]?.date ?? row.date,
    };
  });
  return c.json({ trackerPath: files.tracker, dataRoot: files.dataRoot, rows, warnings: tracker.warnings });
});

app.get("/api/reports", async (c) => {
  const files = await locateFiles();
  const reports = await listReports(files.reportsDir);
  return c.json({ reports, warnings: [] });
});

app.get("/api/reports/:num", async (c) => {
  const num = Number.parseInt(c.req.param("num"), 10);
  if (!Number.isInteger(num) || num <= 0) {
    return c.json({ error: { code: "USAGE", message: `Bad report number "${c.req.param("num")}"` } }, 400);
  }
  const files = await locateFiles();
  const report = await readReport(files.reportsDir, num);
  return c.json({ report });
});

app.get("/api/stats", async (c) => {
  const files = await locateFiles();
  const tracker = await readTracker(files.tracker);
  let logRows = [];
  try {
    logRows = await readStatusLog(files.statusLog);
  } catch {
    // optional file
  }
  return c.json(computeStats(tracker.rows, logRows));
});

app.post("/api/status", async (c) => {
  const body = await c.req.json().catch(() => null);
  const num = Number.parseInt(body?.num, 10);
  const state = body?.state;
  const note = body?.note;
  if (!Number.isInteger(num) || num <= 0) {
    return c.json({ error: { code: "USAGE", message: "num must be a positive tracker row number" } }, 400);
  }
  if (!STATES.includes(state)) {
    return c.json(
      { error: { code: "USAGE", message: `state must be one of ${STATES.join(", ")}` } },
      400,
    );
  }
  const files = await locateFiles();
  const args = [path.join(files.repoRoot, "set-status.mjs"), String(num), state, "--json"];
  if (note) args.push("--note", String(note));

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: files.repoRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ ok: false, raw: String(e), stderr: String(e) }));
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });

  if (!result.ok) {
    return c.json(
      { error: { code: "SET_STATUS_FAILED", message: (result.stderr || result.stdout || "set-status failed").trim() } },
      500,
    );
  }
  // set-status --json prints a JSON object; find it defensively.
  const jsonLine = result.stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trim().startsWith("{"));
  let payload = null;
  try {
    payload = JSON.parse(jsonLine ?? "{}");
  } catch {
    payload = null;
  }
  return c.json({ ok: true, result: payload ?? {} });
});

app.get("/api/system", async (c) => {
  const files = await locateFiles();
  const checks = {};
  const checkFile = async (label, file) => {
    try {
      await fs.promises.access(file, fs.constants.R_OK);
      checks[label] = { status: "ok", path: file };
    } catch (err) {
      checks[label] = {
        status: err.code === "ENOENT" ? "missing" : "error",
        path: file,
        message: err.message,
      };
    }
  };
  await checkFile("tracker", files.tracker);
  await checkFile("statusLog", files.statusLog);
  try {
    const names = await fs.promises.readdir(files.reportsDir);
    checks.reports = { status: "ok", path: files.reportsDir, count: names.filter((f) => f.endsWith(".md")).length };
  } catch (err) {
    checks.reports = { status: err.code === "ENOENT" ? "missing" : "error", path: files.reportsDir, message: err.message };
  }
  return c.json({
    dataRoot: files.dataRoot,
    repoRoot: files.repoRoot,
    node: process.version,
    checks,
  });
});

// --- Production static SPA (dev: Vite serves the frontend instead) ----------
const distDir = path.join(import.meta.dirname, "..", "dist");
if (fs.existsSync(distDir)) {
  app.use("*", serveStatic({ root: distDir }));
  app.get("*", serveStatic({ path: path.join(distDir, "index.html") }));
}

const port = Number(process.env.WEB2_PORT ?? (process.argv.includes("--prod") ? 3001 : 4001));
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`web2 API listening on http://127.0.0.1:${info.port}`);
});
