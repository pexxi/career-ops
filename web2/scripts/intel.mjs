#!/usr/bin/env node
// Fills the company-intel cache (ADR 0004). Run by hand or by an agent session;
// never by the web2 server. See scripts/capture-intel.md.
//
//   node scripts/intel.mjs add --company "Google" --entry /path/entry.json
//   node scripts/intel.mjs import --csv reviews.csv --kind reviews \
//     --source "Glassdoor Job Reviews (Kaggle, CC BY-SA 4.0)" \
//     --url https://www.kaggle.com/datasets/davidgauthier/glassdoor-job-reviews \
//     --as-of 2024-10-15 --company-col firm --value-col overall_rating \
//     [--pros-col pros --cons-col cons] [--level-col level --currency USD]
import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { parseCsv } from "../../linkedin-join.mjs";
import { addIntel, aggregateDataset, intelDir } from "../lib/intel.mjs";
import { locateFiles } from "../lib/paths.mjs";
import { readTracker } from "../lib/tracker.mjs";
import { localDateIso } from "../lib/csv.mjs";

const [command, ...rest] = process.argv.slice(2);
const { values: o } = parseArgs({
  args: rest,
  options: Object.fromEntries(
    ["company", "entry", "csv", "kind", "source", "url", "as-of", "company-col", "value-col", "level-col", "pros-col", "cons-col", "currency"].map(
      (k) => [k, { type: "string" }],
    ),
  ),
});

if (command === "add") {
  if (!o.company || !o.entry) throw new Error("add needs --company and --entry <file.json>");
  const entry = JSON.parse(await fs.readFile(o.entry, "utf8"));
  const snap = await addIntel(intelDir(), o.company, entry);
  console.log(`${snap.company}: ${snap.sources.length} entr${snap.sources.length === 1 ? "y" : "ies"} in ${intelDir()}`);
} else if (command === "import") {
  for (const k of ["csv", "kind", "source", "url", "as-of", "company-col", "value-col"]) {
    if (!o[k]) throw new Error(`import needs --${k}`);
  }
  // Only companies already in the tracker: a dataset of thousands of firms
  // should not become thousands of snapshot files.
  const { rows } = await readTracker(locateFiles().tracker);
  const companies = [...new Set(rows.map((r) => r.company))];
  // ponytail: whole file in memory; fine for the ~300 MB Kaggle CSV, stream it if a dataset outgrows that.
  const found = aggregateDataset(parseCsv(await fs.readFile(o.csv, "utf8")), {
    kind: o.kind,
    companyCol: o["company-col"],
    valueCol: o["value-col"],
    levelCol: o["level-col"],
    prosCol: o["pros-col"],
    consCol: o["cons-col"],
    currency: o.currency,
  }, companies);
  for (const { company, data } of found) {
    await addIntel(intelDir(), company, {
      source: o.source,
      url: o.url,
      fetchedAt: localDateIso(),
      asOf: o["as-of"],
      kind: o.kind,
      data,
    });
  }
  console.log(`Imported ${found.length} of ${companies.length} tracker companies into ${intelDir()}`);
} else {
  console.error("usage: node scripts/intel.mjs add|import [options] (see the header of this file)");
  process.exitCode = 2;
}
