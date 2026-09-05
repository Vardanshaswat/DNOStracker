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

export const MARKER_LABELS: Record<Marker, string> = {
  health: "Health",
  work: "Work",
  prep: "Prep",
  workout: "Workout",
  social: "Social",
  stress: "Stress management",
  study: "Study",
};

export type MarkerScore = {
  marker: Marker;
  score: number; // 1-5
  note?: string | undefined;
};

export type HourlyEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  markers: MarkerScore[];
  report: string;
  createdAt: string;
  updatedAt: string;
};

export type Settings = {
  sleepStartHour: number; // inclusive, e.g. 23 = 11pm
  sleepEndHour: number; // exclusive awake starts, e.g. 7 = 7am
  timezoneOffsetMinutes: number;
};

/** Per-day hours marked awake even if they fall in the usual sleep window. */
export type AwakeOverrides = Record<string, number[]>;

export type Store = {
  settings: Settings;
  entries: HourlyEntry[];
  awakeOverrides: AwakeOverrides;
};

export const DEFAULT_SETTINGS: Settings = {
  sleepStartHour: 23,
  sleepEndHour: 7,
  timezoneOffsetMinutes: 330, // IST default for Vardan
};
