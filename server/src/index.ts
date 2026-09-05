import cors from "cors";
import express from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import {
  getAwakeHoursForDate,
  getEntry,
  getSettings,
  listEntries,
  markAwake,
  updateSettings,
  upsertEntry,
} from "./store.js";
import {
  isInSleepSchedule,
  localClock,
  scheduledAwakeHours,
  trackableHours,
} from "./time.js";
import { MARKERS, MARKER_LABELS, type Marker } from "./types.js";

const PORT = Number(process.env.PORT ?? 3847);

const markerSchema = z.object({
  marker: z.enum(MARKERS),
  score: z.number().int().min(1).max(5),
  note: z.string().max(280).optional(),
});

const entryBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  markers: z.array(markerSchema).min(1).max(MARKERS.length),
  report: z.string().trim().min(1).max(1000),
});

const settingsSchema = z.object({
  sleepStartHour: z.number().int().min(0).max(23).optional(),
  sleepEndHour: z.number().int().min(0).max(23).optional(),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional(),
});

const awakeBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hour: z.number().int().min(0).max(23).optional(),
});

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "dnostracker-api" });
});

app.get("/api/markers", (_req, res) => {
  res.json({
    markers: MARKERS.map((id) => ({ id, label: MARKER_LABELS[id] })),
  });
});

app.get("/api/settings", async (_req, res) => {
  const settings = await getSettings();
  const awake = scheduledAwakeHours(settings);
  res.json({ settings, scheduledAwakeHours: awake, awakeHours: awake });
});

app.put("/api/settings", async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const patch: Partial<{
    sleepStartHour: number;
    sleepEndHour: number;
    timezoneOffsetMinutes: number;
  }> = {};
  if (parsed.data.sleepStartHour !== undefined) {
    patch.sleepStartHour = parsed.data.sleepStartHour;
  }
  if (parsed.data.sleepEndHour !== undefined) {
    patch.sleepEndHour = parsed.data.sleepEndHour;
  }
  if (parsed.data.timezoneOffsetMinutes !== undefined) {
    patch.timezoneOffsetMinutes = parsed.data.timezoneOffsetMinutes;
  }
  const settings = await updateSettings(patch);
  const awake = scheduledAwakeHours(settings);
  res.json({ settings, scheduledAwakeHours: awake, awakeHours: awake });
});

app.get("/api/clock", async (_req, res) => {
  const settings = await getSettings();
  const clock = localClock(settings);
  const overrides = await getAwakeHoursForDate(clock.date);
  const existing = await getEntry(clock.date, clock.hour);
  const markedAwake = overrides.includes(clock.hour);
  const trackingActive =
    !clock.inSleepSchedule || markedAwake || !!existing;

  res.json({
    date: clock.date,
    hour: clock.hour,
    minute: clock.minute,
    inSleepSchedule: clock.inSleepSchedule,
    sleeping: clock.inSleepSchedule && !markedAwake && !existing,
    markedAwake,
    trackingActive,
    entryForHour: existing ?? null,
    needsCheckIn: trackingActive && !existing,
  });
});

app.post("/api/awake", async (req, res) => {
  const parsed = awakeBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const settings = await getSettings();
  const clock = localClock(settings);
  const date = parsed.data.date ?? clock.date;
  const hour = parsed.data.hour ?? clock.hour;
  const hours = await markAwake(date, hour);
  res.json({
    date,
    hour,
    awakeOverrideHours: hours,
    message: `Marked ${String(hour).padStart(2, "0")}:00 as awake — tracking allowed.`,
  });
});

app.get("/api/entries", async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  res.json({ entries: await listEntries(date) });
});

app.get("/api/entries/:date/:hour", async (req, res) => {
  const hour = Number(req.params.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    res.status(400).json({ error: "Invalid hour" });
    return;
  }
  const entry = await getEntry(req.params.date, hour);
  if (!entry) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.json({ entry });
});

app.post("/api/entries", async (req, res) => {
  const parsed = entryBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const settings = await getSettings();
  const clock = localClock(settings);
  const date = parsed.data.date ?? clock.date;
  const hour = parsed.data.hour ?? clock.hour;

  const uniqueMarkers = new Set(parsed.data.markers.map((m) => m.marker));
  if (uniqueMarkers.size !== parsed.data.markers.length) {
    res.status(400).json({ error: "Duplicate markers in one hourly entry" });
    return;
  }

  if (isInSleepSchedule(hour, settings)) {
    await markAwake(date, hour);
  }

  const now = new Date().toISOString();
  const existing = await getEntry(date, hour);
  const markers = parsed.data.markers.map((m) => {
    const item: { marker: Marker; score: number; note?: string } = {
      marker: m.marker,
      score: m.score,
    };
    if (m.note !== undefined) item.note = m.note;
    return item;
  });
  const entry = await upsertEntry({
    id: existing?.id ?? uuid(),
    date,
    hour,
    markers,
    report: parsed.data.report,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  res.status(existing ? 200 : 201).json({ entry });
});

app.get("/api/day-summary", async (req, res) => {
  const settings = await getSettings();
  const clock = localClock(settings);
  const date =
    typeof req.query.date === "string" ? req.query.date : clock.date;
  const entries = await listEntries(date);
  const overrides = await getAwakeHoursForDate(date);
  const loggedHours = entries.map((e) => e.hour);
  const awake = trackableHours(settings, overrides, loggedHours);
  const markedAwakeNow =
    clock.date === date &&
    (overrides.includes(clock.hour) || loggedHours.includes(clock.hour));

  const averages: Partial<Record<Marker, { total: number; count: number }>> =
    {};
  for (const entry of entries) {
    for (const m of entry.markers) {
      const bucket = averages[m.marker] ?? { total: 0, count: 0 };
      bucket.total += m.score;
      bucket.count += 1;
      averages[m.marker] = bucket;
    }
  }

  res.json({
    date,
    sleepingNow:
      clock.date === date && clock.inSleepSchedule && !markedAwakeNow,
    inSleepSchedule: clock.date === date ? clock.inSleepSchedule : false,
    awakeOverrideHours: overrides,
    awakeHours: awake,
    scheduledAwakeHours: scheduledAwakeHours(settings),
    loggedHours,
    missingHours: awake.filter(
      (h) =>
        !entries.some((e) => e.hour === h) &&
        (date < clock.date || (date === clock.date && h <= clock.hour)),
    ),
    markerAverages: MARKERS.map((id) => {
      const bucket = averages[id];
      return {
        id,
        label: MARKER_LABELS[id],
        average: bucket
          ? Number((bucket.total / bucket.count).toFixed(2))
          : null,
        samples: bucket?.count ?? 0,
      };
    }),
    reports: entries.map((e) => ({
      hour: e.hour,
      report: e.report,
      markers: e.markers.map((m) => m.marker),
    })),
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DNOStracker API listening on http://127.0.0.1:${PORT}`);
});
