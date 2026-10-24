// Typed fetchers for the web2 API. One module, no magic.
export interface HistoryEntry {
  date: string;
  from: string;
  to: string;
  source: string;
  note: string;
}

export interface AppRow {
  num: string;
  date: string;
  company: string;
  role: string;
  location: string;
  score: number | null;
  scoreSentinel: string | null;
  status: string;
  pdf: boolean | null;
  reportNum: string | null;
  reportCell: string;
  notes: string;
  via: string;
  url: string;
  history: HistoryEntry[];
  lastTransition: string;
}

export interface ApplicationsPayload {
  trackerPath: string;
  dataRoot: string;
  rows: AppRow[];
  warnings: string[];
}

export interface ReportMeta {
  file: string;
  title: string;
  company: string;
  role: string;
  date: string;
  url: string;
  score: number | null;
  legitimacy: string;
  archetype: string;
}

export interface ReportPayload {
  report: ReportMeta & { markdown: string };
}

export interface ReportListItem extends ReportMeta {}

export interface FunnelStage {
  stage: string;
  count: number;
}

export interface Stats {
  totalRows: number;
  statusCounts: Record<string, number>;
  funnel: FunnelStage[];
  everApplied: number;
  everHired: number;
  avgScore: number | null;
  recentActivity: HistoryEntry[];
}

export interface SystemCheck {
  status: "ok" | "missing" | "error";
  path: string;
  message?: string;
  count?: number;
}

export interface SystemInfo {
  dataRoot: string;
  repoRoot: string;
  node: string;
  checks: Record<string, SystemCheck>;
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(err?.code ?? "HTTP_" + res.status, err?.message ?? res.statusText);
  }
  return body as T;
}

export const api = {
  applications: () => request<ApplicationsPayload>("/api/applications"),
  reportsList: () => request<{ reports: ReportListItem[] }>("/api/reports"),
  report: (num: string | number, signal?: AbortSignal) =>
    request<ReportPayload>(`/api/reports/${num}`, { signal }),
  stats: () => request<Stats>("/api/stats"),
  system: () => request<SystemInfo>("/api/system"),
  setStatus: (num: string | number, state: string, note?: string) =>
    request<{ ok: boolean }>("/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ num, state, note }),
    }),
};
