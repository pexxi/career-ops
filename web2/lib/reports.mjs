// Lightweight reader for reports/*.md — header facts + title only; the full
// markdown is streamed to the client on demand.
import fs from "node:fs/promises";
import path from "node:path";

const FIELD_RE = (name) => new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.*)$`);

export function parseReportMeta(md) {
  const lines = md.split(/\r?\n/);
  const meta = { title: "", date: "", company: "", role: "", url: "", score: null, legitimacy: "", archetype: "" };
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
      ["archetype", FIELD_RE("Archetype")],
    ]) {
      const m = re.exec(line.trim());
      if (m && !meta[field]) {
        if (field === "score") {
          const parsed = /^([\d.]+)\s*\/\s*5$/.exec(m[1].trim());
          meta.score = parsed ? Number.parseFloat(parsed[1]) : null;
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

export async function listReports(reportsDirPath) {
  const names = await fs.readdir(reportsDirPath);
  const reports = [];
  for (const name of names.filter((f) => f.endsWith(".md"))) {
    const md = await fs.readFile(path.join(reportsDirPath, name), "utf8");
    reports.push({ file: name, ...parseReportMeta(md) });
  }
  reports.sort((a, b) => (a.file < b.file ? -1 : 1));
  return reports;
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
  return { file, markdown: md, ...parseReportMeta(md) };
}
