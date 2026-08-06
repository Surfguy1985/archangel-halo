/**
 * Shared GPS live-trail hook. Extracted so both CrewPortal and CrewPortalFlow
 * can use the same localStorage key and ping loop without duplication.
 *
 * Only one component at a time should mount this hook for a given token —
 * both read/write the same localStorage key so the trail survives tab switches.
 */
import { useState, useEffect } from "react";
import { createPortalTrackPoint } from "@workspace/api-client-react";

export function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

// Local YYYY-MM-DD (never UTC) so the trail resets at the crew's midnight.
export function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type TrackState = { day: string; jobId: string | null };

export function readTrackState(token: string): TrackState | null {
  try {
    const raw = localStorage.getItem(`halo_gps_trail_${token}`);
    if (!raw) return null;
    const s = JSON.parse(raw) as TrackState;
    return s.day === localDay() ? s : null;
  } catch {
    return null;
  }
}

export function useGpsTrail(token: string) {
  const [tracking, setTracking] = useState<TrackState | null>(() => readTrackState(token));

  const stopTrail = () => {
    try { localStorage.removeItem(`halo_gps_trail_${token}`); } catch {}
    setTracking(null);
  };

  const startTrail = (jobId: string | null) => {
    const next: TrackState = { day: localDay(), jobId };
    try { localStorage.setItem(`halo_gps_trail_${token}`, JSON.stringify(next)); } catch {}
    setTracking(next);
  };

  // While checked in, breadcrumb the crew's GPS every 30 seconds so the office
  // and client maps can draw the live trail. Stops on checkout, at midnight,
  // or when the server says we're no longer checked in (409).
  useEffect(() => {
    if (!tracking) return;
    let cancelled = false;
    const stop = () => {
      try { localStorage.removeItem(`halo_gps_trail_${token}`); } catch {}
      setTracking(null);
    };
    const ping = async () => {
      if (cancelled) return;
      if (tracking.day !== localDay()) { stop(); return; }
      const pos = await getPosition();
      if (cancelled || !pos) return;
      try {
        await createPortalTrackPoint(token, {
          jobId: tracking.jobId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        if (status === 409 || status === 404) stop();
        // other errors (offline, flaky signal): keep trying
      }
    };
    void ping();
    const iv = window.setInterval(() => void ping(), 30_000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [token, tracking]); // eslint-disable-line react-hooks/exhaustive-deps

  return { tracking, startTrail, stopTrail };
}
