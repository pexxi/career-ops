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

/** One provenance-stamped intel entry (ticket 08). `data` is captured
 * external content: rendered as text, never trusted as instructions. */
export interface IntelEntry {
  source: string;
  url: string;
  fetchedAt: string;
  asOf?: string;
  kind: "reviews" | "salaries";
  data: {
    rating?: number;
    reviewCount?: number;
    pros?: string[];
    cons?: string[];
    medianTotal?: number;
    currency?: string;
    location?: string;
    levels?: Array<{ level: string; total: number }>;
  };
}

export interface IntelPayload {
  snapshot: { company: string; sources: IntelEntry[] } | null;
}

export interface SystemCheck {
  id: string;
  label: string;
  path: string;
  state: "ok" | "missing" | "error";
  detail: string;
}

export interface SystemPayload {
  dataRoot: string;
  rootSource: string;
  node: string;
  checks: SystemCheck[];
}

export interface OverviewPayload {
  kpis: { deciding: number; active: number; everHired: number; avgScore: number | null };
  funnel: Array<{ stage: string; count: number }>;
  activity: Array<{ num: string; company: string; role: string; date: string; from: string; to: string }>;
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
  intel: (company: string) => request<IntelPayload>(`/api/intel?company=${encodeURIComponent(company)}`),
  system: () => request<SystemPayload>("/api/system"),
  overview: () => request<OverviewPayload>("/api/overview"),
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
