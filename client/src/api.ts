export const MARKERS = [
  "health",
  "work",
  "prep",
  "workout",
  "social",
  "stress",
  "study",
] as const;

export type Marker = (typeof MARKERS)[number];

export type MarkerMeta = { id: Marker; label: string };

export type MarkerScore = {
  marker: Marker;
  score: number;
  note?: string;
};

export type HourlyEntry = {
  id: string;
  date: string;
  hour: number;
  markers: MarkerScore[];
  report: string;
  createdAt: string;
  updatedAt: string;
};

export type Settings = {
  sleepStartHour: number;
  sleepEndHour: number;
  timezoneOffsetMinutes: number;
};

export type ClockState = {
  date: string;
  hour: number;
  minute: number;
  inSleepSchedule: boolean;
  sleeping: boolean;
  markedAwake: boolean;
  trackingActive: boolean;
  entryForHour: HourlyEntry | null;
  needsCheckIn: boolean;
};

export type DaySummary = {
  date: string;
  sleepingNow: boolean;
  inSleepSchedule: boolean;
  awakeOverrideHours: number[];
  awakeHours: number[];
  scheduledAwakeHours: number[];
  loggedHours: number[];
  missingHours: number[];
  markerAverages: {
    id: Marker;
    label: string;
    average: number | null;
    samples: number;
  }[];
  reports: { hour: number; report: string; markers: Marker[] }[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data.error === "string"
        ? data.error
        : "Request failed. Check the API server.";
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  markers: () => request<{ markers: MarkerMeta[] }>("/api/markers"),
  settings: () =>
    request<{ settings: Settings; awakeHours: number[] }>("/api/settings"),
  updateSettings: (body: Partial<Settings>) =>
    request<{ settings: Settings; awakeHours: number[] }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  clock: () => request<ClockState>("/api/clock"),
  markAwake: (body?: { date?: string; hour?: number }) =>
    request<{
      date: string;
      hour: number;
      awakeOverrideHours: number[];
      message: string;
    }>("/api/awake", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  saveEntry: (body: {
    date?: string;
    hour?: number;
    markers: MarkerScore[];
    report: string;
  }) =>
    request<{ entry: HourlyEntry }>("/api/entries", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  daySummary: (date: string) =>
    request<DaySummary>(`/api/day-summary?date=${date}`),
};

export function formatHour(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period}`;
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
