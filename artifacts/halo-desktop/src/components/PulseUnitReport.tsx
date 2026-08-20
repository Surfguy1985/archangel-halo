/**
 * Pulse unit lookup + unit report popup.
 *
 * This is the one surface on the Pulse desk built for someone who is not us:
 * a property manager types a unit number and reads that unit's whole story.
 * It is deliberately a dead end — no links, no ids, no money, nothing that
 * opens a back-office screen. The endpoints behind it (/pulse/units and
 * /pulse/unit-report) return sanitised read models for the same reason.
 */
import { useEffect, useMemo, useState } from "react";
import { Camera, Loader2, Maximize2, Minimize2, Search, X } from "lucide-react";
import {
  getGetPulseUnitReportQueryKey,
  getListPulseUnitsQueryKey,
  useGetPulseUnitReport,
  useListPulseUnits,
  type PulseUnitMatch,
  type PulseUnitPhoto,
} from "@workspace/api-client-react";

export type PulseUnitPick = { unitNo: string; propertyId: string | null };

const stageTone = (stage: string) =>
  stage === "in_turn" ? "amber" : stage === "complete" ? "lime" : "muted";

const dateLabel = (v: string | null | undefined) => {
  if (!v) return null;
  // Date-only values are local calendar days — never let UTC shift them.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  const dt = new Date(v);
  return Number.isNaN(dt.getTime())
    ? null
    : dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/**
 * The search bar that sits above the before/after reel.
 *
 * Deliberately NOT scoped to the property selected on the map: people walk up
 * and type a unit number, and silently hiding the unit because a different
 * property is selected reads as "HALO can't find it". Each hit names its
 * property instead.
 */
export function PulseUnitSearch({ onPick }: { onPick: (pick: PulseUnitPick) => void }) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(t);
  }, [term]);

  const params = useMemo(() => ({ ...(debounced ? { q: debounced } : {}), limit: 8 }), [debounced]);
  const { data: hits, isFetching } = useListPulseUnits(params, {
    query: { queryKey: getListPulseUnitsQueryKey(params), enabled: debounced.length > 0 },
  });

  const rows: PulseUnitMatch[] = debounced ? hits ?? [] : [];

  return (
    <div className="pulse-unit-find">
      <label className="pulse-unit-find-bar">
        <Search size={14} />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Unit number — pull up its report"
          aria-label="Search units by number"
          inputMode="numeric"
        />
        {isFetching && debounced ? <Loader2 size={14} className="pulse-unit-spin" /> : null}
        {term ? (
          <button type="button" aria-label="Clear unit search" onClick={() => setTerm("")}>
            <X size={13} />
          </button>
        ) : null}
      </label>

      {debounced ? (
        <div className="pulse-unit-hits" role="listbox" aria-label="Matching units">
          {rows.length === 0 ? (
            <p className="pulse-unit-empty">{isFetching ? "Looking…" : `No unit matching "${debounced}"`}</p>
          ) : (
            rows.map((u) => (
              <button
                key={u.key}
                type="button"
                role="option"
                aria-selected={false}
                className="pulse-unit-hit"
                onClick={() => {
                  onPick({ unitNo: u.unitNo, propertyId: u.propertyId ?? null });
                  setTerm("");
                }}
              >
                <strong>Unit {u.unitNo}</strong>
                <span>{u.propertyName ?? "No property on file"}</span>
                <em className={`pulse-unit-dot ${stageTone(u.stage)}`}>
                  {u.stage === "in_turn"
                    ? `${u.openJobs} open`
                    : u.stage === "complete"
                      ? "Complete"
                      : "No work yet"}
                </em>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function PhotoStrip({ label, shots }: { label: string; shots: PulseUnitPhoto[] }) {
  if (shots.length === 0) return null;
  return (
    <div className="pulse-unit-strip">
      <h5>
        {label} <span>{shots.length}</span>
      </h5>
      <div className="pulse-unit-shots">
        {shots.map((p, i) => (
          <figure key={`${p.url}-${i}`}>
            <img src={p.url} alt={`${label} — ${p.jobNo ?? "unit"}`} loading="lazy" />
            <figcaption>{dateLabel(p.takenAt) ?? ""}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** The popup itself: expandable, closeable, and a dead end by design. */
export function PulseUnitReportModal({
  pick,
  onClose,
}: {
  pick: PulseUnitPick;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const params = useMemo(
    () => ({ unit: pick.unitNo, ...(pick.propertyId ? { propertyId: pick.propertyId } : {}) }),
    [pick],
  );
  const { data, isLoading, isError } = useGetPulseUnitReport(params, {
    query: { queryKey: getGetPulseUnitReportQueryKey(params) },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const before = (data?.photos ?? []).filter((p) => p.phase === "before");
  const after = (data?.photos ?? []).filter((p) => p.phase === "after");

  return (
    <div className="pulse-modal" onClick={onClose}>
      <div
        className={`pulse-modal-card pulse-unit-report${expanded ? " expanded" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Unit ${pick.unitNo} report`}
      >
        <div className="pulse-modal-head">
          <div>
            <h3>Unit {data?.unitNo ?? pick.unitNo}</h3>
            <p className="pulse-unit-sub">{data?.propertyName ?? ""}</p>
          </div>
          <div className="pulse-unit-tools">
            <button
              type="button"
              className="pulse-modal-close"
              aria-label={expanded ? "Shrink report" : "Expand report"}
              title={expanded ? "Shrink" : "Expand"}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button type="button" className="pulse-modal-close" aria-label="Close report" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="pulse-unit-empty">Pulling the unit’s file…</p>
        ) : isError || !data ? (
          <p className="pulse-unit-empty">That unit’s report could not be loaded.</p>
        ) : (
          <>
            <div className="pulse-unit-facts">
              <div className={`pulse-unit-fact ${stageTone(data.stage)}`}>
                <b>{data.stageLabel}</b>
                <span>Status</span>
              </div>
              <div className="pulse-unit-fact">
                <b>{data.turnDays == null ? "—" : `${data.turnDays}d`}</b>
                <span>
                  {data.turnCompletedAt ? "Turn time" : "Turn running"}
                  {data.turnTarget ? ` · target ${data.turnTarget}d` : ""}
                </span>
              </div>
              <div className={`pulse-unit-fact ${data.openPos > 0 ? "amber" : ""}`}>
                <b>{data.openPos > 0 ? `${data.openPos} waiting` : "All on file"}</b>
                <span>Purchase orders</span>
              </div>
              <div className="pulse-unit-fact">
                <b>{data.jobCount}</b>
                <span>Jobs on this unit</span>
              </div>
            </div>

            <PhotoStrip label="Before" shots={before} />
            <PhotoStrip label="After" shots={after} />
            {before.length + after.length === 0 ? (
              <p className="pulse-unit-empty">
                <Camera size={14} /> No before/after pictures on this unit yet.
              </p>
            ) : null}

            <div className="pulse-unit-jobs">
              {data.jobs.length === 0 ? (
                <p className="pulse-unit-empty">No work has been logged on this unit.</p>
              ) : (
                data.jobs.map((j) => (
                  <article key={j.jobNo} className="pulse-unit-job">
                    <header>
                      <strong>{j.title || j.category || "Work order"}</strong>
                      <em className={`pulse-unit-dot ${j.stage === "complete" || j.stage === "cleared" ? "lime" : j.stage === "in_progress" ? "amber" : "muted"}`}>
                        {j.stageLabel}
                      </em>
                    </header>
                    <p className="pulse-unit-job-meta">
                      {[
                        j.crewName ? `Crew: ${j.crewName}` : null,
                        j.scheduledOn ? `Scheduled ${dateLabel(j.scheduledOn)}` : null,
                        j.completedAt ? `Finished ${dateLabel(j.completedAt)}` : null,
                        j.daysOnSite != null ? `${j.daysOnSite}d on site` : null,
                        j.poStatus === "on_file"
                          ? `PO ${j.poNumber}`
                          : j.poStatus === "received"
                            ? "PO received, being logged"
                            : "Waiting on PO",
                        j.warrantyUntil ? `Warranty to ${dateLabel(j.warrantyUntil)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {(j.scopeTotal ?? 0) > 0 ? (
                      <div className="pulse-unit-scope">
                        <span>
                          Scope {j.scopeDone ?? 0}/{j.scopeTotal ?? 0}
                        </span>
                        <ul>
                          {(j.scope ?? []).map((s, i) => (
                            <li key={`${j.jobNo}-${i}`} className={s.done ? "done" : ""}>
                              {s.service}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
