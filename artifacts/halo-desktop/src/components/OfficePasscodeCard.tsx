import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Office passcode management for the desktop Admin page. Talks straight to
// the office-auth endpoints (manual /api URLs must be absolute — never
// BASE_URL-prefixed). Changing the passcode requires the current one even
// while signed in; signing out clears the session cookie + the offline flag
// so the OfficeGate shows again.

export function OfficePasscodeCard() {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const change = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.trim().length < 6) {
      setError("New passcode must be at least 6 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New passcodes don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/office-auth/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: current.trim(), next: next.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setCurrent("");
        setNext("");
        setConfirm("");
        toast({
          title: "Passcode changed",
          description: "Devices already signed in stay signed in.",
        });
      } else {
        setError(body?.error ?? "Something went wrong — try again.");
      }
    } catch {
      setError("Can't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/office-auth/logout", { method: "POST" });
    } catch {
      /* clearing local state below still signs this device out on reload */
    }
    try {
      localStorage.removeItem("halo_office_gate_ok");
    } catch {}
    window.location.reload();
  };

  return (
    <div className="bg-card rounded-2xl p-6 border border-[var(--hairline,transparent)] shadow-sm max-w-xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--ink)] text-[var(--primary)] flex items-center justify-center shrink-0">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-display font-bold text-base">Office passcode</h2>
          <p className="text-muted-foreground text-sm font-medium">
            Protects the office apps on every device
          </p>
        </div>
      </div>
      <form onSubmit={change} className="mt-4 space-y-2">
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current passcode"
          autoComplete="current-password"
          className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#B4FF44]"
          data-testid="input-current-passcode"
        />
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New passcode (6+ characters)"
          autoComplete="new-password"
          className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#B4FF44]"
          data-testid="input-new-passcode"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new passcode"
          autoComplete="new-password"
          className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#B4FF44]"
          data-testid="input-confirm-passcode"
        />
        {error && (
          <div className="text-xs font-medium text-red-600" data-testid="text-passcode-error">
            {error}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={busy || !current.trim() || !next.trim() || !confirm.trim()}
            className="flex items-center gap-2 rounded-xl bg-[var(--ink)] text-white font-display font-bold text-sm px-4 py-2.5 disabled:opacity-60"
            data-testid="button-change-passcode"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {busy ? "Changing…" : "Change passcode"}
          </button>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="flex items-center gap-2 rounded-xl border font-display font-bold text-sm px-4 py-2.5 disabled:opacity-60"
            data-testid="button-office-sign-out"
          >
            {signingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            Sign out on this device
          </button>
        </div>
      </form>
      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
        Forgot the passcode? It can't be recovered. Ask your administrator to
        clear the stored passcode in the database (business settings → office
        passcode) — the app will then ask you to create a new one.
      </p>
    </div>
  );
}
