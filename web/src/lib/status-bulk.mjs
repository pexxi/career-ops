// Local fork addition: request parsing for bulk status changes on /api/status.
// A body with `ns` (several tracker #s) is sent to the fork's root script
// set-status-bulk.mjs as ONE command: one tracker lock, one atomic write, all
// or nothing. Single-row bodies (`n`) keep upstream's set-status.mjs path.
//
// Kept free of Next/Node imports so it is testable with node --test.

export const MAX_BULK_ROWS = 200;

/**
 * The note written to every row. Discarded and SKIP need a reason, tagged the
 * same way the dashboard's discard picker tags it ("DISCARD: …" / "SKIP: …").
 *
 * @param {string} status canonical label
 * @param {string} reason trimmed reason, possibly empty
 * @returns {{ note: string } | { error: string }}
 */
export function bulkNote(status, reason) {
  const prefix = status === "Discarded" ? "DISCARD" : status === "SKIP" ? "SKIP" : null;
  if (!prefix) return { note: reason };
  if (!reason) return { error: `${status} requires a reason` };
  return { note: reason.toUpperCase().startsWith(`${prefix}:`) ? reason : `${prefix}: ${reason}` };
}

/**
 * Validate a bulk request body. `canonicalize` maps a status (label or alias)
 * to its canonical label, or null.
 *
 * @param {{ ns?: unknown, n?: unknown, status?: unknown, reason?: unknown }} body
 * @param {(status: string) => string | null} canonicalize
 * @returns {{ ok: true, ns: string[], status: string, note: string } | { ok: false, error: string, code?: string }}
 */
export function parseBulkRequest(body, canonicalize) {
  if (body.n !== undefined) return { ok: false, error: "n and ns are mutually exclusive" };
  if (!Array.isArray(body.ns) || body.ns.length === 0) return { ok: false, error: "ns must be a non-empty array of tracker row numbers" };
  const ns = [];
  for (const raw of body.ns) {
    const row = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
    if (!/^\d+$/.test(row)) return { ok: false, error: "ns must contain tracker row numbers only" };
    if (!ns.includes(row)) ns.push(row);
  }
  if (ns.length > MAX_BULK_ROWS) return { ok: false, error: `at most ${MAX_BULK_ROWS} rows per request` };
  if (typeof body.status !== "string" || !body.status.trim()) return { ok: false, error: "status required" };
  if (/[|\r\n*]/.test(body.status)) return { ok: false, error: "invalid status (table-breaking characters)" };
  const status = canonicalize(body.status);
  if (!status) return { ok: false, error: `not a canonical status: ${body.status}` };
  if (status === "Hired" && ns.length > 1) {
    return { ok: false, error: "Hired can only be set on one row at a time", code: "hired-in-bulk" };
  }
  if (body.reason !== undefined && typeof body.reason !== "string") return { ok: false, error: "reason must be a string" };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (/[|\r\n\t]/.test(reason)) return { ok: false, error: "reason cannot contain table delimiters or line breaks" };
  const noted = bulkNote(status, reason);
  if ("error" in noted) return { ok: false, error: noted.error };
  return { ok: true, ns, status, note: noted.note };
}

/**
 * argv for set-status-bulk.mjs (script excluded): one --rows csv token.
 *
 * @param {{ ns: string[], status: string, note: string }} request
 * @returns {string[]}
 */
export function bulkStatusArgs(request) {
  const args = ["--rows", request.ns.join(","), request.status, "--source", "web", "--json"];
  if (request.note) args.push(`--note=${request.note}`);
  return args;
}

/**
 * HTTP status for a set-status-bulk.mjs exit code with a parsed document.
 * 0 applied, 5 batch rejected (nothing written), 2/3 single row not found /
 * ambiguous, 4 tracker busy, 1 usage. Anything else is ours: 500.
 *
 * @param {number} code
 * @param {string | undefined} cliCode
 * @returns {number}
 */
export function bulkHttpStatus(code, cliCode) {
  if (code === 0) return 200;
  if (code === 5 || code === 3) return 409;
  if (code === 2) return 404;
  if (code === 4) return 503;
  if (code === 1) return cliCode === "usage" || cliCode === "invalid-state" ? 400 : 500;
  return 500;
}
