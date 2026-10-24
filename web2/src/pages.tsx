// Pages for the web2 shell (ticket 01), one section per ticket.
// 02 Applications table + stage lens · 03 stage-focused detail drawer ·
// 04 selection, bulk state change, CSV export · 05 Reports browser ·
// 06 Overview KPIs + funnel · 07 System health.
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Center,
  Checkbox,
  Code,
  Drawer,
  Group,
  List,
  Loader,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
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
import { BarChart } from "@mantine/charts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, type AppRow, type HistoryEntry } from "./lib/api";
import { CANONICAL_STATES, StatusBadge } from "./lib/ui";
// Stage model + sorting live in lib/ (plain .mjs, tested by node --test).
import { DEFAULT_STAGE, drawerContent, rowsInStage, stageOfStatus } from "../lib/stage.mjs";
import { parseMachineSummaryFields } from "../lib/reportfields.mjs";
import { sortRows } from "../lib/sortrows.mjs";
import { runSequential } from "../lib/bulk.mjs";
import { csvFilename, localDateIso, toCsv } from "../lib/csv.mjs";

// --- Overview (ticket 06) ----------------------------------------------------

function KpiCard({ label, value, lens }: { label: string; value: string; lens: string }) {
  return (
    <UnstyledButton onClick={() => (window.location.hash = `applications/${lens}`)} aria-label={`${label}: ${value}`}>
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          {label}
        </Text>
        <Text fz={28} fw={700}>
          {value}
        </Text>
      </Paper>
    </UnstyledButton>
  );
}

