import { Badge } from "@mantine/core";
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
