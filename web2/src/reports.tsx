// Reports browser (ticket 05).
import { useState } from "react";
import { Alert, Center, Drawer, Group, Loader, ScrollArea, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./lib/api";
import { ApplicationDrawer, FullReport } from "./drawer";

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
