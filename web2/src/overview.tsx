// Overview (ticket 06): KPI cards, the ever-reached funnel, recent activity.
import { Center, Loader, Paper, SimpleGrid, Stack, Table, Text, Title, UnstyledButton } from "@mantine/core";
import { BarChart } from "@mantine/charts";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./lib/api";
import { TrackerErrorState } from "./lib/ui";

/** A card with a lens links to the Applications page in that lens. Without one
 * it is plain: "Ever hired" counts history, which no lens can list. */
function KpiCard({ label, value, lens }: { label: string; value: string; lens?: string }) {
  const card = (
    <Paper withBorder p="md" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text fz={28} fw={700}>
        {value}
      </Text>
    </Paper>
  );
  if (!lens) return card;
  return (
    <UnstyledButton onClick={() => (window.location.hash = `applications/${lens}`)} aria-label={`${label}: ${value}`}>
      {card}
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
        <KpiCard label="Ever hired" value={String(kpis.everHired)} />
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
