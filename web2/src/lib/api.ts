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

export interface ReportsPayload {
  reportsDir: string;
  reports: Array<ReportMeta & { num: string }>;
}

export interface ReportPayload {
  report: ReportMeta & { markdown: string };
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
  reports: () => request<ReportsPayload>("/api/reports"),
  report: (num: string | number, signal?: AbortSignal) =>
    request<ReportPayload>(`/api/reports/${num}`, { signal }),
  setStatus: (num: string | number, state: string, note?: string) =>
    request<{ ok: boolean }>("/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ num, state, note }),
    }),
};
