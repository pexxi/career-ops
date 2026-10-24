// Stub pages for the #01 dev shell; each is replaced by its own ticket
// (05 Reports browser, 06 Overview KPIs, 07 System).
// 02 landed: Applications table + stage lens.
// 03 landed: stage-focused application detail drawer.
import { useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Center,
  Drawer,
  Group,
  List,
  Loader,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Timeline,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, type AppRow, type HistoryEntry } from "./lib/api";
import { CANONICAL_STATES, StatusBadge } from "./lib/ui";
// Stage model + sorting live in lib/ (plain .mjs, tested by node --test).
import { DEFAULT_STAGE, drawerContent, rowsInStage, stageOfStatus } from "../lib/stage.mjs";
import { parseMachineSummaryFields } from "../lib/reportfields.mjs";
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
}: {
  rows: AppRow[];
  sort: SortState;
  onSort: (key: SortKey) => void;
  onSelect: (row: AppRow) => void;
}) {
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
              <Table.Tr
                key={row.num}
                onClick={() => onSelect(row)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(row);
                }}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
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

/** Flexible fact row inside the drawer: dimmed label + value. */
function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group gap="sm" align="baseline" wrap="nowrap">
      <Text w={110} size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      {children}
    </Group>
  );
}

/** Single-row status change — the drawer's only write action. Everything goes
 * through POST /api/status → set-status.mjs (the core's single write path);
 * a failure is surfaced as a notification with the CLI's explanatory stderr,
 * and nothing silently reroutes. */
function StatusChanger({ row }: { row: AppRow }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const mutation = useMutation({
    mutationFn: (vars: { state: string; note: string }) =>
      api.setStatus(row.num, vars.state, vars.note || undefined),
    onSuccess: (_data, vars) => {
      // Table + drawer re-derive from the invalidated tracker payload.
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      notifications.show({
        title: `Row ${row.num} status changed`,
        message: `Now ${vars.state}${vars.note ? ` — "${vars.note}"` : ""}`,
        color: "green",
      });
      setState(null);
      setNote("");
    },
    onError: (err) => {
      notifications.show({
        title: `Row ${row.num} status change failed`,
        message: err instanceof ApiError ? err.message : String(err),
        color: "red",
        autoClose: 20_000,
      });
    },
  });

  return (
    <Group gap="sm" align="flex-end" wrap="nowrap">
      <Select
        label="Change status"
        placeholder={row.status}
        data={CANONICAL_STATES.map((s) => ({ value: s, label: s }))}
        value={state}
        onChange={(v: string | null) => setState(v)}
        miw={160}
      />
      <TextInput
        label="Note (optional)"
        placeholder="why this changes"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        miw={220}
      />
      <Button
        loading={mutation.isPending}
        disabled={!state || state === row.status}
        onClick={() => state && mutation.mutate({ state, note })}
      >
        Apply
      </Button>
    </Group>
  );
}

/** Stage content per the stage-focus model — each branch renders ONLY the
 * fields the model carries for its stage; nothing else exists to render.
 * The model comes from a plain-JS module, so its per-stage fields are typed
 * `T | undefined`; the branches narrow via `model.stage`. */
