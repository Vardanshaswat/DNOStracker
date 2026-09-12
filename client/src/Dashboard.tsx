import { useEffect, useMemo, useState } from "react";
import AppHeader, { type AppView } from "./AppHeader";
import {
  ApiError,
  api,
  formatHour,
  type Insights,
  type User,
} from "./api";

const PRESETS = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
] as const;

function addUtcDays(ymd: string, delta: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + delta));
  return date.toISOString().slice(0, 10);
}

function shortDay(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function hourTint(average: number | null, samples: number): string {
  if (samples === 0 || average == null) {
    return "bg-white/10 text-sand/45";
  }
  if (average < 2) return "bg-sand/25 text-sand";
  if (average < 3) return "bg-leaf/35 text-sand";
  if (average < 4) return "bg-amber/70 text-ink";
  return "bg-amber text-ink";
}

export default function Dashboard({
  user,
  view,
  onView,
  onLogout,
}: {
  user: User;
  view: AppView;
  onView: (view: AppView) => void;
  onLogout: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [activePreset, setActivePreset] = useState<number | null>(7);
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyRange = async (nextFrom: string, nextTo: string, preset: number | null) => {
    setFrom(nextFrom);
    setTo(nextTo);
    setActivePreset(preset);
    setError(null);
    setLoading(true);
    try {
      setData(await api.insights(nextFrom, nextTo));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onLogout();
        return;
      }
      setError(e instanceof Error ? e.message : "Could not load insights");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const clock = await api.clock();
        if (cancelled) return;
        const nextTo = clock.date;
        const nextFrom = addUtcDays(nextTo, -6);
        setFrom(nextFrom);
        setTo(nextTo);
        setActivePreset(7);
        const insights = await api.insights(nextFrom, nextTo);
        if (cancelled) return;
        setData(insights);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          onLogout();
          return;
        }
        setError(e instanceof Error ? e.message : "Could not load insights");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxHours = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.byDay.map((d) => d.hoursLogged));
  }, [data]);

  const reportsByDate = useMemo(() => {
    if (!data) return [];
    const groups: { date: string; items: Insights["reports"] }[] = [];
    for (const report of data.reports) {
      const last = groups[groups.length - 1];
      if (last && last.date === report.date) {
        last.items.push(report);
      } else {
        groups.push({ date: report.date, items: [report] });
      }
    }
    return groups;
  }, [data]);

  const markerLabel = (id: string) =>
    data?.markers.find((m) => m.id === id)?.label ?? id;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:py-12">
      <header className="animate-rise mb-8">
        <AppHeader
          user={user}
          view={view}
          onView={onView}
          onLogout={onLogout}
        />
        <h1 className="mt-2 font-display text-4xl leading-tight text-moss sm:text-5xl">
          Insights
        </h1>
        <p className="mt-3 max-w-2xl text-base text-ink/75 sm:text-lg">
          Averages, coverage, and reports for the days you pick. Scores stay
          blank when nothing was logged.
        </p>
      </header>

      <section className="animate-rise mb-6 rounded-[1.75rem] border border-moss/10 bg-white/55 p-5 backdrop-blur-sm sm:p-6">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              onClick={() => {
                if (!to) return;
                void applyRange(addUtcDays(to, -(preset.days - 1)), to, preset.days);
              }}
              disabled={!to || loading}
              className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                activePreset === preset.days
                  ? "bg-moss text-sand"
                  : "bg-mist text-moss hover:bg-moss/10"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm">
            <span className="font-semibold text-moss">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setActivePreset(null);
              }}
              className="mt-1 w-full rounded-xl border border-moss/15 bg-sand/70 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-moss">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setActivePreset(null);
              }}
              className="mt-1 w-full rounded-xl border border-moss/15 bg-sand/70 px-3 py-2"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={!from || !to || loading}
              onClick={() => void applyRange(from, to, null)}
              className="w-full rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-sand disabled:opacity-50 sm:w-auto"
            >
              Apply
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-6 rounded-xl border border-clay/30 bg-clay/10 px-4 py-3 text-sm text-clay">
          {error}
        </div>
      )}

      {loading && !data ? (
        <p className="animate-pulse-soft font-display text-2xl text-moss">
          Loading insights…
        </p>
      ) : data ? (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            {[
              ["Days", String(data.headline.daysInRange)],
              ["Hours logged", String(data.headline.hoursLogged)],
              ["Days with logs", String(data.headline.daysWithLogs)],
              ["Day coverage", `${data.headline.coveragePercent}%`],
            ].map(([label, value]) => (
              <div
                key={label}
                className="animate-rise rounded-2xl border border-moss/10 bg-moss px-4 py-4 text-sand"
              >
                <p className="text-xs tracking-wide text-sand/65 uppercase">
                  {label}
                </p>
                <p className="mt-1 font-display text-3xl">{value}</p>
              </div>
            ))}
          </div>

          {data.headline.hoursLogged === 0 && (
            <p className="mb-6 text-sm text-ink/55">
              No check-ins in this range.
            </p>
          )}

          <section className="animate-rise mb-6 rounded-[1.75rem] border border-moss/10 bg-white/55 p-5 backdrop-blur-sm sm:p-6">
            <h2 className="font-display text-2xl text-moss">Marker averages</h2>
            <p className="mt-1 text-sm text-ink/65">
              Mean of 1–5 scores in this range. Dash means no samples.
            </p>
            <ul className="mt-4 space-y-3">
              {data.markers.map((m) => (
                <li key={m.id}>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-ink/80">
                      {m.label}
                    </span>
                    <span className="font-display text-lg text-moss">
                      {m.average == null ? "—" : m.average.toFixed(1)}
                      <span className="ml-1 text-xs font-sans text-ink/40">
                        ({m.samples})
                      </span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-mist">
                    <div
                      className="h-full rounded-full bg-amber"
                      style={{
                        width:
                          m.average == null
                            ? "0%"
                            : `${(m.average / 5) * 100}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="animate-rise mb-6 rounded-[1.75rem] border border-moss/10 bg-moss p-5 text-sand sm:p-6">
            <h2 className="font-display text-2xl">Daily activity</h2>
            <p className="mt-1 text-sm text-sand/70">
              Bar height is hours logged. Hover a day for the average score.
            </p>
            <div className="mt-5 flex h-36 items-end gap-1 overflow-x-auto pb-1">
              {data.byDay.map((day) => {
                const height = (day.hoursLogged / maxHours) * 100;
                const title =
                  day.averageScore == null
                    ? `${day.date}: ${day.hoursLogged} hours`
                    : `${day.date}: ${day.hoursLogged} hours, avg ${day.averageScore}`;
                return (
                  <div
                    key={day.date}
                    title={title}
                    className="flex min-w-6 flex-1 flex-col items-center justify-end"
                  >
                    <div
                      className={`w-full max-w-8 rounded-t-md ${
                        day.hoursLogged === 0 ? "bg-white/15" : "bg-amber"
                      }`}
                      style={{
                        height: day.hoursLogged === 0 ? "4px" : `${height}%`,
                      }}
                    />
                    <span className="mt-1 hidden text-[9px] text-sand/60 sm:block">
                      {shortDay(day.date).replace(" ", "\n")}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="animate-rise mb-6 rounded-[1.75rem] border border-moss/10 bg-moss p-5 text-sand sm:p-6">
            <h2 className="font-display text-2xl">Hour of day</h2>
            <p className="mt-1 text-sm text-sand/70">
              Average marker score at each clock hour across the range.
            </p>
            <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {data.byHour.map((cell) => (
                <div
                  key={cell.hour}
                  title={
                    cell.averageScore == null
                      ? `${formatHour(cell.hour)}: no logs`
                      : `${formatHour(cell.hour)}: avg ${cell.averageScore} (${cell.samples})`
                  }
                  className={`rounded-lg px-1 py-2 text-center text-[10px] font-semibold ${hourTint(
                    cell.averageScore,
                    cell.samples,
                  )}`}
                >
                  {cell.hour}
                </div>
              ))}
            </div>
          </section>

          <section className="animate-rise rounded-[1.75rem] border border-moss/10 bg-white/55 p-5 backdrop-blur-sm sm:p-7">
            <h2 className="font-display text-2xl text-moss">Reports</h2>
            <p className="mt-1 text-sm text-ink/65">
              Newest first, up to 100 notes in this range.
            </p>
            <div className="mt-5 space-y-8">
              {reportsByDate.length === 0 ? (
                <p className="text-sm text-ink/55">
                  No reports in this range.
                </p>
              ) : (
                reportsByDate.map((group) => (
                  <div key={group.date}>
                    <h3 className="text-sm font-semibold tracking-wide text-leaf uppercase">
                      {group.date}
                    </h3>
                    <div className="mt-3 space-y-4">
                      {group.items.map((r) => (
                        <article
                          key={`${r.date}-${r.hour}`}
                          className="border-t border-moss/10 pt-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-moss">
                              {formatHour(r.hour)}
                            </h4>
                            <div className="flex flex-wrap gap-1.5">
                              {r.markers.map((m) => (
                                <span
                                  key={m}
                                  className="rounded-md bg-mist px-2 py-0.5 text-[11px] font-semibold text-leaf"
                                >
                                  {markerLabel(m)}
                                </span>
                              ))}
                            </div>
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-ink/80">
                            {r.report}
                          </p>
                        </article>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
