// Local fork addition: one request for the whole bulk selection.
// Upstream's saveStatuses() POSTs once per row (N spawns, N lock waits, partial
// saves on failure). This sends `{ns, status, reason}` once; /api/status runs
// set-status-bulk.mjs, which writes every row or none.

/** Statuses offered in the bulk bar: everything except Hired (one landed job is one row). */
export const BULK_EXCLUDED = new Set(["Hired"]);

/** Discarded and SKIP need a reason, appended to each row's notes. */
export function bulkNeedsReason(status) {
  return status === "Discarded" || status === "SKIP";
}

/** A tracker # the bulk writer can address (digits only). */
export function isBulkSelectable(n) {
  return /^\d+$/.test(String(n ?? "").trim());
}

/**
 * Keys in `orderedKeys` between the last toggled key and `key`, inclusive.
 * Used for shift-click range selection. Empty when either key is gone.
 *
 * @param {string[]} orderedKeys
 * @param {string | null} anchor
 * @param {string} key
 * @returns {string[]}
 */
export function rangeKeys(orderedKeys, anchor, key) {
  const a = anchor == null ? -1 : orderedKeys.indexOf(anchor);
  const b = orderedKeys.indexOf(key);
  if (a < 0 || b < 0) return [];
  const [from, to] = a < b ? [a, b] : [b, a];
  return orderedKeys.slice(from, to + 1);
}

/**
 * @param {string[]} ns tracker #s
 * @param {string} status canonical label
 * @param {string} reason
 * @param {typeof fetch} [request]
 * @returns {Promise<
 *   | { ok: true, changed: number, unchanged: number }
 *   | { ok: false, failed: { n: string, error: string }[], error: string }
 * >}
 */
export async function saveStatusesBulk(ns, status, reason, request = fetch) {
  const response = await request("/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ns, status, ...(reason ? { reason } : {}) }),
  });
  const doc = await response.json().catch(() => null);
  const outcomes = Array.isArray(doc?.outcomes) ? doc.outcomes : [];
  if (response.ok && doc?.applied === true) {
    const changed = outcomes.filter((o) => o?.kind === "changed").length;
    return { ok: true, changed, unchanged: outcomes.length - changed };
  }
  if (response.status === 409 && doc?.applied === false) {
    const failed = outcomes
      .filter((o) => o?.kind === "notFound" || o?.kind === "ambiguous")
      .map((o) => ({ n: String(o.n), error: o.kind === "notFound" ? "not found" : "ambiguous" }));
    return { ok: false, failed, error: `Nothing saved: ${failed.map((f) => `#${f.n} ${f.error}`).join(", ")}` };
  }
  const error = typeof doc?.error === "string" ? doc.error : "Could not save statuses. Please try again.";
  return { ok: false, failed: [], error };
}