function StageFocus({ row, model }: { row: AppRow; model: ReturnType<typeof drawerContent> }) {
  const hardStops = model.hardStops ?? [];
  const softGaps = model.softGaps ?? [];
  const history = model.history ?? [];
  if (model.stage === "deciding") {
    return (
      <Stack gap="xs">
        <FactRow label="Score">
          <Text>{scoreText(row)}</Text>
        </FactRow>
        <FactRow label="Legitimacy">
          <Text>{model.legitimacy || "—"}</Text>
        </FactRow>
        <FactRow label="Decision">
          <Text fw={600}>{model.finalDecision || "—"}</Text>
        </FactRow>
        {hardStops.length > 0 && (
          <Alert color="red" title="Hard stops" mt="xs">
            <List size="sm">
              {hardStops.map((stop: string, i: number) => (
                <List.Item key={i}>{stop}</List.Item>
              ))}
            </List>
          </Alert>
        )}
        {softGaps.length > 0 && (
          <Alert color="yellow" title="Soft gaps" mt="xs">
            <List size="sm">
              {softGaps.map((gap: string, i: number) => (
                <List.Item key={i}>{gap}</List.Item>
              ))}
            </List>
          </Alert>
        )}
      </Stack>
    );
  }
  if (model.stage === "active") {
    return (
      <Stack gap="sm">
        {history.length === 0 ? (
          <Text c="dimmed">No transitions recorded in the status ledger yet.</Text>
        ) : (
          <Timeline bulletSize={16} lineWidth={2}>
            {history.map((h: HistoryEntry, i: number) => (
              <Timeline.Item key={i} title={`${h.from || "—"} → ${h.to}`}>
                <Text size="xs" c="dimmed">
                  {h.date} · {h.source || "manual"}
                  {h.note ? ` · ${h.note}` : ""}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
        )}
        {model.notes && <FactRow label="Notes">{model.notes}</FactRow>}
      </Stack>
    );
  }
  // closed — one outcome line + notes
  return (
    <Stack gap="xs">
      <FactRow label="Outcome">
        <Text fw={600}>{model.outcome || "—"}</Text>
      </FactRow>
      {model.notes && <FactRow label="Notes">{model.notes}</FactRow>}
    </Stack>
  );
}

/** The stage-focused application detail drawer (ticket 03 / ADR 0003). Machine
 * Summary facts are parsed CLIENT-side from the report payload — no second
 * server parse layer. The full report + JD archive appear only behind the
 * explicit "Full report" tab, and its payload is fetched lazily then (or
 * immediately for a deciding row, whose card needs the Machine Summary).
 *
 * The Drawer itself is NOT keyed by row: remounting it makes Mantine's shared
 * portal hand the exit transition of the old instance to the new one, and
 * every drawer after the first mounts hidden. The content is keyed instead,
 * which resets the tab/status-change state per row. */
function ApplicationDrawer({ row, onClose }: { row: AppRow | null; onClose: () => void }) {
  return (
    <Drawer opened={!!row} onClose={onClose} position="right" size="lg">
      {row && <DrawerContent key={row.num} row={row} />}
    </Drawer>
  );
}

function DrawerContent({ row }: { row: AppRow }) {
  const [tab, setTab] = useState<string | null>("focus");
  const stage = stageOfStatus(row.status);
  const needReport = stage === "deciding" || tab === "full";
  const reportQuery = useQuery({
    queryKey: ["report", row.reportNum],
    queryFn: () => api.report(row.reportNum ?? ""),
    enabled: needReport && row.reportNum != null,
  });

  const fields = useMemo(() => {
    const report = reportQuery.data?.report;
    return report ? { ...parseMachineSummaryFields(report.markdown), legitimacy: report.legitimacy } : {};
  }, [reportQuery.data]);
  const model = drawerContent(row, fields);

  return (
    <Stack gap="sm" h="100%">
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={4}>
          <Title order={4}>
            #{row.num} {row.company} — {row.role}
          </Title>
          <Group gap="sm">
            <StatusBadge status={row.status} />
            <Text size="xs" c="dimmed">
              {row.date}
            </Text>
          </Group>
        </Stack>
      </Group>

      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="focus">Stage focus</Tabs.Tab>
          <Tabs.Tab value="full">Full report</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="focus" pt="sm">
          <ScrollArea.Autosize mah="calc(100vh - 260px)">
            {stage === "deciding" && !row.reportNum && (
              <Alert color="yellow" title="No linked report" mb="sm">
                Decision facts come from the report's Machine Summary; this row links none.
              </Alert>
            )}
            {stage === "deciding" && reportQuery.isError && (
              <Alert color="red" title="Machine summary unavailable" mb="sm">
                {reportQuery.error instanceof ApiError
                  ? reportQuery.error.message
                  : String(reportQuery.error)}
              </Alert>
            )}
            <StageFocus row={row} model={model} />
            {model.url && (
              <FactRow label="Posting">
                <Anchor href={model.url} target="_blank" rel="noreferrer" fs="sm">
                  Open externally
                </Anchor>
              </FactRow>
            )}
          </ScrollArea.Autosize>
        </Tabs.Panel>

        <Tabs.Panel value="full" pt="sm">
          {!row.reportNum ? (
            <Text c="dimmed">This Application has no linked report.</Text>
          ) : reportQuery.isPending ? (
            <Center py="md">
              <Loader size="sm" />
            </Center>
          ) : reportQuery.isError ? (
            <Alert color="red" title="Report could not be loaded">
              {reportQuery.error instanceof ApiError
                ? `${reportQuery.error.code}: ${reportQuery.error.message}`
                : String(reportQuery.error)}
            </Alert>
          ) : (
            <ScrollArea.Autosize mah="calc(100vh - 260px)">
              <Markdown remarkPlugins={[remarkGfm]}>{reportQuery.data!.report.markdown}</Markdown>
            </ScrollArea.Autosize>
          )}
        </Tabs.Panel>
      </Tabs>

      <StatusChanger row={row} />
    </Stack>
  );
}

export function ApplicationsPage() {
  const query = useQuery({ queryKey: ["applications"], queryFn: api.applications });
  const [lens, setLens] = useState<string>(DEFAULT_STAGE);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "date", dir: "desc" });
  // The drawer target is a num, re-derived from the tracker payload on every
  // render — after a status change invalidates the query, the drawer shows the
  // fresh state (the payload holds ALL rows; the lens filters are view-side).
  const [selectedNum, setSelectedNum] = useState<string | null>(null);
  const rows = query.data?.rows ?? [];
  const selectedRow = selectedNum ? (rows.find((r) => r.num === selectedNum) ?? null) : null;
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

      <TrackerTable
        rows={sortRows(statusRows, sort)}
        sort={sort}
        onSort={onSort}
        onSelect={(row) => setSelectedNum(row.num)}
      />
      <ApplicationDrawer row={selectedRow} onClose={() => setSelectedNum(null)} />
    </Stack>
  );
}

export const ReportsPage = () => <Stub title="Reports" blurb="Report browser lands here (ticket 05)." />;

export const SystemPage = () => <Stub title="System" blurb="System health lands here (ticket 07)." />;
