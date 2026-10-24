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
import { locateFiles, rootSource } from "../lib/paths.mjs";
import { readTracker } from "../lib/tracker.mjs";
import { readHistoryByRow } from "../lib/statuslog.mjs";
import { listReports, readReport } from "../lib/reports.mjs";
import { overview } from "../lib/overview.mjs";
import { intelDir, readIntel } from "../lib/intel.mjs";
import { applyProfilePatch, readProfile } from "../lib/profile.mjs";
import {
  appendTranscript,
  askCoach,
  buildCoachRequest,
  chatDir,
  coachStatus,
  extractProposals,
  listSessions,
  loadCoachConfig,
  readTranscript,
  SESSION_ID_RE,
} from "../lib/coach.mjs";
import { randomUUID } from "node:crypto";
import { loadCanonicalStates } from "../../tracker-utils.mjs";
import { parseStatusLog } from "../../funnel-velocity.mjs";
import { isMainModule } from "../../lib/is-main-module.mjs";

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
  const files = locateFiles();
  const { rows, warnings } = await loadApplications(files);
  return c.json({ trackerPath: files.tracker, dataRoot: files.dataRoot, rows, warnings });
});

app.get("/api/overview", async (c) => {
  const files = locateFiles();
  const { rows } = await loadApplications(files);
  const ledger = await fs.promises.readFile(files.statusLog, "utf8").catch((err) => {
    if (err.code === "ENOENT") return ""; // no ledger yet = no history, as readHistoryByRow treats it
    throw err;
  });
  return c.json(overview(rows, ledger));
});

app.get("/api/reports", async (c) => {
  const files = locateFiles();
  return c.json({ reportsDir: files.reportsDir, reports: await listReports(files.reportsDir) });
});

app.get("/api/reports/:num", async (c) => {
  const num = Number.parseInt(c.req.param("num"), 10);
  if (!Number.isInteger(num) || num <= 0) {
    return c.json({ error: { code: "USAGE", message: `Bad report number "${c.req.param("num")}"` } }, 400);
  }
  const files = locateFiles();
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
  const files = locateFiles();
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
  // set-status --json prints exactly one JSON object.
  return c.json({ ok: true, result: JSON.parse(result.stdout) });
});

// Company intel (ticket 08): read-only view of the local cache; never scrapes.
app.get("/api/intel", async (c) => {
  const company = c.req.query("company")?.trim();
  if (!company) return c.json({ error: { code: "USAGE", message: "company query parameter is required" } }, 400);
  return c.json({ snapshot: await readIntel(intelDir(), company) });
});

// Candidate profile (ticket 10). The only write is Profile apply: a unified
// patch to one NAMED profile file, applied strictly where its hunks say.
app.get("/api/profile", async (c) => c.json(await readProfile()));

app.post("/api/profile/apply", async (c) => {
  const body = await c.req.json().catch(() => null);
  try {
    return c.json(await applyProfilePatch(body?.file, body?.patch, { dryRun: body?.dryRun === true }));
  } catch (err) {
    if (err.code === "USAGE") return c.json({ error: { code: err.code, message: err.message } }, 400);
    if (err.code === "PATCH_REJECTED") return c.json({ error: { code: err.code, message: err.message } }, 409);
    throw err;
  }
});

// Profile coach (ticket 11, ADR 0005): proposes edits, writes no profile file.
// The key stays here: only coachStatus() (configured/model/reason) is sent.
app.get("/api/profile/coach", async (c) =>
  c.json({ ...coachStatus(await loadCoachConfig()), sessions: await listSessions(chatDir()) }),
);

app.get("/api/profile/coach/:session", async (c) => {
  try {
    const entries = await readTranscript(chatDir(), c.req.param("session"));
    // Proposals are re-derived from the reply text, so a resumed session can still apply them.
    const messages = entries.map((m) => (m.role === "assistant" ? { ...m, proposals: extractProposals(m.content) } : m));
    return c.json({ messages });
  } catch (err) {
    return c.json({ error: { code: "USAGE", message: err.message } }, 400);
  }
});

