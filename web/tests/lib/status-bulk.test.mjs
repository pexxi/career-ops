// Fork: bulk status changes on /api/status (status-bulk.mjs) and the pipeline
// bar's client helper (pipeline-status-bulk.mjs).
//
// Run:  node --test tests/lib/status-bulk.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBulkRequest, bulkStatusArgs, bulkHttpStatus, MAX_BULK_ROWS } from "../../src/lib/status-bulk.mjs";
import { saveStatusesBulk, rangeKeys, isBulkSelectable, bulkNeedsReason } from "../../src/lib/pipeline-status-bulk.mjs";

const LABELS = ["Evaluated", "Applied", "Responded", "Interview", "Offer", "Hired", "Rejected", "Discarded", "SKIP"];
const canon = (s) => LABELS.find((l) => l.toLowerCase() === s.trim().toLowerCase()) ?? null;

test("parses ns, collapses duplicates and builds one --rows token", () => {
  const r = parseBulkRequest({ ns: ["12", 14, "12", "19"], status: "applied" }, canon);
  assert.deepEqual(r, { ok: true, ns: ["12", "14", "19"], status: "Applied", note: "" });
  assert.deepEqual(bulkStatusArgs(r), ["--rows", "12,14,19", "Applied", "--source", "web", "--json"]);
});

test("rejects bad selections", () => {
  assert.equal(parseBulkRequest({ ns: [], status: "Applied" }, canon).ok, false);
  assert.equal(parseBulkRequest({ ns: ["1", "x"], status: "Applied" }, canon).ok, false);
  assert.equal(parseBulkRequest({ ns: ["1"], n: "1", status: "Applied" }, canon).ok, false);
  const many = Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => String(i + 1));
  assert.equal(parseBulkRequest({ ns: many, status: "Applied" }, canon).ok, false);
  assert.equal(parseBulkRequest({ ns: ["1"], status: "Nope" }, canon).ok, false);
  assert.equal(parseBulkRequest({ ns: ["1"], status: "Applied|x" }, canon).ok, false);
});

test("Hired is refused for more than one row", () => {
  assert.deepEqual(parseBulkRequest({ ns: ["1", "2"], status: "Hired" }, canon), {
    ok: false, error: "Hired can only be set on one row at a time", code: "hired-in-bulk",
  });
  assert.equal(parseBulkRequest({ ns: ["1"], status: "Hired" }, canon).ok, true);
});

test("Discarded and SKIP need a reason, tagged once", () => {
  assert.equal(parseBulkRequest({ ns: ["1"], status: "Discarded" }, canon).ok, false);
  const d = parseBulkRequest({ ns: ["1", "2"], status: "Discarded", reason: " comp below floor " }, canon);
  assert.equal(d.note, "DISCARD: comp below floor");
  assert.ok(bulkStatusArgs(d).includes("--note=DISCARD: comp below floor"));
  assert.equal(parseBulkRequest({ ns: ["1"], status: "SKIP", reason: "SKIP: geo" }, canon).note, "SKIP: geo");
  assert.equal(parseBulkRequest({ ns: ["1"], status: "Discarded", reason: "a|b" }, canon).ok, false);
});

test("exit codes map to HTTP", () => {
  assert.equal(bulkHttpStatus(0), 200);
  assert.equal(bulkHttpStatus(5), 409);
  assert.equal(bulkHttpStatus(2), 404);
  assert.equal(bulkHttpStatus(3), 409);
  assert.equal(bulkHttpStatus(4), 503);
  assert.equal(bulkHttpStatus(1, "invalid-state"), 400);
  assert.equal(bulkHttpStatus(1, "write-failure"), 500);
});

function fakeFetch(status, doc) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: status >= 200 && status < 300, status, json: async () => doc };
  };
  fn.calls = calls;
  return fn;
}

test("saveStatusesBulk sends one request and summarizes outcomes", async () => {
  const f = fakeFetch(200, { applied: true, outcomes: [{ kind: "changed", n: 1 }, { kind: "unchanged", n: 2 }] });
  const r = await saveStatusesBulk(["1", "2"], "Applied", "", f);
  assert.deepEqual(r, { ok: true, changed: 1, unchanged: 1 });
  assert.deepEqual(f.calls, [{ ns: ["1", "2"], status: "Applied" }]);
});

test("saveStatusesBulk reports rejected rows", async () => {
  const f = fakeFetch(409, { applied: false, outcomes: [{ kind: "changed", n: 1 }, { kind: "notFound", n: 9 }] });
  const r = await saveStatusesBulk(["1", "9"], "Discarded", "dup", f);
  assert.equal(r.ok, false);
  assert.deepEqual(r.failed, [{ n: "9", error: "not found" }]);
  assert.deepEqual(f.calls[0], { ns: ["1", "9"], status: "Discarded", reason: "dup" });
});

test("saveStatusesBulk passes other errors through", async () => {
  const r = await saveStatusesBulk(["1"], "Applied", "", fakeFetch(503, { error: "tracker busy" }));
  assert.deepEqual(r, { ok: false, failed: [], error: "tracker busy" });
});

test("range, selectability and reason helpers", () => {
  assert.deepEqual(rangeKeys(["a", "b", "c", "d"], "d", "b"), ["b", "c", "d"]);
  assert.deepEqual(rangeKeys(["a", "b"], null, "b"), []);
  assert.equal(isBulkSelectable("12"), true);
  assert.equal(isBulkSelectable("—"), false);
  assert.equal(bulkNeedsReason("SKIP"), true);
  assert.equal(bulkNeedsReason("Applied"), false);
});
