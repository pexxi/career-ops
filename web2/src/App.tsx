import { useEffect, useState } from "react";
import { AppShell, Burger, Group, NavLink, Text, ActionIcon, useMantineColorScheme, ScrollArea } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { IconSun, IconMoon, IconRefresh, IconGauge, IconTable, IconFileText, IconShieldCheck } from "@tabler/icons-react";

const PAGES = [
  { id: "overview", label: "Overview", icon: IconGauge },
  { id: "applications", label: "Applications", icon: IconTable },
  { id: "reports", label: "Reports", icon: IconFileText },
  { id: "system", label: "System", icon: IconShieldCheck },
] as const;

type PageId = (typeof PAGES)[number]["id"];

function pageFromHash(): PageId {
  const hash = window.location.hash.replace("#", "") as PageId;
  return PAGES.some((p) => p.id === hash) ? hash : "overview";
}

export function App() {
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [navOpen, setNavOpen] = useState(false);
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const queryClient = useQueryClient();

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (id: PageId) => {
    window.location.hash = id;
    setPage(id);
    setNavOpen(false);
  };

  const refresh = () => queryClient.invalidateQueries();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: "sm" }}
      footer={{ height: 30 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={navOpen} onClick={() => setNavOpen((o) => !o)} hiddenFrom="sm" size="sm" />
            <Text fw={700} size="md" visibleFrom="xs">
              career-ops
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <ActionIcon variant="default" onClick={refresh} title="Refresh data" aria-label="Refresh data">
              <IconRefresh size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              onClick={() => toggleColorScheme()}
              title="Toggle light / dark"
              aria-label="Toggle color scheme"
            >
              {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar px="xs" py="sm">
        <ScrollArea>
          {PAGES.map(({ id, label, icon: Icon }) => (
            <NavLink key={id} active={page === id} label={label} leftSection={<Icon size={18} />} onClick={() => go(id)} />
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Footer>
        <Group h="100%" px="md" justify="space-between" gap="xs">
          <Text size="xs" c="dimmed">
            loopback only (127.0.0.1)
          </Text>
          <Text size="xs" c="dimmed" visibleFrom="xs">
            local-first · markdown is the source of truth · nothing is submitted for you
          </Text>
        </Group>
      </AppShell.Footer>

      <AppShell.Main>
        {page === "overview" && <OverviewPage />}
        {page === "applications" && <ApplicationsPage />}
        {page === "reports" && <ReportsPage />}
        {page === "system" && <SystemPage />}
      </AppShell.Main>
    </AppShell>
  );
}

// Lazy page references resolved in this single-file shell to avoid a router dep.
import { OverviewPage, ApplicationsPage, ReportsPage, SystemPage } from "./pages";