export function OverviewPage() {
  const query = useQuery({ queryKey: ["applications", "overview"], queryFn: api.overview });
  if (query.isPending) {
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );
  }
  if (query.isError) {
    const code = query.error instanceof ApiError ? query.error.code : "ERROR";
    return <TrackerErrorState code={code} message={query.error.message} onRetry={() => void query.refetch()} />;
  }
  const { kpis, funnel, activity } = query.data;
  return (
    <Stack gap="md">
      <Title order={2}>Overview</Title>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <KpiCard label="Deciding" value={String(kpis.deciding)} lens="deciding" />
        <KpiCard label="Active process" value={String(kpis.active)} lens="active" />
        <KpiCard label="Ever hired" value={String(kpis.everHired)} lens="closed" />
        <KpiCard label="Average score" value={kpis.avgScore != null ? kpis.avgScore.toFixed(2) : "—"} lens="all" />
      </SimpleGrid>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">
          Funnel — applications that ever reached each stage
        </Text>
        <BarChart h={260} data={funnel} dataKey="stage" series={[{ name: "count", label: "Applications", color: "blue.6" }]} />
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">
          Recent status activity
        </Text>
        {activity.length === 0 ? (
          <Text c="dimmed">No transitions in the status ledger yet.</Text>
        ) : (
          <Table>
            <Table.Tbody>
              {activity.map((a, i) => (
                <Table.Tr key={i}>
                  <Table.Td w={110}>{a.date}</Table.Td>
                  <Table.Td>
                    #{a.num} {a.company} — {a.role}
                  </Table.Td>
                  <Table.Td>
                    {a.from || "—"} → {a.to}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}

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

/** CSV columns = the table's visible columns, in the table's order. */
const CSV_HEADER = ["#", "Date", "Company", "Role", "Score", "Status", "Last transition"];

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
  // Only a deciding card needs the Machine Summary up front; the Full report
  // tab fetches on its own (same query key, so never twice).
  const reportQuery = useQuery({
    queryKey: ["report", row.reportNum],
    queryFn: () => api.report(row.reportNum ?? ""),
    enabled: stage === "deciding" && row.reportNum != null,
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
          <Tabs.Tab value="intel">Company intel</Tabs.Tab>
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
          {/* Mounted only while active: the report payload stays lazy. */}
          {tab === "full" && <FullReport reportNum={row.reportNum} />}
        </Tabs.Panel>

        <Tabs.Panel value="intel" pt="sm">
          {tab === "intel" && <CompanyIntel company={row.company} />}
        </Tabs.Panel>
      </Tabs>

      <StatusChanger row={row} />
    </Stack>
  );
}

/** The full report markdown (+ JD archive) for one report number — shared by
 * the application drawer's "Full report" tab and the Reports page, on the same
 * ["report", num] query key, so a report is fetched and parsed in one place. */
function FullReport({ reportNum }: { reportNum: string | null }) {
  const reportQuery = useQuery({
    queryKey: ["report", reportNum],
    queryFn: () => api.report(reportNum ?? ""),
    enabled: reportNum != null,
  });
  if (!reportNum) return <Text c="dimmed">This Application has no linked report.</Text>;
  if (reportQuery.isPending) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    );
  }
  if (reportQuery.isError) {
    return (
      <Alert color="red" title="Report could not be loaded">
        {reportQuery.error instanceof ApiError
          ? `${reportQuery.error.code}: ${reportQuery.error.message}`
          : String(reportQuery.error)}
      </Alert>
    );
  }
  return (
    <ScrollArea.Autosize mah="calc(100vh - 200px)">
      <Markdown remarkPlugins={[remarkGfm]}>{reportQuery.data.report.markdown}</Markdown>
    </ScrollArea.Autosize>
  );
}

/** Company intel from the local cache (ticket 08 / ADR 0004). Every item is
 * stamped with its source and fetch date; the app never scrapes live. */
function CompanyIntel({ company }: { company: string }) {
  const query = useQuery({ queryKey: ["intel", company], queryFn: () => api.intel(company) });
  if (query.isPending) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    );
  }
  if (query.isError) {
    return (
      <Alert color="red" title="Intel could not be loaded">
        {query.error.message}
      </Alert>
    );
  }
  const snapshot = query.data.snapshot;
  if (!snapshot || snapshot.sources.length === 0) {
    return (
      <Alert color="gray" title={`No intel yet for ${company}`}>
        Capture reviews and salaries into the local cache first — see <Code>web2/scripts/capture-intel.md</Code>.
      </Alert>
    );
  }
  // Newest capture first; older ones stay visible (never overwritten).
  const sources = [...snapshot.sources].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  return (
    <ScrollArea.Autosize mah="calc(100vh - 260px)">
      <Stack gap="sm">
        {sources.map((s, i) => (
          <Paper key={i} withBorder p="sm" radius="md">
            <Group justify="space-between" mb={4} wrap="nowrap">
              <Badge variant="light" color={s.kind === "reviews" ? "grape" : "teal"}>
                {s.kind}
              </Badge>
              <Text size="xs" c="dimmed">
                <Anchor href={s.url} target="_blank" rel="noreferrer" size="xs">
                  {s.source}
                </Anchor>{" "}
                · fetched {s.fetchedAt}
                {s.asOf ? ` · data as of ${s.asOf}` : ""}
              </Text>
            </Group>
            {s.kind === "reviews" ? (
              <Stack gap={4}>
                <Text size="sm">
                  Rating {s.data.rating ?? "—"}
                  {s.data.reviewCount != null ? ` from ${s.data.reviewCount} reviews` : ""}
                </Text>
                {(s.data.pros ?? []).length > 0 && (
                  <Text size="sm">
                    <b>Pros:</b> {s.data.pros!.join(" · ")}
                  </Text>
                )}
                {(s.data.cons ?? []).length > 0 && (
                  <Text size="sm">
                    <b>Cons:</b> {s.data.cons!.join(" · ")}
                  </Text>
                )}
              </Stack>
            ) : (
              <Stack gap={4}>
                <Text size="sm">
                  Median total {s.data.medianTotal != null ? s.data.medianTotal.toLocaleString() : "—"} {s.data.currency ?? ""}
                  {s.data.location ? ` · ${s.data.location}` : ""}
                </Text>
                {(s.data.levels ?? []).map((l, j) => (
                  <Text key={j} size="xs" c="dimmed">
                    {l.level}: {l.total.toLocaleString()} {s.data.currency ?? ""}
                  </Text>
                ))}
              </Stack>
            )}
          </Paper>
        ))}
      </Stack>
    </ScrollArea.Autosize>
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
  const statusOptions = useMemo<Array<{ value: string; label: string }>>(
    () =>
      Array.from(new Set(lensRows.map((r) => r.status)))
        .sort((a, b) => a.localeCompare(b))
        .map((s) => ({ value: s, label: s })),
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
    link.download = csvFilename(lens, localDateIso());
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

      <Group gap="sm" wrap="nowrap">
        <Select
          placeholder="Filter by status"
          clearable
          checkIconPosition="right"
          data={statusOptions}
          value={statusFilter}
          onChange={onStatusFilter}
          miw={220}
        />
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

// --- Reports (ticket 05) -----------------------------------------------------

/** Every reports/*.md with a company/role filter. A report linked from a
 * tracker row opens that row's stage-aware drawer; an unlinked one opens
 * straight on its full report. */
export function ReportsPage() {
  const reportsQuery = useQuery({ queryKey: ["reports"], queryFn: api.reports });
  // Shared cache with the Applications page; a missing tracker just means no
  // report matches a row, so every report opens on its full text.
  const appsQuery = useQuery({ queryKey: ["applications"], queryFn: api.applications });
  const [search, setSearch] = useState("");
  const [openNum, setOpenNum] = useState<string | null>(null);

  const rows = appsQuery.data?.rows ?? [];
  const matchedRow = openNum ? (rows.find((r) => r.reportNum === openNum) ?? null) : null;
  const needle = search.trim().toLowerCase();
  const reports = (reportsQuery.data?.reports ?? []).filter(
    (r) => !needle || `${r.company} ${r.role}`.toLowerCase().includes(needle),
  );
  const openReport = reportsQuery.data?.reports.find((r) => r.num === openNum);

  return (
    <Stack gap="sm">
      <Title order={2}>Reports</Title>
      {reportsQuery.isPending ? (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      ) : reportsQuery.isError ? (
        <Alert color="red" title="Reports could not be listed">
          {reportsQuery.error instanceof ApiError
            ? `${reportsQuery.error.code}: ${reportsQuery.error.message}`
            : String(reportsQuery.error)}
        </Alert>
      ) : (
        <>
          <Group gap="sm" wrap="nowrap">
            <TextInput
              placeholder="Search company or role"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              miw={260}
            />
            <Text size="sm" c="dimmed">
              {reports.length} of {reportsQuery.data.reports.length} shown
            </Text>
          </Group>
          <ScrollArea>
            <Table horizontalSpacing="md" highlightOnHover style={{ minWidth: 700 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Company</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Score</Table.Th>
                  <Table.Th>Legitimacy</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {reports.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6}>
                      <Text c="dimmed">No reports match.</Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  reports.map((r) => (
                    <Table.Tr
                      key={r.num}
                      onClick={() => setOpenNum(r.num)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setOpenNum(r.num);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <Table.Td>{r.num}</Table.Td>
                      <Table.Td>{r.date}</Table.Td>
                      <Table.Td>{r.company}</Table.Td>
                      <Table.Td>{r.role}</Table.Td>
                      <Table.Td>{r.score != null ? r.score.toFixed(1) : "—"}</Table.Td>
                      <Table.Td>{r.legitimacy || "—"}</Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </>
      )}
      <ApplicationDrawer row={matchedRow} onClose={() => setOpenNum(null)} />
      <Drawer
        opened={!!openNum && !matchedRow}
        onClose={() => setOpenNum(null)}
        position="right"
        size="lg"
        title={openReport ? `Report ${openReport.num} — ${openReport.company}` : "Report"}
      >
        {openNum && !matchedRow && <FullReport key={openNum} reportNum={openNum} />}
      </Drawer>
    </Stack>
  );
}

// --- System (ticket 07) ------------------------------------------------------

const CHECK_STATE = {
  ok: { color: "green", label: "OK" },
  missing: { color: "yellow", label: "Missing" },
  error: { color: "red", label: "Broken" },
} as const;

export function SystemPage() {
  const query = useQuery({ queryKey: ["system"], queryFn: api.system });
  if (query.isPending) {
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );
  }
  if (query.isError) {
    return (
      <Alert color="red" title="System status unavailable">
        {query.error.message}
      </Alert>
    );
  }
  const { dataRoot, rootSource, node, checks } = query.data;
  return (
    <Stack gap="md">
      <Title order={2}>System</Title>
      <Paper withBorder p="md" radius="md">
        <FactRow label="Data root">
          <Code>{dataRoot}</Code>
        </FactRow>
        <FactRow label="Resolved by">
          <Text size="sm">{rootSource}</Text>
        </FactRow>
        <FactRow label="Node">
          <Code>{node}</Code>
        </FactRow>
      </Paper>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {checks.map((c) => (
          <Paper key={c.id} withBorder p="md" radius="md">
            <Group justify="space-between" mb="xs">
              <Text fw={600}>{c.label}</Text>
              <Badge color={CHECK_STATE[c.state].color} variant="light">
                {CHECK_STATE[c.state].label}
              </Badge>
            </Group>
            <Code block>{c.path}</Code>
            <Text size="sm" mt="xs" c={c.state === "ok" ? "dimmed" : undefined}>
              {c.state === "missing" ? "Not found at this path." : c.detail}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
