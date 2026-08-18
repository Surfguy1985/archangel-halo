import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, LogOut, MapPin } from "lucide-react";
import "./haloCrewPaycard.css";

type PhotoItem = { id: string; phase: string | null; url: string; takenOn?: string };
type PayData = {
  crew: { id: string; name: string };
  todayAssignment: {
    propertyName: string | null;
    unitLabel: string | null;
    jobDescription: string | null;
    units?: string[];
  } | null;
  currentStatus: "in" | "out";
  photos?: { before: number; after: number; items: PhotoItem[] };
};

type PageState = "loading" | "ready" | "busy" | "done" | "error" | "expired";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { ...opts, credentials: "same-origin" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((json as { error?: string }).error ?? String(res.status)), { status: res.status, body: json });
  return json;
}

function getGPS(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is required to get paid"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12_000,
      maximumAge: 15_000,
    });
  });
}

async function jpegFile(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function HaloCrewPaycardPage({ token }: { token: string }) {
  const [state, setState] = useState<PageState>("loading");
  const [data, setData] = useState<PayData | null>(null);
  const [unit, setUnit] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [doneMsg, setDoneMsg] = useState("");

  const reload = async () => {
    const d = (await apiFetch(`/api/checkin/${token}`)) as PayData;
    setData(d);
    setUnit((prev) => prev || d.todayAssignment?.unitLabel || d.todayAssignment?.units?.[0] || "");
    setState("ready");
  };

  useEffect(() => {
    reload().catch((err: { status?: number; message?: string }) => {
      setState(err.status === 410 || err.status === 404 ? "expired" : "error");
      setErrorMsg(err.message ?? "This paycard is not valid.");
    });
  }, [token]);

  const before = data?.photos?.items.find((p) => p.phase === "before")?.url;
  const after = data?.photos?.items.find((p) => p.phase === "after")?.url;
  const checkedIn = data?.currentStatus === "in";
  const photosReady = (data?.photos?.before ?? 0) > 0 && (data?.photos?.after ?? 0) > 0;
  const first = data?.crew.name.split(" ")[0] ?? "there";
  const step = !checkedIn ? "unit" : !before ? "before" : !after ? "after" : "out";

  const gpsBody = async () => {
    const pos = await getGPS();
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      capturedAt: new Date().toISOString(),
    };
  };

  const checkIn = async () => {
    setState("busy");
    try {
      const gps = await gpsBody();
      await apiFetch(`/api/checkin/${token}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...gps, unitNo: unit }),
      });
      setDoneMsg("You're on the map. Take before and after photos, then check out to get paid.");
      await reload();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Check-in failed.");
      setState("error");
    }
  };

  const checkOut = async () => {
    setState("busy");
    try {
      const gps = await gpsBody().catch(() => ({}));
      await apiFetch(`/api/checkin/${token}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gps),
      });
      setDoneMsg("Checked out. This paycard is complete.");
      setState("done");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Check-out failed.");
      setState("error");
    }
  };

  const upload = async (file: File, phase: "before" | "after") => {
    setState("busy");
    try {
      const jpeg = await jpegFile(file);
      const urlResp = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `paycard-${phase}-${Date.now()}.jpg`, contentType: "image/jpeg" }),
      });
      const signed = (await urlResp.json()) as { uploadURL?: string; objectPath?: string; error?: string };
      if (!urlResp.ok || !signed.uploadURL || !signed.objectPath) {
        throw new Error(signed.error || "Could not start photo upload");
      }
      const put = await fetch(signed.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: jpeg,
      });
      if (!put.ok) throw new Error("Photo upload failed");
      let gps: Record<string, unknown> = {};
      try {
        gps = await gpsBody();
      } catch {
        gps = {};
      }
      await apiFetch(`/api/checkin/${token}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: signed.objectPath, phase, ...gps }),
      });
      await reload();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Photo failed.");
      setState("error");
    }
  };

  const steps = useMemo(
    () => [
      { id: "unit", label: "Unit" },
      { id: "in", label: "Check in" },
      { id: "before", label: "Before" },
      { id: "after", label: "After" },
      { id: "out", label: "Check out" },
    ],
    [],
  );

  const onStep = (id: string) => {
    if (id === "unit" || id === "in") return !checkedIn;
    if (id === "before") return checkedIn && !before;
    if (id === "after") return checkedIn && !!before && !after;
    return checkedIn && photosReady;
  };

  return (
    <div className="halo-paypage">
      {state === "loading" && (
        <div className="halo-paypage-card" style={{ alignItems: "center" }}>
          <Loader2 className="w-8 h-8 text-[#B4FF44] animate-spin" />
        </div>
      )}

      {(state === "expired" || (state === "error" && !data)) && (
        <div className="halo-paypage-card" style={{ alignItems: "center", textAlign: "center" }}>
          <AlertCircle className="w-10 h-10 text-[#c23b22]" />
          <h1>Paycard not valid</h1>
          <p className="halo-paypage-warn">{errorMsg || "Ask the office for a new printed card."}</p>
        </div>
      )}

      {(state === "ready" || state === "busy" || (state === "error" && data)) && data && (
        <div className="halo-paypage-card">
          <p className="halo-paypage-kicker">HALO paycard</p>
          <h1>
            Hi, {first}.
            <span>Complete this card to get paid.</span>
          </h1>
          <ol className="halo-paypage-steps">
            {steps.map((s) => (
              <li key={s.id} data-on={onStep(s.id) ? "true" : "false"}>{s.label}</li>
            ))}
          </ol>
          {data.todayAssignment && (
            <div className="halo-paypage-box">
              <p>Today</p>
              <strong>
                <MapPin className="inline w-4 h-4 mr-1" />
                {data.todayAssignment.propertyName || "Your site"}
              </strong>
              <small>{data.todayAssignment.jobDescription || "Log the unit, then check in."}</small>
            </div>
          )}
          {!checkedIn && (
            <label className="halo-paypage-field">
              <span>Unit you are on</span>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                inputMode="text"
                autoComplete="off"
                placeholder="214"
                aria-label="Unit number"
              />
            </label>
          )}
          {checkedIn && (
            <div className="halo-paypage-shots">
              <label className="halo-paypage-shot">
                {before ? <img src={before} alt="Before" /> : null}
                <span>{before ? "Before ✓" : "Before photo"}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f, "before");
                  }}
                />
              </label>
              <label className="halo-paypage-shot">
                {after ? <img src={after} alt="After" /> : null}
                <span>{after ? "After ✓" : "After photo"}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f, "after");
                  }}
                />
              </label>
            </div>
          )}
          {state === "error" && errorMsg ? <p className="halo-paypage-warn">{errorMsg}</p> : null}
          {!checkedIn ? (
            <button type="button" className="halo-paypage-cta" disabled={state === "busy" || !unit.trim()} onClick={() => void checkIn()}>
              {state === "busy" ? <Loader2 className="w-5 h-5 animate-spin inline" /> : "Check in — place my pin"}
            </button>
          ) : (
            <button
              type="button"
              className="halo-paypage-cta"
              data-out="true"
              disabled={state === "busy" || !photosReady}
              onClick={() => void checkOut()}
            >
              {state === "busy" ? (
                <Loader2 className="w-5 h-5 animate-spin inline" />
              ) : (
                <>
                  <LogOut className="w-5 h-5 inline mr-2" />
                  {photosReady ? "Check out to get paid" : "Photos first, then check out"}
                </>
              )}
            </button>
          )}
          <p style={{ margin: 0, textAlign: "center", fontSize: 12, color: "rgba(210,224,255,0.45)", fontWeight: 600 }}>
            {step === "unit"
              ? "Location must be on so your green pin hits the map."
              : photosReady
                ? "Office can see you. Check out when the unit is done."
                : "Before and after photos are required to get paid."}
          </p>
        </div>
      )}

      {state === "done" && (
        <div className="halo-paypage-card" style={{ alignItems: "center", textAlign: "center" }}>
          <CheckCircle2 className="w-12 h-12 text-[#B4FF44]" />
          <h1>Paid clock complete.</h1>
          <p className="halo-paypage-warn" style={{ background: "rgba(180,255,68,0.1)", borderColor: "rgba(180,255,68,0.28)", color: "#d9ff9a" }}>
            {doneMsg}
          </p>
        </div>
      )}
    </div>
  );
}
