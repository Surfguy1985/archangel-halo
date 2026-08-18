import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Globe, Loader2, ShieldCheck } from "lucide-react";
import "./crewInstructionsGate.css";

/**
 * The umbrella instructions gate that opens EVERY crew QR link — the printed
 * paycard check-in link, the crew portal link, and the foreman join link —
 * before the crew can reach any working surface.
 *
 * Two rules shape the design:
 *
 *  1. The wording is served by the server and stored with each acceptance, so
 *     this component never hardcodes the requirement text. A stale bundle on a
 *     crew's phone must not be able to sign someone up to text the office
 *     cannot produce later.
 *  2. It shows on every FRESH open of a link, not once per crew. A reload
 *     mid-shift must not re-nag, so acceptance is remembered in sessionStorage
 *     (dies with the tab) rather than localStorage.
 *
 * It does not replace the per-job payout agreement or the per-checklist
 * agreement — it sits in front of them.
 */

export type CrewLinkSurface = "paycard" | "portal" | "join" | "app";

type Requirement = { title: string; body: string };

export type CrewInstructionsCopy = {
  lang: "en" | "es";
  kicker: string;
  title: string;
  intro: string;
  requirements: Requirement[];
  warning: string;
  agreeLabel: string;
  agreeCheckbox: string;
  footnote: string;
  otherLangLabel: string;
};

type InstructionsPayload = {
  version: string;
  ttlHours: number;
  copy: { en: CrewInstructionsCopy; es: CrewInstructionsCopy };
  crewName?: string | null;
  ack?: { acknowledged: boolean; agreedAt: string | null; current: boolean } | null;
};

const SESSION_PREFIX = "haloCrewInstructions:v1:";
const REQUIRED_EVENT = "halo:crew-instructions-required";

function sessionKey(token: string): string {
  return `${SESSION_PREFIX}${token}`;
}

function readSessionAck(token: string): boolean {
  if (typeof window === "undefined" || !token) return false;
  try {
    return window.sessionStorage.getItem(sessionKey(token)) === "1";
  } catch {
    return false;
  }
}

function writeSessionAck(token: string, on: boolean): void {
  if (typeof window === "undefined" || !token) return;
  try {
    if (on) window.sessionStorage.setItem(sessionKey(token), "1");
    else window.sessionStorage.removeItem(sessionKey(token));
  } catch {
    /* private mode — the gate simply shows again */
  }
}

/**
 * Called when the server refuses an action with `instructions_required`:
 * forget this visit's acceptance and put the gate back on screen.
 */
export function requireCrewInstructions(token: string): void {
  writeSessionAck(token, false);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(REQUIRED_EVENT, { detail: { token } }));
  }
}

/**
 * Carry an acceptance from one token to another WITHIN the same visit.
 *
 * The join flow mints a brand-new paycard token and hands the member straight
 * to it. That is one continuous visit, not a fresh scan, so the member must not
 * be shown the gate twice (nor be recorded as agreeing twice) — the claim
 * already wrote their acknowledgement. Scanning that paycard link later, in a
 * new session, still opens the gate normally.
 */
export function carryCrewInstructionsAck(toToken: string): void {
  writeSessionAck(toToken, true);
}

/** True when a failed request is the server sending the crew back to the gate. */
export function isInstructionsRequired(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string; data?: { code?: string } };
  return e.status === 428 || e.code === "instructions_required" || e.data?.code === "instructions_required";
}

/**
 * Gate state for one crew link. `agreed === false` means the surface must
 * render <CrewInstructionsGate /> instead of its working UI.
 */
