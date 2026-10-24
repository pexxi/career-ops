// Bulk status change (ticket 04) — one row at a time, through the SAME write
// path as a single change (POST /api/status → set-status.mjs), so a batch can
// never take a shortcut around the core's validation.
//
// Stops at the first failure: continuing would write rows past an error the
// user has not seen yet. The result says exactly what landed, what failed and
// what was never attempted, so a partial batch is reported, never guessed at.

/**
 * runSequential(nums, run, onProgress?) → { applied, failed, notAttempted }.
 * `run(num)` may be async and throws on failure; `onProgress({attempt, total,
 * num})` fires before each attempt (attempt is 1-based).
 */
export async function runSequential(nums, run, onProgress) {
  const applied = [];
  const total = nums.length;
  for (let i = 0; i < total; i++) {
    const num = nums[i];
    onProgress?.({ attempt: i + 1, total, num });
    try {
      await run(num);
    } catch (err) {
      return {
        applied,
        failed: { num, message: String(err?.message || err || "unknown error") },
        notAttempted: nums.slice(i + 1),
      };
    }
    applied.push(num);
  }
  return { applied, failed: null, notAttempted: [] };
}
