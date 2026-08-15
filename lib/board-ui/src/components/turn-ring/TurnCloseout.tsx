import { useEffect, useState } from "react";
import { formatStageClock } from "./clock";
import "./turnCloseout.css";

export type TurnClockFields = {
  timezone?: string;
  vacantSince?: string | null;
  requestReceivedAt?: string | null;
  completedAt?: string | null;
  poReceivedAt?: string | null;
  poNumber?: string | null;
  clockStopped?: boolean;
  clockStoppedAt?: string | null;
};

function civilStamp(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16);
  }
}

function elapsedMs(startIso: string | null | undefined, stopMs: number): number {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, stopMs - start);
}

export function LiveElapsed(props: {
  startIso: string | null | undefined;
  stopIso?: string | null;
  running: boolean;
  empty?: string;
}) {
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!props.running) return;
    const ms = reduce ? 30_000 : 1_000;
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [props.running, reduce]);

  if (!props.startIso) return <span>{props.empty ?? "—"}</span>;
  const end = props.stopIso ? new Date(props.stopIso).getTime() : now;
  const label = formatStageClock(elapsedMs(props.startIso, end));
  return (
    <span className={props.running ? "turn-clock-live" : undefined} aria-live="off">
      {label}
    </span>
  );
}

export function TurnCloseoutStrip(props: TurnClockFields & { daysVacant?: number; compact?: boolean; tone?: "light" | "dark" }) {
  const zone = props.timezone || "America/Chicago";
  const stopped = Boolean(props.clockStopped);
  const vacantStop = stopped ? props.clockStoppedAt : null;
  const workStop = props.completedAt ?? null;
  const poStop = props.poReceivedAt ?? null;

  return (
    <div className={`turn-closeout${props.compact ? " compact" : ""}${props.tone === "dark" ? " on-dark" : ""}`}>
      <p className="turn-closeout-vacant">
        <LiveElapsed startIso={props.vacantSince} stopIso={vacantStop} running={!stopped && Boolean(props.vacantSince)} />
        <small>
          vacant from move-out
          {typeof props.daysVacant === "number" ? ` · ${props.daysVacant} calendar days` : ""}
          {stopped ? " · stopped (complete + PO)" : ""}
        </small>
      </p>
      <div className="turn-closeout-split">
        <div>
          <small>Received</small>
          <b>{props.requestReceivedAt ? civilStamp(props.requestReceivedAt, zone) : "—"}</b>
          <em>turn request</em>
        </div>
        <div>
          <small>Work</small>
          <b>
            <LiveElapsed
              startIso={props.requestReceivedAt}
              stopIso={workStop}
              running={!props.completedAt && Boolean(props.requestReceivedAt)}
              empty="—"
            />
          </b>
          <em>{props.completedAt ? `done ${civilStamp(props.completedAt, zone)}` : "in progress"}</em>
        </div>
        <div>
          <small>PO / close-out</small>
          <b>
            {props.completedAt ? (
              <LiveElapsed
                startIso={props.completedAt}
                stopIso={poStop}
                running={Boolean(props.completedAt) && !props.poReceivedAt}
                empty="—"
              />
            ) : (
              "after complete"
            )}
          </b>
          <em>
            {props.poNumber
              ? `${props.poNumber}${props.poReceivedAt ? ` · ${civilStamp(props.poReceivedAt, zone)}` : ""}`
              : "waiting on PO"}
          </em>
        </div>
      </div>
    </div>
  );
}
