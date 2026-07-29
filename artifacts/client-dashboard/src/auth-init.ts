import { setAuthTokenGetter } from '@workspace/api-client-react';

// Setup token getter before React renders
setAuthTokenGetter(() => {
  const path = window.location.pathname;
  const match = path.match(/\/dashboard\/([^/]+)/);
  const token = match ? match[1] : null;
  if (token) {
    return localStorage.getItem(`halo_client_session_${token}`);
  }
  return null;
});
