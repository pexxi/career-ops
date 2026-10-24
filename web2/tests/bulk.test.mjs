// Seam E (ticket 04): the bulk status change is one-row-at-a-time and stops at
// the first failure, so a partial batch is always reported precisely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSequential } from "../lib/bulk.mjs";

test("all rows applied in order → nothing failed, nothing left", async () => {
  const seen = [];
  const out = await runSequential(["1", "2", "3"], async (num) => {
    seen.push(num);
  });
  assert.deepEqual(seen, ["1", "2", "3"]);
  assert.deepEqual(out, { applied: ["1", "2", "3"], failed: null, notAttempted: [] });
});

test("a failure stops the batch: later rows are never attempted", async () => {
  const seen = [];
  const out = await runSequential(["1", "2", "3", "4"], async (num) => {
    seen.push(num);
    if (num === "2") throw new Error("No tracker row with #2");
  });
  assert.deepEqual(seen, ["1", "2"], "rows after the failure must not run");
  assert.deepEqual(out.applied, ["1"]);
  assert.deepEqual(out.failed, { num: "2", message: "No tracker row with #2" });
  assert.deepEqual(out.notAttempted, ["3", "4"]);
});

test("progress reports each attempt, 1-based, before it runs", async () => {
  const progress = [];
  await runSequential(["7", "8"], async () => {}, (p) => progress.push(p));
  assert.deepEqual(progress, [
    { attempt: 1, total: 2, num: "7" },
    { attempt: 2, total: 2, num: "8" },
  ]);
});

test("a failure with no message still reports something usable", async () => {
  const out = await runSequential(["1"], async () => {
    throw new Error("");
  });
  assert.equal(out.failed.num, "1");
  assert.equal(typeof out.failed.message, "string");
  assert.notEqual(out.failed.message, "");
});

test("an empty selection runs nothing", async () => {
  const out = await runSequential([], async () => {
    throw new Error("must not run");
  });
  assert.deepEqual(out, { applied: [], failed: null, notAttempted: [] });
});
