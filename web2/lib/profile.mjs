// Candidate profile (ticket 10, GLOSSARY "Candidate profile"): the four
// user-layer files, read for the Profile page and changed ONLY by Profile
// apply — a unified text patch the user confirmed against a diff. Text is
// patched in place, never re-serialized, so profile.yml comments survive.
import fs from "node:fs/promises";
import path from "node:path";
import { getProfilePath } from "../../path-resolver.mjs";
import { loadYaml } from "../../lib/yaml-document.mjs";
import { dataRoot } from "./paths.mjs";

/** The closed set Profile apply may write — keyed by name, never by a client path. */
export function profilePaths() {
  const root = dataRoot();
  return {
    profile: getProfilePath(), // honors CAREER_OPS_PROFILE like every core reader
    cv: path.join(root, "cv.md"),
    modeProfile: path.join(root, "modes", "_profile.md"),
    voice: path.join(root, "voice-dna.md"),
  };
}

/** Each file → {name, path, exists, content}; profile.yml also gets `parsed` or `parseError`. */
export async function readProfile() {
  const files = await Promise.all(
    Object.entries(profilePaths()).map(async ([name, filePath]) => {
      try {
        return { name, path: filePath, exists: true, content: await fs.readFile(filePath, "utf8") };
      } catch (err) {
        if (err.code === "ENOENT") return { name, path: filePath, exists: false, content: "" };
        throw err;
      }
    }),
  );
  const yml = files.find((f) => f.name === "profile");
  let parsed = null;
  let parseError = null;
  try {
    parsed = yml.exists ? loadYaml(yml.content) : null;
  } catch (err) {
    parseError = err.message;
  }
  return { files, parsed, parseError };
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Apply a unified diff to `text`. Strict: every hunk's context and removed
 * lines must sit exactly at the line the hunk names (after earlier hunks'
 * offsets) — no fuzz, no searching elsewhere — or the whole patch is refused.
 * `---`/`+++` headers are ignored: the caller picks the file by name.
 */
export function applyPatch(text, patch) {
  const hunks = [];
  for (const line of patch.replace(/\r/g, "").split("\n")) {
    const m = HUNK_RE.exec(line);
    if (m) {
      hunks.push({ oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]), old: [], next: [] });
    } else if (hunks.length && /^[ +-]/.test(line) && !/^(---|\+\+\+) /.test(line)) {
      const hunk = hunks.at(-1);
      if (line[0] !== "+") hunk.old.push(line.slice(1));
      if (line[0] !== "-") hunk.next.push(line.slice(1));
    } else if (hunks.length && line === "") {
      // A context line for an empty source line often loses its leading space in transit.
      hunks.at(-1).old.push("");
      hunks.at(-1).next.push("");
    }
  }
  if (!hunks.length) throw new Error("Patch has no hunks (@@ -a,b +c,d @@ lines)");

  const endsWithNewline = text === "" || text.endsWith("\n");
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  let delta = 0;
  hunks.forEach((hunk, i) => {
    // A trailing blank line in the patch text is not part of the hunk.
    while (hunk.old.length > hunk.oldCount && hunk.old.at(-1) === "" && hunk.next.at(-1) === "") {
      hunk.old.pop();
      hunk.next.pop();
    }
    const start = (hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1) + delta;
    const actual = lines.slice(start, start + hunk.old.length);
    if (hunk.old.length !== hunk.oldCount || actual.join("\n") !== hunk.old.join("\n")) {
      throw new Error(`Hunk ${i + 1} does not match at line ${hunk.oldStart} — the file changed or the patch is wrong`);
    }
    lines.splice(start, hunk.old.length, ...hunk.next);
    delta += hunk.next.length - hunk.old.length;
  });
  return lines.join("\n") + (endsWithNewline && lines.length ? "\n" : "");
}

/** Profile apply: patch one named profile file. `dryRun` returns before/after without writing. */
export async function applyProfilePatch(name, patch, { dryRun = false } = {}) {
  const paths = profilePaths();
  if (!Object.hasOwn(paths, name)) {
    const err = new Error(`"${name}" is not a candidate profile file (${Object.keys(paths).join(", ")})`);
    err.code = "USAGE";
    throw err;
  }
  const filePath = paths[name];
  const before = await fs.readFile(filePath, "utf8").catch((err) => {
    if (err.code === "ENOENT") return "";
    throw err;
  });
  let after;
  try {
    after = applyPatch(before, String(patch ?? ""));
  } catch (err) {
    err.code = "PATCH_REJECTED";
    throw err;
  }
  if (!dryRun) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(`${filePath}.tmp`, after);
    await fs.rename(`${filePath}.tmp`, filePath);
  }
  return { name, path: filePath, before, after, written: !dryRun };
}
