import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListJobsQueryKey, type Job } from "@workspace/api-client-react";
import "./haloLevels.css";

type PoRow = Job & { missing: boolean };

export function HaloPosCard(props: {
  jobs: Job[];
  selectedPropertyId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string>("");

  const rows = useMemo(() => {
    const live = props.jobs.filter((j) => !["complete", "paid", "cancelled", "canceled"].includes(j.status));
    const scoped = props.selectedPropertyId
      ? live.filter((j) => j.propertyId === props.selectedPropertyId)
      : live;
    const mapped: PoRow[] = scoped.map((j) => ({ ...j, missing: !j.poNumber?.trim() }));
    mapped.sort((a, b) => {
      if (a.missing !== b.missing) return a.missing ? -1 : 1;
      const pa = (a.propertyName ?? "").localeCompare(b.propertyName ?? "");
      if (pa) return pa;
      return (a.unitNo ?? "").localeCompare(b.unitNo ?? "", undefined, { numeric: true });
    });
    return mapped;
  }, [props.jobs, props.selectedPropertyId]);

  const missing = rows.filter((r) => r.missing).length;

  const save = async (job: Job) => {
    const poNumber = (draft[job.id] ?? "").trim();
    if (!poNumber) return;
    setBusy(job.id);
    setErr("");
    try {
      const r = await fetch(`/api/jobs/${job.id}/client-po`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poNumber }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; base44?: { ok?: boolean } };
      if (!r.ok) throw new Error(j.error || "Could not save PO");
      setDraft((d) => ({ ...d, [job.id]: "" }));
      await queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save PO");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="halo-desk">
      <p className="halo-pos-lead">
        Active units from the Work app. Type a missing PO here — dispatch and the field fill in automatically.
      </p>
      <p className="halo-desk-kicker">{missing === 0 ? "Every live unit has a PO" : `${missing} missing`}</p>
      {err ? <p className="halo-desk-empty">{err}</p> : null}
      {rows.length === 0 ? <p className="halo-desk-empty">No active units from Base44 yet.</p> : null}
      {rows.map((job) => (
        <div key={job.id} className="halo-pos-row" data-has={job.missing ? "false" : "true"}>
          <div className="halo-pos-top">
            <span className="halo-pos-unit">{job.unitNo || "—"}</span>
            <div className="halo-pos-meta">
              <strong>{job.propertyName || "Site"}</strong>
              <em>{job.crewLeaderName || "Uncrewed"} · {job.category || job.jobNo}</em>
            </div>
          </div>
          {job.missing ? (
            <form
              className="halo-pos-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save(job);
              }}
            >
              <input
                value={draft[job.id] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [job.id]: e.target.value }))}
                placeholder="PO number"
                autoComplete="off"
                aria-label={`PO for unit ${job.unitNo || job.jobNo}`}
              />
              <button type="submit" disabled={busy === job.id || !(draft[job.id] ?? "").trim()}>
                {busy === job.id ? "Saving" : "Save"}
              </button>
            </form>
          ) : (
            <p className="halo-pos-done">PO {job.poNumber}</p>
          )}
        </div>
      ))}
    </div>
  );
}
