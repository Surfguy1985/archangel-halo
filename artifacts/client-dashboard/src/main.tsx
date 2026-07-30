import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

// Aggressive update pickup: check for a new published version on launch,
// whenever the app returns to the foreground, and every 5 minutes while
// open. With skipWaiting/clientsClaim the new version activates instantly
// and the page reloads once, so installed apps never show stale builds.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // New service worker is ready — activate it and reload.
    void updateSW(true);
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => registration.update().catch(() => {});
    setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);