import cors from "cors";
import express from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import {
  getEntry,
  getSettings,
  listEntries,
  updateSettings,
  upsertEntry,
} from "./store.js";
import { awakeHours, isSleeping, localClock } from "./time.js";
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
  res.json({
    settings,
    awakeHours: awakeHours(settings),
  });
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
  res.json({ settings, awakeHours: awakeHours(settings) });
});

app.get("/api/clock", async (_req, res) => {
  const settings = await getSettings();
  const clock = localClock(settings);
  const existing = await getEntry(clock.date, clock.hour);
  res.json({
    ...clock,
    trackingActive: !clock.sleeping,
    entryForHour: existing ?? null,
    needsCheckIn: !clock.sleeping && !existing,
  });
});

app.get("/api/entries", async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  const entries = await listEntries(date);
  res.json({ entries });
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

  if (isSleeping(hour, settings)) {
    res.status(400).json({
      error:
        "This hour falls inside your sleep window. Tracking is paused while you sleep.",
      sleepStartHour: settings.sleepStartHour,
      sleepEndHour: settings.sleepEndHour,
    });
    return;
  }

  const uniqueMarkers = new Set(parsed.data.markers.map((m) => m.marker));
  if (uniqueMarkers.size !== parsed.data.markers.length) {
    res.status(400).json({ error: "Duplicate markers in one hourly entry" });
    return;
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
  const awake = awakeHours(settings);

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
    sleepingNow: clock.date === date ? clock.sleeping : false,
    awakeHours: awake,
    loggedHours: entries.map((e) => e.hour),
    missingHours: awake.filter(
      (h) =>
        !entries.some((e) => e.hour === h) &&
        (date < clock.date || (date === clock.date && h < clock.hour)),
    ),
    markerAverages: MARKERS.map((id) => {
      const bucket = averages[id];
      return {
        id,
        label: MARKER_LABELS[id],
        average: bucket ? Number((bucket.total / bucket.count).toFixed(2)) : null,
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
