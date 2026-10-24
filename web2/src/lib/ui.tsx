import { Alert, Badge, Button, Group, Stack, Text } from "@mantine/core";
import type { AppRow } from "./api";
export { CANONICAL_STATES } from "../../lib/stage.mjs";

/** Display colors per canonical state; an unknown state falls back to gray. */
export const STATUS_COLORS: Record<string, string> = {
  Evaluated: "blue",
  Applied: "cyan",
  Responded: "grape",
  Assessment: "orange",
  Interview: "violet",
  Offer: "teal",
  Hired: "green",
  Rejected: "red",
  Discarded: "gray",
  SKIP: "dark",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "gray";
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge color={statusColor(status)} variant="light" size="sm" w="fit-content">
      {status}
    </Badge>
  );
}

/** Sentinels render as their own text ("—" / "N/A"), never as 0 or NaN. */
export function scoreText(row: AppRow): string {
  if (row.scoreSentinel) return row.scoreSentinel;
  if (row.score != null) return row.score.toFixed(1);
  return "—";
}

/** Error states distinguish a missing tracker file from a malformed one —
 * missing file ≠ broken file (the parser/AGENTS rule). */
export function TrackerErrorState({ code, message, onRetry }: { code: string; message?: string; onRetry: () => void }) {
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

/** Flexible fact row (drawer, System page): dimmed label + value. */
export function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group gap="sm" align="baseline" wrap="nowrap">
      <Text w={110} size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      {children}
    </Group>
  );
}
