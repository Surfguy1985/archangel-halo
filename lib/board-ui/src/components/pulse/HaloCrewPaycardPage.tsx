import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Check,
  Copy,
  HardHat,
  Loader2,
  LogOut,
  MapPin,
  RefreshCw,
  Share2,
  Trash2,
  UserPlus,
  WifiOff,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import "./haloCrewPaycard.css";

type PhotoItem = { id: string; phase: string | null; url: string; takenOn?: string };
type TeamMember = { id: string; name: string; trade: string | null };
type TeamInvite = {
  id: string;
  prefix: string;
  url: string | null;
  claimedAt: string | null;
  claimedName: string | null;
  expiresAt: string;
  expired: boolean;
  createdAt: string;
};
type TeamView = { members: TeamMember[]; invites: TeamInvite[]; origin: string };

type PayData = {
  crew: { id: string; name: string; isForeman?: boolean };
  team?: TeamView | null;
  todayAssignment: {
    propertyName: string | null;
    unitLabel: string | null;
    jobDescription: string | null;
    units?: string[];
  } | null;
  currentStatus: "in" | "out";
  lastCheckin?: string | null;
  session?: { status?: string; checkedInAt?: string | null } | null;
  photos?: { before: number; after: number; items: PhotoItem[] };
};

type PageState = "loading" | "ready" | "done" | "error" | "expired";
type Phase = "before" | "after";
type StepId = "unit" | "in" | "before" | "after" | "out";

/**
 * Turn anything thrown by fetch/geolocation into copy a crew member can act on.
 * GeolocationPositionError is NOT an Error instance, so `instanceof Error`
 * silently swallowed the most common real-world failure (location denied) and
 * showed a useless "Check-in failed." instead.
 */
function describeError(err: unknown, fallback: string): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You're offline. Reconnect and try again — nothing was lost.";
  }
  if (typeof err === "object" && err !== null && "code" in err && "PERMISSION_DENIED" in Object(err)) {
    const code = (err as GeolocationPositionError).code;
    if (code === 1) return "Location is blocked. Turn it on for this page — your pin is what proves you were on site.";
    if (code === 2) return "Can't get a location fix here. Step outside or near a window, then try again.";
    if (code === 3) return "Location took too long. Try again — it usually works on the second attempt.";
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { ...opts, credentials: "same-origin" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error((json as { error?: string }).error ?? `Request failed (${res.status})`), {
      status: res.status,
      body: json,
    });
  }
  return json;
}

