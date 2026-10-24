// Ticket 10 seam: Profile apply's patcher (lib/profile.mjs). A unified diff
// lands only where it says it does; nothing is re-serialized.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyPatch } from "../lib/profile.mjs";

const yml = fs.readFileSync(path.join(import.meta.dirname, "fixtures/profile/config/profile.yml"), "utf8");

test("comments survive an apply; only the patched line changes", () => {
  const patch = [
    "--- a/config/profile.yml",
    "+++ b/config/profile.yml",
    "@@ -15,3 +15,3 @@",
    " compensation:",
    '-  target_range: "EUR 110K-130K"',
    '+  target_range: "EUR 120K-140K"',
    '   minimum: "EUR 100K"',
  ].join("\n");
  const after = applyPatch(yml, patch);
  assert.equal(after, yml.replace('"EUR 110K-130K"', '"EUR 120K-140K"'));
  assert.match(after, /^# Fixture profile — comments must survive/);
  assert.match(after, /    # primary lane\n/);
});

test("a hunk whose context is not at the stated line is refused, even if it matches elsewhere", () => {
  // Same context as above, but claimed at line 3: must not slide to line 15.
  const patch = ["@@ -3,2 +3,2 @@", " compensation:", '-  target_range: "EUR 110K-130K"', '+  target_range: "X"'].join("\n");
  assert.throws(() => applyPatch(yml, patch), /Hunk 1 does not match at line 3/);
});

test("a hunk whose removed line differs from the file is refused", () => {
  const patch = ["@@ -16,1 +16,1 @@", '-  target_range: "EUR 1"', '+  target_range: "EUR 2"'].join("\n");
  assert.throws(() => applyPatch(yml, patch), /does not match/);
});

test("several hunks apply with line offsets from earlier hunks", () => {
  const text = "a\nb\nc\nd\ne\nf\n";
  const patch = ["@@ -1,2 +1,3 @@", " a", "+a2", " b", "@@ -5,2 +6,1 @@", "-e", " f"].join("\n");
  assert.equal(applyPatch(text, patch), "a\na2\nb\nc\nd\nf\n");
});

test("a patch with no hunks is refused", () => {
  assert.throws(() => applyPatch("x\n", "just some text"), /no hunks/);
});
