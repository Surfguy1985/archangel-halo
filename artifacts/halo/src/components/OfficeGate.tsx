import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Lock } from "lucide-react";

// Passcode gate for the office app. The API now rejects every office call
// without a signed office-session cookie; this screen mints one. Public
// surfaces (client boards, crew portals, pay/track/share links) never see it.
// Manual /api URLs must be absolute — never BASE_URL-prefixed.

type GateState = "loading" | "setup" | "login" | "ok" | "offline" | "forgot" | "forgot-sent" | "reset-form";

export function OfficeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("loading");
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Held during the reset-form state so the token can be submitted with the new passcode.
  const [pendingResetToken, setPendingResetToken] = useState<string | null>(null);

  useEffect(() => {
    // Check for a reset token in the URL first.
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get("reset");
    if (resetToken) {
      // Remove the token from the URL immediately so a copy-paste or refresh
      // doesn't accidentally resubmit it.
      const url = new URL(window.location.href);
      url.searchParams.delete("reset");
      window.history.replaceState({}, "", url.toString());
      // Show the inline "set new passcode" form — the token is submitted
      // together with the new passcode so there is no gap for /setup hijack.
      setPendingResetToken(resetToken);
      setState("reset-form");
      return;
    }

    let alive = true;
    fetch("/api/office-auth/status")
      .then((r) => r.json())
      .then((s) => {
        if (!alive) return;
        if (s.authenticated) setState("ok");
        else if (!s.configured) setState("setup");
        else setState("login");
      })
      .catch(() => {
        if (!alive) return;
        // Offline (PWA) fallback: if this device signed in before, let the app
        // boot — every API call still carries the cookie and the server is the
        // real gate. Never-signed-in devices stay blocked.
        let seen = false;
        try { seen = localStorage.getItem("halo_office_gate_ok") === "1"; } catch {}
        setState(seen ? "ok" : "offline");
      });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (state === "setup" || state === "reset-form") {
      if (passcode.trim().length < 6) {
        setError("Use at least 6 characters.");
        return;
      }
      if (passcode !== confirm) {
        setError("Passcodes don't match.");
        return;
      }
    }
    setBusy(true);
    try {
      let endpoint: string;
      let body: Record<string, string>;
      if (state === "reset-form") {
        endpoint = "/api/office-auth/reset";
        body = { token: pendingResetToken ?? "", passcode: passcode.trim() };
      } else {
        endpoint = `/api/office-auth/${state === "setup" ? "setup" : "login"}`;
        body = { passcode: passcode.trim() };
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (res.ok) {
        try { localStorage.setItem("halo_office_gate_ok", "1"); } catch {}
        setState("ok");
      } else if (resBody?.setupRequired) {
        setState("setup");
        setError(null);
      } else {
        setError(resBody?.error ?? "Something went wrong — try again.");
      }
    } catch {
      setError("Can't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const sendForgot = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/office-auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setSentTo(body?.sentTo ?? null);
        setState("forgot-sent");
      } else {
        setError(body?.error ?? "Couldn't send the reset email — try again.");
        setState("login");
      }
    } catch {
      setError("Can't reach the server — check your connection.");
      setState("login");
    } finally {
      setBusy(false);
    }
  };

  if (state === "ok") return <>{children}</>;

  if (state === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state === "offline") {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="text-center text-sm text-muted-foreground">
          Can't reach the server. Check your connection and reload.
        </div>
      </div>
    );
  }

  if (state === "reset-form") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">HALO Office</div>
              <div className="text-xs text-muted-foreground">Set a new passcode</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
            Your reset link is valid. Enter a new passcode below — you'll be signed in immediately.
          </p>
          <input
            type="password"
            inputMode="text"
            autoFocus
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="New passcode"
            className="mt-4 w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#B4FF44]"
            data-testid="input-office-passcode"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new passcode"
            className="mt-2 w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#B4FF44]"
            data-testid="input-office-passcode-confirm"
          />
          {error && (
            <div className="mt-2 text-xs font-medium text-red-600" data-testid="text-office-gate-error">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-[#B4FF44] py-2.5 text-sm font-bold text-black disabled:opacity-60"
            data-testid="button-office-gate-submit"
          >
            {busy ? "One moment…" : "Set passcode & sign in"}
          </button>
        </form>
      </div>
    );
  }

  if (state === "forgot" || state === "forgot-sent") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">HALO Office</div>
              <div className="text-xs text-muted-foreground">
                {state === "forgot-sent" ? "Reset link sent" : "Forgot passcode?"}
              </div>
            </div>
          </div>
          {state === "forgot-sent" ? (
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              A reset link was sent to{" "}
              <strong className="text-foreground">{sentTo ?? "your business email"}</strong>.
              Open it within 1 hour to set a new passcode.
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              We'll send a one-time reset link to the business email on file. The link
              expires in 1 hour and can only be used once.
            </p>
          )}
          {error && (
            <div className="mt-2 text-xs font-medium text-red-600">{error}</div>
          )}
          {state === "forgot" && (
            <button
              type="button"
              disabled={busy}
              onClick={sendForgot}
              className="mt-4 w-full rounded-xl bg-[#B4FF44] py-2.5 text-sm font-bold text-black disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>
          )}
          <button
            type="button"
            onClick={() => { setError(null); setState("login"); }}
            className="mt-3 w-full rounded-xl border py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background">
            <Lock className="h-4 w-4" />
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">HALO Office</div>
            <div className="text-xs text-muted-foreground">
              {state === "setup" ? "Create your office passcode" : "Enter your office passcode"}
            </div>
          </div>
        </div>
        {state === "setup" && (
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
            This passcode protects all office data. You'll enter it once per device.
            Client boards, crew portals, and pay links are not affected.
          </p>
        )}
        <input
          type="password"
          inputMode="text"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Passcode"
          className="mt-4 w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#B4FF44]"
          data-testid="input-office-passcode"
        />
        {state === "setup" && (
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm passcode"
            className="mt-2 w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#B4FF44]"
            data-testid="input-office-passcode-confirm"
          />
        )}
        {error && (
          <div className="mt-2 text-xs font-medium text-red-600" data-testid="text-office-gate-error">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-xl bg-[#B4FF44] py-2.5 text-sm font-bold text-black disabled:opacity-60"
          data-testid="button-office-gate-submit"
        >
          {busy ? "One moment…" : state === "setup" ? "Set passcode & enter" : "Sign in"}
        </button>
        {state === "login" && (
          <button
            type="button"
            onClick={() => { setError(null); setState("forgot"); }}
            className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            data-testid="button-office-forgot"
          >
            Forgot passcode?
          </button>
        )}
      </form>
    </div>
  );
}
