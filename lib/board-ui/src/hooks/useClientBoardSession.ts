import { useEffect } from "react";

/**
 * One-time token→cookie session exchange. Client APIs are in strict mode:
 * mutating requests need the httpOnly session cookie.
 */
export function useClientBoardSession(token: string | undefined) {
  useEffect(() => {
    if (!token) return;
    fetch(`/api/client/${token}/session`, { method: "POST", credentials: "include" }).catch(() => {});
  }, [token]);
}