function getGPS(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This phone can't share location, so the office can't verify you were on site."));
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

/**
 * Newest photo for a phase — a retake must replace what the crew sees.
 * The server returns photos ordered newest-first, so the first match wins.
 */
function latestPhoto(items: PhotoItem[] | undefined, phase: Phase): string | undefined {
  return items?.find((p) => p.phase === phase)?.url;
}

const STALE_AFTER_HOURS = 12;

/**
 * A running clock only makes sense for today's shift. Cards left open
 * overnight would otherwise show absurd totals like "478:56:27", which reads
 * as a bug and hides the real problem — the card was never closed out.
 */
function payClock(
  fromIso: string | null | undefined,
  nowMs: number,
): { label: string; stale: boolean } | null {
  if (!fromIso) return null;
  const startedAt = new Date(fromIso);
  const started = startedAt.getTime();
  if (!Number.isFinite(started)) return null;
  const secs = Math.max(0, Math.floor((nowMs - started) / 1000));
  if (secs >= STALE_AFTER_HOURS * 3600) {
    return {
      label: startedAt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      stale: true,
    };
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return {
    label:
      h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${m}:${String(s).padStart(2, "0")}`,
    stale: false,
  };
}

export function HaloCrewPaycardPage({ token }: { token: string }) {
  const [state, setState] = useState<PageState>("loading");
  const [data, setData] = useState<PayData | null>(null);
  const [unit, setUnit] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [doneMsg, setDoneMsg] = useState("");
  const [pending, setPending] = useState<null | "checkin" | "checkout" | Phase>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Foreman-only: his own crew roster + the QR invites he hands out.
  const [team, setTeam] = useState<TeamView | null>(null);
  const [teamBusy, setTeamBusy] = useState<string | null>(null);
  const [teamMsg, setTeamMsg] = useState("");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState("");
  const [copied, setCopied] = useState(false);
  const beforeInput = useRef<HTMLInputElement | null>(null);
  const afterInput = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    const d = (await apiFetch(`/api/checkin/${token}`)) as PayData;
    setData(d);
    setUnit((prev) => prev || d.todayAssignment?.unitLabel || d.todayAssignment?.units?.[0] || "");
    setState("ready");
    return d;
  }, [token]);

  const load = useCallback(() => {
    setState("loading");
    setErrorMsg("");
    reload().catch((err: unknown) => {
      const status = (err as { status?: number }).status;
      setState(status === 410 || status === 404 ? "expired" : "error");
      setErrorMsg(describeError(err, "This paycard could not be opened."));
    });
  }, [reload]);

  useEffect(() => {
    load();
  }, [load]);

  const checkedIn = data?.currentStatus === "in";
  const clockStart = data?.session?.checkedInAt ?? data?.lastCheckin ?? null;

  // Live pay clock — only ticks while the crew is actually on the clock.
  useEffect(() => {
    if (!checkedIn || !clockStart) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [checkedIn, clockStart]);

  // Counts are the server's own checkout evidence; items are only thumbnails
  // (the API truncates them), so never derive step state from items.
  const hasBefore = (data?.photos?.before ?? 0) > 0;
  const hasAfter = (data?.photos?.after ?? 0) > 0;
  const beforeUrl = latestPhoto(data?.photos?.items, "before");
  const afterUrl = latestPhoto(data?.photos?.items, "after");
  const photosReady = hasBefore && hasAfter;
  const first = data?.crew.name.split(" ")[0] ?? "there";
  const busy = pending !== null;
  const clock = payClock(clockStart, nowMs);
  const staleShift = checkedIn && clock?.stale === true;

  const done = useMemo<Record<StepId, boolean>>(
    () => ({
      unit: checkedIn,
      in: checkedIn,
      before: checkedIn && hasBefore,
      after: checkedIn && hasAfter,
      out: false,
    }),
    [checkedIn, hasBefore, hasAfter],
  );

  const currentStep: StepId = !checkedIn ? "unit" : !hasBefore ? "before" : !hasAfter ? "after" : "out";

  const steps: { id: StepId; label: string }[] = useMemo(
    () => [
      { id: "unit", label: "Unit" },
      { id: "in", label: "Check in" },
      { id: "before", label: "Before" },
      { id: "after", label: "After" },
      { id: "out", label: "Check out" },
    ],
    [],
  );

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
    if (busy) return;
    setErrorMsg("");
    setPending("checkin");
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
      setErrorMsg(describeError(err, "Check-in didn't go through. Try again."));
    } finally {
      setPending(null);
    }
  };

  const checkOut = async () => {
    if (busy) return;
    setErrorMsg("");
    setPending("checkout");
    try {
      // Checkout tolerates a missing fix — the office already has the check-in pin.
      const gps = await gpsBody().catch(() => ({}));
      await apiFetch(`/api/checkin/${token}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gps),
      });
      setDoneMsg("Checked out. This paycard is complete.");
      setState("done");
    } catch (err: unknown) {
      setErrorMsg(describeError(err, "Check-out didn't go through. Try again."));
      // The server owns the photo rule; re-read so the card reflects it.
      await reload().catch(() => undefined);
    } finally {
      setPending(null);
    }
  };

  const upload = async (file: File, phase: Phase) => {
    if (busy) return;
    setErrorMsg("");
    setPending(phase);
    try {
      const jpeg = await jpegFile(file);
      const urlResp = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `paycard-${phase}-${Date.now()}.jpg`, contentType: "image/jpeg" }),
      });
      const signed = (await urlResp.json().catch(() => ({}))) as {
        uploadURL?: string;
        objectPath?: string;
        error?: string;
      };
      if (!urlResp.ok || !signed.uploadURL || !signed.objectPath) {
        throw new Error(signed.error || "Could not start the photo upload.");
      }
      const put = await fetch(signed.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: jpeg,
      });
      if (!put.ok) throw new Error("The photo didn't finish uploading. Try again.");
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
      setErrorMsg(describeError(err, "That photo didn't save. Try again."));
    } finally {
      setPending(null);
    }
  };

  /**
   * Clearing the input value matters: without it, picking the SAME photo again
   * after a failure fires no change event and the retry looks broken.
   */
  const onPick = (phase: Phase) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void upload(f, phase);
  };

  const shot = (
    phase: Phase,
    saved: boolean,
    url: string | undefined,
    ref: React.RefObject<HTMLInputElement | null>,
  ) => {
    const uploading = pending === phase;
    const name = phase === "before" ? "Before" : "After";
    return (
      <div
        className="halo-paypage-shot"
        data-filled={saved ? "true" : "false"}
        data-busy={uploading ? "true" : "false"}
      >
        {url ? <img src={url} alt={`${name} photo of the unit`} /> : null}
        <button
          type="button"
          className="halo-paypage-shot-hit"
          onClick={() => ref.current?.click()}
          disabled={busy}
          aria-label={saved ? `Retake ${phase} photo` : `Take ${phase} photo`}
        >
          <span className="halo-paypage-shot-badge">
            {uploading ? (
              <Loader2 className="halo-spin" aria-hidden="true" />
            ) : saved ? (
              <Check aria-hidden="true" />
            ) : (
              <Camera aria-hidden="true" />
            )}
            {uploading ? "Saving…" : saved ? `${name} · Retake` : `${name} photo`}
          </span>
        </button>
        <input ref={ref} type="file" accept="image/*" capture="environment" onChange={onPick(phase)} tabIndex={-1} />
      </div>
    );
  };

  // ── Foreman: QR invites ───────────────────────────────────────────────────

  useEffect(() => {
    if (data?.team) setTeam(data.team);
  }, [data?.team]);

  useEffect(() => {
    if (!qrUrl) {
      setQrSvg("");
      return;
    }
    let alive = true;
    QRCode.toString(qrUrl, {
      type: "svg",
      margin: 1,
      width: 240,
      color: { dark: "#0F1B2D", light: "#ffffff" },
    })
      .then((out) => {
        if (alive) setQrSvg(out);
      })
      .catch(() => {
        if (alive) setQrSvg("");
      });
    return () => {
      alive = false;
    };
  }, [qrUrl]);

  const mintInvite = async () => {
    if (teamBusy) return;
    setTeamBusy("mint");
    setTeamMsg("");
    try {
      const res = await fetch(`/api/checkin/${token}/team/invites`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        invite?: TeamInvite;
        team?: TeamView;
        error?: string;
      };
      if (!res.ok || !json.invite?.url) {
        setTeamMsg(json.error ?? "Could not create a code. Try again.");
        return;
      }
      if (json.team) setTeam(json.team);
      setCopied(false);
      setQrUrl(json.invite.url);
    } catch (err) {
      setTeamMsg(describeError(err, "Could not create a code. Try again."));
    } finally {
      setTeamBusy(null);
    }
  };

  const revokeInvite = async (id: string) => {
    if (teamBusy) return;
    setTeamBusy(id);
    setTeamMsg("");
    try {
      const res = await fetch(`/api/checkin/${token}/team/invites/${id}/revoke`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { team?: TeamView; error?: string };
      if (!res.ok) {
        setTeamMsg(json.error ?? "Could not remove that code.");
        return;
      }
      if (json.team) setTeam(json.team);
    } catch (err) {
      setTeamMsg(describeError(err, "Could not remove that code."));
    } finally {
      setTeamBusy(null);
    }
  };

  const shareInvite = async (url: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Join my HALO crew", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* user dismissed the share sheet — nothing to report */
    }
  };

  const openInvites = (team?.invites ?? []).filter((i) => !i.claimedAt && !i.expired);
  const joinedInvites = (team?.invites ?? []).filter((i) => i.claimedAt).slice(0, 6);

  return (
    <div className="halo-paypage">
      {state === "loading" && (
        <div className="halo-paypage-card halo-paypage-centered" role="status" aria-live="polite">
          <Loader2 className="halo-spin halo-paypage-bigspin" aria-hidden="true" />
          <p className="halo-paypage-muted">Opening your paycard…</p>
        </div>
      )}

      {(state === "expired" || (state === "error" && !data)) && (
        <div className="halo-paypage-card halo-paypage-centered">
          <span className="halo-paypage-glyph" data-tone="bad">
            <AlertCircle aria-hidden="true" />
          </span>
          <h1>{state === "expired" ? "This paycard has expired" : "Couldn't open your paycard"}</h1>
          <p className="halo-paypage-muted">{errorMsg || "Ask the office to text you a fresh card."}</p>
          {state === "error" && (
            <button type="button" className="halo-paypage-cta" onClick={load}>
              <RefreshCw aria-hidden="true" /> Try again
            </button>
          )}
        </div>
      )}

      {(state === "ready" || state === "error") && data && (
        <div className="halo-paypage-card">
          <header className="halo-paypage-head">
            <p className="halo-paypage-kicker">HALO paycard</p>
            <h1>Hi, {first}.</h1>
            <p className="halo-paypage-sub">
              {!checkedIn
                ? "Complete this card to get paid."
                : staleShift
                  ? "This card is still open from an earlier shift."
                  : "You're on the clock. Finish the card to get paid."}
            </p>
            <span
              className="halo-paypage-status"
              data-on={checkedIn && !staleShift ? "true" : "false"}
              data-stale={staleShift ? "true" : "false"}
            >
              <i aria-hidden="true" />
              {!checkedIn ? (
                "Not checked in"
              ) : staleShift ? (
                <>
                  Left open since<b>{clock?.label}</b>
                </>
              ) : (
                <>
                  On the clock
                  {clock ? <b aria-label={`On the clock for ${clock.label}`}>{clock.label}</b> : null}
                </>
              )}
            </span>
          </header>

          <ol
            className="halo-paypage-steps"
            aria-label={`Step ${steps.findIndex((s) => s.id === currentStep) + 1} of ${steps.length}`}
          >
            {steps.map((s) => {
              const isDone = done[s.id];
              const isNow = s.id === currentStep || (currentStep === "unit" && s.id === "in");
              return (
                <li
                  key={s.id}
                  data-done={isDone ? "true" : "false"}
                  data-now={!isDone && isNow ? "true" : "false"}
                  aria-current={!isDone && isNow ? "step" : undefined}
                >
                  <span className="halo-paypage-dot" aria-hidden="true">
                    {isDone ? <Check /> : null}
                  </span>
                  <span className="halo-paypage-steplabel">{s.label}</span>
                </li>
              );
            })}
          </ol>

          {data.todayAssignment && (
            <div className="halo-paypage-box">
              <p>Today</p>
              <strong>
                <MapPin aria-hidden="true" />
                {data.todayAssignment.propertyName || "Your site"}
              </strong>
              <small>{data.todayAssignment.jobDescription || "Log the unit, then check in."}</small>
            </div>
          )}

          {!checkedIn ? (
            <label className="halo-paypage-field">
              <span>Unit you are on</span>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                inputMode="text"
                autoComplete="off"
                placeholder="214"
                aria-label="Unit number"
                disabled={busy}
              />
            </label>
          ) : (
            <>
              {unit ? (
                <p className="halo-paypage-onunit">
                  Checked in on <b>Unit {unit.replace(/^unit\s*/i, "")}</b>
                </p>
              ) : null}
              <div className="halo-paypage-shots">
                {shot("before", hasBefore, beforeUrl, beforeInput)}
                {shot("after", hasAfter, afterUrl, afterInput)}
              </div>
            </>
          )}

          <p className="halo-paypage-live" role="status" aria-live="polite">
            {errorMsg ? (
              <span className="halo-paypage-warn">
                {typeof navigator !== "undefined" && navigator.onLine === false ? (
                  <WifiOff aria-hidden="true" />
                ) : (
                  <AlertCircle aria-hidden="true" />
                )}
                {errorMsg}
              </span>
            ) : null}
          </p>

          <div className="halo-paypage-actions">
            {!checkedIn ? (
              <button
                type="button"
                className="halo-paypage-cta"
                disabled={busy || !unit.trim()}
                onClick={() => void checkIn()}
              >
                {pending === "checkin" ? (
                  <>
                    <Loader2 className="halo-spin" aria-hidden="true" /> Placing your pin…
                  </>
                ) : (
                  <>
                    <MapPin aria-hidden="true" /> Check in — place my pin
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="halo-paypage-cta"
                data-out={photosReady ? "true" : "false"}
                disabled={busy || !photosReady}
                onClick={() => void checkOut()}
              >
                {pending === "checkout" ? (
                  <>
                    <Loader2 className="halo-spin" aria-hidden="true" /> Checking out…
                  </>
                ) : (
                  <>
                    <LogOut aria-hidden="true" />
                    {photosReady ? "Check out to get paid" : !hasBefore ? "Before photo needed" : "After photo needed"}
                  </>
                )}
              </button>
            )}
            <p className="halo-paypage-foot">
              {!checkedIn
                ? "Location must be on so your green pin hits the map."
                : staleShift
                  ? "This card was left open from an earlier shift. Add the photos and check out to close it."
                  : photosReady
                    ? "Office can see you. Check out when the unit is done."
                    : "Before and after photos are required to get paid."}
            </p>
          </div>
        </div>
      )}

      {(state === "ready" || state === "error" || state === "done") && data?.crew.isForeman && (
        <section className="halo-payteam" aria-label="My crew">
          <header className="halo-payteam-head">
            <span className="halo-payteam-badge">
              <HardHat aria-hidden="true" /> Foreman
            </span>
            <div>
              <p>My crew</p>
              <strong>
                {(team?.members.length ?? 0) === 0
                  ? "No one added yet"
                  : `${team?.members.length} on your crew`}
              </strong>
            </div>
          </header>

          {team && team.members.length > 0 && (
            <ul className="halo-payteam-list">
              {team.members.map((m) => (
                <li key={m.id}>
                  <span className="halo-payteam-avatar" aria-hidden="true">
                    {m.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="halo-payteam-name">{m.name}</span>
                  {m.trade ? <small>{m.trade}</small> : null}
                </li>
              ))}
            </ul>
          )}

          {openInvites.length > 0 && (
            <ul className="halo-payteam-codes">
              {openInvites.map((inv) => (
                <li key={inv.id}>
                  <span className="halo-payteam-codedot" aria-hidden="true" />
                  <span className="halo-payteam-name">Code ·{inv.prefix.slice(-4)}</span>
                  <small>waiting for a scan</small>
                  <div className="halo-payteam-codeacts">
                    {inv.url ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCopied(false);
                          setQrUrl(inv.url);
                        }}
                      >
                        Show QR
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Remove this code"
                      data-danger="true"
                      disabled={teamBusy === inv.id}
                      onClick={() => void revokeInvite(inv.id)}
                    >
                      {teamBusy === inv.id ? <Loader2 className="halo-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {joinedInvites.length > 0 && (
            <p className="halo-payteam-recent">
              Recently joined: {joinedInvites.map((i) => i.claimedName).filter(Boolean).join(", ")}
            </p>
          )}

          {teamMsg ? (
            <p className="halo-paypage-warn halo-payteam-warn" role="status" aria-live="polite">
              <AlertCircle aria-hidden="true" />
              {teamMsg}
            </p>
          ) : null}

          <button
            type="button"
            className="halo-payteam-cta"
            disabled={teamBusy === "mint"}
            onClick={() => void mintInvite()}
          >
            {teamBusy === "mint" ? (
              <>
                <Loader2 className="halo-spin" aria-hidden="true" /> Making a code…
              </>
            ) : (
              <>
                <UserPlus aria-hidden="true" /> New QR code for a crew member
              </>
            )}
          </button>
          <p className="halo-payteam-foot">
            They scan it, type their name, and get their own paycard on your crew. Each code works once.
          </p>
        </section>
      )}

      {qrUrl && (
        <div
          className="halo-payqr"
          role="dialog"
          aria-modal="true"
          aria-label="Crew join code"
          onClick={() => setQrUrl(null)}
        >
          <div className="halo-payqr-sheet" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="halo-payqr-close"
              aria-label="Close"
              onClick={() => setQrUrl(null)}
            >
              <X aria-hidden="true" />
            </button>
            <p className="halo-payqr-kicker">Scan to join {first}'s crew</p>
            <div className="halo-payqr-code" aria-hidden="true">
              {qrSvg ? (
                <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
              ) : (
                <Loader2 className="halo-spin halo-paypage-bigspin" />
              )}
            </div>
            <p className="halo-payqr-hint">
              Hold it up. They type their name and get their own paycard — this code works once.
              Print or send it now: for security it can't be shown again.
            </p>
            <div className="halo-payqr-acts">
              <button type="button" className="halo-payteam-cta" onClick={() => void shareInvite(qrUrl)}>
                {copied ? (
                  <>
                    <Check aria-hidden="true" /> Link copied
                  </>
                ) : (
                  <>
                    <Share2 aria-hidden="true" /> Send the link instead
                  </>
                )}
              </button>
              <button
                type="button"
                className="halo-payqr-copy"
                onClick={() => {
                  navigator.clipboard?.writeText(qrUrl).then(
                    () => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 2200);
                    },
                    () => setTeamMsg("Could not copy the link."),
                  );
                }}
              >
                <Copy aria-hidden="true" /> Copy link
              </button>
            </div>
          </div>
        </div>
      )}

      {state === "done" && (
        <div className="halo-paypage-card halo-paypage-centered">
          <span className="halo-paypage-glyph" data-tone="good">
            <CheckCircle2 aria-hidden="true" />
          </span>
          <h1>Paid clock complete.</h1>
          <p className="halo-paypage-good">{doneMsg}</p>
          {clock && !clock.stale ? <p className="halo-paypage-muted">Time on site · {clock.label}</p> : null}
        </div>
      )}
    </div>
  );
}
