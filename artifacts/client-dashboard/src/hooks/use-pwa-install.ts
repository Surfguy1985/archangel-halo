import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = window.navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
}

/**
 * PWA install state for the client board.
 * - Chrome/Edge fire `beforeinstallprompt`; we stash it and trigger it from the button.
 * - iOS/Safari never fire it, so we surface manual instructions instead.
 * - Once running standalone (installed), the button hides entirely.
 */
export function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!promptEvent) return 'unavailable';
    // The event is single-use in Chromium: clear it regardless of outcome.
    // The browser fires a fresh beforeinstallprompt later if install is still possible.
    setPromptEvent(null);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  };

  return {
    /** True when the app is already running as an installed app. */
    installed,
    /** True when the browser can show a native install prompt right now. */
    canPrompt: promptEvent !== null,
    /** True on iOS/Safari where install is manual (Share → Add to Home Screen / Dock). */
    needsManualInstall: !installed && promptEvent === null && isIos(),
    promptInstall,
  };
}
