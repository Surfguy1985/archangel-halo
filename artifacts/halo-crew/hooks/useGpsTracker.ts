/**
 * GPS tracker with foreground watch + background location task.
 *
 * Background tracking (via expo-task-manager + expo-location) works in
 * standalone builds.  In Expo Go the background task silently no-ops, but
 * the foreground watch + 30-second server ping still function normally.
 *
 * Token is stored in AsyncStorage so the background task can read it
 * without React context.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const BUFFER_KEY = 'halo_gps_buffer';
const TOKEN_KEY = 'halo_crew_token'; // same key used by AuthContext
const SEND_INTERVAL_MS = 30_000;
const MAX_BUFFER = 200;
export const BG_LOCATION_TASK = 'halo-crew-bg-location';

type BufferedPoint = { lat: number; lng: number; ts: string };

// ─── Background task ────────────────────────────────────────────────────────
// Must be defined at module scope (before any component mounts).
// TaskManager APIs are not available on web — guard every call.
if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(BG_LOCATION_TASK)) {
  TaskManager.defineTask(
    BG_LOCATION_TASK,
    async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
      if (error) return;
      const locations = (data as any)?.locations as Location.LocationObject[] | undefined;
      if (!locations?.length) return;

      const loc = locations[locations.length - 1];
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;

      try {
        const token = await AsyncStorage.getItem(TOKEN_KEY);
        if (!token) return;

        // Try live send first
        const domain = process.env.EXPO_PUBLIC_DOMAIN;
        if (domain) {
          try {
            const resp = await fetch(
              `https://${domain}/api/portal/${token}/track-points`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat, lng }),
              },
            );
            if (resp.ok) return; // sent successfully
          } catch {
            // fall through to buffer
          }
        }

        // Buffer for foreground flush
        const raw = await AsyncStorage.getItem(BUFFER_KEY);
        const buf: BufferedPoint[] = raw ? JSON.parse(raw) : [];
        buf.push({ lat, lng, ts: new Date(loc.timestamp).toISOString() });
        if (buf.length > MAX_BUFFER) buf.splice(0, buf.length - MAX_BUFFER);
        await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(buf));
      } catch {
        // ignore storage errors in background task
      }
    },
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
async function sendPoint(token: string, lat: number, lng: number): Promise<boolean> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return false;
  try {
    const resp = await fetch(`https://${domain}/api/portal/${token}/track-points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function flushBuffer(token: string) {
  try {
    const raw = await AsyncStorage.getItem(BUFFER_KEY);
    if (!raw) return;
    const buf: BufferedPoint[] = JSON.parse(raw);
    if (!buf.length) return;

    const remaining: BufferedPoint[] = [];
    for (const pt of buf) {
      const ok = await sendPoint(token, pt.lat, pt.lng);
      if (!ok) {
        remaining.push(...buf.slice(buf.indexOf(pt)));
        break;
      }
    }
    await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(remaining));
  } catch {
    // ignore flush errors
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────
export type GpsState = {
  active: boolean;
  hasPermission: boolean;
  hasBackgroundPermission: boolean;
  coords: { lat: number; lng: number } | null;
  requestPermission: () => Promise<boolean>;
};

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useGpsTracker(token: string | null, tracking: boolean): GpsState {
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCoords = useRef<{ lat: number; lng: number } | null>(null);

  const [hasPermission, setHasPermission] = useState(false);
  const [hasBackgroundPermission, setHasBackgroundPermission] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Check permissions on mount
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      setHasPermission(status === 'granted');
    });
    // Background permission (no-op in Expo Go)
    if (Platform.OS !== 'web') {
      Location.getBackgroundPermissionsAsync().then(({ status }) => {
        setHasBackgroundPermission(status === 'granted');
      });
    }
  }, []);

  const requestPermission = useCallback(async () => {
    // Step 1: foreground
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    const fgGranted = fg === 'granted';
    setHasPermission(fgGranted);
    if (!fgGranted) return false;

    // Step 2: background (best-effort — no-ops in Expo Go)
    if (Platform.OS !== 'web') {
      try {
        const { status: bg } = await Location.requestBackgroundPermissionsAsync();
        setHasBackgroundPermission(bg === 'granted');
      } catch {
        // Expo Go: background API unsupported — that's fine
      }
    }

    return true;
  }, []);

  // Helper: unconditionally stop the background task if it is registered.
  // Safe to call regardless of which instance or restart cycle started it.
  function stopBgTask() {
    if (Platform.OS === 'web') return;
    TaskManager.isTaskRegisteredAsync(BG_LOCATION_TASK)
      .then((registered) => {
        if (registered) {
          Location.stopLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => {});
        }
      })
      .catch(() => {});
  }

  // Start / stop tracking when `tracking` or `token` changes
  useEffect(() => {
    if (!tracking || !token || !hasPermission) {
      // Stop foreground watch
      watchRef.current?.remove();
      watchRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;

      // Always stop background task — covers both the normal checkout path
      // and the startup case where the OS task survived a process restart.
      stopBgTask();
      return;
    }

    let mounted = true;

    async function start() {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted' || !mounted) return;

      // ── Foreground watch (live UI updates + 30s send) ──────────────────
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 10,
        },
        (loc) => {
          const pt = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          lastCoords.current = pt;
          if (mounted) setCoords(pt);
        },
      );

      // 30-second send interval
      intervalRef.current = setInterval(() => {
        if (lastCoords.current && token) {
          const { lat, lng } = lastCoords.current;
          sendPoint(token, lat, lng).then((ok) => {
            if (!ok && token) flushBuffer(token);
          });
        }
      }, SEND_INTERVAL_MS);

      // Flush any offline buffer immediately
      if (token) flushBuffer(token);

      // ── Background task (standalone builds only) ───────────────────────
      // startLocationUpdatesAsync is idempotent if already registered.
      if (Platform.OS !== 'web' && hasBackgroundPermission) {
        try {
          await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: SEND_INTERVAL_MS,
            distanceInterval: 50,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: 'HALO Crew',
              notificationBody: 'Tracking your location while on the job',
              notificationColor: '#B4FF44',
            },
            pausesUpdatesAutomatically: false,
          });
        } catch {
          // Expo Go: startLocationUpdatesAsync throws — foreground-only is fine
        }
      }
    }

    start();

    return () => {
      mounted = false;
      // Stop foreground watch
      watchRef.current?.remove();
      watchRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      // Stop background task on unmount (checkout, navigate away, or component teardown)
      stopBgTask();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, token, hasPermission, hasBackgroundPermission]);

  return {
    active: tracking && hasPermission,
    hasPermission,
    hasBackgroundPermission,
    coords,
    requestPermission,
  };
}
