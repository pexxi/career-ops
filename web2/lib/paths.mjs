// Resolves the same career-ops file locations the CLI resolves — by importing the
// CLI's own resolver rather than re-implementing the precedence rules.
// (web/AGENTS.md rule 1 in spirit: orchestrate the core, never reimplement it.)
import path from "node:path";
import { getCareerOpsRoot, resolveTrackerPath } from "../../path-resolver.mjs";

export function repoRoot() {
  // web2/ is one level under the repo root; lib/ is one level under web2/.
  return path.resolve(import.meta.dirname, "..", "..");
}

export function dataRoot() {
  return getCareerOpsRoot();
}

export function trackerPath() {
  const root = dataRoot();
  // resolveTrackerPath returns data/applications.md (or the root-level legacy
  // layout if that is what exists). It may or may not exist yet.
  return resolveTrackerPath(root);
}

export function reportsDir() {
  // Reports live under the resolved data root (repo root by default).
  return path.join(dataRoot(), "reports");
}

export function statusLogPath(trackerFilePath) {
  // Sibling of the tracker file: tracks both repo-root and data/ layouts.
  return path.join(path.dirname(trackerFilePath), "status-log.tsv");
}

export function locateFiles() {
  const tracker = trackerPath();
  return {
    dataRoot: dataRoot(),
    repoRoot: repoRoot(),
    tracker,
    reportsDir: reportsDir(),
    statusLog: statusLogPath(tracker),
    statesYml: path.join(repoRoot(), "templates", "states.yml"),
  };
}
