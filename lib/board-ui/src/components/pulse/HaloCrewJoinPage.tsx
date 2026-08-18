import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, HardHat, Loader2, UserPlus } from "lucide-react";
import {
  CrewInstructionsGate,
  carryCrewInstructionsAck,
  useCrewInstructionsGate,
} from "../crew/CrewInstructionsGate";
import "./haloCrewPaycard.css";

type JoinInfo = { foreman: { name: string; trade: string | null }; expiresAt: string };
type State = "loading" | "ready" | "saving" | "done" | "dead";

const DEAD_COPY: Record<string, string> = {
  claimed: "This code was already used. Ask your foreman for a new one.",
  expired: "This code has expired. Ask your foreman for a new one.",
  revoked: "Your foreman removed this code. Ask for a new one.",
  malformed: "That code isn't valid. Scan the QR again.",
  not_found: "We don't recognize this code. Ask your foreman for a new one.",
  foreman_inactive: "This crew is no longer taking new members.",
};

/**
 * Public page behind a foreman's QR invite: the new crew member types their
 * own name and lands straight on their own paycard.
 */
export function HaloCrewJoinPage({
  token,
  onJoined,
}: {
  token: string;
  /** App-level navigation to the new member's paycard (keeps the router's base path). */
  onJoined: (paycardToken: string, paycardUrl: string) => void;
}) {
  const [state, setState] = useState<State>("loading");
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [deadReason, setDeadReason] = useState("");
  // The instructions come BEFORE the name form: nobody joins this crew
  // without having read what getting paid requires. There is no crew row yet,
  // so the acceptance rides along with the claim and is written with it.
  const gate = useCrewInstructionsGate(token);
  const agreedLang = useRef<"en" | "es">("en");

  const load = useCallback(async () => {
    setState("loading");
    setErrorMsg("");
    try {
      const res = await fetch(`/api/join/${token}`);
      const json = (await res.json().catch(() => ({}))) as JoinInfo & { code?: string };
      if (!res.ok) {
        setDeadReason(DEAD_COPY[json.code ?? ""] ?? "This code can't be used.");
        setState("dead");
        return;
      }
      setInfo(json);
      setState("ready");
    } catch {
      setDeadReason("You're offline. Reconnect and scan the code again.");
      setState("dead");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (state === "saving") return;
    const clean = name.trim().replace(/\s+/g, " ");
    if (clean.length < 2) {
      setErrorMsg("Enter your first and last name.");
      return;
    }
    setErrorMsg("");
    setState("saving");
    try {
      const res = await fetch(`/api/join/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: clean,
          phone: phone.trim() || undefined,
          instructionsAgreed: true,
          instructionsLang: agreedLang.current,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        paycardUrl?: string;
        token?: string;
        code?: string;
        error?: string;
      };
      if (!res.ok || !json.token) {
        if (json.code && DEAD_COPY[json.code]) {
          setDeadReason(DEAD_COPY[json.code]);
          setState("dead");
          return;
        }
        setErrorMsg(json.error ?? "Could not add you to the crew. Try again.");
        setState("ready");
        return;
      }
      setState("done");
      // The claim already recorded this member's acceptance, and the paycard
      // we're about to open is the same visit — carry the gate state onto the
      // new token so it doesn't ask again (or record a second acceptance).
      carryCrewInstructionsAck(json.token);
      // Let the success frame land before handing over to the paycard.
      window.setTimeout(() => onJoined(json.token!, json.paycardUrl ?? ""), 1400);
    } catch {
      setErrorMsg("You're offline. Reconnect and try again.");
      setState("ready");
    }
  };

  return (
    <div className="halo-paypage">
      {!gate.agreed && state !== "dead" && (
        <CrewInstructionsGate
          token={token}
          surface="join"
          recordOnAgree={false}
          onAgreed={(lang) => {
            agreedLang.current = lang;
            gate.accept();
          }}
        />
      )}

      {state === "loading" && (
        <div className="halo-paypage-card halo-paypage-centered" role="status" aria-live="polite">
          <Loader2 className="halo-spin halo-paypage-bigspin" aria-hidden="true" />
          <p className="halo-paypage-muted">Opening your invite…</p>
        </div>
      )}

      {state === "dead" && (
        <div className="halo-paypage-card halo-paypage-centered">
          <span className="halo-paypage-glyph" data-tone="bad">
            <AlertCircle aria-hidden="true" />
          </span>
          <h1>Code can't be used</h1>
          <p className="halo-paypage-muted">{deadReason}</p>
        </div>
      )}

      {state === "done" && (
        <div className="halo-paypage-card halo-paypage-centered">
          <span className="halo-paypage-glyph" data-tone="good">
            <CheckCircle2 aria-hidden="true" />
          </span>
          <h1>You're on the crew.</h1>
          <p className="halo-paypage-good">Opening your paycard — bookmark it. It's how you get paid.</p>
          <Loader2 className="halo-spin halo-paypage-bigspin" aria-hidden="true" />
        </div>
      )}

      {(state === "ready" || state === "saving") && info && (
        <div className="halo-paypage-card">
          <header className="halo-paypage-head">
            <p className="halo-paypage-kicker">HALO crew</p>
            <h1>
              Join {info.foreman.name.split(" ")[0]}'s crew
            </h1>
            <p className="halo-paypage-sub">
              {info.foreman.trade ? `${info.foreman.trade} · ` : ""}Add your name to get your own paycard.
            </p>
            <span className="halo-paypage-status" data-on="false">
              <HardHat aria-hidden="true" style={{ width: 13, height: 13 }} />
              Foreman · {info.foreman.name}
            </span>
          </header>

          <label className="halo-paypage-field">
            <span>Your full name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jose Ramirez"
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="done"
              disabled={state === "saving"}
            />
          </label>

          <label className="halo-paypage-field">
            <span>Phone (optional)</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              inputMode="tel"
              autoComplete="tel"
              disabled={state === "saving"}
            />
          </label>

          <p className="halo-paypage-live" role="status" aria-live="polite">
            {errorMsg ? (
              <span className="halo-paypage-warn">
                <AlertCircle aria-hidden="true" />
                {errorMsg}
              </span>
            ) : null}
          </p>

          <div className="halo-paypage-actions">
            <button
              type="button"
              className="halo-paypage-cta"
              disabled={state === "saving" || name.trim().length < 2}
              onClick={() => void submit()}
            >
              {state === "saving" ? (
                <>
                  <Loader2 className="halo-spin" aria-hidden="true" /> Adding you…
                </>
              ) : (
                <>
                  <UserPlus aria-hidden="true" /> Join the crew
                </>
              )}
            </button>
            <p className="halo-paypage-foot">
              This code works once. Your name goes on the crew list your foreman sees.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
