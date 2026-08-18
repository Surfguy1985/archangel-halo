import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./haloLevels.css";

export type ProofReelShot = {
  url: string;
  phase: string;
  takenAt?: string | null;
  crewName?: string | null;
  source?: string;
};

export type ProofReelUnit = {
  key: string;
  unitNo: string;
  propertyId?: string | null;
  propertyName?: string | null;
  jobId?: string | null;
  crewName?: string | null;
  before?: ProofReelShot | null;
  after?: ProofReelShot | null;
  latestAt?: string | null;
  photoCount: number;
};

/** "just now" / "3h ago" / "Apr 8" — short enough for a panel caption. */
function landed(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Frame(props: { shot?: ProofReelShot | null; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [props.shot?.url]);
  const showImage = !!props.shot?.url && !failed;
  return (
    <div className={`halo-reel-frame${showImage ? "" : " empty"}`}>
      {showImage ? (
        <img src={props.shot!.url} alt={`${props.label} photo`} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="halo-reel-frame-none">{failed ? "Photo unavailable" : `No ${props.label.toLowerCase()} yet`}</span>
      )}
      <em className={`halo-reel-chip ${props.label.toLowerCase()}`}>{props.label}</em>
    </div>
  );
}

/**
 * The Overview reel: one slide per unit, newest work first.  Ordering is the
 * server's job — this component never re-sorts, it only remembers which unit
 * the user parked on so a background refresh doesn't yank the slide away.
 */
export function HaloProofReel(props: {
  units: ProofReelUnit[];
  loading?: boolean;
  title?: string;
  onOpenUnit?: (unit: ProofReelUnit) => void;
}) {
  const units = props.units;
  const [parkedKey, setParkedKey] = useState<string | null>(null);

  const index = useMemo(() => {
    if (!parkedKey) return 0;
    const at = units.findIndex((u) => u.key === parkedKey);
    return at < 0 ? 0 : at;
  }, [parkedKey, units]);

  // The parked unit fell out of the feed (photo removed, filter changed):
  // drop back to the newest slide rather than pointing at nothing.
  useEffect(() => {
    if (parkedKey && !units.some((u) => u.key === parkedKey)) setParkedKey(null);
  }, [parkedKey, units]);

  const go = useCallback(
    (delta: number) => {
      if (units.length < 2) return;
      const next = (index + delta + units.length) % units.length;
      setParkedKey(units[next]?.key ?? null);
    },
    [index, units],
  );

  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchX.current;
    touchX.current = null;
    if (start == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  };

  if (props.loading && units.length === 0) {
    return (
      <div className="halo-reel loading" aria-busy="true">
        <div className="halo-reel-stage">
          <div className="halo-reel-frame empty skeleton" />
          <div className="halo-reel-frame empty skeleton" />
        </div>
        <p className="halo-reel-foot">Looking for field pictures…</p>
      </div>
    );
  }

  if (units.length === 0) {
    return (
      <div className="halo-reel empty-state">
        <div className="halo-reel-stage">
          <div className="halo-reel-frame empty">
            <span className="halo-reel-frame-none">No before yet</span>
            <em className="halo-reel-chip before">Before</em>
          </div>
          <div className="halo-reel-frame empty">
            <span className="halo-reel-frame-none">No after yet</span>
            <em className="halo-reel-chip after">After</em>
          </div>
        </div>
        <p className="halo-reel-foot">Pictures show up when the field posts them.</p>
      </div>
    );
  }

  const unit = units[index]!;
  const when = landed(unit.latestAt);
  const meta = [unit.propertyName, unit.crewName].filter(Boolean).join(" · ");

  return (
    <div
      className="halo-reel"
      role="group"
      aria-roledescription="carousel"
      aria-label="Before and after pictures by unit"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        }
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="halo-reel-head">
        <strong>
          Unit {unit.unitNo}
          {index === 0 && when ? <b className="halo-reel-new">Newest</b> : null}
        </strong>
        <span>{meta || props.title || "Field pictures"}</span>
      </div>

      <button
        type="button"
        className="halo-reel-stage tap"
        onClick={() => props.onOpenUnit?.(unit)}
        title={unit.jobId ? "Open this unit's job" : "Field pictures on this unit"}
      >
        <Frame shot={unit.before} label="Before" />
        <Frame shot={unit.after} label="After" />
      </button>

      <div className="halo-reel-foot">
        <span className="halo-reel-when">
          {when ? `Landed ${when}` : "Waiting on a timestamp"} · {unit.photoCount} photo
          {unit.photoCount === 1 ? "" : "s"}
        </span>
        {units.length > 1 && (
          <span className="halo-reel-nav">
            <button type="button" onClick={() => go(-1)} aria-label="Previous unit">
              ‹
            </button>
            <i>
              {index + 1}/{units.length}
            </i>
            <button type="button" onClick={() => go(1)} aria-label="Next unit">
              ›
            </button>
          </span>
        )}
      </div>

      {units.length > 1 && (
        <div className="halo-reel-dots" role="tablist" aria-label="Units with pictures">
          {units.slice(0, 10).map((u, i) => (
            <button
              key={u.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Unit ${u.unitNo}`}
              className={i === index ? "on" : ""}
              onClick={() => setParkedKey(u.key)}
            />
          ))}
          {units.length > 10 && <i>+{units.length - 10}</i>}
        </div>
      )}
    </div>
  );
}
