// Hono API + (production) static SPA server for web2.
// Loopback-only local tool: reads the career-ops markdown files, writes status
// changes ONLY through the core's set-status.mjs (single write path).
import { Hono } from "hono";
import { serve } from "@hono/node-server";
// v2 moved static serving to a subpath export.
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { locateFiles } from "../lib/paths.mjs";
import { readTracker } from "../lib/tracker.mjs";
import { readHistoryByRow } from "../lib/statuslog.mjs";
import { listReports, readReport } from "../lib/reports.mjs";
import { overview } from "../lib/overview.mjs";
import { loadCanonicalStates } from "../../tracker-utils.mjs";

// Canonical states from templates/states.yml (set-status.mjs is the real
// validator; this only rejects obviously-bad requests early).
const loadStates = (files) => loadCanonicalStates(files.statesYml);

const app = new Hono();
export { app };

app.onError((err, c) => {
  const status = err.code === "ENOENT" ? 404 : 500;
  const code = err.code || "ERROR";
  return c.json({ error: { code, message: err.message } }, status);
});

/** Tracker rows joined with their status-ledger history (newest first). */
async function loadApplications(files) {
  const tracker = await readTracker(files.tracker);
  const historyByRow = await readHistoryByRow(files.statusLog, loadStates(files));
  const rows = tracker.rows.map((row) => {
    const history = historyByRow.get(row.num) ?? [];
    return {
      ...row,
      history,
      lastTransition: history[0]?.date ?? row.date,
    };
  });
  return { rows, warnings: tracker.warnings };
}

app.get("/api/applications", async (c) => {
  const files = await locateFiles();
  const { rows, warnings } = await loadApplications(files);
  return c.json({ trackerPath: files.tracker, dataRoot: files.dataRoot, rows, warnings });
});

app.get("/api/overview", async (c) => {
  const files = await locateFiles();
  const { rows } = await loadApplications(files);
  const ledger = await fs.promises.readFile(files.statusLog, "utf8").catch((err) => {
    if (err.code === "ENOENT") return ""; // no ledger yet = no history, as readHistoryByRow treats it
    throw err;
  });
  return c.json(overview(rows, ledger));
});

app.get("/api/reports", async (c) => {
  const files = await locateFiles();
  return c.json({ reportsDir: files.reportsDir, reports: await listReports(files.reportsDir) });
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

app.post("/api/status", async (c) => {
  const body = await c.req.json().catch(() => null);
  const num = Number.parseInt(body?.num, 10);
  const state = body?.state;
  const note = body?.note;
  if (!Number.isInteger(num) || num <= 0) {
    return c.json({ error: { code: "USAGE", message: "num must be a positive tracker row number" } }, 400);
  }
  const files = await locateFiles();
  const labels = loadStates(files).map((s) => s.label);
  if (!labels.includes(state)) {
    return c.json({ error: { code: "USAGE", message: `state must be one of ${labels.join(", ")}` } }, 400);
  }
  // --row, never a bare "#N": the bare numeric selector is ambiguous once the
  // tracker's row IDs and its report links have diverged (the core guard
  // rejects it on such rows), and the drawer is always addressing a row.
  const args = [path.join(files.repoRoot, "set-status.mjs"), "--row", String(num), state, "--json"];
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

// --- Production static SPA (dev: Vite serves the frontend instead) ----------
const distDir = path.join(import.meta.dirname, "..", "dist");
if (fs.existsSync(distDir)) {
  app.use("*", serveStatic({ root: distDir }));
  app.get("*", serveStatic({ path: path.join(distDir, "index.html") }));
}

// Bind the port only when this module is the entrypoint (`node server/index.mjs`,
// dev.mjs, `npm start`) — importing it from tests must stay socket-free.
const isEntrypoint =
  process.env.WEB2_SERVE === "1" ||
  (!!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href);

if (isEntrypoint) {
  const port = Number(process.env.WEB2_PORT ?? (process.argv.includes("--prod") ? 3001 : 4001));
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
    console.log(`web2 API listening on http://127.0.0.1:${info.port}`);
  });
}