export function useCrewInstructionsGate(token: string): {
  agreed: boolean;
  accept: () => void;
  reopen: () => void;
} {
  const [agreed, setAgreed] = useState(() => readSessionAck(token));

  useEffect(() => {
    setAgreed(readSessionAck(token));
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onRequired = (ev: Event) => {
      const detail = (ev as CustomEvent<{ token?: string }>).detail;
      if (!detail?.token || detail.token === token) setAgreed(false);
    };
    window.addEventListener(REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(REQUIRED_EVENT, onRequired);
  }, [token]);

  const accept = useCallback(() => {
    writeSessionAck(token, true);
    setAgreed(true);
  }, [token]);

  const reopen = useCallback(() => {
    writeSessionAck(token, false);
    setAgreed(false);
  }, [token]);

  return { agreed, accept, reopen };
}

function detectLang(): "en" | "es" {
  if (typeof navigator === "undefined") return "en";
  const langs = [navigator.language, ...(navigator.languages ?? [])];
  return langs.some((l) => typeof l === "string" && l.toLowerCase().startsWith("es")) ? "es" : "en";
}

export type CrewInstructionsGateProps = {
  token: string;
  surface: CrewLinkSurface;
  /**
   * Where the copy comes from and where the acceptance is posted.
   * The join surface has no crew row yet, so it only reads: the acceptance is
   * written by the claim itself (see `onAgreed(lang)`).
   */
  onAgreed: (lang: "en" | "es") => void;
  /** Set for /join — agreeing does not POST, it hands the language to the claim. */
  recordOnAgree?: boolean;
  /** Overrides the API prefix; defaults to the same-origin /api mount. */
  apiBase?: string;
};

function endpointFor(surface: CrewLinkSurface, token: string, apiBase: string): string {
  const base = apiBase.replace(/\/$/, "");
  if (surface === "join") return `${base}/join/${token}/instructions`;
  if (surface === "paycard") return `${base}/checkin/${token}/instructions`;
  return `${base}/portal/${token}/instructions`;
}

export function CrewInstructionsGate({
  token,
  surface,
  onAgreed,
  recordOnAgree = surface !== "join",
  apiBase = "/api",
}: CrewInstructionsGateProps) {
  const [payload, setPayload] = useState<InstructionsPayload | null>(null);
  const [lang, setLang] = useState<"en" | "es">(() => detectLang());
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");

  const url = useMemo(() => endpointFor(surface, token, apiBase), [surface, token, apiBase]);

  useEffect(() => {
    let alive = true;
    setLoadError("");
    setPayload(null);
    void (async () => {
      try {
        const res = await fetch(url);
        const json = (await res.json().catch(() => null)) as InstructionsPayload | null;
        if (!alive) return;
        if (!res.ok || !json?.copy) {
          setLoadError("Could not load the crew instructions. Pull down to retry.");
          return;
        }
        setPayload(json);
      } catch {
        if (alive) setLoadError("You're offline. Reconnect to open your link.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [url]);

  const copy = payload?.copy[lang] ?? null;

  const agree = async () => {
    if (saving || !checked) return;
    setSaveError("");
    if (!recordOnAgree) {
      onAgreed(lang);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The crew is resolved from the link token server-side — never sent
        // from here.
        body: JSON.stringify({ lang, linkKind: surface }),
      });
      if (!res.ok) {
        setSaveError("Could not record your agreement. Try again.");
        setSaving(false);
        return;
      }
      onAgreed(lang);
    } catch {
      setSaveError("You're offline. Reconnect and try again.");
      setSaving(false);
    }
  };

  return (
    <div className="halo-cig" data-surface={surface}>
      <div className="halo-cig-card">
        {!copy ? (
          <div className="halo-cig-loading" role="status" aria-live="polite">
            {loadError ? (
              <>
                <AlertTriangle aria-hidden="true" />
                <p>{loadError}</p>
              </>
            ) : (
              <>
                <Loader2 className="halo-spin" aria-hidden="true" />
                <p>Loading…</p>
              </>
            )}
          </div>
        ) : (
          <>
            <header className="halo-cig-head">
              <div className="halo-cig-headrow">
                <span className="halo-cig-kicker">
                  <ShieldCheck aria-hidden="true" />
                  {copy.kicker}
                </span>
                <button
                  type="button"
                  className="halo-cig-lang"
                  onClick={() => setLang(lang === "en" ? "es" : "en")}
                >
                  <Globe aria-hidden="true" />
                  {copy.otherLangLabel}
                </button>
              </div>
              <h1>{copy.title}</h1>
              {payload?.crewName ? <p className="halo-cig-who">{payload.crewName}</p> : null}
              <p className="halo-cig-intro">{copy.intro}</p>
            </header>

            <ol className="halo-cig-list">
              {copy.requirements.map((r, i) => (
                <li key={r.title}>
                  <span className="halo-cig-num">{i + 1}</span>
                  <div>
                    <strong>{r.title}</strong>
                    <p>{r.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <p className="halo-cig-warn">
              <AlertTriangle aria-hidden="true" />
              <span>{copy.warning}</span>
            </p>

            <label className="halo-cig-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                disabled={saving}
              />
              <span className="halo-cig-box" aria-hidden="true">
                {checked ? <Check /> : null}
              </span>
              <span>{copy.agreeCheckbox}</span>
            </label>

            {saveError ? (
              <p className="halo-cig-error" role="alert">
                <AlertTriangle aria-hidden="true" />
                {saveError}
              </p>
            ) : null}

            <button
              type="button"
              className="halo-cig-cta"
              disabled={!checked || saving}
              onClick={() => void agree()}
            >
              {saving ? (
                <Loader2 className="halo-spin" aria-hidden="true" />
              ) : (
                <ArrowRight aria-hidden="true" />
              )}
              {copy.agreeLabel}
            </button>

            <p className="halo-cig-foot">{copy.footnote}</p>
          </>
        )}
      </div>
    </div>
  );
}
