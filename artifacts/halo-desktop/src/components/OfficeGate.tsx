import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import haloLogo from "../assets/halo-logo.png";

/**
 * OfficeGate — passcode auth for the office app.
 * Lives in the same dark shell as HaloCommand so sign-in
 * feels like part of the product, not a separate screen.
 * Public surfaces (client boards, crew portals, pay/track links) never see it.
 */

type GateState = "loading" | "setup" | "login" | "ok" | "offline" | "forgot" | "forgot-sent" | "reset-form";

export function OfficeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("loading");
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pendingResetToken, setPendingResetToken] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get("reset");
    if (resetToken) {
      const url = new URL(window.location.href);
      url.searchParams.delete("reset");
      window.history.replaceState({}, "", url.toString());
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
        let seen = false;
        try { seen = localStorage.getItem("halo_office_gate_ok") === "1"; } catch {}
        setState(seen ? "ok" : "offline");
      });
    return () => { alive = false; };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (state === "setup" || state === "reset-form") {
      if (passcode.trim().length < 6) { setError("Use at least 6 characters."); return; }
      if (passcode !== confirm) { setError("Passcodes don't match."); return; }
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (res.ok) {
        try { localStorage.setItem("halo_office_gate_ok", "1"); } catch {}
        setState("ok");
      } else if (resBody?.setupRequired) {
        setState("setup"); setError(null);
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
    setError(null); setBusy(true);
    try {
      const res = await fetch("/api/office-auth/forgot", {
        method: "POST", headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setSentTo(body?.sentTo ?? null); setState("forgot-sent"); }
      else { setError(body?.error ?? "Couldn't send the reset email — try again."); setState("login"); }
    } catch {
      setError("Can't reach the server — check your connection."); setState("login");
    } finally { setBusy(false); }
  };

  if (state === "ok") return <>{children}</>;

  // ── Shell wrapper — dark, full-screen, centered ───────────────────────────
  const Shell = ({ children: inner }: { children: ReactNode }) => (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#080D17",
        padding: 24,
      }}
    >
      {inner}
    </div>
  );

  if (state === "loading") {
    return (
      <Shell>
        <Loader2 style={{ width: 20, height: 20, color: "rgba(255,255,255,0.2)", animation: "spin 1s linear infinite" }} />
      </Shell>
    );
  }

  if (state === "offline") {
    return (
      <Shell>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", maxWidth: 280, lineHeight: 1.6, textAlign: "center" }}>
          Can't reach the server.<br />Check your connection and reload.
        </p>
      </Shell>
    );
  }

  if (state === "forgot" || state === "forgot-sent") {
    return (
      <Shell>
        <GateCard logo={haloLogo}>
          <GateHeader
            title={state === "forgot-sent" ? "Check your inbox" : "Reset passcode"}
            subtitle={
              state === "forgot-sent"
                ? sentTo ? `Sent to ${sentTo}` : "Reset link sent"
                : "We'll email you a one-time reset link"
            }
          />
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.3)", lineHeight: 1.65, marginTop: 16 }}>
            {state === "forgot-sent"
              ? "Open the link within 1 hour to set a new passcode. You can close this tab."
              : "The link expires in 1 hour and can only be used once. It'll be sent to the business email on file."}
          </p>
          {error && <ErrorLine text={error} />}
          {state === "forgot" && (
            <div style={{ marginTop: 20 }}>
              <GateButton onClick={sendForgot} busy={busy} label="Send reset link" busyLabel="Sending…" />
            </div>
          )}
          <GateLink onClick={() => { setError(null); setState("login"); }} label="Back to sign in" />
        </GateCard>
      </Shell>
    );
  }

  if (state === "reset-form") {
    return (
      <Shell>
        <GateCard logo={haloLogo}>
          <GateHeader title="Set new passcode" subtitle="Your reset link is valid" />
          <form onSubmit={submit} style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            <GateInput type="password" placeholder="New passcode" value={passcode} onChange={setPasscode}
              autoFocus focused={focused === "p"} onFocus={() => setFocused("p")} onBlur={() => setFocused(null)}
              testId="input-office-passcode" />
            <GateInput type="password" placeholder="Confirm passcode" value={confirm} onChange={setConfirm}
              focused={focused === "c"} onFocus={() => setFocused("c")} onBlur={() => setFocused(null)}
              testId="input-office-passcode-confirm" />
            {error && <ErrorLine text={error} />}
            <div style={{ marginTop: 4 }}>
              <GateButton type="submit" busy={busy} label="Set passcode & enter" busyLabel="One moment…" />
            </div>
          </form>
        </GateCard>
      </Shell>
    );
  }

  // setup / login
  return (
    <Shell>
      <GateCard logo={haloLogo}>
        <GateHeader
          title={state === "setup" ? "Set your passcode" : "Welcome back"}
          subtitle={state === "setup" ? "Protects all office data — one time per device" : "Enter your office passcode"}
        />
        <form onSubmit={submit} style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <GateInput type="password" placeholder="Passcode" value={passcode} onChange={setPasscode}
            autoFocus focused={focused === "p"} onFocus={() => setFocused("p")} onBlur={() => setFocused(null)}
            testId="input-office-passcode" />
          {state === "setup" && (
            <GateInput type="password" placeholder="Confirm passcode" value={confirm} onChange={setConfirm}
              focused={focused === "c"} onFocus={() => setFocused("c")} onBlur={() => setFocused(null)}
              testId="input-office-passcode-confirm" />
          )}
          {error && <ErrorLine text={error} />}
          <div style={{ marginTop: 4 }}>
            <GateButton type="submit" busy={busy}
              label={state === "setup" ? "Set passcode & enter" : "Sign in"}
              busyLabel="One moment…"
              testId="button-office-gate-submit" />
          </div>
        </form>
        {state === "login" && (
          <GateLink onClick={() => { setError(null); setState("forgot"); }} label="Forgot passcode?" testId="button-office-forgot" />
        )}
      </GateCard>
    </Shell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GateCard({ children, logo }: { children: ReactNode; logo: string }) {
  return (
    <div style={{
      width: "100%", maxWidth: 360,
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 22,
      padding: "28px 24px 24px",
    }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
        <img src={logo} alt="HALO" style={{ height: 20, width: "auto", filter: "brightness(0) invert(1)", opacity: 0.45 }} />
      </div>
      {children}
    </div>
  );
}

function GateHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "rgba(255,255,255,0.88)", letterSpacing: "-0.015em", fontFamily: "var(--font-display)", margin: 0 }}>
        {title}
      </h1>
      <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.3)", marginTop: 4, marginBottom: 0 }}>
        {subtitle}
      </p>
    </div>
  );
}

