import {
  useGetJob,
  getGetJobQueryKey,
  getListJobsQueryKey,
  getGetTodayQueryKey,
  getGetCalendarQueryKey,
  useDraftJobRecap,
  useCreateRecapShare,
  useScheduleJob,
  useCompleteJob,
  useClearJob,
  useRestartJob,
  useDeleteJob,
  useListCrews,
  useUpdateJob,
  useUpdateProperty,
  useGetProperty,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";
import { MarginSection } from "@/components/MarginSection";
import { CrewPhotosSection } from "@/components/CrewPhotosSection";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import {
  ChevronLeft,
  Sparkles,
  Send,
  Check,
  CalendarDays,
  Trash2,
  Archive,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const fieldCls =
  "w-full bg-background border border-border rounded-md py-2.5 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const HOURS = Array.from({ length: 24 }, (_, h) => `${pad(h)}:00`);

export default function JobDetail() {
  const params = useParams();
  const id = params.id as string;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetJob(id, {
    query: { enabled: !!id, queryKey: getGetJobQueryKey(id) },
  });
  const { data: crews } = useListCrews();

  const [recapOpen, setRecapOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [recapBody, setRecapBody] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scheduledOn, setScheduledOn] = useState(localToday());
  const [windowStart, setWindowStart] = useState("08:00");
  const [crewLeaderId, setCrewLeaderId] = useState("");

  const draft = useDraftJobRecap();
  const createShare = useCreateRecapShare();
  const schedule = useScheduleJob();
  const complete = useCompleteJob();
  const clearJob = useClearJob();
  const restartJob = useRestartJob();
  const del = useDeleteJob();
  const updateJob = useUpdateJob();
  const updateProperty = useUpdateProperty();
  const propertyId = data?.job.propertyId ?? "";
  const { data: propData } = useGetProperty(propertyId, {
    query: { enabled: !!propertyId, queryKey: getGetPropertyQueryKey(propertyId) },
  });

  const invalidateJob = () => {
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
    if (propertyId) queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
  };

  const onClear = () =>
    clearJob.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateJob();
          toast({ title: "Job cleared to history" });
        },
        onError: (e) =>
          toast({ title: "Couldn't clear", description: e.message, variant: "destructive" }),
      },
    );

  const onRestart = () =>
    restartJob.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateJob();
          toast({ title: "Job restarted" });
        },
        onError: (e) =>
          toast({ title: "Couldn't restart", description: e.message, variant: "destructive" }),
      },
    );

  const generateRecap = () => {
    setRecapOpen(true);
    draft.mutate(
      { id },
      {
        onSuccess: (d) => {
          setSubject(d.subject);
          setRecapBody(d.body);
        },
      },
    );
  };

  const send = () => {
    createShare.mutate(
      { id, data: { subject, body: recapBody } },
      {
        onSuccess: async (share) => {
          invalidateJob();
          setRecapOpen(false);
          const url = `${window.location.origin}/recap/${share.token}`;
          const message = `${subject}\n\n${recapBody}\n\nFull recap with photos: ${url}`;
          try {
            await navigator.clipboard.writeText(url);
            toast({
              title: "Recap link copied",
              description: "Opening Messages with the prefilled recap…",
            });
          } catch {
            toast({ title: "Recap link ready", description: url });
          }
          window.location.href = `sms:?&body=${encodeURIComponent(message)}`;
        },
        onError: (e) =>
          toast({ title: "Couldn't create recap link", description: e.message, variant: "destructive" }),
      },
    );
  };

  const submitSchedule = () => {
    if (!scheduledOn) return;
    schedule.mutate(
      { id, data: { scheduledOn, windowStart: windowStart || undefined, crewLeaderId: crewLeaderId || undefined } },
      {
        onSuccess: () => {
          invalidateJob();
          setScheduleOpen(false);
          toast({ title: "Job scheduled" });
        },
        onError: (e) =>
          toast({ title: "Couldn't schedule", description: e.message, variant: "destructive" }),
      },
    );
  };

  const onComplete = () =>
    complete.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateJob();
          toast({ title: "Job marked complete" });
        },
        onError: (e) =>
          toast({ title: "Couldn't complete", description: e.message, variant: "destructive" }),
      },
    );

  const onDelete = () =>
    del.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          toast({ title: "Job deleted" });
          navigate(data?.job.propertyId ? `/properties/${data.job.propertyId}` : "/properties");
        },
        onError: (e) =>
          toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
      },
    );

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!data) return <div className="p-8 text-center text-muted-foreground">Job not found</div>;

  const { job, expenses, schedules, crewPhotos } = data;
  const leaders = (crews ?? []).filter((c) => c.isLeader !== false);
  const canComplete = job.status !== "complete" && job.status !== "paid" && job.status !== "cancelled";

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link
        href={job.propertyId ? `/properties/${job.propertyId}` : "/properties"}
        className="flex items-center gap-2 text-muted-foreground text-sm font-semibold w-fit hover:text-foreground"
      >
        <ChevronLeft className="w-4 h-4" /> Back
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">
            {job.category || "General"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {job.propertyName} {job.unitNo ? `· Unit ${job.unitNo}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setScheduleOpen(true)}
            className="flex items-center gap-2 bg-card border border-border px-4 py-2 rounded-md font-medium hover:bg-black/[0.03] transition-colors shadow-sm text-sm"
          >
            <CalendarDays className="w-4 h-4" />
            {schedules.length > 0 ? "Reschedule" : "Schedule"}
          </button>
          {canComplete && (
            <button
              onClick={onComplete}
              disabled={complete.isPending}
              className="flex items-center gap-2 bg-[var(--ink)] text-white px-4 py-2 rounded-md font-medium hover:opacity-90 transition-opacity shadow-sm text-sm disabled:opacity-50"
            >
              <Check className="w-4 h-4" /> {complete.isPending ? "Completing…" : "Complete"}
            </button>
          )}
          {job.status === "complete" && !job.clearedAt && (
            <button
              onClick={onClear}
              disabled={clearJob.isPending}
              className="flex items-center gap-2 bg-card border border-border px-4 py-2 rounded-md font-medium hover:bg-black/[0.03] transition-colors shadow-sm text-sm disabled:opacity-50"
            >
              <Archive className="w-4 h-4" /> {clearJob.isPending ? "Clearing…" : "Clear to history"}
            </button>
          )}
          {job.status === "complete" && (
            <button
              onClick={onRestart}
              disabled={restartJob.isPending}
              className="flex items-center gap-2 bg-card border border-border px-4 py-2 rounded-md font-medium text-[var(--gold-dark)] hover:bg-[rgba(143,106,31,0.06)] transition-colors shadow-sm text-sm disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" /> {restartJob.isPending ? "Restarting…" : "Restart"}
            </button>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 bg-card border border-border px-3 py-2 rounded-md font-medium hover:bg-destructive/10 hover:text-destructive transition-colors shadow-sm text-sm text-muted-foreground"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card rounded-xl shadow-sm border border-border p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Status</div>
                {job.status === "complete" ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                      <Check className="w-3 h-3" /> Completed
                    </span>
                    {job.clearedAt && <span className="text-xs text-muted-foreground">In job history</span>}
                  </div>
                ) : (
                  <div className="font-semibold text-base capitalize">{job.status.replace("_", " ")}</div>
                )}
              </div>
              <div className="text-right font-mono text-xs text-muted-foreground">
                <div>{job.jobNo}</div>
                {job.woNo && <div>WO: {job.woNo}</div>}
              </div>
            </div>
            <div className="text-sm text-[var(--ink2)] leading-relaxed">{job.description}</div>
          </div>

          <MarginSection
            title="Job margin"
            currentPct={job.marginPct != null ? Math.round(job.marginPct * 1000) / 10 : null}
            minFrac={propData?.property.marginMin}
            targetFrac={propData?.property.marginTarget}
            currentEditable
            saving={updateJob.isPending || updateProperty.isPending}
            helperText="Thresholds come from the property. Below-minimum jobs get flagged in Today."
            onSave={({ minFrac, targetFrac, currentFrac }) => {
              updateJob.mutate(
                { id, data: { marginPct: currentFrac ?? null } },
                {
                  onSuccess: () => {
                    invalidateJob();
                    if (propertyId)
                      queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
                    toast({ title: "Margin updated" });
                  },
                  onError: (e) =>
                    toast({ title: "Couldn't save margin", description: e.message, variant: "destructive" }),
                },
              );
              if (propertyId) {
                updateProperty.mutate(
                  { id: propertyId, data: { marginMin: minFrac, marginTarget: targetFrac } },
                  {
                    onSuccess: () => {
                      queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
                      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
                    },
                    onError: (e) =>
                      toast({ title: "Couldn't save thresholds", description: e.message, variant: "destructive" }),
                  },
                );
              }
            }}
          />

          <CrewPhotosSection photos={crewPhotos ?? []} />

          {(job.status === "complete" || job.recapSentAt) && (
            <section>
              <h2 className="text-lg font-display font-bold mb-3 text-[var(--ink)]">Client recap</h2>
              <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                {job.recapSentAt && !recapOpen ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-emerald-600" />
                    Recap sent {new Date(job.recapSentAt).toLocaleDateString()}
                    <button onClick={generateRecap} className="ml-auto text-sm font-semibold text-[var(--gold-dark)]">
                      Draft again
                    </button>
                  </div>
                ) : !recapOpen ? (
                  <button
                    onClick={generateRecap}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md bg-[var(--ink)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Sparkles className="w-4 h-4" /> Draft recap with AI
                  </button>
                ) : (
                  <div className="space-y-3">
                    {draft.isPending ? (
                      <div className="py-6 text-center text-sm text-muted-foreground animate-pulse">Writing the recap…</div>
                    ) : (
                      <>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Subject</div>
                          <input value={subject} onChange={(e) => setSubject(e.target.value)} className={fieldCls} />
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Message</div>
                          <textarea value={recapBody} onChange={(e) => setRecapBody(e.target.value)} rows={8} className={`${fieldCls} resize-y leading-relaxed`} />
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setRecapOpen(false)} className="text-sm font-semibold text-muted-foreground px-3 py-2">Cancel</button>
                          <button
                            onClick={send}
                            disabled={createShare.isPending || !subject || !recapBody}
                            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--gold)] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[var(--gold-dark)] transition-colors"
                          >
                            <Send className="w-4 h-4" /> {createShare.isPending ? "Preparing…" : "Send recap"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="text-lg font-display font-bold mb-3 text-[var(--ink)]">Schedule</h2>
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
              {schedules.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-4 text-sm">
                  <div>
                    <div className="font-semibold">{new Date(s.scheduledOn).toLocaleDateString()}</div>
                    {s.windowStart && <div className="text-xs text-muted-foreground">{s.windowStart}</div>}
                  </div>
                  <div className="text-xs font-medium capitalize text-muted-foreground">{s.status}</div>
                </div>
              ))}
              {!schedules.length && <div className="p-4 text-center text-sm text-muted-foreground">Not scheduled.</div>}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-display font-bold mb-3 text-[var(--ink)]">Expenses</h2>
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
              {expenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between p-4 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{e.vendor || e.category}</div>
                    <div className="text-xs text-muted-foreground truncate">{e.source || "Manual entry"}</div>
                  </div>
                  <div className="font-mono font-semibold shrink-0">${e.amount.toLocaleString()}</div>
                </div>
              ))}
              {!expenses.length && <div className="p-4 text-center text-sm text-muted-foreground">No expenses.</div>}
            </div>
          </section>
        </div>
      </div>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Schedule job</DialogTitle>
            <DialogDescription>{job.jobNo} · {job.category || "Job"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Date</div>
              <input type="date" className={fieldCls} value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Start time</div>
              <select className={fieldCls} value={windowStart} onChange={(e) => setWindowStart(e.target.value)}>
                {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Crew leader</div>
              <select className={fieldCls} value={crewLeaderId} onChange={(e) => setCrewLeaderId(e.target.value)}>
                <option value="">Unassigned</option>
                {leaders.map((c) => <option key={c.id} value={c.id}>{c.name}{c.trade ? ` · ${c.trade}` : ""}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={submitSchedule}
              disabled={schedule.isPending || !scheduledOn}
              className="flex items-center gap-2 bg-[var(--gold)] text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 hover:bg-[var(--gold-dark)] transition-colors"
            >
              <CalendarDays className="w-4 h-4" /> {schedule.isPending ? "Scheduling…" : "Schedule job"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the job and its schedules and expenses. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
