// System health (ticket 07).
import { Alert, Badge, Center, Code, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api";
import { FactRow } from "./lib/ui";

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
