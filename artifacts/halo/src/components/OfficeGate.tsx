import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Lock } from "lucide-react";

// Passcode gate for the office app. The API now rejects every office call
// without a signed office-session cookie; this screen mints one. Public
// surfaces (client boards, crew portals, pay/track/share links) never see it.
// Manual /api URLs must be absolute — never BASE_URL-prefixed.

type GateState = "loading" | "setup" | "login" | "ok" | "offline";

export function OfficeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("loading");
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
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
    if (state === "setup") {
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
      const res = await fetch(`/api/office-auth/${state === "setup" ? "setup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: passcode.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        try { localStorage.setItem("halo_office_gate_ok", "1"); } catch {}
        setState("ok");
      } else if (body?.setupRequired) {
        setState("setup");
        setError(null);
      } else {
        setError(body?.error ?? "Something went wrong — try again.");
      }
    } catch {
      setError("Can't reach the server — check your connection.");
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
      </form>
    </div>
  );
}
