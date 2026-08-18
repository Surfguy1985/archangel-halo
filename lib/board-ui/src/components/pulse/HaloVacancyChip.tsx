import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PortfolioPulseDocument } from "@workspace/api-client-react";
import { formatUsdCents } from "./formatUsdCents";
import "./haloLevels.css";

function daysLabel(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}d`;
}

function ratioLabel(count: number, of: number): string {
  if (of <= 0 && count <= 0) return "—";
  if (count === 0) return "0";
  const den = Math.max(of, count);
  return `${count} / ${den}`;
}

export function HaloVacancyChip(props: {
  pulse: PortfolioPulseDocument | undefined;
  avgTurnDays: number | null;
  callbacks: { count: number; of: number };
  poProvideDays: number | null;
  poProvideSample?: number;
  poWaiting?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ top: 0, right: 0 });
  const cents = props.pulse?.headline.vacancyCostCents;
  const tiles = [...(props.pulse?.tiles ?? [])].sort((a, b) => {
    const da = a.medianTurnDays ?? 1e9;
    const db = b.medianTurnDays ?? 1e9;
    if (da !== db) return db - da;
    return a.name.localeCompare(b.name);
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (root.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="halo-vacancy" ref={root}>
      <button
        type="button"
        className="halo-vacancy-hit"
        aria-expanded={open}
        aria-label="Revenue lost to vacancy this month. Click to expand turn, callback, and PO times."
        onClick={() => {
          const node = root.current;
          if (node) {
            const r = node.getBoundingClientRect();
            setAnchor({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
          }
          setOpen((v) => !v);
        }}
      >
        <b>{cents != null && cents !== "" ? formatUsdCents(cents) : "—"}</b>
        <span>Lost to vacancy this month</span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={pop}
              className="halo-vacancy-pop"
              role="dialog"
              aria-label="Vacancy drivers this month"
              style={{ top: anchor.top, right: anchor.right }}
            >
          <p className="halo-vacancy-pop-kicker">What sits under that number</p>
          <div className="halo-vacancy-metrics">
            <div>
              <b>{daysLabel(props.pulse?.supporting.medianTurnDays ?? props.avgTurnDays)}</b>
              <span>Typical turn</span>
            </div>
            <div>
              <b>{ratioLabel(props.callbacks.count, props.callbacks.of)}</b>
              <span>Callback ratio</span>
            </div>
            <div>
              <b>{daysLabel(props.poProvideDays)}</b>
              <span>
                Time to provide a PO
                {props.poProvideSample ? ` · ${props.poProvideSample}` : ""}
              </span>
            </div>
          </div>
          {props.poWaiting != null && props.poWaiting > 0 ? (
            <p className="halo-vacancy-note">
              {props.poWaiting === 1 ? "1 live job is still waiting on a PO." : `${props.poWaiting} live jobs are still waiting on a PO.`}
            </p>
          ) : null}
          <p className="halo-vacancy-pop-kicker">Average turn by community</p>
          {tiles.length === 0 ? (
            <p className="halo-vacancy-note">No communities in this window yet.</p>
          ) : (
            tiles.map((t) => (
              <div key={t.propertyId} className="halo-vacancy-row">
                <strong>{t.name}</strong>
                <em>{daysLabel(t.medianTurnDays)}</em>
                <span>{formatUsdCents(t.vacancyCostCents)}</span>
              </div>
            ))
          )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
