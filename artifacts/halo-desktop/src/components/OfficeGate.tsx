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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      {/* Ambient brand light — soft lime from above, navy from below. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(640px 380px at 50% -8%, rgba(180,255,68,0.16), transparent 65%), radial-gradient(720px 420px at 50% 112%, rgba(10,25,48,0.10), transparent 62%)",
        }}
      />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-3xl border border-[var(--hairline)] bg-card p-7 shadow-[var(--shadow-lift)]"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--secondary)] text-[var(--primary)] shadow-[0_4px_16px_-2px_rgba(10,25,48,0.35)]">
            <Lock className="h-4 w-4" />
          </div>
          <div>
            <div className="font-display text-lg font-bold tracking-tight">HALO Office</div>
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
          className="mt-5 w-full rounded-xl border border-[var(--hairline)] bg-background px-3.5 py-2.5 text-sm outline-none transition-shadow focus:border-[#9DB40F] focus:shadow-[0_0_0_4px_rgba(180,255,68,0.25)]"
          data-testid="input-office-passcode"
        />
        {state === "setup" && (
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm passcode"
            className="mt-2 w-full rounded-xl border border-[var(--hairline)] bg-background px-3.5 py-2.5 text-sm outline-none transition-shadow focus:border-[#9DB40F] focus:shadow-[0_0_0_4px_rgba(180,255,68,0.25)]"
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
          className="mt-5 w-full rounded-xl bg-[#B4FF44] py-2.5 font-display text-sm font-bold text-black transition-all duration-200 hover:-translate-y-px hover:bg-[#A3E63D] hover:shadow-[0_6px_20px_-4px_rgba(180,255,68,0.6)] disabled:opacity-60"
          data-testid="button-office-gate-submit"
        >
          {busy ? "One moment…" : state === "setup" ? "Set passcode & enter" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
