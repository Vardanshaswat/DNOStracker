import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  api,
  formatHour,
  hourLabel,
  type ClockState,
  type DaySummary,
  type Marker,
  type MarkerMeta,
  type MarkerScore,
  type Settings,
  type User,
} from "./api";
import Login from "./Login";

const SCORE_LABELS = ["Low", "Soft", "OK", "Strong", "Peak"];

function SleepBanner({
  clock,
  settings,
  onAwake,
  busy,
}: {
  clock: ClockState;
  settings: Settings | null;
  onAwake: () => void;
  busy: boolean;
}) {
  if (!clock.inSleepSchedule || !settings) return null;

  if (clock.trackingActive) {
    return (
      <div className="animate-rise rounded-2xl border border-leaf/25 bg-leaf/10 px-5 py-4 text-leaf">
        <p className="font-display text-xl tracking-tight text-moss">
          You’re awake during the sleep window
        </p>
        <p className="mt-1 text-sm text-ink/70">
          Usual sleep is {hourLabel(settings.sleepStartHour)}–
          {hourLabel(settings.sleepEndHour)}. This hour is open for tracking.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-rise rounded-2xl border border-moss/15 bg-moss px-5 py-4 text-sand shadow-lg shadow-moss/20">
      <p className="font-display text-xl tracking-tight">Usual sleep window</p>
      <p className="mt-1 text-sm text-sand/80">
        Schedule says {hourLabel(settings.sleepStartHour)}–
        {hourLabel(settings.sleepEndHour)}. If you’re awake, mark it and log —
        nothing is blocked.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onAwake}
        className="mt-3 rounded-xl bg-amber px-4 py-2 text-sm font-bold text-ink disabled:opacity-50"
      >
        I’m awake — track this hour
      </button>
    </div>
  );
}

function ScorePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`h-10 min-w-10 rounded-xl px-3 text-sm font-semibold transition ${
            value === n
              ? "bg-amber text-ink"
              : "bg-white/70 text-ink/70 hover:bg-white"
          }`}
          aria-label={`Score ${n} ${SCORE_LABELS[n - 1]}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function Tracker({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [markers, setMarkers] = useState<MarkerMeta[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clock, setClock] = useState<ClockState | null>(null);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [selected, setSelected] = useState<Marker[]>([]);
  const [scores, setScores] = useState<Partial<Record<Marker, number>>>({});
  const [report, setReport] = useState("");
  const [sleepStart, setSleepStart] = useState(23);
  const [sleepEnd, setSleepEnd] = useState(7);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [markerRes, settingsRes, clockRes] = await Promise.all([
        api.markers(),
        api.settings(),
        api.clock(),
      ]);
      setMarkers(markerRes.markers);
      setSettings(settingsRes.settings);
      setSleepStart(settingsRes.settings.sleepStartHour);
      setSleepEnd(settingsRes.settings.sleepEndHour);
      setClock(clockRes);
      setSummary(await api.daySummary(clockRes.date));

      if (clockRes.entryForHour) {
        const entry = clockRes.entryForHour;
        setSelected(entry.markers.map((m) => m.marker));
        setScores(
          Object.fromEntries(entry.markers.map((m) => [m.marker, m.score])),
        );
        setReport(entry.report);
      } else if (selected.length === 0) {
        setSelected(["health", "work", "stress"]);
        setScores({ health: 3, work: 3, stress: 3 });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onLogout();
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void api.clock().then(setClock).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMarker = (id: Marker) => {
    setSelected((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((m) => m !== id);
        setScores((s) => {
          const copy = { ...s };
          delete copy[id];
          return copy;
        });
        return next;
      }
      setScores((s) => ({ ...s, [id]: s[id] ?? 3 }));
      return [...prev, id];
    });
  };

  const canSubmit = useMemo(() => {
    if (!clock) return false;
    if (selected.length === 0) return false;
    if (!report.trim()) return false;
    return selected.every((m) => (scores[m] ?? 0) >= 1);
  }, [clock, selected, scores, report]);

  const markAwake = async () => {
    if (!clock) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.markAwake({
        date: clock.date,
        hour: clock.hour,
      });
      setNotice(res.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark awake");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!canSubmit || !clock) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: MarkerScore[] = selected.map((marker) => ({
        marker,
        score: scores[marker] ?? 3,
      }));
      await api.saveEntry({
        date: clock.date,
        hour: clock.hour,
        markers: payload,
        report: report.trim(),
      });
      setNotice(`Saved ${formatHour(clock.hour)} pulse.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveSleep = async () => {
    setSaving(true);
    setError(null);
    try {
      const offset = -new Date().getTimezoneOffset();
      const res = await api.updateSettings({
        sleepStartHour: sleepStart,
        sleepEndHour: sleepEnd,
        timezoneOffsetMinutes: offset,
      });
      setSettings(res.settings);
      setNotice("Sleep window updated for today and ahead.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4">
        <p className="animate-pulse-soft font-display text-2xl text-moss">
          Loading your hourly pulse…
        </p>
      </main>
    );
  }

  const statusLabel = !clock
    ? ""
    : clock.needsCheckIn
      ? "Check-in due this hour"
      : clock.entryForHour
        ? "This hour already logged"
        : clock.inSleepSchedule
          ? "Sleep schedule — tap I’m awake to track"
          : "Ready";

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:py-12">
      <header className="animate-rise mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="text-sm font-semibold tracking-[0.18em] text-leaf uppercase">
            DNOStracker
          </p>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-moss text-xs font-bold text-sand">
              {user.username.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-moss">
                {user.username}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="rounded-xl border border-moss/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-moss hover:bg-white"
            >
              Sign out
            </button>
          </div>
        </div>
        <h1 className="mt-2 font-display text-4xl leading-tight text-moss sm:text-5xl">
          Hourly habit pulse
        </h1>
        <p className="mt-3 max-w-2xl text-base text-ink/75 sm:text-lg">
          Log a few markers each hour you’re awake — health, work, prep,
          workout, social, stress management, study — plus a short report. Sleep
          hours are a flexible schedule: adjust anytime, and track if you wake
          early or stay up late.
        </p>
        {clock && (
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-moss px-3 py-1.5 font-semibold text-sand">
              {clock.date} · {formatHour(clock.hour)}
            </span>
            <span
              className={`rounded-full px-3 py-1.5 font-medium ${
                clock.needsCheckIn
                  ? "bg-amber/80 text-ink"
                  : clock.entryForHour
                    ? "bg-leaf/15 text-leaf"
                    : "bg-ink/10 text-ink/70"
              }`}
            >
              {statusLabel}
            </span>
          </div>
        )}
      </header>

      <div className="mb-6 space-y-3">
        {clock && (
          <SleepBanner
            clock={clock}
            settings={settings}
            onAwake={() => void markAwake()}
            busy={saving}
          />
        )}
        {error && (
          <div className="rounded-xl border border-clay/30 bg-clay/10 px-4 py-3 text-sm text-clay">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-leaf/25 bg-leaf/10 px-4 py-3 text-sm text-leaf">
            {notice}
          </div>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
        <section className="animate-rise rounded-[1.75rem] border border-moss/10 bg-white/55 p-5 shadow-sm backdrop-blur-sm sm:p-7">
          <h2 className="font-display text-2xl text-moss">This hour</h2>
          <p className="mt-1 text-sm text-ink/65">
            Pick one or a few markers, score them 1–5, and write a short report.
            You can always save — even inside the sleep schedule.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {markers.map((m) => {
              const on = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMarker(m.id)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    on
                      ? "bg-moss text-sand"
                      : "bg-mist text-moss hover:bg-moss/10"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="mt-6 space-y-5">
            {selected.map((id) => {
              const meta = markers.find((m) => m.id === id);
              return (
                <div key={id} className="border-t border-moss/10 pt-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-semibold text-moss">
                      {meta?.label ?? id}
                    </p>
                    <p className="text-xs tracking-wide text-ink/50 uppercase">
                      {SCORE_LABELS[(scores[id] ?? 3) - 1]}
                    </p>
                  </div>
                  <ScorePicker
                    value={scores[id] ?? 3}
                    onChange={(n) =>
                      setScores((s) => ({
                        ...s,
                        [id]: n,
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>

          <label className="mt-6 block">
            <span className="text-sm font-semibold text-moss">
              Hourly report
            </span>
            <textarea
              value={report}
              onChange={(e) => setReport(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="What moved the needle this hour? Keep it short — a few markers is enough."
              className="mt-2 w-full resize-y rounded-2xl border border-moss/15 bg-sand/60 px-4 py-3 text-sm outline-none ring-amber/40 placeholder:text-ink/40 focus:ring-2"
            />
          </label>

          <button
            type="button"
            disabled={!canSubmit || saving}
            onClick={() => void submit()}
            className="mt-5 w-full rounded-2xl bg-amber px-4 py-3 text-sm font-bold text-ink transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-8"
          >
            {saving
              ? "Saving…"
              : clock?.entryForHour
                ? "Update this hour"
                : "Save hourly pulse"}
          </button>
        </section>

        <aside className="space-y-6">
          <section className="animate-rise rounded-[1.75rem] border border-moss/10 bg-moss p-5 text-sand sm:p-6">
            <h2 className="font-display text-2xl">Today’s rhythm</h2>
            <p className="mt-1 text-sm text-sand/70">
              Scheduled awake hours plus any hours you marked awake today
            </p>
            <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {(summary?.awakeHours ?? []).map((h) => {
                const logged = summary?.loggedHours.includes(h);
                const current = clock?.hour === h;
                const override = summary?.awakeOverrideHours.includes(h);
                return (
                  <div
                    key={h}
                    title={`${formatHour(h)}${override ? " (awake override)" : ""}`}
                    className={`rounded-lg px-1 py-2 text-center text-[10px] font-semibold ${
                      logged
                        ? "bg-amber text-ink"
                        : current
                          ? "bg-sand/25 text-sand"
                          : override
                            ? "bg-leaf/40 text-sand"
                            : "bg-white/10 text-sand/70"
                    }`}
                  >
                    {h}
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-sand/65">
              Missing earlier hours:{" "}
              {summary?.missingHours.length
                ? summary.missingHours.map(formatHour).join(", ")
                : "none"}
            </p>
          </section>

          <section className="animate-rise rounded-[1.75rem] border border-moss/10 bg-white/55 p-5 backdrop-blur-sm sm:p-6">
            <h2 className="font-display text-2xl text-moss">Marker averages</h2>
            <ul className="mt-4 space-y-3">
              {(summary?.markerAverages ?? []).map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-sm font-medium text-ink/80">
                    {m.label}
                  </span>
                  <span className="font-display text-lg text-moss">
                    {m.average == null ? "—" : m.average.toFixed(1)}
                    <span className="ml-1 text-xs font-sans text-ink/40">
                      ({m.samples})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="animate-rise rounded-[1.75rem] border border-moss/10 bg-white/55 p-5 backdrop-blur-sm sm:p-6">
            <h2 className="font-display text-2xl text-moss">Sleep window</h2>
            <p className="mt-1 text-sm text-ink/65">
              Adjust anytime during the day. It guides your rhythm — it never
              blocks a check-in if you’re awake.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="font-semibold text-moss">Sleep starts</span>
                <select
                  value={sleepStart}
                  onChange={(e) => setSleepStart(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-moss/15 bg-sand/70 px-3 py-2"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="font-semibold text-moss">Wake / end</span>
                <select
                  value={sleepEnd}
                  onChange={(e) => setSleepEnd(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-moss/15 bg-sand/70 px-3 py-2"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={() => void saveSleep()}
              disabled={saving}
              className="mt-4 rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-sand disabled:opacity-50"
            >
              Save sleep settings
            </button>
          </section>
        </aside>
      </div>

      <section className="animate-rise mt-8 rounded-[1.75rem] border border-moss/10 bg-white/55 p-5 backdrop-blur-sm sm:p-7">
        <h2 className="font-display text-2xl text-moss">Hourly reports</h2>
        <p className="mt-1 text-sm text-ink/65">
          Short notes attached to today’s check-ins.
        </p>
        <div className="mt-5 space-y-4">
          {(summary?.reports ?? []).length === 0 ? (
            <p className="text-sm text-ink/55">
              No reports yet. Save your first pulse above whenever you’re awake.
            </p>
          ) : (
            [...(summary?.reports ?? [])]
              .sort((a, b) => b.hour - a.hour)
              .map((r) => (
                <article
                  key={r.hour}
                  className="border-t border-moss/10 pt-4 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-moss">
                      {formatHour(r.hour)}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {r.markers.map((m) => (
                        <span
                          key={m}
                          className="rounded-md bg-mist px-2 py-0.5 text-[11px] font-semibold text-leaf"
                        >
                          {markers.find((x) => x.id === m)?.label ?? m}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink/80">
                    {r.report}
                  </p>
                </article>
              ))
          )}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await api.me();
        if (!cancelled) setUser(me.user);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSignedIn = useCallback((next: User) => {
    setUser(next);
  }, []);

  const onLogout = useCallback(() => {
    void api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4">
        <p className="animate-pulse-soft font-display text-2xl text-moss">
          Loading your hourly pulse…
        </p>
      </main>
    );
  }

  if (!user) {
    return <Login onSignedIn={onSignedIn} />;
  }

  return <Tracker user={user} onLogout={onLogout} />;
}