function GateInput({
  type, placeholder, value, onChange, autoFocus, focused, onFocus, onBlur, testId,
}: {
  type: string; placeholder: string; value: string;
  onChange: (v: string) => void; autoFocus?: boolean;
  focused: boolean; onFocus: () => void; onBlur: () => void; testId?: string;
}) {
  return (
    <input
      type={type} inputMode="text" autoFocus={autoFocus}
      value={value} onChange={e => onChange(e.target.value)}
      onFocus={onFocus} onBlur={onBlur}
      placeholder={placeholder} data-testid={testId}
      style={{
        width: "100%", boxSizing: "border-box",
        height: 48, borderRadius: 13, padding: "0 14px",
        fontSize: 14,
        background: focused ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${focused ? "rgba(180,255,68,0.28)" : "rgba(255,255,255,0.08)"}`,
        color: "rgba(255,255,255,0.88)",
        caretColor: "#B4FF44",
        boxShadow: focused ? "0 0 0 3px rgba(180,255,68,0.06)" : "none",
        outline: "none",
        transition: "all 0.15s ease",
      }}
    />
  );
}

function GateButton({
  type = "button", busy, label, busyLabel, onClick, testId,
}: {
  type?: "button" | "submit"; busy: boolean; label: string; busyLabel: string;
  onClick?: () => void; testId?: string;
}) {
  return (
    <button
      type={type} disabled={busy} onClick={onClick} data-testid={testId}
      style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        height: 48, borderRadius: 13, fontSize: 14, fontWeight: 600,
        background: "#B4FF44", color: "#07101E", border: "none", cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.5 : 1, transition: "opacity 0.15s ease",
      }}
    >
      {busy && <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />}
      {busy ? busyLabel : label}
    </button>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p data-testid="text-office-gate-error"
      style={{ fontSize: 11.5, fontWeight: 500, color: "rgba(225,29,72,0.85)", margin: 0, paddingTop: 2 }}>
      {text}
    </p>
  );
}

function GateLink({ onClick, label, testId }: { onClick: () => void; label: string; testId?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      style={{
        width: "100%", marginTop: 12, fontSize: 12, color: "rgba(255,255,255,0.28)",
        background: "none", border: "none", cursor: "pointer", textAlign: "center",
        transition: "color 0.15s ease",
      }}
      onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.52)")}
      onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.28)")}
    >
      {label}
    </button>
  );
}
