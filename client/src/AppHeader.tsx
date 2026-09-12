import type { User } from "./api";

export type AppView = "log" | "insights";

export default function AppHeader({
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
  const tab =
    "rounded-xl px-3 py-1.5 text-xs font-semibold transition";
  const on = "bg-moss text-sand";
  const off = "bg-white/70 text-moss hover:bg-white";

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <p className="text-sm font-semibold tracking-[0.18em] text-leaf uppercase">
        DNOStracker
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex rounded-2xl border border-moss/15 bg-white/50 p-1">
          <button
            type="button"
            onClick={() => onView("log")}
            className={`${tab} ${view === "log" ? on : off}`}
          >
            Log
          </button>
          <button
            type="button"
            onClick={() => onView("insights")}
            className={`${tab} ${view === "insights" ? on : off}`}
          >
            Insights
          </button>
        </nav>
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
  );
}
