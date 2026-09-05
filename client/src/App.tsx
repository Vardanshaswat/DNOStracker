import { useEffect, useMemo, useState } from "react";
import {
  api,
  formatHour,
  hourLabel,
  type ClockState,
  type DaySummary,
  type Marker,
  type MarkerMeta,
  type MarkerScore,
  type Settings,
} from "./api";

const SCORE_LABELS = ["Low", "Soft", "OK", "Strong", "Peak"];

function SleepBanner({
  sleeping,
  settings,
}: {
  sleeping: boolean;
  settings: Settings | null;
}) {
  if (!sleeping || !settings) return null;
  return (
    <div className="animate-rise rounded-2xl border border-moss/15 bg-moss px-5 py-4 text-sand shadow-lg shadow-moss/20">
      <p className="font-display text-xl tracking-tight">Sleep window active</p>
      <p className="mt-1 text-sm text-sand/80">
        Hourly tracking is paused from {hourLabel(settings.sleepStartHour)} to{" "}
        {hourLabel(settings.sleepEndHour)}. Rest now — check-ins resume when
        you wake.
      </p>
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

export default function App() {
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
      const day = await api.daySummary(clockRes.date);
      setSummary(day);

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
    if (!clock || clock.sleeping) return false;
    if (selected.length === 0) return false;
    if (!report.trim()) return false;
    return selected.every((m) => (scores[m] ?? 0) >= 1);
  }, [clock, selected, scores, report]);

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
      setNotice("Sleep window updated.");
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

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:py-12">
      <header className="animate-rise mb-8">
        <p className="text-sm font-semibold tracking-[0.18em] text-leaf uppercase">
          DNOStracker
        </p>
        <h1 className="mt-2 font-display text-4xl leading-tight text-moss sm:text-5xl">
          Hourly habit pulse
        </h1>
        <p className="mt-3 max-w-2xl text-base text-ink/75 sm:text-lg">
          Log a few markers each waking hour — health, work, prep, workout,
          social, stress management, study — and leave a short report. Tracking
          stays off while you sleep.
        </p>
        {clock && (
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-moss px-3 py-1.5 font-semibold text-sand">
              {clock.date} · {formatHour(clock.hour)}
            </span>
            <span
              className={`rounded-full px-3 py-1.5 font-medium ${
                clock.sleeping
                  ? "bg-ink/10 text-ink/70"
                  : clock.needsCheckIn
                    ? "bg-amber/80 text-ink"
                    : "bg-leaf/15 text-leaf"
              }`}
            >
              {clock.sleeping
                ? "Sleeping — tracking paused"
                : clock.needsCheckIn
                  ? "Check-in due this hour"
                  : "This hour already logged"}
            </span>
          </div>
        )}
      </header>

      <div className="mb-6 space-y-3">
        <SleepBanner sleeping={!!clock?.sleeping} settings={settings} />
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
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {markers.map((m) => {
              const on = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!!clock?.sleeping}
                  onClick={() => toggleMarker(m.id)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
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
              disabled={!!clock?.sleeping}
              rows={4}
              maxLength={1000}
              placeholder="What moved the needle this hour? Keep it short — a few markers is enough."
              className="mt-2 w-full resize-y rounded-2xl border border-moss/15 bg-sand/60 px-4 py-3 text-sm outline-none ring-amber/40 placeholder:text-ink/40 focus:ring-2 disabled:opacity-50"
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
              Awake hours vs logged check-ins
            </p>
            <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {(summary?.awakeHours ?? []).map((h) => {
                const logged = summary?.loggedHours.includes(h);
                const current = clock?.hour === h;
                return (
                  <div
                    key={h}
                    title={formatHour(h)}
                    className={`rounded-lg px-1 py-2 text-center text-[10px] font-semibold ${
                      logged
                        ? "bg-amber text-ink"
                        : current
                          ? "bg-sand/25 text-sand"
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
                <li key={m.id} className="flex items-center justify-between gap-3">
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
              No hourly prompts inside this range.
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
              No reports yet. Save your first waking-hour pulse above.
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
