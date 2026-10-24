import { Badge } from "@mantine/core";

/** Canonical-state colors — Exhaustive map over templates/states.yml states. */
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

export const CANONICAL_STATES = Object.keys(STATUS_COLORS);
