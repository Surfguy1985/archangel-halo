import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Lock } from 'lucide-react';

// The Walk app has its OWN passcode, separate from the office one, enforced
// server-side (walk routes 401 without a halo_walk_session cookie). This gate
// checks /walk-auth/status on load and shows a lock screen until signed in.
// First-time setup requires the OFFICE passcode as authority.
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
    <div className="flex flex-col items-center justify-center flex-1 p-6 min-h-[70dvh]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="p-4 rounded-2xl bg-primary/10 text-primary">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {status === null ? 'Checking access…' : status.configured ? 'Enter Walk passcode' : 'Set a Walk passcode'}
          </h1>
          {status !== null && !status.configured && (
            <p className="text-sm text-muted-foreground">
              First time here. Enter the office passcode to prove it's you, then choose a separate
              passcode just for the Walk app.
            </p>
          )}
        </div>

        {status === null ? (
          <div className="flex flex-col items-center gap-3">
            {error ? (
              <>
                <p className="text-sm font-semibold text-destructive text-center" data-testid="walk-auth-error">
                  {error}
                </p>
                <Button variant="outline" onClick={loadStatus} data-testid="button-walk-retry">
                  Try again
                </Button>
              </>
            ) : (
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {!status.configured && (
              <input
                type="password"
                inputMode="text"
                autoComplete="off"
                placeholder="Office passcode"
                value={officePasscode}
                onChange={(e) => setOfficePasscode(e.target.value)}
                className="w-full h-14 px-4 rounded-xl border-2 border-border bg-card text-lg font-semibold focus:border-primary focus:outline-none"
                data-testid="input-office-passcode"
              />
            )}
            <input
              type="password"
              inputMode="text"
              autoComplete="off"
              placeholder={status.configured ? 'Walk passcode' : 'New Walk passcode (6+ characters)'}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="w-full h-14 px-4 rounded-xl border-2 border-border bg-card text-lg font-semibold focus:border-primary focus:outline-none"
              data-testid="input-walk-passcode"
              autoFocus
            />
            {error && (
              <p className="text-sm font-semibold text-destructive text-center" data-testid="walk-auth-error">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full h-14 text-lg font-bold rounded-xl"
              disabled={busy || passcode.length < 6 || (!status.configured && officePasscode.length < 6)}
              data-testid="button-walk-unlock"
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : status.configured ? 'Unlock' : 'Set passcode & unlock'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
