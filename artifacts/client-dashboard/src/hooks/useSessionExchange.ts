import { useEffect } from 'react';

/**
 * One-time token→cookie session exchange. Every client-facing page must call
 * this on load: the API is in strict mode, so mutating requests (approve,
 * pay, work requests, hub edits) require the httpOnly session cookie — the
 * raw URL token is no longer honored for state changes.
 *
 * Manual /api URLs must be absolute — never BASE_URL-prefixed.
 */
export function useSessionExchange(token: string | undefined) {
  useEffect(() => {
    if (!token) return;
    fetch(`/api/client/${token}/session`, { method: 'POST', credentials: 'include' }).catch(() => {});
  }, [token]);
}
