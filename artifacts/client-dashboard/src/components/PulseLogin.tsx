import React, { useState } from 'react';
import { useClientBoardLogin } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey, getGetClientBoardMapQueryKey, getGetUnitMapQueryKey, getGetClientPortfolioPulseQueryKey } from '@workspace/api-client-react';

export function pulseErrorStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err && 'status' in err) {
    const n = Number((err as { status: number }).status);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function pulseErrorBody(err: unknown): { needsLogin?: boolean; propertyName?: string } {
  if (typeof err === 'object' && err && 'data' in err) {
    const data = (err as { data?: { needsLogin?: boolean; propertyName?: string } }).data;
    return data ?? {};
  }
  return {};
}

interface PulseLoginProps {
  token: string;
  propertyName?: string;
  onSuccess?: () => void;
}

export function PulseLogin({ token, propertyName, onSuccess }: PulseLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const login = useClientBoardLogin();
  const queryClient = useQueryClient();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    login.mutate(
      { token, data: { email, password } },
      {
        onSuccess: (res) => {
          localStorage.setItem(`halo_client_session_${token}`, res.sessionToken);
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientBoardMapQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetUnitMapQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPortfolioPulseQueryKey(token) });
          onSuccess?.();
        },
        onError: (err: unknown) => {
          const data = pulseErrorBody(err);
          setError((data as { error?: string }).error || (err as { message?: string }).message || 'Invalid credentials');
        },
      },
    );
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#fafafa] px-6" data-testid="pulse-login">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-[400px] rounded-[24px] border border-black/[0.06] bg-white p-8"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6e6e73]">Pulse</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-[#1d1d1f]">
          {propertyName || 'Sign in'}
        </h1>
        <p className="mt-2 text-[15px] text-[#6e6e73]">
          Day-to-day operations for this community. Sign in to see the live board, map, and units.
        </p>
        <label className="mt-6 block text-[13px] font-medium text-[#1d1d1f]">
          Email
          <input
            data-testid="input-pulse-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            className="mt-1.5 h-11 w-full rounded-[10px] border border-black/[0.08] bg-[#f5f5f7] px-3 text-[15px] outline-none focus:border-[#007AFF]"
          />
        </label>
        <label className="mt-4 block text-[13px] font-medium text-[#1d1d1f]">
          Password
          <input
            data-testid="input-pulse-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="mt-1.5 h-11 w-full rounded-[10px] border border-black/[0.08] bg-[#f5f5f7] px-3 text-[15px] outline-none focus:border-[#007AFF]"
          />
        </label>
        {error ? (
          <p className="mt-3 text-[13px] text-[#FF3B30]" data-testid="pulse-login-error">
            {error}
          </p>
        ) : null}
        <button
          data-testid="button-pulse-login"
          type="submit"
          disabled={login.isPending}
          className="mt-6 h-12 w-full rounded-[12px] bg-[#1d1d1f] text-[15px] font-semibold text-white disabled:opacity-50"
        >
          {login.isPending ? 'Signing in…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
