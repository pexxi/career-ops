// Lightweight reader for reports/*.md — header facts + title only; the full
// markdown and its Machine Summary (parsed by the core) are sent on demand.
import fs from "node:fs/promises";
import path from "node:path";
import { parseScoreCell } from "./tracker.mjs";
import { parseMachineSummary } from "../../analyze-patterns.mjs";

const FIELD_RE = (name) => new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.*)$`);

export function parseReportMeta(md) {
  const lines = md.split(/\r?\n/);
  const meta = { title: "", date: "", company: "", role: "", url: "", score: null, legitimacy: "" };
  for (const line of lines) {
    if (line.startsWith("## ")) break; // header facts end at the first section
    if (!meta.title && /^#\s+/.test(line)) {
      meta.title = line.replace(/^#\s+/, "").trim();
      // "# Evaluation: Company — Role"
      const m = /^Evaluation:\s*(.+?)\s*[—–-]\s*(.+)$/.exec(meta.title);
      if (m) {
        meta.company = m[1].trim();
        meta.role = m[2].trim();
      }
      continue;
    }
    for (const [field, re] of [
      ["date", FIELD_RE("Date")],
      ["url", FIELD_RE("URL")],
      ["score", FIELD_RE("Score")],
      ["legitimacy", FIELD_RE("Legitimacy")],
    ]) {
      const m = re.exec(line.trim());
      if (m && !meta[field]) {
        if (field === "score") {
          meta.score = parseScoreCell(m[1]).score;
        } else {
          meta[field] = m[1].trim();
        }
      }
    }
  }
  return meta;
}

export function padNum(n) {
  return String(n).padStart(3, "0");
}

export async function readReport(reportsDirPath, num) {
  const padded = padNum(num);
  const names = await fs.readdir(reportsDirPath);
  const file = names.find((f) => f.startsWith(`${padded}-`) && f.endsWith(".md"));
  if (!file) {
    const err = new Error(`No report ${padded}-*.md in ${reportsDirPath}`);
    err.code = "ENOENT";
    throw err;
  }
  const md = await fs.readFile(path.join(reportsDirPath, file), "utf8");
  return { file, markdown: md, ...parseReportMeta(md), summary: parseMachineSummary(md) ?? {} };
}

/** Every `NNN-*.md` in the reports dir → header facts (no body), newest number first. */
export async function listReports(reportsDirPath) {
  // No reports dir yet = no reports (the System page reports it as missing).
  const all = await fs.readdir(reportsDirPath).catch((err) => (err.code === "ENOENT" ? [] : Promise.reject(err)));
  const names = all.filter((f) => /^\d+-.*\.md$/.test(f));
  const reports = await Promise.all(
    names.map(async (file) => ({
      num: padNum(Number.parseInt(file, 10)),
      file,
      ...parseReportMeta(await fs.readFile(path.join(reportsDirPath, file), "utf8")),
    })),
  );
  return reports.sort((a, b) => Number(b.num) - Number(a.num));
}
