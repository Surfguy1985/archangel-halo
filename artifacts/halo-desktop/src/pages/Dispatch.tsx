import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, Inbox, GripVertical, AlertTriangle, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJobs,
  useListCrews,
  useDispatchJob,
  getListJobsQueryKey,
  getListCrewsQueryKey,
  getGetCalendarQueryKey,
  getGetTodayQueryKey,
  getGetStaffingContextQueryKey,
  type Job,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d: Date) {
  return addDays(d, -d.getDay());
}
function fmtTimeShort(hhmm: string) {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const mer = h! >= 12 ? "PM" : "AM";
  const hr = h! % 12 === 0 ? 12 : h! % 12;
  return m ? `${hr}:${pad(m!)} ${mer}` : `${hr} ${mer}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Minimum gap (in minutes) required between consecutive scheduled jobs in the
 *  same crew/day cell before the board flags a time clash. */
const MIN_GAP_MINUTES = 60;

/** Convert "HH:MM" → total minutes since midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True when any two consecutive timed jobs in the cell are closer together
 *  than MIN_GAP_MINUTES (covers identical start times as a special case).
 *  Jobs must already be sorted by scheduledTime ascending (byCell does this). */
function hasTimeClash(cellJobs: Job[]) {
  const times = cellJobs
    .filter((j) => j.scheduledTime)
    .map((j) => toMinutes(j.scheduledTime!));
  for (let i = 1; i < times.length; i++) {
    if (times[i]! - times[i - 1]! < MIN_GAP_MINUTES) return true;
  }
  return false;
}
const FINISHED = new Set(["complete", "paid", "cancelled"]);

/** Dispatch cards show the exact service(s) sold; " — n BR" size suffixes are
 *  stripped for readability. Falls back to category/description. */
function serviceLabel(job: Job) {
  const services = (job.services ?? []).map((s) =>
    s.replace(/\s*[—–-]\s*\d\s*BR\s*$/i, "").trim(),
  );
  const unique = services.filter((s, i) => services.indexOf(s) === i);
  if (unique.length > 0) return unique.join(" · ");
  return job.category || job.description || "Job";
}

type DropTarget =
  | { kind: "cell"; crewId: string; date: string }
  | { kind: "backlog" };

function targetKey(t: DropTarget) {
  return t.kind === "backlog" ? "backlog" : `${t.crewId}|${t.date}`;
}

export default function Dispatch() {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState<Date>(today);
  const [over, setOver] = useState<string | null>(null);
  // After a drop on a crew/day, offer an optional start time (skippable).
  // isEdit=true when triggered by clicking the time chip on an existing card.
  const [timePrompt, setTimePrompt] = useState<{
    jobId: string;
    jobNo: string;
    crewId: string;
    date: string;
    time: string;
    isEdit: boolean;
  } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const ws = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const todayStr = ymd(new Date());

  const { data: jobs, isLoading: jobsLoading } = useListJobs();
  const { data: crews, isLoading: crewsLoading } = useListCrews();
  const isLoading = jobsLoading || crewsLoading;

  const activeCrews = useMemo(
    () => (crews ?? []).filter((c) => c.active !== false),
    [crews],
  );
  const openJobs = useMemo(
    () => (jobs ?? []).filter((j) => !FINISHED.has(j.status)),
    [jobs],
  );
  const backlog = useMemo(
    () => openJobs.filter((j) => !j.crewLeaderId),
    [openJobs],
  );
  const assignedNoDate = useMemo(
    () => openJobs.filter((j) => j.crewLeaderId && !j.scheduledOn),
    [openJobs],
  );
  const byCell = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of openJobs) {
      if (!j.crewLeaderId || !j.scheduledOn) continue;
      const key = `${j.crewLeaderId}|${j.scheduledOn}`;
      const arr = map.get(key) ?? [];
      arr.push(j);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.scheduledTime ?? "99").localeCompare(b.scheduledTime ?? "99"));
    }
    return map;
  }, [openJobs]);

  const dispatch = useDispatchJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListCrewsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetStaffingContextQueryKey(),
        });
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ??
          "That move didn't stick — try again.";
        toast({ title: "Couldn't dispatch job", description: msg, variant: "destructive" });
      },
    },
  });

  const handleDrop = (target: DropTarget, ev: React.DragEvent) => {
    ev.preventDefault();
    setOver(null);
    const jobId = ev.dataTransfer.getData("text/plain");
    if (!jobId || dispatch.isPending) return;
    const job = openJobs.find((j) => j.id === jobId);
    if (!job) return;
    if (target.kind === "backlog") {
      if (!job.crewLeaderId && !job.scheduledOn) return;
      dispatch.mutate({ id: jobId, data: { crewLeaderId: null, scheduledOn: null } });
    } else {
      if (job.crewLeaderId === target.crewId && job.scheduledOn === target.date) return;
      dispatch.mutate(
        {
          id: jobId,
          data: { crewLeaderId: target.crewId, scheduledOn: target.date },
        },
        {
          onSuccess: () =>
            setTimePrompt({
              jobId,
              jobNo: job.jobNo,
              crewId: target.crewId,
              date: target.date,
              time: job.scheduledTime ?? "",
              isEdit: false,
            }),
        },
      );
    }
  };

  const commitTime = () => {
    if (!timePrompt || !timePrompt.time) return;
    dispatch.mutate({
      id: timePrompt.jobId,
      data: {
        crewLeaderId: timePrompt.crewId,
        scheduledOn: timePrompt.date,
        scheduledTime: timePrompt.time,
      },
    });
    setTimePrompt(null);
  };

  const clearTime = () => {
    if (!timePrompt) return;
    dispatch.mutate({
      id: timePrompt.jobId,
      data: {
        crewLeaderId: timePrompt.crewId,
        scheduledOn: timePrompt.date,
        scheduledTime: null,
      },
    });
    setTimePrompt(null);
  };

  const openEditTime = (job: Job) => {
    if (!job.crewLeaderId || !job.scheduledOn) return;
    setTimePrompt({
      jobId: job.id,
      jobNo: job.jobNo,
      crewId: job.crewLeaderId,
      date: job.scheduledOn,
      time: job.scheduledTime ?? "",
      isEdit: true,
    });
  };

  const dragProps = (target: DropTarget) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(targetKey(target));
    },
    onDragLeave: () => setOver((cur) => (cur === targetKey(target) ? null : cur)),
    onDrop: (e: React.DragEvent) => handleDrop(target, e),
  });

  const headerTitle = (() => {
    const we = addDays(ws, 6);
    const sameMonth = ws.getMonth() === we.getMonth();
    return sameMonth
      ? `${ws.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`
      : `${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${we.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  })();

  return (
    <div className="p-8 h-screen flex flex-col animate-in fade-in duration-500">
      <header className="flex items-center gap-4 mb-5 shrink-0">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)] truncate">
            Dispatch
          </h1>
          <p className="text-muted-foreground text-sm">
            {headerTitle} — drag jobs onto a crew &amp; day to assign
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCursor(addDays(cursor, -7))}
            className="w-9 h-9 grid place-items-center border border-[var(--hairline)] rounded-full bg-card hover:bg-black/5 transition-colors"
            aria-label="Previous week"
            data-testid="button-prev-week"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="px-4 h-9 text-sm font-semibold border border-[var(--hairline)] rounded-full bg-card hover:bg-black/5 transition-colors"
            data-testid="button-this-week"
          >
            This week
          </button>
          <button
            onClick={() => setCursor(addDays(cursor, 7))}
            className="w-9 h-9 grid place-items-center border border-[var(--hairline)] rounded-full bg-card hover:bg-black/5 transition-colors"
            aria-label="Next week"
            data-testid="button-next-week"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </header>

      {isLoading ? (
        <Skeleton className="flex-1 w-full rounded-[20px]" />
      ) : (
        <div className="flex-1 min-h-0 flex gap-4">
          {/* Backlog */}
          <div
            {...dragProps({ kind: "backlog" })}
            className={`w-[240px] shrink-0 flex flex-col bg-card rounded-[20px] border shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden transition-colors ${
              over === "backlog"
                ? "border-[var(--gold)] bg-[color-mix(in_srgb,var(--gold-light)_8%,var(--card))]"
                : "border-[var(--hairline)]"
            }`}
            data-testid="dropzone-backlog"
          >
            <div className="px-4 py-3 border-b border-[var(--hairline)] flex items-center gap-2 shrink-0">
              <Inbox className="w-4 h-4 text-[var(--gold)]" />
              <span className="text-sm font-display font-bold text-[var(--ink)]">
                Backlog
              </span>
              <span className="ml-auto text-[11px] font-bold text-muted-foreground">
                {backlog.length}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2.5 flex flex-col gap-2">
              {backlog.length === 0 && assignedNoDate.length === 0 && (
                <p className="text-xs text-muted-foreground px-1.5 py-2">
                  No unassigned jobs. Drag a job here to send it back to the
                  backlog.
                </p>
              )}
              {backlog.map((j) => (
                <JobCard key={j.id} job={j} pending={dispatch.isPending} />
              ))}
              {assignedNoDate.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-muted-foreground px-1.5 pt-2">
                    Assigned · no date
                  </div>
                  {assignedNoDate.map((j) => (
                    <JobCard key={j.id} job={j} pending={dispatch.isPending} showCrew />
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Crew × day grid */}
          <div className="flex-1 min-w-0 flex flex-col bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden">
            <div className="flex-1 min-h-0 overflow-auto">
              <div
                className="grid min-w-[900px]"
                style={{
                  gridTemplateColumns: "160px repeat(7, minmax(110px, 1fr))",
                }}
              >
                {/* Header row */}
                <div className="sticky top-0 z-10 bg-card border-b border-[var(--hairline)]" />
                {days.map((d) => {
                  const key = ymd(d);
                  const isToday = key === todayStr;
                  return (
                    <div
                      key={key}
                      className="sticky top-0 z-10 bg-card border-b border-l border-[var(--hairline)] px-2 py-2 flex items-center justify-center gap-1.5"
                    >
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                        {DAY_NAMES[d.getDay()]}
                      </span>
                      <span
                        className={`w-6 h-6 grid place-items-center rounded-full text-[12px] font-display font-bold ${
                          isToday ? "bg-[var(--red)] text-white" : "text-[var(--ink)]"
                        }`}
                      >
                        {d.getDate()}
                      </span>
                    </div>
                  );
                })}

                {activeCrews.map((crew) => (
                  <CrewRow
                    key={crew.id}
                    crew={crew}
                    days={days}
                    byCell={byCell}
                    over={over}
                    dragProps={dragProps}
                    pending={dispatch.isPending}
                    todayStr={todayStr}
                    onEditTime={openEditTime}
                  />
                ))}
              </div>
              {activeCrews.length === 0 && (
                <p className="text-sm text-muted-foreground p-6">
                  No active crews yet — add crews to start dispatching.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {timePrompt && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/20"
          onClick={() => setTimePrompt(null)}
          data-testid="overlay-dispatch-time"
        >
          <div
            className="bg-card rounded-[16px] border border-[var(--hairline)] shadow-[0_8px_32px_rgba(0,0,0,0.16)] p-5 w-[300px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-display font-bold text-[var(--ink)]">
              {timePrompt.isEdit ? "Edit start time" : "Set a start time?"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {timePrompt.isEdit
                ? `${timePrompt.jobNo} — change or remove the scheduled start time.`
                : `${timePrompt.jobNo} is on the day — optionally pick when the crew should start.`}
            </p>
            <input
              type="time"
              value={timePrompt.time}
              onChange={(e) =>
                setTimePrompt((p) => (p ? { ...p, time: e.target.value } : p))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTime();
              }}
              autoFocus
              className="mt-3 w-full h-10 px-3 rounded-[10px] border border-[var(--hairline)] bg-card text-sm text-[var(--ink)]"
              data-testid="input-dispatch-start-time"
            />
            <div className="mt-4 flex items-center gap-2">
              {/* Remove time — only shown when editing an existing time */}
              {timePrompt.isEdit && (
                <button
                  type="button"
                  onClick={clearTime}
                  disabled={dispatch.isPending}
                  className="px-3.5 h-9 text-sm font-semibold rounded-full border border-[var(--hairline)] bg-card text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  data-testid="button-clear-start-time"
                >
                  Remove time
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setTimePrompt(null)}
                className="px-3.5 h-9 text-sm font-semibold rounded-full border border-[var(--hairline)] bg-card hover:bg-black/5 transition-colors"
                data-testid="button-skip-start-time"
              >
                {timePrompt.isEdit ? "Cancel" : "Skip"}
              </button>
              <button
                type="button"
                onClick={commitTime}
                disabled={!timePrompt.time || dispatch.isPending}
                className="px-4 h-9 text-sm font-bold rounded-full bg-[var(--gold-light,#B4FF44)] text-black disabled:opacity-50 transition-opacity"
                data-testid="button-set-start-time"
              >
                {timePrompt.isEdit ? "Save" : "Set time"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CrewRow({
  crew,
  days,
  byCell,
  over,
  dragProps,
  pending,
  todayStr,
  onEditTime,
}: {
  crew: { id: string; name: string; trade?: string | null; selfiePath?: string | null };
  days: Date[];
  byCell: Map<string, Job[]>;
  over: string | null;
  dragProps: (t: DropTarget) => Record<string, unknown>;
  pending: boolean;
  todayStr: string;
  onEditTime: (job: Job) => void;
}) {
  return (
    <>
      <div className="border-b border-border px-3 py-2.5 flex items-center gap-2.5 min-h-[76px]">
        {crew.selfiePath ? (
          <img
            src={`/api/storage${crew.selfiePath}`}
            alt={crew.name}
            className="w-8 h-8 rounded-full object-cover shrink-0"
          />
        ) : (
          <span className="w-8 h-8 rounded-full bg-[var(--ink)] text-white grid place-items-center text-[11px] font-display font-bold shrink-0">
            {crew.name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join("")
              .toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <Link
            href={`/crews/${crew.id}`}
            className="block text-[13px] font-display font-bold text-[var(--ink)] truncate hover:underline"
            data-testid={`link-crew-${crew.id}`}
          >
            {crew.name}
          </Link>
          {crew.trade && (
            <div className="text-[11px] text-muted-foreground truncate">
              {crew.trade}
            </div>
          )}
        </div>
      </div>
      {days.map((d) => {
        const date = ymd(d);
        const cellKey = `${crew.id}|${date}`;
        const cellJobs = byCell.get(cellKey) ?? [];
        const isOver = over === cellKey;
        const isToday = date === todayStr;
        const overbooked = cellJobs.length > 1;
        const clash = overbooked && hasTimeClash(cellJobs);
        return (
          <div
            key={cellKey}
            {...dragProps({ kind: "cell", crewId: crew.id, date })}
            className={`border-b border-l border-border p-1.5 flex flex-col gap-1.5 min-h-[76px] transition-colors ${
              isOver
                ? "bg-[color-mix(in_srgb,var(--gold-light)_14%,var(--card))]"
                : clash
                  ? "bg-red-500/10"
                  : overbooked
                    ? "bg-amber-400/10"
                    : isToday
                      ? "bg-[var(--gold-tint,rgba(212,175,55,0.05))]"
                      : ""
            }`}
            data-testid={`dropzone-cell-${crew.id}-${date}`}
          >
            {overbooked && (
              <div
                className={`flex items-center gap-1 self-start rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  clash
                    ? "bg-red-600 text-white"
                    : "bg-amber-500/15 text-amber-700"
                }`}
                title={
                  clash
                    ? `Consecutive jobs are less than ${MIN_GAP_MINUTES} min apart — likely overlapping`
                    : `${cellJobs.length} jobs booked for this crew on this day`
                }
                data-testid={`badge-overbooked-${crew.id}-${date}`}
              >
                <AlertTriangle className="w-3 h-3" />
                {clash ? "Time clash" : `${cellJobs.length} jobs`}
              </div>
            )}
            {cellJobs.map((j) => (
              <JobCard key={j.id} job={j} pending={pending} compact onEditTime={() => onEditTime(j)} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function JobCard({
  job,
  pending,
  compact,
  showCrew,
  onEditTime,
}: {
  job: Job;
  pending: boolean;
  compact?: boolean;
  showCrew?: boolean;
  /** When provided, the time chip becomes a clickable button to edit/set the start time. */
  onEditTime?: () => void;
}) {
  // Primary label: "1601 — Make Ready" or just service if no unit.
  const svcLabel = serviceLabel(job);
  const headline = job.unitNo ? `${job.unitNo} — ${svcLabel}` : svcLabel;

  return (
    <div
      draggable={!pending}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", job.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group/card rounded-[10px] border border-[var(--hairline)] bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-[var(--gold)] transition-colors ${
        pending ? "opacity-60" : ""
      }`}
      data-testid={`card-dispatch-job-${job.id}`}
    >
      <div className="flex items-start gap-1">
        <GripVertical className="w-3 h-3 mt-[2px] text-muted-foreground/50 shrink-0" />
        <div className="min-w-0 flex-1">
          {/* Unit + service on one line, time on the next */}
          <Link
            href={`/jobs/${job.id}`}
            onClick={(e) => e.stopPropagation()}
            className={`block font-display font-bold text-[var(--ink)] hover:underline leading-tight ${
              compact ? "text-[12px] line-clamp-2" : "text-[13px] line-clamp-3"
            }`}
            data-testid={`link-dispatch-job-${job.id}`}
          >
            {headline}
          </Link>
          {/* Time chip — clickable when onEditTime is provided */}
          {onEditTime ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditTime();
              }}
              className="flex items-center gap-0.5 mt-[2px] text-[10px] font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] hover:underline transition-colors cursor-pointer"
              title={job.scheduledTime ? "Edit start time" : "Set start time"}
              data-testid={`btn-edit-time-${job.id}`}
            >
              <Clock className="w-2.5 h-2.5 shrink-0" />
              {job.scheduledTime ? fmtTimeShort(job.scheduledTime) : (
                <span className="opacity-0 group-hover/card:opacity-60 transition-opacity">
                  Set time
                </span>
              )}
            </button>
          ) : (
            job.scheduledTime && (
              <div className="text-[10px] font-semibold text-[var(--gold-dark)] mt-[2px]">
                {fmtTimeShort(job.scheduledTime)}
              </div>
            )
          )}
          {!compact && job.propertyName && (
            <div className="text-[10px] text-muted-foreground truncate mt-0.5">
              {job.propertyName}
            </div>
          )}
          {showCrew && job.crewLeaderName && (
            <div className="text-[10px] font-semibold text-[var(--gold)] truncate mt-0.5">
              {job.crewLeaderName}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
