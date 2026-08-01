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
  useRestartJob,
  useDeleteJob,
  useListCrews,
  useUpdateJob,
  useUpdateProperty,
  useGetProperty,
  getGetPropertyQueryKey,
  useCreateJobTrackerShare,
  useBroadcastJob,
  useListInvoices,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  type Invoice,
} from "@workspace/api-client-react";
import { InvoiceWizardDialog } from "@/components/InvoiceWizardDialog";
import { PushCardDialog, type PushPrefill } from "@/components/PushCardDialog";
import { RecordPaymentDialog } from "@/components/MoneyDialogs";
import { SendInvoiceDialog } from "@/components/SendInvoiceDialog";
import { MarginSection} from "@/components/MarginSection";
import { CrewPhotosSection} from "@/components/CrewPhotosSection";
import { useQueryClient} from "@tanstack/react-query";
import { useParams, Link, useLocation} from "wouter";
import {
  ChevronLeft,
  Sparkles,
  Send,
  Check,
  CalendarDays,
  Trash2,
  Archive,
  RotateCcw,
  Radio,
  FileDown,
  Megaphone,
  FileText,
  DollarSign,
  MessageSquareShare,
} from "lucide-react";
import { useState} from "react";
import { Skeleton} from "@/components/ui/skeleton";
import { useToast} from "@/hooks/use-toast";
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
  return`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const HOURS = Array.from({ length: 24}, (_, h) =>`${pad(h)}:00`);

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
  const restartJob = useRestartJob();
  const del = useDeleteJob();
  const updateJob = useUpdateJob();
  const updateProperty = useUpdateProperty();
  const trackerShare = useCreateJobTrackerShare();
  const [trackerCopied, setTrackerCopied] = useState(false);
  const broadcast = useBroadcastJob();
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [pushPrefill, setPushPrefill] = useState<PushPrefill | null>(null);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [sendInvoice, setSendInvoice] = useState<Invoice | null>(null);
  const { data: allInvoices } = useListInvoices();
  const jobInvoices = (allInvoices ?? []).filter((i) => i.jobId === id);

  const invalidateMoney = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
  };

  const openUpdateClient = (prefill: PushPrefill | null) => {
    setPushPrefill(prefill);
    setPushOpen(true);
  };

  const runBroadcast = (v: string) => {
    setBroadcastOpen(false);
    if (!v) return;
    const payload =
      v === "all"
        ? { mode: "all" }
        : v.startsWith("trade:")
          ? { mode: "trade", trade: v.slice(6) }
          : { mode: "crews", crewIds: [v.slice(5)] };
    broadcast.mutate(
      { id, data: payload },
      {
        onSuccess: (r) => {
          invalidateJob();
          toast({
            title: "Job broadcast sent",
            description:
              (r as { message?: string }).message ??
              "Crews can now claim this job from their portal.",
          });
        },
        onError: (e) =>
          toast({ title: "Couldn't broadcast", description: e.message, variant: "destructive" }),
      },
    );
  };

  const copyTrackerLink = () => {
    trackerShare.mutate(
      { id },
      {
        onSuccess: async (r) => {
          const url = r.link || `${window.location.origin}/track/${r.token}`;
          try {
            await navigator.clipboard.writeText(url);
            setTrackerCopied(true);
            setTimeout(() => setTrackerCopied(false), 2500);
            toast({ title: "Live tracker link copied", description: "Paste it into a text or email to the property manager." });
          } catch {
            window.prompt("Copy this live tracker link:", url);
          }
        },
        onError: (e) =>
          toast({ title: "Couldn't create tracker link", description: e.message, variant: "destructive" }),
      },
    );
  };
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
          if (jobInvoices.length === 0) {
            toast({ title: "Job marked complete", description: "Next: create the invoice." });
            setWizardOpen(true);
          } else {
            toast({ title: "Job marked complete" });
          }
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
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)]">
            {job.category || "General"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {job.propertyName} {job.unitNo ? `· Unit ${job.unitNo}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {!job.clearedAt && !job.crewLeaderId && job.status !== "complete" && job.status !== "paid" && job.status !== "cancelled" && (
            broadcastOpen ? (
              <select
                autoFocus
                defaultValue=""
                onChange={(e) => runBroadcast(e.target.value)}
                onBlur={() => setBroadcastOpen(false)}
                className="px-4 py-2 bg-card border border-[var(--hairline)] text-sm font-medium rounded-full outline-none max-w-[220px]"
                data-testid="select-broadcast-target"
              >
                <option value="">Broadcast to…</option>
                <option value="all">All active crews</option>
                {Array.from(new Set((crews ?? []).map((c) => c.trade).filter(Boolean))).map((t) => (
                  <option key={`trade:${t}`} value={`trade:${t}`}>Trade: {t}</option>
                ))}
                {(crews ?? []).filter((c) => c.active !== false).map((c) => (
                  <option key={`crew:${c.id}`} value={`crew:${c.id}`}>{c.name}</option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => setBroadcastOpen(true)}
                disabled={broadcast.isPending}
                data-testid="button-broadcast-job"
                className="flex items-center gap-2 bg-card border border-[var(--hairline)] px-4 py-2 rounded-full font-medium hover:border-[var(--ink)] transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-sm disabled:opacity-50"
              >
                <Megaphone className="w-4 h-4" /> {broadcast.isPending ? "Broadcasting…" : "Broadcast"}
              </button>
            )
          )}
          <button
            onClick={() => openUpdateClient(null)}
            data-testid="button-update-client"
            className="flex items-center gap-2 bg-card border border-[var(--hairline)] px-4 py-2 rounded-full font-medium hover:border-[var(--ink)] transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-sm"
          >
            <MessageSquareShare className="w-4 h-4" /> Update client
          </button>
          <button
            onClick={() => setScheduleOpen(true)}
            className="flex items-center gap-2 bg-card border border-[var(--hairline)] px-4 py-2 rounded-full font-medium hover:border-[var(--ink)] transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-sm"
          >
            <CalendarDays className="w-4 h-4" />
            {schedules.length > 0 ? "Reschedule" : "Schedule"}
          </button>
          {canComplete && (
            <button
              onClick={onComplete}
              disabled={complete.isPending}
              className="flex items-center gap-2 bg-[var(--ink)] text-white px-4 py-2 rounded-full font-medium hover:opacity-90 transition-opacity shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-sm disabled:opacity-50"
            >
              <Check className="w-4 h-4" /> {complete.isPending ? "Completing…" : "Complete"}
            </button>
          )}
          {job.status === "complete" && !job.clearedAt && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-2">
              <Archive className="w-3.5 h-3.5" /> Close out from the property's job funnel
            </span>
          )}
          {job.status === "complete" && (
            <button
              onClick={onRestart}
              disabled={restartJob.isPending}
              className="flex items-center gap-2 bg-card border border-[var(--hairline)] px-4 py-2 rounded-full font-medium text-[var(--ink)] hover:border-[var(--ink)] transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-sm disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" /> {restartJob.isPending ? "Restarting…" : "Restart"}
            </button>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 bg-card border border-[var(--hairline)] px-3 py-2 rounded-full font-medium hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-sm text-muted-foreground"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6">
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

          <section>
            <h2 className="text-lg font-display font-bold mb-3 text-[var(--ink)]">Live tracker &amp; evidence</h2>
            <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6">
              <p className="text-sm text-muted-foreground mb-4">
                Share a live link with the property manager — it shows GPS
                check-ins, before &amp; after photos, and work notes in real
                time. The PDF report packages everything with tamper-proof
                photo fingerprints.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={copyTrackerLink}
                  disabled={trackerShare.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--ink,#17181c)] text-white text-sm font-semibold disabled:opacity-60"
                >
                  {trackerCopied ? (
                    <>
                      <Check className="w-4 h-4" /> Link copied!
                    </>
                  ) : (
                    <>
                      <Radio className="w-4 h-4" />
                      {trackerShare.isPending ? "Creating link…" : "Copy live tracker link"}
                    </>
                  )}
                </button>
                <a
                  href={`/api/jobs/${id}/report`}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-card border border-[var(--hairline)] text-sm font-semibold hover:border-[var(--ink)] transition-colors"
                >
                  <FileDown className="w-4 h-4" /> Download job report (PDF)
                </a>
              </div>
            </div>
          </section>

          {(job.status === "complete" || job.recapSentAt) && (
            <section>
              <h2 className="text-lg font-display font-bold mb-3 text-[var(--ink)]">Client recap</h2>
              <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6">
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
                            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--gold-light)] text-black text-sm font-semibold disabled:opacity-50 hover:brightness-95 transition-colors"
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
            <h2 className="text-lg font-display font-bold mb-3 text-[var(--ink)]">Billing</h2>
            <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
              {jobInvoices.map((inv) => (
                <div key={inv.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <Link href={`/invoices/${inv.id}`} className="font-semibold hover:underline">
                      {inv.invoiceNo}
                    </Link>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium capitalize text-muted-foreground">{inv.status.replace("_", " ")}</span>
                      <span className="font-mono font-semibold">${inv.amount.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {inv.status === "draft" && (
                      <button
                        onClick={() => setSendInvoice(inv)}
                        data-testid={`button-send-invoice-${inv.id}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--gold-light)] text-black text-xs font-bold hover:brightness-95"
                      >
                        <Send className="w-3.5 h-3.5" /> Send
                      </button>
                    )}
                    {inv.status !== "paid" && (
                      <button
                        onClick={() => setPayInvoice(inv)}
                        data-testid={`button-record-payment-${inv.id}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--hairline)] text-xs font-bold hover:border-[var(--ink)]"
                      >
                        <DollarSign className="w-3.5 h-3.5" /> Record payment
                      </button>
                    )}
                    <button
                      onClick={() =>
                        openUpdateClient({
                          templateId: "invoice",
                          title: `Invoice ${inv.invoiceNo}`,
                          amount: inv.amount,
                          dueDate: inv.dueAt ? String(inv.dueAt).slice(0, 10) : null,
                          source: { type: "invoice", id: inv.id },
                        })
                      }
                      data-testid={`button-push-invoice-${inv.id}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--hairline)] text-xs font-bold hover:border-[var(--ink)]"
                    >
                      <MessageSquareShare className="w-3.5 h-3.5" /> To client board
                    </button>
                  </div>
                </div>
              ))}
              {!jobInvoices.length && (
                <div className="p-4 space-y-3 text-center">
                  <div className="text-sm text-muted-foreground">No invoice yet.</div>
                  <button
                    onClick={() => setWizardOpen(true)}
                    data-testid="button-create-invoice"
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-semibold transition-colors ${
                      job.status === "complete"
                        ? "bg-[var(--gold-light)] text-black hover:brightness-95"
                        : "bg-card border border-[var(--hairline)] hover:border-[var(--ink)]"
                    }`}
                  >
                    <FileText className="w-4 h-4" /> Create invoice
                  </button>
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-display font-bold mb-3 text-[var(--ink)]">Schedule</h2>
            <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
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
            <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
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
              className="flex items-center gap-2 bg-[var(--gold-light)] text-black px-4 py-2 rounded-full font-medium disabled:opacity-50 hover:brightness-95 transition-colors"
            >
              <CalendarDays className="w-4 h-4" /> {schedule.isPending ? "Scheduling…" : "Schedule job"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {propertyId && (
        <InvoiceWizardDialog
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          propertyId={propertyId}
          propertyName={job.propertyName ?? ""}
        />
      )}
      {propertyId && (
        <PushCardDialog
          propertyId={propertyId}
          open={pushOpen}
          onOpenChange={(v) => { if (!v) setPushOpen(false); }}
          prefill={pushPrefill}
        />
      )}
      <RecordPaymentDialog
        open={!!payInvoice}
        onOpenChange={(v) => {
          if (!v) {
            setPayInvoice(null);
            invalidateMoney();
            invalidateJob();
          }
        }}
        invoice={payInvoice}
      />
      <SendInvoiceDialog
        open={!!sendInvoice}
        onOpenChange={(v) => { if (!v) setSendInvoice(null); }}
        invoice={sendInvoice}
        onSent={() => {
          invalidateMoney();
          invalidateJob();
          toast({ title: "Invoice sent", description: "Tip: push it to the client's board too." });
        }}
      />

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
