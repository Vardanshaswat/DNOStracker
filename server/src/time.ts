import type { Settings } from "./types.js";

export function nowInOffset(offsetMinutes: number): Date {
  const utc = Date.now() + new Date().getTimezoneOffset() * 60_000;
  return new Date(utc + offsetMinutes * 60_000);
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Sleep window can wrap midnight. Sleeping if hour in [start, 24) U [0, end). */
export function isSleeping(hour: number, settings: Settings): boolean {
  const { sleepStartHour, sleepEndHour } = settings;
  if (sleepStartHour === sleepEndHour) return false;
  if (sleepStartHour < sleepEndHour) {
    return hour >= sleepStartHour && hour < sleepEndHour;
  }
  return hour >= sleepStartHour || hour < sleepEndHour;
}

export function awakeHours(settings: Settings): number[] {
  return Array.from({ length: 24 }, (_, h) => h).filter(
    (h) => !isSleeping(h, settings),
  );
}

export function localClock(settings: Settings): {
  date: string;
  hour: number;
  minute: number;
  sleeping: boolean;
} {
  const d = nowInOffset(settings.timezoneOffsetMinutes);
  const hour = d.getHours();
  return {
    date: formatDate(d),
    hour,
    minute: d.getMinutes(),
    sleeping: isSleeping(hour, settings),
  };
}
