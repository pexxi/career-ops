// Stub pages for the #01 dev shell; each is replaced by its own ticket
// (05 Reports browser, 06 Overview KPIs, 07 System).
// 02 landed: Applications table + stage lens.
import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type AppRow } from "./lib/api";
import { StatusBadge } from "./lib/ui";
// Stage model + sorting live in lib/ (plain .mjs, tested by node --test).
import { DEFAULT_STAGE, rowsInStage } from "../lib/stage.mjs";
import { sortRows } from "../lib/sortrows.mjs";

function Stub({ title, blurb }: { title: string; blurb: string }) {
  return (
    <Stack h="100%" align="center" justify="center" gap="xs">
      <Title order={2}>{title}</Title>
      <Text c="dimmed">{blurb}</Text>
    </Stack>
  );
}

export const OverviewPage = () => <Stub title="Overview" blurb="Funnel KPIs land here (ticket 06)." />;

// --- Applications (ticket 02) ------------------------------------------------

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

/** Sentinels render as their own text ("—" / "N/A"), never as 0 or NaN. */
function scoreText(row: AppRow): string {
  if (row.scoreSentinel) return row.scoreSentinel;
  if (row.score != null) return row.score.toFixed(1);
  return "—";
}

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
    <Table.Th
      onClick={() => onSort(sortKey)}
      style={{ cursor: "pointer", userSelect: "none" }}
    >
      {label}
      {active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </Table.Th>
  );
}

function TrackerTable({ rows, sort, onSort }: { rows: AppRow[]; sort: SortState; onSort: (key: SortKey) => void }) {
  return (
    <ScrollArea>
      <Table horizontalSpacing="md" highlightOnHover style={{ minWidth: 760 }}>
        <Table.Thead>
          <Table.Tr>
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
              <Table.Td colSpan={7}>
                <Text c="dimmed">No applications in this lens.</Text>
              </Table.Td>
            </Table.Tr>
          ) : (
            rows.map((row) => (
              <Table.Tr key={row.num}>
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

/** Error states distinguish a missing tracker file from a malformed one —
 * missing file ≠ broken file (the parser/AGENTS rule). */
function TrackerErrorState({ code, message, onRetry }: { code: string; message?: string; onRetry: () => void }) {
  const missing = code === "ENOENT" || code === "HTTP_404";
  const malformed = code === "EBADTRACKER";
  const title = malformed ? "Tracker malformed" : missing ? "Tracker file missing" : `Tracker error (${code})`;
  return (
    <Stack align="center" gap="sm" py="xl">
      <Alert color="red" title={title} w="100%" maw={680}>
        {malformed
          ? "applications.md exists but is not a readable tracker table. The parse warning below explains what failed:"
          : missing
            ? "No applications.md was found at the resolved tracker path."
            : "The tracker could not be loaded."}
        {message && (
          <Text size="sm" mt={4}>
            {message}
          </Text>
        )}
      </Alert>
      <Button variant="default" onClick={onRetry}>
        Retry
      </Button>
    </Stack>
  );
}

export function ApplicationsPage() {
  const query = useQuery({ queryKey: ["applications"], queryFn: api.applications });
  const [lens, setLens] = useState<string>(DEFAULT_STAGE);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "date", dir: "desc" });

  // All hooks stay above every early return — React needs a constant hook count.
  const rows = query.data?.rows ?? [];
  const lensRows = useMemo<AppRow[]>(() => rowsInStage(rows, lens) as AppRow[], [rows, lens]);
  const statusOptions = useMemo<Array<{ value: string; label: string }>>(
    () =>
      Array.from(new Set(lensRows.map((r) => r.status)))
        .sort((a, b) => a.localeCompare(b))
        .map((s) => ({ value: s, label: s })),
    [lensRows],
  );

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
  const onLens = (value: string) => {
    setLens(value);
    setStatusFilter(null); // a status chosen in one lens may not exist in another
  };
  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const statusRows = statusFilter ? lensRows.filter((r) => r.status === statusFilter) : lensRows;

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Title order={2}>Applications</Title>
        <SegmentedControl data={LENSES} value={lens} onChange={onLens} />
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

      <Group gap="sm" wrap="nowrap">
        <Select
          placeholder="Filter by status"
          clearable
          checkIconPosition="right"
          data={statusOptions}
          value={statusFilter}
          onChange={(value: string | null) => setStatusFilter(value)}
          miw={220}
        />
        <Text size="sm" c="dimmed">
          {statusRows.length} of {payload.rows.length} shown
        </Text>
      </Group>

      <TrackerTable rows={sortRows(statusRows, sort)} sort={sort} onSort={onSort} />
    </Stack>
  );
}

export function ReportsPage(_props: { reportOpener: unknown }) {
  return <Stub title="Reports" blurb="Report browser lands here (ticket 05)." />;
}

export const SystemPage = () => <Stub title="System" blurb="System health lands here (ticket 07)." />;
