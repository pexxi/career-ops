// Profile page (ticket 10): a view over the four candidate profile files plus
// Profile apply — the only way this page changes a file: a unified patch,
// previewed (dry run) as a diff, then applied on an explicit click.
import { useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Code,
  Group,
  MultiSelect,
  Loader,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FILE_LABELS as PROFILE_FILE_LABELS } from "../lib/profilefiles.mjs";
import { api, ApiError, type ApplyResult, type CoachProposal, type ProfileFile, type ProfileYaml } from "./lib/api";

const FILE_LABELS: Record<ProfileFile["name"], string> = PROFILE_FILE_LABELS;

function Facts({ title, entries }: { title: string; entries: Array<[string, unknown]> }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text fw={600} mb="xs">
        {title}
      </Text>
      {entries.length === 0 ? (
        <Text size="sm" c="dimmed">
          Not set in profile.yml.
        </Text>
      ) : (
        <Stack gap={4}>
          {entries.map(([k, v]) => (
            <Text key={k} size="sm">
              <Text span c="dimmed">
                {k.replace(/_/g, " ")}:
              </Text>{" "}
              {typeof v === "object" ? JSON.stringify(v) : String(v)}
            </Text>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

function Reference({ parsed }: { parsed: ProfileYaml }) {
  const archetypes = parsed.target_roles?.archetypes ?? [];
  // Contact fields stay on this loopback page; photo is a file path, not a fact worth a row.
  const identity = Object.entries(parsed.candidate ?? {}).filter(([k, v]) => k !== "photo" && v);
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Facts title="Identity" entries={identity} />
        <Facts title="Compensation" entries={Object.entries(parsed.compensation ?? {})} />
        <Facts title="Work preferences" entries={Object.entries(parsed.work_preferences ?? {})} />
      </SimpleGrid>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="xs">
          Target roles
        </Text>
        <Group gap="xs" mb="sm">
          {(parsed.target_roles?.primary ?? []).map((r) => (
            <Badge key={r} variant="light">
              {r}
            </Badge>
          ))}
        </Group>
        {archetypes.length > 0 && (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Archetype</Table.Th>
                <Table.Th>Level</Table.Th>
                <Table.Th>Fit</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {archetypes.map((a, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{a.name}</Table.Td>
                  <Table.Td>{a.level}</Table.Td>
                  <Table.Td>{a.fit}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}

/** A unified patch rendered as before (−) / after (+) lines. */
function PatchView({ patch }: { patch: string }) {
  return (
    <ScrollArea.Autosize mah={360}>
      <Box component="pre" ff="monospace" fz="xs" m={0}>
        {patch.split("\n").map((line, i) => {
          const bg = line.startsWith("+") && !line.startsWith("+++")
            ? "var(--mantine-color-green-light)"
            : line.startsWith("-") && !line.startsWith("---")
              ? "var(--mantine-color-red-light)"
              : undefined;
          return (
            <div key={i} style={{ background: bg, whiteSpace: "pre-wrap" }}>
              {line || " "}
            </div>
          );
        })}
      </Box>
    </ScrollArea.Autosize>
  );
}

/** Profile apply: paste (or receive) a patch → Preview (dry run, nothing
 * written) → Apply. Apply stays disabled until THIS exact file+patch previewed
 * cleanly, so what is written is always what was shown. */
export function ProfileApply({ initialFile = "profile", initialPatch = "" }: { initialFile?: string; initialPatch?: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<string>(initialFile);
  const [patch, setPatch] = useState(initialPatch);
  const [preview, setPreview] = useState<{ file: string; patch: string; result: ApplyResult } | null>(null);
  const previewed = preview?.file === file && preview.patch === patch;

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.applyProfile(file, patch, dryRun),
    onSuccess: (result, dryRun) => {
      if (dryRun) {
        setPreview({ file, patch, result });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      notifications.show({ title: "Profile updated", message: `Applied to ${result.path}`, color: "green" });
      setPreview(null);
      setPatch("");
    },
    onError: (err) => {
      setPreview(null);
      notifications.show({
        title: "Patch not applied",
        message: err instanceof ApiError ? err.message : String(err),
        color: "red",
        autoClose: 20_000,
      });
    },
  });

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Text fw={600}>Profile apply</Text>
        <Text size="sm" c="dimmed">
          Paste a unified diff. It applies only where its hunks say, nothing is re-serialized, and nothing is written
          until you preview it and click Apply.
        </Text>
        <Select
          label="File"
          data={Object.entries(FILE_LABELS).map(([value, label]) => ({ value, label }))}
          value={file}
          onChange={(v) => v && setFile(v)}
          allowDeselect={false}
          maw={320}
        />
        <Textarea
          label="Patch"
          placeholder={"@@ -16,1 +16,1 @@\n-  target_range: \"EUR 110K-130K\"\n+  target_range: \"EUR 120K-140K\""}
          autosize
          minRows={4}
          maxRows={16}
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
          value={patch}
          onChange={(e) => setPatch(e.currentTarget.value)}
        />
        {previewed && (
          <Alert color="green" title={`Applies cleanly to ${preview.result.path}`}>
            <Tabs defaultValue="diff">
              <Tabs.List>
                <Tabs.Tab value="diff">Diff</Tabs.Tab>
                <Tabs.Tab value="before">Before</Tabs.Tab>
                <Tabs.Tab value="after">After</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="diff" pt="xs">
                <PatchView patch={patch} />
              </Tabs.Panel>
              {(["before", "after"] as const).map((side) => (
                <Tabs.Panel key={side} value={side} pt="xs">
                  <ScrollArea.Autosize mah={360}>
                    <Code block>{preview.result[side] || "(empty file)"}</Code>
                  </ScrollArea.Autosize>
                </Tabs.Panel>
              ))}
            </Tabs>
          </Alert>
        )}
        <Group gap="sm">
          <Button variant="default" disabled={!patch.trim()} loading={run.isPending && run.variables} onClick={() => run.mutate(true)}>
            Preview
          </Button>
          <Button disabled={!previewed} loading={run.isPending && !run.variables} onClick={() => run.mutate(false)}>
            Apply
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

/** Profile coach (ticket 11, ADR 0005): chat about the profile, with reports
 * attached as context. Its proposals are only ever handed to Profile apply. */
function CoachPanel({ onPropose }: { onPropose: (p: CoachProposal) => void }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["coach"], queryFn: api.coach });
  const reportsQuery = useQuery({ queryKey: ["reports"], queryFn: api.reports });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [attached, setAttached] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const transcript = useQuery({
    queryKey: ["coach", "session", sessionId],
    queryFn: () => api.coachSession(sessionId!),
    enabled: sessionId != null,
  });
  const send = useMutation({
    mutationFn: () => api.coachChat(sessionId, message, attached),
    onSuccess: (res) => {
      setSessionId(res.sessionId);
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["coach"] });
    },
    onError: (err) =>
      notifications.show({
        title: "Coach request failed",
        message: err instanceof ApiError ? err.message : String(err),
        color: "red",
        autoClose: 20_000,
      }),
  });

  if (status.isPending) return null;
  if (status.isError) {
    return (
      <Alert color="red" title="Coach status unavailable">
        {status.error.message}
      </Alert>
    );
  }
  if (!status.data.configured) {
    return (
      <Alert color="gray" title="Profile coach is not set up">
        <Text size="sm">{status.data.reason}</Text>
        <Code block mt="xs">
          {'{ "provider": "anthropic", "model": "claude-opus-5-5", "apiKeyEnv": "ANTHROPIC_API_KEY" }'}
        </Code>
        <Text size="xs" c="dimmed" mt="xs">
          config/web2.json (in the data root) is gitignored. The key stays on the server and is never sent to this page.
        </Text>
      </Alert>
    );
  }

  const messages = transcript.data?.messages ?? [];
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Profile coach</Text>
          <Text size="xs" c="dimmed">
            {status.data.model} · proposes edits only; you apply them below
          </Text>
        </Group>
        <Select
          label="Session"
          placeholder="New session"
          clearable
          data={status.data.sessions.map((s) => ({ value: s.id, label: `${s.updated.slice(0, 10)} · ${s.title}` }))}
          value={sessionId}
          onChange={setSessionId}
        />
        <ScrollArea.Autosize mah={480}>
          <Stack gap="xs">
            {messages.map((m, i) => (
              <Paper key={i} p="sm" radius="md" bg={m.role === "user" ? "var(--mantine-color-default-hover)" : undefined} withBorder={m.role === "assistant"}>
                <Text size="xs" c="dimmed" mb={4}>
                  {m.role === "user" ? "You" : "Coach"}
                  {m.reports?.length ? ` · attached reports ${m.reports.join(", ")}` : ""}
                </Text>
                {m.role === "user" ? <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{m.content}</Text> : <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>}
                {(m.proposals ?? []).map((p, j) => (
                  <Button key={j} size="xs" variant="light" mt={4} mr="xs" onClick={() => onPropose(p)}>
                    Review edit to {FILE_LABELS[p.file]} in Profile apply
                  </Button>
                ))}
              </Paper>
            ))}
            {send.isPending && (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Coach is thinking…
                </Text>
              </Group>
            )}
          </Stack>
        </ScrollArea.Autosize>
        <MultiSelect
          label="Attach evaluation reports"
          placeholder="Optional context"
          searchable
          clearable
          data={(reportsQuery.data?.reports ?? []).map((r) => ({ value: r.num, label: `${r.num} · ${r.company} — ${r.role}` }))}
          value={attached}
          onChange={setAttached}
        />
        <Textarea
          label="Message"
          placeholder="e.g. Tighten my headline for AI Solutions Architect roles"
          autosize
          minRows={2}
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
        />
        <Group>
          <Button disabled={!message.trim()} loading={send.isPending} onClick={() => send.mutate()}>
            Send
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

export function ProfilePage() {
  const query = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  // A coach proposal re-mounts Profile apply pre-filled with it (n forces the remount).
  const [proposal, setProposal] = useState<(CoachProposal & { n: number }) | null>(null);
  if (query.isPending) {
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );
  }
  if (query.isError) {
    return (
      <Alert color="red" title="Profile could not be loaded">
        {query.error.message}
      </Alert>
    );
  }
  const { files, parsed, parseError } = query.data;
  return (
    <Stack gap="md">
      <Title order={2}>Profile</Title>
      {parseError && (
        <Alert color="red" title="config/profile.yml does not parse">
          {parseError}
        </Alert>
      )}
      {parsed && <Reference parsed={parsed} />}
      <Tabs defaultValue="cv">
        <Tabs.List>
          {files.map((f) => (
            <Tabs.Tab
              key={f.name}
              value={f.name}
              rightSection={!f.exists && <Badge color="gray" size="xs">missing</Badge>}
            >
              {FILE_LABELS[f.name]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {files.map((f) => (
          <Tabs.Panel key={f.name} value={f.name} pt="sm">
            <Text size="xs" c="dimmed" mb="xs">
              {f.path}
            </Text>
            {!f.exists ? (
              <Text c="dimmed">Not created yet. That is fine; nothing reads it as an error.</Text>
            ) : f.name === "profile" ? (
              <Code block>{f.content}</Code>
            ) : (
              <ScrollArea.Autosize mah="60vh">
                <Markdown remarkPlugins={[remarkGfm]}>{f.content}</Markdown>
              </ScrollArea.Autosize>
            )}
          </Tabs.Panel>
        ))}
      </Tabs>
      <CoachPanel
        onPropose={(p) => {
          setProposal((prev) => ({ ...p, n: (prev?.n ?? 0) + 1 }));
          document.getElementById("profile-apply")?.scrollIntoView({ behavior: "smooth" });
        }}
      />
      <div id="profile-apply">
        <ProfileApply key={proposal?.n ?? 0} initialFile={proposal?.file} initialPatch={proposal?.patch} />
      </div>
    </Stack>
  );
}
