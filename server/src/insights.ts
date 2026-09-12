import { MARKERS, MARKER_LABELS, type HourlyEntry, type Marker } from "./types.js";

export const MAX_INSIGHT_DAYS = 90;
export const MAX_INSIGHT_REPORTS = 100;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export type InsightsPayload = {
  from: string;
  to: string;
  headline: {
    daysInRange: number;
    hoursLogged: number;
    daysWithLogs: number;
    coveragePercent: number;
  };
  markers: {
    id: Marker;
    label: string;
    average: number | null;
    samples: number;
  }[];
  byDay: {
    date: string;
    hoursLogged: number;
    averageScore: number | null;
  }[];
  byHour: {
    hour: number;
    averageScore: number | null;
    samples: number;
  }[];
  reports: {
    date: string;
    hour: number;
    report: string;
    markers: Marker[];
  }[];
};

function utcFromYmd(value: string): Date | null {
  const match = YMD.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysInclusive(from: string, to: string): number {
  const start = utcFromYmd(from);
  const end = utcFromYmd(to);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function eachDate(from: string, to: string): string[] {
  const start = utcFromYmd(from);
  const end = utcFromYmd(to);
  if (!start || !end) return [];
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(formatUtc(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function mean(total: number, count: number): number | null {
  if (count === 0) return null;
  return Number((total / count).toFixed(2));
}

export function parseInsightsRange(
  fromRaw: unknown,
  toRaw: unknown,
): { error: string } | { from: string; to: string } {
  if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
    return { error: "from and to dates are required (YYYY-MM-DD)" };
  }
  if (!utcFromYmd(fromRaw) || !utcFromYmd(toRaw)) {
    return { error: "Dates must be valid YYYY-MM-DD values" };
  }
  if (fromRaw > toRaw) {
    return { error: "from must be on or before to" };
  }
  if (daysInclusive(fromRaw, toRaw) > MAX_INSIGHT_DAYS) {
    return { error: `Range cannot exceed ${MAX_INSIGHT_DAYS} days` };
  }
  return { from: fromRaw, to: toRaw };
}

export function buildInsights(
  from: string,
  to: string,
  entries: HourlyEntry[],
): InsightsPayload {
  const dates = eachDate(from, to);
  const daysInRange = dates.length;
  const byDate = new Map<string, HourlyEntry[]>();
  for (const date of dates) byDate.set(date, []);
  for (const entry of entries) {
    const bucket = byDate.get(entry.date);
    if (bucket) bucket.push(entry);
  }

  const markerTotals: Record<Marker, { total: number; count: number }> =
    Object.fromEntries(
      MARKERS.map((id) => [id, { total: 0, count: 0 }]),
    ) as Record<Marker, { total: number; count: number }>;

  const hourTotals = Array.from({ length: 24 }, () => ({
    total: 0,
    count: 0,
  }));

  const byDay = dates.map((date) => {
    const dayEntries = byDate.get(date) ?? [];
    let scoreTotal = 0;
    let scoreCount = 0;
    for (const entry of dayEntries) {
      for (const item of entry.markers) {
        markerTotals[item.marker].total += item.score;
        markerTotals[item.marker].count += 1;
        scoreTotal += item.score;
        scoreCount += 1;
        const hourBucket = hourTotals[entry.hour];
        if (hourBucket) {
          hourBucket.total += item.score;
          hourBucket.count += 1;
        }
      }
    }
    return {
      date,
      hoursLogged: dayEntries.length,
      averageScore: mean(scoreTotal, scoreCount),
    };
  });

  const hoursLogged = entries.length;
  const daysWithLogs = byDay.filter((d) => d.hoursLogged > 0).length;
  // Share of calendar days in the range that have at least one check-in.
  // Not hours vs scheduled awake time — that depends on the sleep window.
  const coveragePercent =
    daysInRange === 0
      ? 0
      : Number(((daysWithLogs / daysInRange) * 100).toFixed(1));

  const reports = [...entries]
    .sort((a, b) =>
      a.date === b.date ? b.hour - a.hour : b.date.localeCompare(a.date),
    )
    .slice(0, MAX_INSIGHT_REPORTS)
    .map((e) => ({
      date: e.date,
      hour: e.hour,
      report: e.report,
      markers: e.markers.map((m) => m.marker),
    }));

  return {
    from,
    to,
    headline: {
      daysInRange,
      hoursLogged,
      daysWithLogs,
      coveragePercent,
    },
    markers: MARKERS.map((id) => {
      const bucket = markerTotals[id];
      return {
        id,
        label: MARKER_LABELS[id],
        average: mean(bucket.total, bucket.count),
        samples: bucket.count,
      };
    }),
    byDay,
    byHour: hourTotals.map((bucket, hour) => ({
      hour,
      averageScore: mean(bucket.total, bucket.count),
      samples: bucket.count,
    })),
    reports,
  };
}
