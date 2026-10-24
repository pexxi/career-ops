// The stage-focused application detail drawer (ticket 03 / ADR 0003), shared
// by the Applications and Reports pages, with its tabs: stage focus, full
// report (ticket 05) and company intel (ticket 08).
import { useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Center,
  Code,
  Drawer,
  Group,
  List,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Timeline,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, type AppRow, type HistoryEntry } from "./lib/api";
import { CANONICAL_STATES, FactRow, scoreText, StatusBadge } from "./lib/ui";
import { drawerContent, stageOfStatus } from "../lib/stage.mjs";

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
 * Summary facts arrive with the report payload, parsed server-side by the
 * core's parseMachineSummary (one YAML parser for the whole project). The full report + JD archive appear only behind the
 * explicit "Full report" tab, and its payload is fetched lazily then (or
 * immediately for a deciding row, whose card needs the Machine Summary).
 *
 * The Drawer itself is NOT keyed by row: remounting it makes Mantine's shared
 * portal hand the exit transition of the old instance to the new one, and
 * every drawer after the first mounts hidden. The content is keyed instead,
 * which resets the tab/status-change state per row. */
export function ApplicationDrawer({ row, onClose }: { row: AppRow | null; onClose: () => void }) {
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

  const report = reportQuery.data?.report;
  const model = drawerContent(row, report ? { ...report.summary, legitimacy: report.legitimacy } : {});

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
export function FullReport({ reportNum }: { reportNum: string | null }) {
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
                  {s.data.reviewCount != null ? ` from ${s.data.reviewCount.toLocaleString()} reviews` : ""}
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
