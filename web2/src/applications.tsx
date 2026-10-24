// Applications (ticket 02): the tracker table under a stage lens, with
// selection, bulk state change and CSV export (ticket 04).
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Center,
  Checkbox,
  Chip,
  Group,
  List,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type AppRow } from "./lib/api";
import { CANONICAL_STATES, scoreText, StatusBadge, TrackerErrorState } from "./lib/ui";
import { ApplicationDrawer } from "./drawer";
// Stage model, sorting, bulk runner and CSV live in lib/ (plain .mjs, tested by node --test).
import { DEFAULT_STAGE, rowsInStage } from "../lib/stage.mjs";
import { sortRows } from "../lib/sortrows.mjs";
import { runSequential } from "../lib/bulk.mjs";
import { csvFilename, toCsv } from "../lib/csv.mjs";
import { localToday } from "../../lib/local-today.mjs";

/** The stage lens: GLOSSARY vocabulary — Stage is the UI lens, State is the
 * canonical tracker status. Values are lib/stage.mjs's STAGE_ORDER keys. */
const LENSES = [
  { value: "deciding", label: "Deciding" },
  { value: "active", label: "Active process" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

type SortKey = "date" | "company" | "score";
type SortState = { key: SortKey; dir: "asc" | "desc" };

/** CSV columns = the table's visible columns, in the table's order. */
const CSV_HEADER = ["#", "Date", "Company", "Role", "Score", "Status", "Last transition"];

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <Table.Th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <UnstyledButton onClick={() => onSort(sortKey)} fw={700} fz="sm">
        {label}
        {active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
      </UnstyledButton>
    </Table.Th>
  );
}

function TrackerTable({
  rows,
  sort,
  onSort,
  onSelect,
  selected,
  onToggle,
  onToggleAll,
}: {
  rows: AppRow[];
  sort: SortState;
  onSort: (key: SortKey) => void;
  onSelect: (row: AppRow) => void;
  selected: Set<string>;
  onToggle: (num: string) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.num));
  const someSelected = rows.some((r) => selected.has(r.num));
  return (
    <ScrollArea>
      <Table horizontalSpacing="md" highlightOnHover style={{ minWidth: 800 }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={40}>
              <Checkbox
                aria-label="Select all rows in view"
                checked={allSelected}
                indeterminate={!allSelected && someSelected}
                onChange={(e) => onToggleAll(e.currentTarget.checked)}
              />
            </Table.Th>
            <Table.Th>#</Table.Th>
            <SortableTh label="Date" sortKey="date" sort={sort} onSort={onSort} />
            <SortableTh label="Company" sortKey="company" sort={sort} onSort={onSort} />
            <Table.Th>Role</Table.Th>
            <SortableTh label="Score" sortKey="score" sort={sort} onSort={onSort} />
            <Table.Th>Status</Table.Th>
            <Table.Th>Last transition</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={8}>
                <Text c="dimmed">No applications in this lens.</Text>
              </Table.Td>
            </Table.Tr>
          ) : (
            rows.map((row) => (
              <Table.Tr
                key={row.num}
                onClick={() => onSelect(row)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(row);
                }}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                <Table.Td>
                  {/* Ticking a row must not also open its drawer. */}
                  <Checkbox
                    aria-label={`Select row ${row.num}`}
                    checked={selected.has(row.num)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggle(row.num)}
                  />
                </Table.Td>
                <Table.Td>{row.num}</Table.Td>
                <Table.Td>{row.date}</Table.Td>
                <Table.Td>{row.company}</Table.Td>
                <Table.Td>{row.role}</Table.Td>
                <Table.Td>{scoreText(row)}</Table.Td>
                <Table.Td>
                  <StatusBadge status={row.status} />
                </Table.Td>
                <Table.Td>{row.lastTransition}</Table.Td>
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

/** Bulk state change (ticket 04). Every row takes the SAME write path as a
 * single change (POST /api/status → set-status.mjs), one at a time: a batch
 * must not invent a second write path that skips the core's validation. The
 * batch stops at the first failure so nothing is written past an error the
 * user has not seen yet, and the report says exactly what landed, what failed
 * and what was never attempted. */
type BulkOutcome = Awaited<ReturnType<typeof runSequential>>;

function BulkStatusModal({
  opened,
  rows,
  onClose,
  onSelectionChange,
}: {
  opened: boolean;
  rows: AppRow[];
  onClose: () => void;
  onSelectionChange: (keep: string[]) => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title="Change status for selected applications" size="lg">
      {opened && <BulkStatusBody rows={rows} onClose={onClose} onSelectionChange={onSelectionChange} />}
    </Modal>
  );
}

function BulkStatusBody({
  rows,
  onClose,
  onSelectionChange,
}: {
  rows: AppRow[];
  onClose: () => void;
  onSelectionChange: (keep: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<{ attempt: number; total: number; num: string } | null>(null);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const [running, setRunning] = useState(false);

  // Targets are the page's LIVE selection, not a snapshot: after a partial
  // failure the page prunes it down to the rows that still need writing, so
  // "retry" re-runs the failed row and the untouched ones — never the rows the
  // first attempt already applied.
  const run = async () => {
    if (!state) return;
    setRunning(true);
    setOutcome(null);
    const result = await runSequential(
      rows.map((r) => r.num),
      (num: string) => api.setStatus(num, state, note || undefined),
      setProgress,
    );
    setRunning(false);
    setProgress(null);
    setOutcome(result);
    // Applied rows leave the selection; the failed row and the untouched ones
    // stay selected, so a corrected retry is one click away.
    onSelectionChange(result.failed ? [result.failed.num, ...result.notAttempted] : []);
    queryClient.invalidateQueries({ queryKey: ["applications"] });
    if (result.failed) {
      notifications.show({
        title: `Bulk change stopped at row #${result.failed.num}`,
        message: `${result.applied.length} applied, ${result.failed.num} failed, ${result.notAttempted.length} not attempted — ${result.failed.message}`,
        color: "red",
        autoClose: 20_000,
      });
    } else {
      notifications.show({
        title: `${result.applied.length} application${result.applied.length === 1 ? "" : "s"} changed`,
        message: `Now ${state}${note ? ` — "${note}"` : ""}`,
        color: "green",
      });
    }
  };

  return (
    <Stack gap="sm">
      <ScrollArea.Autosize mah={220}>
        <List size="sm">
          {rows.map((row) => (
            <List.Item key={row.num}>
              #{row.num} {row.company} — {row.role}{" "}
              <Text span size="xs" c="dimmed">
                ({row.status})
              </Text>
            </List.Item>
          ))}
        </List>
      </ScrollArea.Autosize>

      <Select
        label="New status"
        required
        placeholder="Pick a canonical state"
        data={CANONICAL_STATES.map((s) => ({ value: s, label: s }))}
        value={state}
        onChange={(v: string | null) => setState(v)}
        disabled={running}
      />
      <TextInput
        label="Note (optional)"
        placeholder="why these change"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        disabled={running}
      />

      {progress && (
        <Stack gap={4}>
          <Progress value={(100 * progress.attempt) / progress.total} />
          <Text size="xs" c="dimmed">
            Row #{progress.num} — {progress.attempt} of {progress.total}
          </Text>
        </Stack>
      )}

      {outcome && !outcome.failed && (
        <Alert color="green" title={`Changed ${outcome.applied.length} application${outcome.applied.length === 1 ? "" : "s"}`}>
          Now {state}.
        </Alert>
      )}
      {outcome?.failed && (
        <Alert color="red" title={`Stopped at row #${outcome.failed.num}`}>
          <Text size="sm">{outcome.failed.message}</Text>
          <Text size="sm" mt={4}>
            Applied: {outcome.applied.length ? outcome.applied.map((n: string) => `#${n}`).join(", ") : "none"}
          </Text>
          <Text size="sm">
            Not attempted:{" "}
            {outcome.notAttempted.length ? outcome.notAttempted.map((n: string) => `#${n}`).join(", ") : "none"}
          </Text>
        </Alert>
      )}

      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={onClose} disabled={running}>
          Close
        </Button>
        <Button onClick={run} loading={running} disabled={!state || rows.length === 0}>
          Change {rows.length} row{rows.length === 1 ? "" : "s"}
        </Button>
      </Group>
    </Stack>
  );
}

export function ApplicationsPage() {
  const query = useQuery({ queryKey: ["applications"], queryFn: api.applications });
  // "#applications/active" (an Overview card) opens in that lens.
  const [lens, setLens] = useState<string>(() => {
    const fromHash = window.location.hash.split("/")[1];
    return LENSES.some((l) => l.value === fromHash) ? fromHash : DEFAULT_STAGE;
  });
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "date", dir: "desc" });
  // Multi-row selection (ticket 04) and the bulk confirm modal.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // The drawer target is a num, re-derived from the tracker payload on every
  // render — after a status change invalidates the query, the drawer shows the
  // fresh state (the payload holds ALL rows; the lens filters are view-side).
  const [selectedNum, setSelectedNum] = useState<string | null>(null);
  const rows = query.data?.rows ?? [];
  const selectedRow = selectedNum ? (rows.find((r) => r.num === selectedNum) ?? null) : null;
  const lensRows = useMemo<AppRow[]>(() => rowsInStage(rows, lens) as AppRow[], [rows, lens]);
  const statusOptions = useMemo(
    () => Array.from(new Set(lensRows.map((r) => r.status))).sort((a, b) => a.localeCompare(b)),
    [lensRows],
  );
  const statusRows = useMemo(
    () => (statusFilter ? lensRows.filter((r) => r.status === statusFilter) : lensRows),
    [lensRows, statusFilter],
  );
  // A row can also leave the view with no lens/filter change (a status change
  // from the drawer, a refetch landing someone else's write). Those ids are
  // dropped loudly too, so "N selected" always equals what a batch would write.
  useEffect(() => {
    const live = new Set(statusRows.map((r) => r.num));
    const dropped = [...selected].filter((num) => !live.has(num));
    if (dropped.length === 0) return;
    notifications.show({
      title: "Selection changed",
      message: `${dropped.length} row(s) left this view and were removed from the selection.`,
      color: "gray",
    });
    setSelected(new Set([...selected].filter((num) => live.has(num))));
  }, [statusRows, selected]);

  if (query.isPending) {
    return (
      <Center py="xl">
        <Loader size="sm" />
        <Text c="dimmed" ml="sm">
          Loading tracker…
        </Text>
      </Center>
    );
  }
  if (query.isError) {
    const code = query.error instanceof ApiError ? query.error.code : "ERROR";
    const message = query.error instanceof Error ? query.error.message : undefined;
    return <TrackerErrorState code={code} message={message} onRetry={() => void query.refetch()} />;
  }

  const payload = query.data;
  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  // Selection is derived from what is in view, so a row that leaves the lens
  // (a status change from the drawer, a refetch) can never be batched silently.
  const selectedRows = statusRows.filter((r) => selected.has(r.num));

  // Changed lens or filter → the selection is dropped LOUDLY rather than carried
  // into a view where those rows are no longer visible (ticket 04's pick-one).
  const resetSelection = (why: string) => {
    if (selectedRows.length > 0) notifications.show({ title: "Selection cleared", message: why, color: "gray" });
    setSelected(new Set());
  };
  const onLens = (value: string) => {
    setLens(value);
    setStatusFilter(null); // a status chosen in one lens may not exist in another
    resetSelection("The lens changed, so the previous selection was dropped.");
  };
  const onStatusFilter = (value: string | null) => {
    setStatusFilter(value);
    resetSelection("The status filter changed, so the previous selection was dropped.");
  };
  const toggleRow = (num: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(statusRows.map((r) => r.num)) : new Set());

  // CSV of the current filtered rows, in the order the table shows them.
  const exportCsv = () => {
    const rows = sortRows(statusRows, sort);
    const csv = toCsv(
      CSV_HEADER,
      rows.map((r) => [r.num, r.date, r.company, r.role, scoreText(r), r.status, r.lastTransition]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename(lens, localToday());
    // Attached, then revoked on the next tick: a detached anchor or an
    // immediately revoked blob URL is dropped by non-Chromium browsers.
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Title order={2}>Applications</Title>
        <Group gap="sm" wrap="nowrap">
          {selectedRows.length > 0 && (
            <Text size="sm" fw={600}>
              {selectedRows.length} selected
            </Text>
          )}
          <SegmentedControl data={LENSES} value={lens} onChange={onLens} />
        </Group>
      </Group>

      {payload.warnings.length > 0 && (
        <Alert color="yellow" title="Some tracker rows were skipped — malformed, never silent">
          {payload.warnings.map((warning, i) => (
            <Text key={i} size="sm">
              · {warning}
            </Text>
          ))}
        </Alert>
      )}

      <Group gap="sm">
        {/* Status filter chips: one at a time; clicking the active chip clears it. */}
        <Group gap={6}>
          {statusOptions.map((s) => (
            <Chip key={s} size="xs" checked={statusFilter === s} onChange={() => onStatusFilter(statusFilter === s ? null : s)}>
              {s}
            </Chip>
          ))}
        </Group>
        <Text size="sm" c="dimmed">
          {statusRows.length} of {payload.rows.length} shown
        </Text>
        <Button size="sm" variant="default" ml="auto" disabled={statusRows.length === 0} onClick={exportCsv}>
          Export CSV
        </Button>
      </Group>

      {selectedRows.length > 0 && (
        <Group gap="sm" wrap="nowrap">
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            Change status…
          </Button>
          <Button size="sm" variant="subtle" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
          <Text size="sm" c="dimmed">
            in {lens === "all" ? "all applications" : `the ${lens} lens`}
          </Text>
        </Group>
      )}

      <TrackerTable
        rows={sortRows(statusRows, sort)}
        sort={sort}
        onSort={onSort}
        onSelect={(row) => setSelectedNum(row.num)}
        selected={selected}
        onToggle={toggleRow}
        onToggleAll={toggleAll}
      />
      <ApplicationDrawer row={selectedRow} onClose={() => setSelectedNum(null)} />
      <BulkStatusModal
        opened={bulkOpen}
        rows={selectedRows}
        onClose={() => setBulkOpen(false)}
        onSelectionChange={(keep: string[]) => setSelected(new Set(keep))}
      />
    </Stack>
  );
}
