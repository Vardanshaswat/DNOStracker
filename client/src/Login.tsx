import { useState, type FormEvent } from "react";
import { api, type User } from "./api";

type Mode = "login" | "signup";

const fieldClass =
  "mt-1 w-full rounded-xl border border-moss/15 bg-sand/70 px-3 py-2.5 text-sm outline-none ring-amber/40 placeholder:text-ink/40 focus:ring-2";

export default function Login({
  onSignedIn,
}: {
  onSignedIn: (user: User) => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title =
    mode === "signup" ? "Create your account" : "Sign in to your hourly pulse";
  const subtitle =
    mode === "signup"
      ? "Pick a username and password. Your check-ins stay on this account."
      : "Use the username and password you created. New here? Make an account first.";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const res =
        mode === "signup"
          ? await api.signup(username, password)
          : await api.login(username, password);
      onSignedIn(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <section className="animate-rise rounded-[1.75rem] border border-moss/10 bg-white/55 p-6 shadow-sm backdrop-blur-sm sm:p-8">
        <p className="text-sm font-semibold tracking-[0.18em] text-leaf uppercase">
          DNOStracker
        </p>
        <h1 className="mt-2 font-display text-4xl leading-tight text-moss">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink/70">{subtitle}</p>

        <form className="mt-8 space-y-4" onSubmit={(e) => void submit(e)}>
          <label className="block text-sm">
            <span className="font-semibold text-moss">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              minLength={3}
              maxLength={24}
              required
              placeholder="e.g. vardan"
              className={fieldClass}
            />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-moss">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              minLength={8}
              maxLength={128}
              required
              placeholder="At least 8 characters"
              className={fieldClass}
            />
          </label>
          {mode === "signup" && (
            <label className="block text-sm">
              <span className="font-semibold text-moss">Confirm password</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                className={fieldClass}
              />
            </label>
          )}

          {error && (
            <p className="rounded-xl border border-clay/30 bg-clay/10 px-3 py-2 text-sm text-clay">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-amber px-4 py-3 text-sm font-bold text-ink transition hover:brightness-105 disabled:opacity-50"
          >
            {busy
              ? mode === "signup"
                ? "Creating account…"
                : "Signing in…"
              : mode === "signup"
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink/70">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="font-semibold text-leaf underline-offset-2 hover:underline"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button
                type="button"
                className="font-semibold text-leaf underline-offset-2 hover:underline"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
              >
                Create an account
              </button>
            </>
          )}
        </p>
      </section>
    </main>
  );
}
