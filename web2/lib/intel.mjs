// Company-intel cache (ticket 08, ADR 0004): one JSON snapshot per company under
// {data root}/data/web2/company-intel/ (gitignored user data). The app only reads it; the
// capture routines in scripts/ add entries. Every entry carries its provenance
// (source + url + fetchedAt), and adding never overwrites an earlier entry.
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeCompanyName } from "../../invite-match.mjs";
import { median } from "../../funnel-velocity.mjs";
import { replaceUserFile } from "../../tracker-utils.mjs";
import { web2DataDir } from "./paths.mjs";

export const INTEL_KINDS = ["reviews", "salaries"];

export function intelDir() {
  return path.join(web2DataDir(), "company-intel");
}

/** "OpenAI, Inc." and "openai" → the same file; null for a name with no
 * letters/digits (the tracker's "?" unknown-employer marker). The key is
 * letters/digits/spaces only, so it cannot escape the dir. */
function intelFile(dir, company) {
  const key = normalizeCompanyName(company);
  return key ? path.join(dir, `${key.replace(/ /g, "-")}.json`) : null;
}

export async function readIntel(dir, company) {
  const file = intelFile(dir, company);
  if (!file) return null;
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** Append one dated entry `{source, url, fetchedAt, kind, data, asOf?}` to the company's snapshot. */
export async function addIntel(dir, company, entry) {
  const { source, url, fetchedAt, kind } = entry ?? {};
  if (!source || !url || !/^\d{4}-\d{2}-\d{2}/.test(fetchedAt ?? "")) {
    throw new Error("Intel entry needs provenance: source, url and fetchedAt (YYYY-MM-DD)");
  }
  if (!INTEL_KINDS.includes(kind)) throw new Error(`Intel kind must be one of ${INTEL_KINDS.join(", ")}`);
  const file = intelFile(dir, company);
  if (!file) throw new Error(`Company "${company}" has no usable name to key intel on`);
  const snapshot = (await readIntel(dir, company)) ?? { company, sources: [] };
  snapshot.sources.push(entry);
  await fs.mkdir(dir, { recursive: true });
  replaceUserFile(file, JSON.stringify(snapshot, null, 2) + "\n");
  return snapshot;
}

/**
 * Open-dataset import (ticket 09): CSV rows (header first) → one `{company, data}`
 * per tracker company that appears in the dataset. Columns are named explicitly
 * because dataset schemas drift; a wrong name fails with the real header list.
 * opts: { kind, companyCol, valueCol, levelCol?, prosCol?, consCol?, currency? }
 */
export function aggregateDataset(rows, opts, companies) {
  const [header, ...body] = rows;
  const col = (name) => {
    if (!name) return -1;
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Column "${name}" not in the dataset header: ${header.join(", ")}`);
    return i;
  };
  const [ci, vi, li, pi, ki] = [opts.companyCol, opts.valueCol, opts.levelCol, opts.prosCol, opts.consCol].map(col);
  const wanted = new Map(companies.map((c) => [normalizeCompanyName(c), c]).filter(([key]) => key));
  const byCompany = new Map();
  for (const row of body) {
    const company = wanted.get(normalizeCompanyName(row[ci]));
    const value = Number.parseFloat(row[vi]);
    if (!company || !Number.isFinite(value)) continue;
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push({ value, level: row[li], pros: row[pi]?.trim(), cons: row[ki]?.trim() });
  }
  return [...byCompany].map(([company, recs]) => {
    const values = recs.map((r) => r.value);
    if (opts.kind === "reviews") {
      const sample = (key) => recs.map((r) => r[key]).filter(Boolean).slice(0, 3);
      return {
        company,
        data: {
          rating: Math.round((100 * values.reduce((a, b) => a + b, 0)) / values.length) / 100,
          reviewCount: recs.length,
          pros: sample("pros"),
          cons: sample("cons"),
        },
      };
    }
    const data = { medianTotal: median(values), currency: opts.currency ?? "" };
    if (li !== -1) {
      const levels = Map.groupBy(recs.filter((r) => r.level), (r) => r.level);
      data.levels = [...levels]
        .map(([level, rs]) => ({ level, total: median(rs.map((r) => r.value)) }))
        .sort((a, b) => a.level.localeCompare(b.level));
    }
    return { company, data };
  });
}