app.post("/api/profile/chat", async (c) => {
  const body = await c.req.json().catch(() => null);
  const message = String(body?.message ?? "").trim();
  const reportNums = Array.isArray(body?.reports) ? body.reports.map(String) : [];
  if (!message) return c.json({ error: { code: "USAGE", message: "message is required" } }, 400);
  if (reportNums.some((n) => !/^\d{1,6}$/.test(n))) {
    return c.json({ error: { code: "USAGE", message: "reports must be report numbers" } }, 400);
  }
  const config = await loadCoachConfig();
  if (!config.ok) return c.json({ error: { code: "COACH_NOT_CONFIGURED", message: config.reason } }, 503);

  const sessionId = body?.sessionId || randomUUID();
  if (!SESSION_ID_RE.test(String(sessionId))) {
    return c.json({ error: { code: "USAGE", message: "bad sessionId" } }, 400);
  }
  const files = locateFiles();
  // A corrupt transcript surfaces as a server error, not as the client's mistake.
  const history = await readTranscript(chatDir(), sessionId);
  const reports = await Promise.all(
    reportNums.map(async (n) => ({ num: n, markdown: (await readReport(files.reportsDir, Number(n))).markdown })),
  );
  const request = buildCoachRequest({ files: (await readProfile()).files, reports, history, message });

  let reply;
  try {
    reply = await askCoach(config, request);
  } catch (err) {
    // SDK errors carry status + message, never the key.
    return c.json({ error: { code: "COACH_API_ERROR", message: err.message } }, 502);
  }
  const at = new Date().toISOString();
  await appendTranscript(chatDir(), sessionId, { role: "user", content: message, reports: reportNums, at });
  await appendTranscript(chatDir(), sessionId, { role: "assistant", content: reply, at: new Date().toISOString() });
  return c.json({ sessionId, reply, proposals: extractProposals(reply) });
});

// System health (ticket 07): each file the app reads is ok, missing (ENOENT)
// or broken (any other error, incl. a parse failure) — three different states.
async function check(id, label, filePath, probe) {
  try {
    return { id, label, path: filePath, state: "ok", detail: await probe() };
  } catch (err) {
    return { id, label, path: filePath, state: err.code === "ENOENT" ? "missing" : "error", detail: err.message };
  }
}

app.get("/api/system", async (c) => {
  const files = locateFiles();
  const checks = await Promise.all([
    check("tracker", "Application tracker", files.tracker, async () => {
      const { rows, warnings } = await readTracker(files.tracker);
      // Skipped rows are a parse problem, so the file reads as broken (like the ledger).
      if (warnings.length) throw new Error(`${warnings.length} row(s) skipped as malformed; first: ${warnings[0]}`);
      return `${rows.length} rows`;
    }),
    check("statusLog", "Status ledger", files.statusLog, async () => {
      const text = await fs.promises.readFile(files.statusLog, "utf8");
      const { observations, unparseable } = parseStatusLog(text, loadStates(files));
      if (unparseable.length) {
        const first = unparseable[0];
        throw new Error(`${unparseable.length} unparseable line(s); first: line ${first.line} (${first.reason})`);
      }
      return `${observations.length} transitions`;
    }),
    check("reportsDir", "Reports directory", files.reportsDir, async () => {
      const names = await fs.promises.readdir(files.reportsDir);
      return `${names.filter((f) => f.endsWith(".md")).length} reports`;
    }),
  ]);
  return c.json({ dataRoot: files.dataRoot, rootSource: rootSource(), node: process.version, checks });
});

// --- Production static SPA (dev: Vite serves the frontend instead) ----------
const distDir = path.join(import.meta.dirname, "..", "dist");
if (fs.existsSync(distDir)) {
  app.use("*", serveStatic({ root: distDir }));
  app.get("*", serveStatic({ path: path.join(distDir, "index.html") }));
}

// Bind the port only when this module is the entrypoint (`node server/index.mjs`,
// dev.mjs, `npm start`) — importing it from tests must stay socket-free.
const isEntrypoint = process.env.WEB2_SERVE === "1" || isMainModule(import.meta.url);

if (isEntrypoint && process.argv.includes("--help")) {
  console.log("usage: node server/index.mjs [--prod]   (port 4001, or 3001 with --prod; WEB2_PORT overrides)");
} else if (isEntrypoint) {
  const port = Number(process.env.WEB2_PORT ?? (process.argv.includes("--prod") ? 3001 : 4001));
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
    console.log(`web2 API listening on http://127.0.0.1:${info.port}`);
  });
}
