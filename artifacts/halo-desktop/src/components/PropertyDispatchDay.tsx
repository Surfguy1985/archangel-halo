import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDispatchBoard,
  getGetDispatchBoardQueryKey,
  useCreateDispatchAssignment,
  useDeleteDispatchAssignment,
  useRequestDispatchMove,
  useUpdateDispatchChecklist,
  type DispatchBoard,
  type DispatchAssignment,
  type DispatchBoardJob,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  UserPlus,
  X,
  ArrowRightLeft,
  Clock,
  CheckCircle2,
  ListChecks,
  Hourglass,
} from "lucide-react";

type ApiErr = { data?: { error?: string } };

function errMsg(e: unknown, fallback: string) {
  return (e as ApiErr)?.data?.error || fallback;
}

function Avatar({
  name,
  selfiePath,
  size = 8,
}: {
  name: string;
  selfiePath?: string | null;
  size?: 7 | 8 | 9;
}) {
  const cls = size === 7 ? "w-7 h-7" : size === 9 ? "w-9 h-9" : "w-8 h-8";
  return (
    <div
      className={`${cls} rounded-full bg-[var(--ink)] text-[var(--gold-light)] grid place-items-center overflow-hidden shrink-0`}
    >
      {selfiePath ? (
        <img
          src={`/api/storage${selfiePath}`}
          alt={name}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="text-[11px] font-bold">
          {name
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p[0])
            .join("")}
        </span>
      )}
    </div>
  );
}

