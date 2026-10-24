// Pure table sorting for the Applications page (Seam A of ticket 02).
// Dependency-free: three keys the table sorts on — date | company | score.
// Score sentinels (rows where score is null) always sort LAST in BOTH
// directions — never as NaN/0 mid-pack.

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const COMPARATORS = {
  date: (a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")),
  company: (a, b) => collator.compare(a.company ?? "", b.company ?? ""),
  // score never lives here: its branch partitions nulls before sorting, and a
  // comparator-based score would sort sentinels mid-pack as 0.
};

/**
 * sortRows(rows, { key, dir }) → new sorted array. Input is never mutated.
 * Null scores are partitioned out and appended, so "last in both directions"
 * survives the asc/desc flip (which only reverses real numeric pairs).
 */
export function sortRows(rows, { key = "date", dir = "asc" } = {}) {
  if (key === "score") {
    const valued = rows.filter((r) => r.score != null);
    const nulls = rows.filter((r) => r.score == null);
    valued.sort((a, b) => (a.score - b.score) * (dir === "desc" ? -1 : 1));
    return [...valued, ...nulls];
  }
  const cmp = COMPARATORS[key] ?? COMPARATORS.date;
  return [...rows].sort((a, b) => cmp(a, b) * (dir === "desc" ? -1 : 1));
}
