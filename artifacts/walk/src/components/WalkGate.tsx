import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, LockKeyhole } from 'lucide-react';

const API = '/api/walk-auth';

type Status = { configured: boolean; authenticated: boolean };

export default function WalkGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [passcode, setPasscode] = useState('');
  const [officePasscode, setOfficePasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = () => {
    setError(null);
    fetch(`${API}/status`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setError('Could not reach the server — check your connection.'));
  };
  useEffect(loadStatus, []);

  if (status?.authenticated) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!status || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = status.configured
        ? await fetch(`${API}/login`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passcode }),
          })
        : await fetch(`${API}/setup`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passcode, officePasscode }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Sign-in failed');
        return;
      }
      setStatus({ configured: true, authenticated: true });
    } catch {
      setError('Could not reach the server — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 bg-background overflow-hidden">
      <div className="w-full max-w-sm space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-2">
            <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-float">
              <LockKeyhole className="w-6 h-6 text-primary-foreground stroke-[2.5]" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            {status === null ? 'Connecting...' : status.configured ? 'Welcome Back' : 'Setup Walk'}
          </h1>
          {status !== null && !status.configured && (
            <p className="text-base text-muted-foreground max-w-[280px]">
              Enter the office passcode to verify, then choose a PIN for the Walk app.
            </p>
          )}
          {status !== null && status.configured && (
            <p className="text-base text-muted-foreground max-w-[280px]">
              Enter your passcode to unlock the app and continue.
            </p>
          )}
        </div>

        {status === null ? (
          <div className="flex flex-col items-center gap-4 h-32 justify-center">
            {error ? (
              <>
                <p className="text-sm font-semibold text-destructive text-center" data-testid="walk-auth-error">
                  {error}
                </p>
                <Button variant="outline" className="rounded-full font-bold px-8" onClick={loadStatus} data-testid="button-walk-retry">
                  Try again
                </Button>
              </>
            ) : (
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5 bg-card p-6 rounded-3xl shadow-subtle border border-black/[0.03]">
            {!status.configured && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider pl-2">Office Passcode</label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="••••••"
                  value={officePasscode}
                  onChange={(e) => setOfficePasscode(e.target.value)}
                  className="w-full h-14 px-5 rounded-2xl border-0 bg-muted text-xl font-bold tracking-widest text-center focus:ring-2 focus:ring-primary focus:outline-none transition-all placeholder:text-muted-foreground/50 placeholder:font-normal"
                  data-testid="input-office-passcode"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider pl-2">
                {status.configured ? 'Walk Passcode' : 'New Passcode'}
              </label>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="••••••"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full h-14 px-5 rounded-2xl border-0 bg-muted text-xl font-bold tracking-widest text-center focus:ring-2 focus:ring-primary focus:outline-none transition-all placeholder:text-muted-foreground/50 placeholder:font-normal"
                data-testid="input-walk-passcode"
                autoFocus
              />
            </div>
            
            {error && (
              <p className="text-sm font-semibold text-destructive text-center bg-destructive/10 py-2 rounded-xl" data-testid="walk-auth-error">
                {error}
              </p>
            )}
            
            <Button
              type="submit"
              className="w-full h-14 text-lg font-bold rounded-2xl shadow-float hover:-translate-y-0.5 transition-transform"
              disabled={busy || passcode.length < 6 || (!status.configured && officePasscode.length < 6)}
              data-testid="button-walk-unlock"
            >
              {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : status.configured ? 'Unlock App' : 'Set & Unlock'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
