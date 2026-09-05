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

/** Usual sleep schedule — advisory only, can be overridden when awake. */
export function isInSleepSchedule(hour: number, settings: Settings): boolean {
  const { sleepStartHour, sleepEndHour } = settings;
  if (sleepStartHour === sleepEndHour) return false;
  if (sleepStartHour < sleepEndHour) {
    return hour >= sleepStartHour && hour < sleepEndHour;
  }
  return hour >= sleepStartHour || hour < sleepEndHour;
}

export function scheduledAwakeHours(settings: Settings): number[] {
  return Array.from({ length: 24 }, (_, h) => h).filter(
    (h) => !isInSleepSchedule(h, settings),
  );
}

/** Hours to track today: schedule + same-day awake overrides + already logged hours. */
export function trackableHours(
  settings: Settings,
  overrideHours: number[],
  loggedHours: number[] = [],
): number[] {
  const set = new Set([
    ...scheduledAwakeHours(settings),
    ...overrideHours,
    ...loggedHours,
  ]);
  return [...set].sort((a, b) => a - b);
}

export function localClock(settings: Settings): {
  date: string;
  hour: number;
  minute: number;
  inSleepSchedule: boolean;
} {
  const d = nowInOffset(settings.timezoneOffsetMinutes);
  const hour = d.getHours();
  return {
    date: formatDate(d),
    hour,
    minute: d.getMinutes(),
    inSleepSchedule: isInSleepSchedule(hour, settings),
  };
}
