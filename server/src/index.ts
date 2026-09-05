import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { loadEnv } from "./env.js";
import { rateLimit } from "./rateLimit.js";
import {
  AuthError,
  clearSessionCookie,
  corsOrigin,
  login,
  publicUser,
  requireAuth,
  setSessionCookie,
  signSession,
  signup,
} from "./auth.js";
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
import { MARKERS, MARKER_LABELS, type Marker, type User } from "./types.js";

loadEnv();

const PORT = Number(process.env.PORT ?? 3847);
const IS_PROD = process.env.NODE_ENV === "production";
const here = path.dirname(fileURLToPath(import.meta.url));

if (IS_PROD && !process.env.JWT_SECRET?.trim()) {
  console.error("JWT_SECRET is required in production");
  process.exit(1);
}

function clientDistDir(): string {
  if (process.env.CLIENT_DIST) return path.resolve(process.env.CLIENT_DIST);
  return path.resolve(here, "..", "..", "client", "dist");
}

function serveClient(app: express.Express) {
  const dist = clientDistDir();
  const index = path.join(dist, "index.html");
  if (!existsSync(index)) {
    console.warn(`Client build not found at ${dist} — API-only mode`);
    app.get("/", (_req, res) => {
      res
        .status(503)
        .type("html")
        .send(
          "<!doctype html><p>DNOStracker UI is missing from this deploy. Check that the client built into <code>client/dist</code>.</p>",
        );
    });
    return;
  }
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(index);
  });
}

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });

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

const credentialsSchema = z.object({
  username: z.string().min(1).max(24),
  password: z.string().min(1).max(128),
});

function currentUser(req: express.Request): User {
  const user = req.user;
  if (!user) throw new Error("Sign in required");
  return user;
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "dnostracker-api" });
});

app.post("/api/auth/signup", authLimit, async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  try {
    const user = await signup(parsed.data.username, parsed.data.password);
    setSessionCookie(res, signSession(user));
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Could not create account" });
  }
});

app.post("/api/auth/login", authLimit, async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  try {
    const user = await login(parsed.data.username, parsed.data.password);
    setSessionCookie(res, signSession(user));
    res.json({ user: publicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Could not sign in" });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(currentUser(req)) });
});

app.get("/api/markers", requireAuth, (_req, res) => {
  res.json({
    markers: MARKERS.map((id) => ({ id, label: MARKER_LABELS[id] })),
  });
});

app.get("/api/settings", requireAuth, async (req, res) => {
  const settings = await getSettings(currentUser(req).id);
  const awake = scheduledAwakeHours(settings);
  res.json({ settings, scheduledAwakeHours: awake, awakeHours: awake });
});

app.put("/api/settings", requireAuth, async (req, res) => {
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
  const settings = await updateSettings(currentUser(req).id, patch);
  const awake = scheduledAwakeHours(settings);
  res.json({ settings, scheduledAwakeHours: awake, awakeHours: awake });
});

app.get("/api/clock", requireAuth, async (req, res) => {
  const userId = currentUser(req).id;
  const settings = await getSettings(userId);
  const clock = localClock(settings);
  const overrides = await getAwakeHoursForDate(userId, clock.date);
  const existing = await getEntry(userId, clock.date, clock.hour);
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

app.post("/api/awake", requireAuth, async (req, res) => {
  const parsed = awakeBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const userId = currentUser(req).id;
  const settings = await getSettings(userId);
  const clock = localClock(settings);
  const date = parsed.data.date ?? clock.date;
  const hour = parsed.data.hour ?? clock.hour;
  const hours = await markAwake(userId, date, hour);
  res.json({
    date,
    hour,
    awakeOverrideHours: hours,
    message: `Marked ${String(hour).padStart(2, "0")}:00 as awake — tracking allowed.`,
  });
});

app.get("/api/entries", requireAuth, async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  res.json({ entries: await listEntries(currentUser(req).id, date) });
});

app.get("/api/entries/:date/:hour", requireAuth, async (req, res) => {
  const date = req.params.date;
  const hour = Number(req.params.hour);
  if (typeof date !== "string") {
    res.status(400).json({ error: "Invalid date" });
    return;
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    res.status(400).json({ error: "Invalid hour" });
    return;
  }
  const entry = await getEntry(currentUser(req).id, date, hour);
  if (!entry) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.json({ entry });
});

app.post("/api/entries", requireAuth, async (req, res) => {
  const parsed = entryBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const userId = currentUser(req).id;
  const settings = await getSettings(userId);
  const clock = localClock(settings);
  const date = parsed.data.date ?? clock.date;
  const hour = parsed.data.hour ?? clock.hour;

  const uniqueMarkers = new Set(parsed.data.markers.map((m) => m.marker));
  if (uniqueMarkers.size !== parsed.data.markers.length) {
    res.status(400).json({ error: "Duplicate markers in one hourly entry" });
    return;
  }

  if (isInSleepSchedule(hour, settings)) {
    await markAwake(userId, date, hour);
  }

  const now = new Date().toISOString();
  const existing = await getEntry(userId, date, hour);
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
    userId,
    date,
    hour,
    markers,
    report: parsed.data.report,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  res.status(existing ? 200 : 201).json({ entry });
});

app.get("/api/day-summary", requireAuth, async (req, res) => {
  const userId = currentUser(req).id;
  const settings = await getSettings(userId);
  const clock = localClock(settings);
  const date =
    typeof req.query.date === "string" ? req.query.date : clock.date;
  const entries = await listEntries(userId, date);
  const overrides = await getAwakeHoursForDate(userId, date);
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

if (IS_PROD) {
  serveClient(app);
}

app.listen(PORT, "0.0.0.0", () => {
  const mode = IS_PROD ? "production" : "development";
  console.log(`DNOStracker listening on http://127.0.0.1:${PORT} (${mode})`);
});