function CheckinDot({ status }: { status?: string | null }) {
  if (!status) return <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" title="No check-in yet" />;
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${status === "in" ? "bg-[var(--green)]" : "bg-[var(--orange)]"}`}
      title={status === "in" ? "Checked in" : "Checked out"}
    />
  );
}

/**
 * Read-only member chips for one job on a given day, reused on the job
 * detail page. Shows each assigned member with check-in dot + checklist
 * progress, pulled from the same dispatch board feed.
 */
export function JobDispatchMembers({ day, jobId }: { day: string; jobId: string }) {
  const { data, isLoading, error } = useGetDispatchBoard(day, {
    query: {
      queryKey: getGetDispatchBoardQueryKey(day),
      refetchInterval: 30_000,
    },
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (error || !data) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Couldn't load dispatch info.
      </div>
    );
  }

  const job = data.properties
    .flatMap((p) => p.jobs)
    .find((j) => j.jobId === jobId);
  const assignments = job?.assignments ?? [];

  if (assignments.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No members dispatched for this day yet.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-1.5">
      {assignments.map((a) => {
        const done = a.checklist.filter((i) => i.done).length;
        return (
          <div
            key={a.id}
            data-testid={`dispatch-member-${a.id}`}
            className="flex items-center gap-2.5 bg-black/[0.03] rounded-xl px-2.5 py-1.5"
          >
            <Avatar name={a.memberName} selfiePath={a.selfiePath} size={7} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--ink)] truncate flex items-center gap-1.5">
                {a.memberName} <CheckinDot status={a.checkinStatus} />
                {a.status === "pending_move" && (
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider text-[var(--orange)] inline-flex items-center gap-1"
                    title={`Move to ${a.pendingJobLabel ?? "another job"} awaiting foreman ${a.leaderName ?? ""}`}
                  >
                    <Hourglass className="w-3 h-3" /> awaiting foreman
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {a.checklist.length > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    {done === a.checklist.length ? (
                      <CheckCircle2 className="w-3 h-3 text-[var(--green)]" />
                    ) : (
                      <ListChecks className="w-3 h-3" />
                    )}
                    {done}/{a.checklist.length} scope items
                  </span>
                ) : (
                  "No scope items"
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PropertyDispatchDay({ day }: { day: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useGetDispatchBoard(day, {
    query: {
      queryKey: getGetDispatchBoardQueryKey(day),
      refetchInterval: 30_000,
    },
  });
  const [activeProp, setActiveProp] = useState<string | null>(null);
  const [pickedMember, setPickedMember] = useState<{ id: string; name: string } | null>(null);
  const [moving, setMoving] = useState<DispatchAssignment | null>(null);
  const [checklistFor, setChecklistFor] = useState<DispatchAssignment | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetDispatchBoardQueryKey(day) });

  const create = useCreateDispatchAssignment();
  const remove = useDeleteDispatchAssignment();
  const move = useRequestDispatchMove();

  const board: DispatchBoard | undefined = data;
  const properties = board?.properties ?? [];
  const current =
    properties.find((p) => p.propertyId === activeProp) ?? properties[0];

  const allJobs = useMemo(
    () => properties.flatMap((p) => p.jobs.map((j) => ({ ...j, propertyName: p.propertyName }))),
    [properties],
  );

  const assign = (jobId: string) => {
    if (!pickedMember) return;
    setActionError(null);
    create.mutate(
      { data: { day, jobId, memberId: pickedMember.id } },
      {
        onSuccess: () => {
          setPickedMember(null);
          invalidate();
        },
        onError: (e) => setActionError(errMsg(e, "Couldn't assign.")),
      },
    );
  };

  const doMove = (toJobId: string) => {
    if (!moving) return;
    setActionError(null);
    move.mutate(
      { id: moving.id, data: { toJobId } },
      {
        onSuccess: () => {
          setMoving(null);
          invalidate();
        },
        onError: (e) => setActionError(errMsg(e, "Couldn't move.")),
      },
    );
  };

  const unassign = (id: string) => {
    setActionError(null);
    remove.mutate(
      { id },
      {
        onSuccess: () => invalidate(),
        onError: (e) => setActionError(errMsg(e, "Couldn't remove.")),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex-1 grid grid-cols-[1fr_320px] gap-6">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (error || !board) {
    return (
      <div className="flex-1 grid place-items-center text-muted-foreground text-sm">
        Couldn't load the dispatch board.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex gap-6">
      {/* Left: property tabs + jobs */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {actionError && (
          <div className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-4 py-2 flex items-center justify-between">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} aria-label="Dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {pickedMember && (
          <div className="text-sm bg-[var(--gold-tint)] border border-[var(--gold)]/30 rounded-xl px-4 py-2 flex items-center justify-between">
            <span>
              Assigning <b>{pickedMember.name}</b> — pick a job below.
            </span>
            <button onClick={() => setPickedMember(null)} className="font-semibold">
              Cancel
            </button>
          </div>
        )}
        {moving && (
          <div className="text-sm bg-[var(--gold-tint)] border border-[var(--gold)]/30 rounded-xl px-4 py-2 flex items-center justify-between">
            <span>
              Moving <b>{moving.memberName}</b>
              {moving.leaderName ? ` (foreman ${moving.leaderName} must approve)` : ""} — pick the new job.
            </span>
            <button onClick={() => setMoving(null)} className="font-semibold">
              Cancel
            </button>
          </div>
        )}

        {properties.length === 0 ? (
          <div className="flex-1 grid place-items-center border border-dashed border-[var(--hairline)] rounded-[20px] text-muted-foreground bg-card">
            No active jobs for this day. Schedule jobs first, then dispatch members here.
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              {properties.map((p) => (
                <button
                  key={p.propertyId}
                  onClick={() => setActiveProp(p.propertyId)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                    current?.propertyId === p.propertyId
                      ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                      : "bg-card border-[var(--hairline)] text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.propertyName}
                  <span className="ml-2 opacity-70">{p.jobs.length}</span>
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              {current?.jobs.map((job) => (
                <JobCard
                  key={job.jobId}
                  job={job}
                  highlight={!!pickedMember || !!moving}
                  disabled={
                    (moving && moving.jobId === job.jobId) || false
                  }
                  onPick={() => (moving ? doMove(job.jobId) : assign(job.jobId))}
                  pickLabel={moving ? "Move here" : pickedMember ? "Assign here" : null}
                  onUnassign={unassign}
                  onStartMove={(a) => {
                    setPickedMember(null);
                    setMoving(a);
                  }}
                  onChecklist={(a) => setChecklistFor(a)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Right: roster grouped by team */}
      <aside className="w-[320px] shrink-0 overflow-y-auto space-y-4">
        <h3 className="font-display font-bold text-[var(--ink)] flex items-center gap-2">
          <Users className="w-4 h-4 text-[var(--gold)]" /> Crew roster
        </h3>
        {board.teams.map((t, i) => (
          <div
            key={t.leaderId ?? `independent-${i}`}
            className="bg-card border border-[var(--hairline)] rounded-[16px] p-3 space-y-1"
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--gold-dark)] px-1 pb-1">
              {t.leaderName ? `${t.leaderName}'s team` : "Independent"}
            </div>
            {t.members.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMoving(null);
                  setPickedMember(
                    pickedMember?.id === m.id ? null : { id: m.id, name: m.name },
                  );
                }}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-left transition-colors ${
                  pickedMember?.id === m.id
                    ? "bg-[var(--gold-tint)] ring-1 ring-[var(--gold)]/40"
                    : "hover:bg-black/5"
                }`}
              >
                <Avatar name={m.name} selfiePath={m.selfiePath} size={7} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[var(--ink)] truncate flex items-center gap-1.5">
                    {m.name} <CheckinDot status={m.checkinStatus} />
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {m.trade || "General"}
                    {m.assignmentCount > 0
                      ? ` · ${m.assignmentCount} job${m.assignmentCount === 1 ? "" : "s"} today`
                      : " · unassigned"}
                  </div>
                </div>
                <UserPlus className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        ))}
      </aside>

      {checklistFor && (
        <ChecklistEditor
          day={day}
          assignment={checklistFor}
          onClose={() => setChecklistFor(null)}
        />
      )}
    </div>
  );
}

function JobCard({
  job,
  highlight,
  disabled,
  pickLabel,
  onPick,
  onUnassign,
  onStartMove,
  onChecklist,
}: {
  job: DispatchBoardJob & { propertyName?: string };
  highlight: boolean;
  disabled: boolean;
  pickLabel: string | null;
  onPick: () => void;
  onUnassign: (id: string) => void;
  onStartMove: (a: DispatchAssignment) => void;
  onChecklist: (a: DispatchAssignment) => void;
}) {
  // "1601 — Make Ready" format. Falls back to description then job number.
  const j = job as DispatchBoardJob & { category?: string | null; propertyName?: string };
  const svcLabel = j.category || j.description || job.jobNo;
  const headline = job.unitNo ? `${job.unitNo} — ${svcLabel}` : svcLabel;

  return (
    <div
      className={`bg-card border rounded-[20px] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all ${
        highlight && !disabled
          ? "border-[var(--gold)]/60 ring-1 ring-[var(--gold)]/30"
          : "border-[var(--hairline)]"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Primary: "1601 — Make Ready" */}
          <div className="font-display font-bold text-[var(--ink)] text-[15px] leading-snug truncate">
            {headline}
          </div>

          {/* Second row: start time + status badge + job number */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {job.scheduledTime && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--gold-dark)] bg-[color-mix(in_srgb,var(--gold-light)_15%,transparent)] px-2 py-0.5 rounded-full">
                <Clock className="w-3 h-3" />
                {job.scheduledTime}
              </span>
            )}
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-black/5 text-muted-foreground">
              {job.status.replace(/_/g, " ")}
            </span>
            <span className="text-[10px] text-muted-foreground">{job.jobNo}</span>
          </div>

          {/* Crew leader assigned on the main board */}
          {job.crewLeaderName && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Crew</span>
              <span className="text-[11px] font-semibold text-[var(--ink)] truncate">{job.crewLeaderName}</span>
            </div>
          )}
        </div>
        {pickLabel && !disabled && (
          <button onClick={onPick} className="btn-gold px-3 py-1.5 text-sm shrink-0">
            {pickLabel}
          </button>
        )}
      </div>

      {job.assignments.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {job.assignments.map((a) => {
            const done = a.checklist.filter((i) => i.done).length;
            return (
              <div
                key={a.id}
                className="flex items-center gap-2.5 bg-black/[0.03] rounded-xl px-2.5 py-1.5"
              >
                <Avatar name={a.memberName} selfiePath={a.selfiePath} size={7} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[var(--ink)] truncate flex items-center gap-1.5">
                    {a.memberName} <CheckinDot status={a.checkinStatus} />
                    {a.status === "pending_move" && (
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider text-[var(--orange)] inline-flex items-center gap-1"
                        title={`Move to ${a.pendingJobLabel ?? "another job"} awaiting foreman ${a.leaderName ?? ""}`}
                      >
                        <Hourglass className="w-3 h-3" /> awaiting foreman
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {a.checklist.length > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        {done === a.checklist.length ? (
                          <CheckCircle2 className="w-3 h-3 text-[var(--green)]" />
                        ) : (
                          <ListChecks className="w-3 h-3" />
                        )}
                        {done}/{a.checklist.length} scope items
                      </span>
                    ) : (
                      "No scope items"
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onChecklist(a)}
                  title="Edit scope of work"
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground"
                >
                  <ListChecks className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onStartMove(a)}
                  title="Move to another job"
                  disabled={a.status === "pending_move"}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground disabled:opacity-40"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onUnassign(a.id)}
                  title="Remove from this job"
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-black/5 hover:text-destructive"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChecklistEditor({
  day,
  assignment,
  onClose,
}: {
  day: string;
  assignment: DispatchAssignment;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState(assignment.checklist.map((i) => ({ ...i })));
  const [newText, setNewText] = useState("");
  const update = useUpdateDispatchChecklist();

  const save = () => {
    update.mutate(
      { id: assignment.id, data: { items } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetDispatchBoardQueryKey(day),
          });
          onClose();
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-[20px] border border-[var(--hairline)] shadow-xl w-full max-w-md p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display font-bold text-[var(--ink)]">
          Scope of work — {assignment.memberName}
        </h3>
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {items.map((i, idx) => (
            <div key={i.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={i.done}
                onChange={() =>
                  setItems((xs) =>
                    xs.map((x, j) => (j === idx ? { ...x, done: !x.done } : x)),
                  )
                }
              />
              <input
                className="flex-1 bg-white border border-border rounded-lg px-2.5 py-1.5 text-sm"
                value={i.text}
                onChange={(e) =>
                  setItems((xs) =>
                    xs.map((x, j) => (j === idx ? { ...x, text: e.target.value } : x)),
                  )
                }
              />
              <button
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))}
                className="p-1 text-muted-foreground hover:text-destructive"
                aria-label="Remove item"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">No scope items yet.</p>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-white border border-border rounded-lg px-2.5 py-1.5 text-sm"
            placeholder="Add a scope item…"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newText.trim()) {
                setItems((xs) => [
                  ...xs,
                  { id: crypto.randomUUID(), text: newText.trim(), done: false },
                ]);
                setNewText("");
              }
            }}
          />
          <button
            onClick={() => {
              if (!newText.trim()) return;
              setItems((xs) => [
                ...xs,
                { id: crypto.randomUUID(), text: newText.trim(), done: false },
              ]);
              setNewText("");
            }}
            className="px-3 py-1.5 rounded-lg border border-[var(--hairline)] text-sm font-semibold"
          >
            Add
          </button>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-lg hover:bg-black/5">
            Cancel
          </button>
          <button onClick={save} disabled={update.isPending} className="btn-gold px-4 py-2 text-sm">
            {update.isPending ? "Saving…" : "Save scope"}
          </button>
        </div>
      </div>
    </div>
  );
}
