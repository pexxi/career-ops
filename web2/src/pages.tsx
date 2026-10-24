// Stub pages for the #01 dev shell; each is replaced by its own ticket
// (02 Applications table, 05 Reports browser, 06 Overview KPIs, 07 System).
import { Stack, Text, Title } from "@mantine/core";

function Stub({ title, blurb }: { title: string; blurb: string }) {
  return (
    <Stack h="100%" align="center" justify="center" gap="xs">
      <Title order={2}>{title}</Title>
      <Text c="dimmed">{blurb}</Text>
    </Stack>
  );
}

export const OverviewPage = () => <Stub title="Overview" blurb="Funnel KPIs land here (ticket 06)." />;

export const ApplicationsPage = () => (
  <Stub title="Applications" blurb="Tracker table and stage lens land here (ticket 02)." />
);

export function ReportsPage(_props: { reportOpener: unknown }) {
  return <Stub title="Reports" blurb="Report browser lands here (ticket 05)." />;
}

export const SystemPage = () => <Stub title="System" blurb="System health lands here (ticket 07)." />;
