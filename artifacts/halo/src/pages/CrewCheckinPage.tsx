/**
 * CrewCheckinPage — the entire crew UX.
 *
 * A crew member taps a link from iMessage. This page loads.
 * They see their name, today's property/unit assignment (from Base44 dispatch).
 * One tap: Check In. GPS captured. Done.
 * Later: one tap: Check Out. Done.
 *
 * No login. No navigation. No app install.
 */

import { useState, useEffect } from "react";
import { MapPin, CheckCircle2, LogOut, AlertCircle, Loader2, Wifi } from "lucide-react";

interface CheckinData {
  crew: { id: string; name: string };
  todayAssignment: {
    propertyName: string | null;
    unitLabel: string | null;
    jobDescription: string | null;
  } | null;
  currentStatus: "out" | "in"; // whether crew is currently checked in
  lastCheckin?: string; // ISO timestamp
}

type PageState = "loading" | "ready" | "requesting_gps" | "submitting" | "success" | "error" | "expired";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { ...opts, credentials: "same-origin" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? String(res.status)), { status: res.status });
  return json;
}

function getGPS(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location not supported on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12_000,
      maximumAge: 30_000,
    });
  });
}

export default function CrewCheckinPage({ token }: { token: string }) {
  const [state, setState] = useState<PageState>("loading");
  const [data, setData] = useState<CheckinData | null>(null);
  const [gpsEnabled, setGpsEnabled] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [checkedIn, setCheckedIn] = useState(false);

  // Load crew info
  useEffect(() => {
    apiFetch(`/api/checkin/${token}`)
      .then((d) => {
        setData(d);
        setCheckedIn(d.currentStatus === "in");
        setState("ready");
        // Pre-check GPS permission
        navigator.permissions?.query({ name: "geolocation" }).then((r) => {
          setGpsEnabled(r.state === "granted");
        }).catch(() => {});
      })
      .catch((err) => {
        setState(err.status === 410 || err.status === 404 ? "expired" : "error");
        setErrorMsg(err.message ?? "This link is not valid.");
      });
  }, [token]);

  const handleAction = async () => {
    setState("requesting_gps");
    let position: GeolocationPosition | null = null;

    try {
      position = await getGPS();
      setGpsEnabled(true);
    } catch (err: any) {
      setGpsEnabled(false);
      // Allow submission without GPS if denied — server handles gracefully
    }

    setState("submitting");
    const action = checkedIn ? "checkout" : "checkin";

    try {
      const result = await apiFetch(`/api/checkin/${token}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: position?.coords.latitude ?? null,
          lng: position?.coords.longitude ?? null,
          accuracy: position?.coords.accuracy ?? null,
        }),
      });

      setSuccessMsg(
        checkedIn
          ? `Checked out at ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Have a great rest of your day!`
          : `Checked in at ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Have a productive shift!`
      );
      setCheckedIn(!checkedIn);
      setState("success");
    } catch (err: any) {
      setErrorMsg(err.message ?? "Something went wrong. Try again.");
      setState("error");
    }
  };

  const greetingName = data?.crew.name.split(" ")[0] ?? "Hi";
  const property = data?.todayAssignment?.propertyName;
  const unit = data?.todayAssignment?.unitLabel;
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#060C18] px-6"
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
    >
      {/* Loading */}
      {state === "loading" && (
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-[#B4FF44] animate-spin" />
          <span className="text-white/40 text-[14px]">Loading…</span>
        </div>
      )}

      {/* Expired / invalid */}
      {(state === "expired" || (state === "error" && !data)) && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-[#E11D48]/10 border border-[#E11D48]/20 grid place-items-center">
            <AlertCircle className="w-8 h-8 text-[#E11D48]" />
          </div>
          <div>
            <p className="text-white/80 text-[18px] font-semibold mb-1">Link not valid</p>
            <p className="text-white/35 text-[13px] max-w-[280px] leading-relaxed">
              {state === "expired"
                ? "This check-in link has expired or been revoked. Ask the office for a new one."
                : errorMsg}
            </p>
          </div>
        </div>
      )}

      {/* Ready state */}
      {(state === "ready" || state === "requesting_gps" || state === "submitting") && data && (
        <div className="w-full max-w-sm flex flex-col items-center text-center gap-0">
          {/* HALO wordmark */}
          <div className="text-[11px] font-bold tracking-[0.3em] uppercase text-white/20 mb-10">HALO</div>

          {/* Greeting */}
          <div className="mb-8">
            <p className="text-[42px] font-bold text-white leading-none tracking-tight mb-1">
              Hi, {greetingName}.
            </p>
            <p className="text-[15px] text-white/35 font-medium">{dateStr} · {timeStr}</p>
          </div>

          {/* Assignment */}
          {data.todayAssignment && (
            <div className="w-full bg-white/[0.04] border border-white/[0.07] rounded-[16px] px-4 py-4 mb-8">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-3.5 h-3.5 text-[#B4FF44]/60 shrink-0" />
                <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/30">Today's Assignment</span>
              </div>
              <p className="text-[17px] font-semibold text-white/85 leading-snug">
                {property}{unit ? ` — Unit ${unit}` : ""}
              </p>
              {data.todayAssignment.jobDescription && (
                <p className="text-[12.5px] text-white/40 mt-1">{data.todayAssignment.jobDescription}</p>
              )}
            </div>
          )}
          {!data.todayAssignment && (
            <div className="w-full bg-white/[0.03] border border-white/[0.06] rounded-[16px] px-4 py-3 mb-8">
              <p className="text-[13px] text-white/35">No assignment found in dispatch for today — the office will update you.</p>
            </div>
          )}

          {/* GPS status */}
          {gpsEnabled === false && state !== "submitting" && (
            <div className="flex items-center gap-2 bg-[#F59E0B]/8 border border-[#F59E0B]/18 rounded-[10px] px-3 py-2 mb-5 w-full">
              <AlertCircle className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
              <span className="text-[11.5px] text-[#F59E0B]/80">Enable location so the map can show where you are</span>
            </div>
          )}
          {gpsEnabled === true && (
            <div className="flex items-center gap-2 mb-5 w-full">
              <Wifi className="w-3.5 h-3.5 text-[#22C55E]/60" />
              <span className="text-[11.5px] text-white/30">Location active</span>
            </div>
          )}

          {/* Big action button */}
          <button
            onClick={handleAction}
            disabled={state === "submitting" || state === "requesting_gps"}
            className="w-full h-[72px] rounded-[20px] flex items-center justify-center gap-3 text-[19px] font-bold transition-all active:scale-[0.96] disabled:opacity-70 shadow-2xl"
            style={{
              background: checkedIn ? "#E11D48" : "#B4FF44",
              color: checkedIn ? "#ffffff" : "#07101E",
              boxShadow: checkedIn
                ? "0 8px 40px rgba(225,29,72,0.35)"
                : "0 8px 40px rgba(180,255,68,0.35)",
            }}
          >
            {state === "submitting" || state === "requesting_gps" ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : checkedIn ? (
              <><LogOut className="w-5 h-5" /> Check Out</>
            ) : (
              <><CheckCircle2 className="w-5 h-5" /> Check In</>
            )}
          </button>

          <p className="text-[11px] text-white/20 mt-4">
            {checkedIn ? "Tap to record your departure" : "Tap to record your arrival"}
          </p>
        </div>
      )}

      {/* Success */}
      {state === "success" && (
        <div className="flex flex-col items-center gap-6 text-center">
          <div
            className="w-20 h-20 rounded-full grid place-items-center border-2"
            style={{
              background: checkedIn ? "rgba(225,29,72,0.08)" : "rgba(34,197,94,0.08)",
              borderColor: checkedIn ? "rgba(225,29,72,0.25)" : "rgba(34,197,94,0.25)",
            }}
          >
            <CheckCircle2 className="w-9 h-9" style={{ color: checkedIn ? "#E11D48" : "#22C55E" }} />
          </div>
          <div>
            <p className="text-[22px] font-bold text-white leading-tight mb-2">
              {checkedIn ? "All done!" : "You're in!"}
            </p>
            <p className="text-[14px] text-white/45 leading-relaxed max-w-[280px]">{successMsg}</p>
          </div>
          <button
            onClick={() => { setCheckedIn(prev => !prev); setState("ready"); }}
            className="text-[12px] text-white/25 underline underline-offset-2"
          >
            {checkedIn ? "Check in again" : "Check out instead"}
          </button>
        </div>
      )}

      {/* Error after data loaded */}
      {state === "error" && data && (
        <div className="w-full max-w-sm flex flex-col items-center gap-4 text-center">
          <AlertCircle className="w-8 h-8 text-[#E11D48]" />
          <p className="text-white/70 text-[15px]">{errorMsg}</p>
          <button
            onClick={() => setState("ready")}
            className="text-[13px] text-[#B4FF44]/70 underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
