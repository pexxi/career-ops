// Runtime smoke test for every web2 screen — the safety net unit tests cannot
// give: the app is BUILT, served through the production Hono server against a
// throwaway copy of tests/fixtures/smoke, and driven in a real browser.
// Any page error (or a non-network console error) fails the run.
//
//   npm run smoke          # builds, then runs this
//
// Playwright resolves from the repo-root install (the core's PDF pipeline
// already depends on it); no separate browser download is needed here.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const web2Root = import.meta.dirname;
const failures = [];
const pageErrors = [];
// Missing favicon etc. are browser noise, not UI breakage.
const BENIGN_CONSOLE = /Failed to load resource|favicon/i;

async function step(name, fn) {
  try {
    await fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.error(`✖ ${name}\n  ${err.message}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(base, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/system`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not answer ${base}/api/system within ${timeoutMs}ms`);
}

async function main() {
  await fs.access(path.join(web2Root, "dist", "index.html")).catch(() => {
    throw new Error("dist/ is missing — run `npm run build` first (npm run smoke does both)");
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "web2-smoke-"));
  await fs.cp(path.join(web2Root, "tests", "fixtures", "smoke"), tmp, { recursive: true });

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, CAREER_OPS_ROOT: tmp, WEB2_PORT: String(port) };
  delete env.CAREER_OPS_DATA_DIR;
  delete env.CAREER_OPS_TRACKER;

  const server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: web2Root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));

  let browser;
  try {
    await waitForServer(base);
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.on("pageerror", (err) => pageErrors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !BENIGN_CONSOLE.test(msg.text())) {
        pageErrors.push(`console.error: ${msg.text()}`);
      }
    });

    const visible = async (locator, timeout = 8_000) => {
      await locator.first().waitFor({ state: "visible", timeout });
      return locator.first();
    };
    const absent = async (locator) => {
      assert.equal(await locator.count(), 0, `expected no ${locator} on screen`);
    };
    // The drawer is modal: close it before touching the table again.
    const closeDrawer = async () => {
      await page.keyboard.press("Escape");
      await page
        .locator('[role="dialog"]')
        .first()
        .waitFor({ state: "hidden", timeout: 3_000 })
        .catch(() => undefined);
    };
    const goto = async (hash) => {
      await closeDrawer();
      await page.goto(`${base}/#${hash}`, { waitUntil: "networkidle" });
    };

    // --- Every screen renders ------------------------------------------------
    await step("Overview screen renders", async () => {
      await goto("overview");
      await visible(page.getByRole("heading", { name: "Overview" }));
      await visible(page.getByText("nothing is submitted for you"));
    });

    await step("Applications screen renders the tracker table", async () => {
      await goto("applications");
      await visible(page.getByRole("heading", { name: "Applications" }));
      // Default lens is Deciding: only the Evaluated fixture row is listed.
      await visible(page.locator("tbody tr", { hasText: "OpenAI" }));
      assert.equal(await page.locator("tbody tr", { hasText: "Google" }).count(), 0);
      await visible(page.getByText("1 of 4 shown"));
    });

    await step("Reports screen renders", async () => {
      await goto("reports");
      await visible(page.getByRole("heading", { name: "Reports" }));
    });

    await step("System screen renders", async () => {
      await goto("system");
      await visible(page.getByRole("heading", { name: "System" }));
    });

    // --- Drawer: one stage at a time ----------------------------------------
    await step("deciding row opens the decision card (no process content)", async () => {
      await goto("applications");
      await page.locator("tbody tr", { hasText: "OpenAI" }).click();
      await visible(page.getByRole("tab", { name: "Stage focus" }));
      await visible(page.getByText("Requires US citizenship")); // hard stop
      await visible(page.getByText("No production Rust evidence")); // soft gap
      await visible(page.getByText("High Confidence")); // legitimacy
      await visible(page.getByText("Open externally"));
      await absent(page.getByText("Outcome", { exact: true }));
      await absent(page.getByText("No transitions recorded"));
    });

    await step("full report + JD archive stay behind the explicit tab", async () => {
      await absent(page.getByRole("heading", { name: /Evaluation: OpenAI/ }));
      await page.getByRole("tab", { name: "Full report" }).click();
      await visible(page.getByRole("heading", { name: /Evaluation: OpenAI/ }));
      await visible(page.getByText("Archived JD fixture line for the smoke test."));
    });

    await step("active row shows history + notes, never decision content", async () => {
      await goto("applications");
      await page.getByText("All", { exact: true }).click();
      await page.locator("tbody tr", { hasText: "Google" }).click();
      await visible(page.getByText("Applied → Interview"));
      await visible(page.getByText("loop scheduled"));
      await absent(page.getByText("Hard stops"));
      await absent(page.getByText("Soft gaps"));
    });

    await step("closed row condenses to one outcome line + notes", async () => {
      await closeDrawer();
      await page.locator("tbody tr", { hasText: "Meta" }).click();
      await visible(page.getByText("Outcome", { exact: true }));
      await visible(page.getByText("Rejected on 2026-09-01"));
      await visible(page.getByText("after loop"));
      await absent(page.getByText("Hard stops"));
    });

    // --- Status change: the single write path --------------------------------
    await step("status change writes through set-status.mjs and refreshes the drawer", async () => {
      await closeDrawer();
      await page.locator("tbody tr", { hasText: "Stripe" }).click();
      await visible(page.getByLabel("Change status").first());
      await page.getByRole("combobox", { name: "Change status" }).click();
      await page.getByRole("option", { name: "Interview", exact: true }).click();
      await page.getByLabel("Note (optional)").fill("smoke test");
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await visible(page.getByText("Row 4 status changed"), 15_000);
      // Drawer re-derives after invalidation: row 4 is now in an active stage.
      await visible(page.getByText("Applied → Interview"));
    });

    await step("the tracker file on disk carries the new state", async () => {
      const tracker = await fs.readFile(path.join(tmp, "data", "applications.md"), "utf8");
      const row = tracker.split(/\r?\n/).find((line) => line.startsWith("| 4 |"));
      assert.ok(row, "row 4 not found in the written tracker");
      assert.match(row, /\| Interview \|/, `row 4 status not Interview: ${row}`);
    });

    // --- Nothing crashed along the way ---------------------------------------
    await step("no page errors or unexpected console errors", async () => {
      assert.deepEqual(pageErrors, []);
    });
  } finally {
    await browser?.close().catch(() => undefined);
    server.kill("SIGTERM");
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} smoke step(s) failed.`);
    if (serverLog.trim()) console.error(`\nServer log:\n${serverLog}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll smoke steps passed.");
  }
}

await main();
