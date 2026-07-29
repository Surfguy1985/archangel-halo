import { setAuthTokenGetter } from '@workspace/api-client-react';

// Setup token getter before React renders
setAuthTokenGetter(() => {
  const path = window.location.pathname;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const match = path.startsWith(base) ? path.slice(base.length).match(/^\/([^/]+)/) : null;
  const token = match ? match[1] : null;
  if (token) {
    return localStorage.getItem(`halo_client_session_${token}`);
  }
  return null;
});
