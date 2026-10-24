// Company-intel cache (ticket 08, ADR 0004): one JSON snapshot per company under
// web2/data/company-intel/ (gitignored user data). The app only reads it; the
// capture routines in scripts/ add entries. Every entry carries its provenance
// (source + url + fetchedAt), and adding never overwrites an earlier entry.
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeCompanyName } from "../../invite-match.mjs";

export const INTEL_KINDS = ["reviews", "salaries"];

/** WEB2_DATA_DIR overrides web2/data (tests, a data root elsewhere). */
export function intelDir() {
  return path.join(process.env.WEB2_DATA_DIR || path.join(import.meta.dirname, "..", "data"), "company-intel");
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
  await fs.writeFile(`${file}.tmp`, JSON.stringify(snapshot, null, 2) + "\n");
  await fs.rename(`${file}.tmp`, file);
  return snapshot;
}
