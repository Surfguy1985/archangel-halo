import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Office passcode management for the Settings page. Talks straight to the
// office-auth endpoints (manual /api URLs must be absolute — never
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
    <div className="rounded-[20px] border border-[var(--hairline)] bg-card p-[16px] mb-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-[10px]">
        <div className="w-[36px] h-[36px] rounded-full grid place-items-center bg-[var(--ink)] shrink-0">
          <KeyRound className="w-[19px] h-[19px] text-[var(--gold-light)]" strokeWidth={2} />
        </div>
        <div className="font-display font-bold text-[15px]">Office passcode</div>
      </div>
      <p className="text-[12.5px] text-muted-foreground mt-[10px] leading-[1.5]">
        The passcode that protects this office app on every device. Changing it
        won't sign out devices that are already in.
      </p>
      <form onSubmit={change} className="mt-[12px] space-y-[8px]">
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current passcode"
          autoComplete="current-password"
          className="w-full rounded-[12px] border border-[var(--hairline)] bg-background px-[12px] py-[10px] text-[14px] outline-none focus:ring-2 focus:ring-[#B4FF44]"
          data-testid="input-current-passcode"
        />
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New passcode (6+ characters)"
          autoComplete="new-password"
          className="w-full rounded-[12px] border border-[var(--hairline)] bg-background px-[12px] py-[10px] text-[14px] outline-none focus:ring-2 focus:ring-[#B4FF44]"
          data-testid="input-new-passcode"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new passcode"
          autoComplete="new-password"
          className="w-full rounded-[12px] border border-[var(--hairline)] bg-background px-[12px] py-[10px] text-[14px] outline-none focus:ring-2 focus:ring-[#B4FF44]"
          data-testid="input-confirm-passcode"
        />
        {error && (
          <div className="text-[12px] font-medium text-red-600" data-testid="text-passcode-error">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !current.trim() || !next.trim() || !confirm.trim()}
          className="w-full flex items-center justify-center gap-[8px] rounded-[12px] bg-[var(--ink)] text-white font-display font-bold text-[14px] py-[12px] transition-transform active:scale-[0.98] disabled:opacity-60"
          data-testid="button-change-passcode"
        >
          {busy ? <Loader2 className="w-[16px] h-[16px] animate-spin" /> : <KeyRound className="w-[16px] h-[16px]" strokeWidth={2} />}
          {busy ? "Changing…" : "Change passcode"}
        </button>
      </form>
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="mt-[10px] w-full flex items-center justify-center gap-[8px] rounded-[12px] border border-[var(--hairline)] text-foreground font-display font-bold text-[14px] py-[12px] transition-transform active:scale-[0.98] disabled:opacity-60"
        data-testid="button-office-sign-out"
      >
        {signingOut ? <Loader2 className="w-[16px] h-[16px] animate-spin" /> : <LogOut className="w-[16px] h-[16px]" strokeWidth={2} />}
        Sign out on this device
      </button>
      <p className="text-[11.5px] text-muted-foreground mt-[8px] leading-[1.5]">
        Forgot the passcode? It can't be recovered. Ask your administrator to
        clear the stored passcode in the database (business settings → office
        passcode) — the app will then ask you to create a new one.
      </p>
    </div>
  );
}
