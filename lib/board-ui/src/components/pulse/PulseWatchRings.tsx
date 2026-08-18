import "./haloLevels.css";

export function PulseWatchRings(props: {
  days: number | null;
  target?: number;
  openTurns?: number;
  doneToday?: number;
  sample?: number;
}) {
  const target = props.target && props.target > 0 ? props.target : 7;
  const days = props.days;
  const turnPct = days == null ? 0.12 : Math.max(0.08, Math.min(1, target / Math.max(days, 0.4)));
  const openPct = Math.max(0.08, Math.min(1, (props.openTurns ?? 0) / 12));
  const donePct = Math.max(0.08, Math.min(1, (props.doneToday ?? 0) / 8));
  const ring = (r: number, pct: number, color: string) => {
    const c = 2 * Math.PI * r;
    return (
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${(c * pct).toFixed(1)} ${c.toFixed(1)}`}
        transform="rotate(-90 48 48)"
      />
    );
  };
  return (
    <div className="halo-rings">
      <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="Average turn time">
        <circle cx="48" cy="48" r="38" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle cx="48" cy="48" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <circle cx="48" cy="48" r="18" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
        {ring(38, turnPct, "#B4FF44")}
        {ring(28, openPct, "#E4C25A")}
        {ring(18, donePct, "#7EC8FF")}
      </svg>
      <div className="halo-rings-meta">
        <p>Typical turn</p>
        <strong>{days == null ? "—" : `${days.toFixed(1)}d`}</strong>
        <span>
          {days == null
            ? "No finished turns in this window yet."
            : `Target ${target} days${props.sample ? ` · ${props.sample} done` : ""}.`}
        </span>
      </div>
    </div>
  );
}

export function HaloProofPair(props: {
  title: string;
  caption?: string;
  before?: string | null;
  after?: string | null;
  onOpen?: () => void;
}) {
  return (
    <button type="button" className="halo-proof" onClick={props.onOpen}>
      <span className="halo-proof-pair">
        {props.before ? <img src={props.before} alt="" /> : <i>Before</i>}
        {props.after ? <img src={props.after} alt="" /> : <i>After</i>}
      </span>
      <span>
        <strong>{props.title}</strong>
        <em>{props.caption ?? "Tap to open pictures"}</em>
      </span>
    </button>
  );
}
