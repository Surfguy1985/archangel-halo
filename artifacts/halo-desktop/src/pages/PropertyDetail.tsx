import { useGetProperty, getGetPropertyQueryKey, useSetInvoiceStatus, useUpdateProperty, useUpdateJob, useClearJob, useRestartJob, useCompleteJob, getGetMoneySummaryQueryKey, getListInvoicesQueryKey, getGetTodayQueryKey, getListPropertiesQueryKey, getListJobsQueryKey, getGetCalendarQueryKey, getGetJobQueryKey, getListExpensesQueryKey, getListJobBoardQueryKey, useCreateInvoice, useListCrews, useBroadcastJob, useCreateCrewPayment} from "@workspace/api-client-react";
import type { Job, Invoice } from "@workspace/api-client-react";
import { AddExpenseDialog} from "@/components/MoneyDialogs";
import { MarginSection} from "@/components/MarginSection";
import { CrewPhotosSection} from "@/components/CrewPhotosSection";
import { useQueryClient} from "@tanstack/react-query";
import { useParams, Link, useLocation} from "wouter";
import { AlertTriangle, CalendarDays, Check, ChevronDown, ChevronLeft, Archive, RotateCcw, Pencil, Plus, Radio, Repeat, BookOpen, FileUp, Receipt, Users, Wand2, Zap} from "lucide-react";
import { InvoiceWizardDialog} from "@/components/InvoiceWizardDialog";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton} from "@/components/ui/skeleton";

import { useState, useEffect} from "react";
import { useToast} from "@/hooks/use-toast";
import { JobLineItemsPanel} from "@/components/JobLineItemsPanel";
import { JobSummaryDialog} from "@/components/JobSummaryDialog";
import { ImportFromCatalogDialog} from "@/components/ImportFromCatalogDialog";
import { ImportPriceSheetDialog} from "@/components/ImportPriceSheetDialog";
import { QuickJobDialog} from "@/components/QuickJobDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  EditPropertyDialog,
  AddPriceItemDialog,
  AddContactDialog,
  AddJobDialog,
  EditPriceItemDialog,
  EditContactDialog,
  EditJobDialog,
} from "@/components/PropertyDialogs";

export default function PropertyDetail() {
  const params = useParams();
  const id = params.id as string;
  const [editOpen, setEditOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [priceSheetOpen, setPriceSheetOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [quickJobOpen, setQuickJobOpen] = useState(false);
  // The card just created from the New-job form — it flashes green at the top
  // of the list so you can see your info landed on it.
  const [newJobId, setNewJobId] = useState<string | null>(null);
  // Site-map view: tapping a unit box opens the full job card in a dialog.
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  // Inline PO# edit — shown when the card hits the invoice/$ stage and no PO yet.
  const [poJobId, setPoJobId] = useState<string | null>(null);
  const [poDraft, setPoDraft] = useState("");
  // Inline complete-job blocker — replaces window.confirm; keyed by jobId.
  const [completeBlocker, setCompleteBlocker] = useState<{
    jobId: string;
    text: string;
    missing: string[];
    codes: string[];
  } | null>(null);
  useEffect(() => {
    if (!newJobId) return;
    const t = setTimeout(() => setNewJobId(null), 8000);
    return () => clearTimeout(t);
  }, [newJobId]);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [editPriceId, setEditPriceId] = useState<string | null>(null);
  const [openLineItemsJobId, setOpenLineItemsJobId] = useState<string | null>(null);
  const [expandedInvoiceGroup, setExpandedInvoiceGroup] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [jobTab, setJobTab] = useState<"active" | "history">("active");
  const [expenseJobId, setExpenseJobId] = useState<string | null>(null);
  const [rateJobId, setRateJobId] = useState<string | null>(null);
  const [assignJobId, setAssignJobId] = useState<string | null>(null);
  const [broadcastJobId, setBroadcastJobId] = useState<string | null>(null);
  const [summaryJobId, setSummaryJobId] = useState<string | null>(null);
  const broadcast = useBroadcastJob();
  const [, navigate] = useLocation();
  const [rateDraft, setRateDraft] = useState("");
  const updateJob = useUpdateJob();
  const setStatus = useSetInvoiceStatus();
  const clearJob = useClearJob();
  const createCrewPayment = useCreateCrewPayment();
  const restartJob = useRestartJob();
  const completeJob = useCompleteJob();
  const updateProperty = useUpdateProperty();
  const createInvoice = useCreateInvoice();
  const { data: crews } = useListCrews();
  const { data, isLoading } = useGetProperty(id, { query: { enabled: !!id, queryKey: getGetPropertyQueryKey(id), refetchInterval: 15000 } });

  if (isLoading) {
    return <div className="p-8 max-w-6xl mx-auto"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!data) return <div className="p-8 text-center text-muted-foreground">Property not found</div>;

  const { property, stats, jobs, priceItems, contacts, expenses, invoices, upcomingVisits, crewPhotos } = data;
  // Newest first — the card you just made is always at the top, never lost
  // somewhere down an endless page.
  const byNewest = (a: Job, b: Job) =>
    new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
  const activeJobs = jobs.filter((j) => !j.clearedAt).sort(byNewest);
  const historyJobs = jobs.filter((j) => !!j.clearedAt).sort(byNewest);
  const invoiceStatusRank: Record<string, number> = { paid: 0, past_due: 1, sent: 2, draft: 3 };
  const invoiceForJob = (jobId: string) => {
    const matches = invoices.filter((inv) => inv.jobId === jobId);
    if (matches.length <= 1) return matches[0];
    return [...matches].sort(
      (a, b) => (invoiceStatusRank[a.status] ?? 9) - (invoiceStatusRank[b.status] ?? 9),
    )[0];
  };
  const invoiceStatusLabel: Record<string, string> = {
    draft: "Invoice drafted",
    sent: "Invoice sent",
    past_due: "Invoice past due",
    paid: "Invoice paid",
  };
  const invoiceStatusCls: Record<string, string> = {
    draft: "bg-black/[0.05] text-muted-foreground",
    sent: "bg-sky-50 text-sky-700 border border-sky-200",
    past_due: "bg-red-50 text-red-700 border border-red-200",
    paid: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  };

  const invalidateJobLists = () => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
    // Keep the Job Board rails in lockstep with the property timeline.
    queryClient.invalidateQueries({ queryKey: getListJobBoardQueryKey() });
  };

  const invalidateMoney = (jobId?: string) => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListJobBoardQueryKey() });
    if (jobId) queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
  };

  const saveRate = (jobId: string) => {
    const parsed = rateDraft.trim() === "" ? null : Number(rateDraft);
    if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) return;
    updateJob.mutate(
      { id: jobId, data: { crewRate: parsed } },
      {
        onSuccess: () => {
          setRateJobId(null);
          invalidateMoney(jobId);
        },
      },
    );
  };

  const marginBadge = (pct: number | null | undefined) => {
    if (pct == null) return null;
    const val = Math.round(pct * 100);
    const cls =
      pct < (property.marginMin ?? 0.25)
        ? "bg-red-50 text-red-700 border border-red-200"
        : "bg-emerald-50 text-emerald-700 border border-emerald-200";
    return (
      <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${cls}`}>
        {val}% margin
      </span>
    );
  };

  const toggleInvoice = (invoiceId: string, next: "paid" | "sent") => {
    const jobId = invoices.find((inv) => inv.id === invoiceId)?.jobId ?? undefined;
    setStatus.mutate(
      { id: invoiceId, data: { status: next } },
      {
        onSuccess: () => invalidateMoney(jobId),
        onError: (err) =>
          toast({ title: "Couldn't update invoice", description: err.message, variant: "destructive" }),
      },
    );
  };

  const renderJobCard = (job: Job, invoice: Invoice | undefined) => {
    const isComplete = job.status === "complete";
    const closed = !!job.clearedAt;
    // 5-stage timeline driven by the exact same server fields the Job Board
    // rails read (crewLeaderId, check-ins, invoice status, crewPay, clearedAt),
    // so board actions and this timeline can never disagree.
    const paymentReceived = invoice?.status === "paid";
    const crewPaid = job.crewPaymentStatus === "paid";
    const invoiceSent = !!invoice && invoice.status !== "draft";
    const workStarted =
      !!job.workStartedAt ||
      ["in_progress", "complete", "paid"].includes(job.status) ||
      ["completed", "billing", "pay_alert"].includes(job.boardStatus ?? "");
    const moneyAt = [invoice?.paidAt, job.crewPaidAt].filter(Boolean).sort().at(-1) ?? null;
    const STAGES: {
      label: string;
      done: boolean;
      at?: string | null;
      partial?: boolean;
      hint?: string;
    }[] = [
      { label: "Crew", done: !!job.crewLeaderId || closed, at: job.crewAssignedAt },
      { label: "Work", done: workStarted || closed, at: job.workStartedAt ?? job.completedAt },
      { label: "Invoice", done: invoiceSent || closed, at: invoice?.sentAt },
      {
        label: "$",
        done: (paymentReceived && crewPaid) || closed,
        at: moneyAt,
        partial: !closed && paymentReceived !== crewPaid,
        hint:
          paymentReceived && !crewPaid
            ? "crew pay due"
            : crewPaid && !paymentReceived
              ? "awaiting client $"
              : undefined,
      },
      { label: "Close", done: closed, at: job.clearedAt },
    ];
    const activeIdx = STAGES.findIndex((s) => !s.done);
    // How long the job has been sitting in the current stage — measured from
    // the previous stage's timestamp (or job creation for the first stage).
    const enteredAt =
      activeIdx > 0
        ? (STAGES[activeIdx - 1].at ?? job.createdAt)
        : job.createdAt;
    const daysHere =
      activeIdx >= 0 && enteredAt
        ? Math.floor((Date.now() - new Date(enteredAt).getTime()) / 86400000)
        : null;
    const stalled = daysHere != null && daysHere > 3;
    const fmtDay = (d?: string | null) =>
      d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;

    // Date-only strings (YYYY-MM-DD) must be built from LOCAL parts — new
    // Date("Y-M-D") parses as UTC and shifts the day.
    const fmtDueDay = (d: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
      if (!m) return d;
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    };

    const renderPrimaryAction = () => {
      if (assignJobId === job.id) {
        return (
          <select 
            autoFocus
            onChange={(e) => {
              if (e.target.value) {
                updateJob.mutate({ id: job.id, data: { crewLeaderId: e.target.value } }, { onSuccess: invalidateJobLists });
              }
              setAssignJobId(null);
            }}
            onBlur={() => setAssignJobId(null)}
            className="px-4 py-2.5 bg-white text-black text-sm font-bold rounded-xl outline-none"
          >
            <option value="">Select crew...</option>
            {crews?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        );
      }

      const { label, action } = nextStep;
      if (!label) return null;
      return (
        <button
          onClick={action}
          className="px-5 py-2.5 bg-white text-black text-sm font-bold rounded-xl hover:bg-white/90 transition-colors"
        >
          {label}
        </button>
      );
    };

    // ONE resolver decides both the big white button AND the plain-language
    // guidance strip, so they can never tell the user two different things.
    const nextStep: { step: string | null; text: string; label: string; action: () => void } = (() => {
      if (job.clearedAt)
        return {
          step: null,
          text: "",
          label: "Reopen",
          action: () => restartJob.mutate({ id: job.id }, { onSuccess: invalidateJobLists }),
        };
      if (!job.crewLeaderId)
        return {
          step: "1 of 5",
          text: "Get a crew on it — tap Assign crew, or Broadcast job and let a crew claim it.",
          label: "Assign crew",
          action: () => setAssignJobId(job.id),
        };
      if (!isComplete)
        return {
          step: "2 of 5",
          text: "Crew is on it — when the work is finished, tap Complete work.",
          label: "Complete work",
          action: () => {
            // Clear any previous blocker for this job so the strip stays fresh.
            setCompleteBlocker(null);
            completeJob.mutate(
              { id: job.id, data: {} },
              {
                onSuccess: invalidateJobLists,
                onError: (err) => {
                  const data = (err as any)?.data as
                    | { missing?: string[]; missingCodes?: string[]; error?: string }
                    | undefined;
                  if (data?.missing?.length) {
                    // Show the inline blocker strip instead of a browser dialog.
                    setCompleteBlocker({
                      jobId: job.id,
                      text: data.error ?? "A few things need attention before this job can move forward.",
                      missing: data.missing,
                      codes: data.missingCodes ?? [],
                    });
                  } else {
                    toast({
                      title: "Couldn't complete the job",
                      description: data?.error ?? err.message,
                      variant: "destructive",
                    });
                  }
                },
              },
            );
          },
        };
      if (!invoice)
        return {
          step: "3 of 5",
          text: "Work's done — tap Create invoice to bill the client.",
          label: "Create invoice",
          action: () =>
            createInvoice.mutate(
              { data: { propertyId: id, jobId: job.id, amount: job.lineTotal || 0 } },
              {
                onSuccess: () => invalidateMoney(job.id),
                onError: (err) =>
                  toast({
                    title: "Invoice already exists",
                    description: (err as any)?.data?.error ?? err.message,
                    variant: "destructive",
                  }),
              },
            ),
        };
      if (invoice.status === "draft")
        return {
          step: "3 of 5",
          text: "Invoice is drafted — tap Send invoice so the client gets it.",
          label: "Send invoice",
          action: () =>
            setStatus.mutate(
              { id: invoice.id, data: { status: "sent" } },
              {
                onSuccess: () => invalidateMoney(job.id),
                onError: (err) =>
                  toast({
                    title: "Couldn't send invoice",
                    description: (err as any)?.data?.error ?? err.message,
                    variant: "destructive",
                  }),
              },
            ),
        };
      if (invoice.status === "sent" || invoice.status === "past_due")
        return {
          step: "4 of 5",
          text: "Waiting on the client — tap Mark paid the moment money lands.",
          label: "Mark paid",
          action: () =>
            setStatus.mutate(
              { id: invoice.id, data: { status: "paid" } },
              {
                onSuccess: () => invalidateMoney(job.id),
                onError: (err) =>
                  toast({ title: "Couldn't mark paid", description: err.message, variant: "destructive" }),
              },
            ),
        };
      if (invoice.status === "paid" && job.crewPaymentStatus !== "paid")
        // Client money is in but the crew hasn't been paid — the pay flow
        // (per-member amounts) lives on the Job Board billing card.
        return {
          step: "4 of 5",
          text: "Client paid — now pay the crew from the Job Board.",
          label: "Pay crew",
          action: () => navigate("/jobboard"),
        };
      if (invoice.status === "paid")
        // Close-out first opens the job summary form (prefilled recap for the PM).
        return {
          step: "5 of 5",
          text: "All money settled — tap Close out and this card moves to History.",
          label: "Close out",
          action: () => setSummaryJobId(job.id),
        };
      // Safe fallback: an invoice in a cancelled/legacy/unknown status. Never
      // show a blank button or point at an action that doesn't exist.
      return {
        step: null,
        text: `This job's invoice is marked "${invoice.status}" — open it to sort things out.`,
        label: "Open invoice",
        action: () => navigate(`/invoices/${invoice.id}`),
      };
    })();

    const isNew = job.id === newJobId;
    return (
      <div
        key={job.id}
        className={`bg-[var(--ink)] text-white rounded-2xl p-6 shadow-sm flex flex-col gap-5 relative z-10 ${isNew ? "card-move-flash" : ""}`}
        data-testid={`job-card-${job.id}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <Link href={`/jobs/${job.id}`} className="block hover:opacity-80 transition-opacity">
            <h3 className="text-xl font-display font-bold text-white mb-1 flex items-center gap-2">
              {job.category || 'General'} · {job.unitNo || 'Common'}
              {isNew && (
                <span className="text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 bg-[var(--gold-light)] text-black">
                  Just created
                </span>
              )}
              <button
                aria-label="Edit job"
                onClick={(e) => { e.preventDefault(); setEditJobId(job.id); }}
                className="w-6 h-6 rounded-full flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white transition-colors"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </h3>
          </Link>
          
          {/* Status is told once, by the timeline below — only closed jobs
              keep a badge since they sit in the History tab. */}
          {job.clearedAt && (
             <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 bg-white/10 text-white rounded-full">
               <Archive className="w-3.5 h-3.5" /> Closed
             </span>
          )}
        </div>

        {/* Info Grid — everything typed into the New-job form shows here */}
        <div className="flex items-center flex-wrap gap-x-5 gap-y-2 text-sm text-white/70 font-medium">
          <span className="font-mono text-white/50">{job.jobNo}</span>
          {job.woNo ? (
            <button
              onClick={() => { setPoJobId(job.id); setPoDraft(job.woNo ?? ""); }}
              className="inline-flex items-center gap-1 font-mono text-white/50 hover:text-white/80 transition-colors"
              title="Edit PO #"
            >
              PO# {job.woNo} <Pencil className="w-3 h-3 opacity-40" />
            </button>
          ) : (invoice && !job.clearedAt) ? (
            poJobId === job.id ? (
              <span className="inline-flex items-center gap-1.5">
                <input
                  autoFocus
                  value={poDraft}
                  onChange={(e) => setPoDraft(e.target.value)}
                  placeholder="PO-1234"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateJob.mutate({ id: job.id, data: { woNo: poDraft.trim() || undefined } }, { onSuccess: () => { setPoJobId(null); invalidateJobLists(); } });
                    }
                    if (e.key === "Escape") setPoJobId(null);
                  }}
                  className="w-24 px-2 py-1 rounded-lg border-none bg-white text-black text-sm tabular-nums outline-none"
                />
                <button
                  onClick={() => updateJob.mutate({ id: job.id, data: { woNo: poDraft.trim() || undefined } }, { onSuccess: () => { setPoJobId(null); invalidateJobLists(); } })}
                  className="font-bold text-white hover:text-white/80"
                >Save</button>
                <button onClick={() => setPoJobId(null)} className="text-white/40 hover:text-white/70">✕</button>
              </span>
            ) : (
              <button
                onClick={() => { setPoJobId(job.id); setPoDraft(""); }}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--gold-light)] hover:opacity-80 transition-opacity"
              >
                + Add PO#
              </button>
            )
          ) : null}
          {(job.flexDueBy || job.scheduledOn) && (
            <span className="flex items-center gap-1.5" data-testid={`job-due-${job.id}`}>
              <CalendarDays className="w-4 h-4" /> Due {fmtDueDay(job.flexDueBy ?? job.scheduledOn ?? "")}
            </span>
          )}
          {job.crewLeaderName && (
            <span className="flex items-center gap-1.5">
              <Users className="w-4 h-4" /> {job.crewLeaderName}
            </span>
          )}
          {job.isRecurring && (
            <span className="flex items-center gap-1.5">
              <Repeat className="w-4 h-4" /> 
              {{ daily: "Daily", weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly", quarterly: "Quarterly" }[job.recurrence ?? ""] ?? "Recurring"}
            </span>
          )}
          {rateJobId === job.id ? (
            <span className="inline-flex items-center gap-1.5">
              Crew $
              <input
                autoFocus
                inputMode="decimal"
                value={rateDraft}
                onChange={(e) => setRateDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveRate(job.id); if (e.key === "Escape") setRateJobId(null); }}
                className="w-20 px-2 py-1 rounded-lg border-none bg-white text-black text-sm tabular-nums outline-none"
              />
              <button
                disabled={updateJob.isPending}
                onClick={() => saveRate(job.id)}
                className="font-bold text-white hover:text-white/80 disabled:opacity-50"
              >
                Save
              </button>
            </span>
          ) : (
            <button
              onClick={() => { setRateJobId(job.id); setRateDraft(job.crewRate != null ? String(job.crewRate) : ""); }}
              className="inline-flex items-center gap-1 font-medium text-white/70 hover:text-white transition-colors"
            >
              Crew {job.crewRate != null ? `$${job.crewRate.toLocaleString()}` : "rate —"}
              <Pencil className="w-3 h-3 opacity-50" />
            </button>
          )}
          <span>Invoiced <b className="text-white tabular-nums">${(job.invoicedTotal ?? 0).toLocaleString()}</b></span>
          <span>Paid <b className="text-[var(--primary)] tabular-nums">${(job.paidTotal ?? 0).toLocaleString()}</b></span>
          <span>Expenses <b className="text-white tabular-nums">${(job.expensesTotal ?? 0).toLocaleString()}</b></span>
          {job.marginPct != null && (
            <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${job.marginPct < (property.marginMin ?? 0.25) ? "bg-rose-500/20 text-rose-300" : "bg-[var(--primary)]/20 text-[var(--primary)]"}`}>
              {Math.round(job.marginPct * 100)}% margin
            </span>
          )}
        </div>

        {/* Live 5-stage timeline — mirrors the Job Board rails */}
        <div className="flex items-start gap-2" data-testid={`job-timeline-${job.id}`}>
          {STAGES.map((s, i) => {
            const isActive = i === activeIdx;
            const isMoney = s.label === "$";
            const barCls = s.done
              ? isMoney
                ? "bg-emerald-400"
                : "bg-[var(--primary)]"
              : s.partial
                ? "bg-gradient-to-r from-emerald-400 from-50% to-white/10 to-50%"
                : isActive
                  ? stalled
                    ? "bg-amber-400/60"
                    : "bg-white/25"
                  : "bg-white/10";
            const labelCls = s.done
              ? isMoney
                ? "text-emerald-400"
                : "text-[var(--primary)]"
              : isActive
                ? stalled
                  ? "text-amber-300"
                  : "text-white/80"
                : "text-white/40";
            return (
              <div key={s.label} className="flex-1 flex flex-col items-start gap-2 min-w-0" data-testid={`job-stage-${job.id}-${i}`}>
                <div className={`h-1.5 w-full rounded-full transition-colors ${barCls}`} />
                <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${labelCls}`}>
                  {s.label}
                </span>
                {s.done && fmtDay(s.at) ? (
                  <span className="text-[10px] text-white/40 tabular-nums -mt-1.5">{fmtDay(s.at)}</span>
                ) : !s.done && s.partial && s.hint ? (
                  <span className="text-[10px] text-amber-300/90 -mt-1.5">{s.hint}</span>
                ) : isActive && daysHere != null ? (
                  <span className={`text-[10px] tabular-nums -mt-1.5 ${stalled ? "text-amber-300 font-bold" : "text-white/50"}`}>
                    {daysHere === 0 ? "today" : `${daysHere} day${daysHere === 1 ? "" : "s"} here`}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Scope — moved to the bottom of the card so the header stays scannable */}
        {job.description && (
          <p className="text-white/70 text-sm font-medium" data-testid={`job-description-${job.id}`}>
            {job.description}
          </p>
        )}

        {/* One plain-language next step — tells a first-time user exactly what
            to do now, matching whatever the big white button says. */}
        {!job.clearedAt && nextStep.text && (
          <div className="flex items-start gap-2.5 rounded-xl bg-[var(--gold-light)]/10 border border-[var(--gold-light)]/25 px-3.5 py-2.5" data-testid={`job-next-step-${job.id}`}>
            {nextStep.step && (
              <span className="shrink-0 rounded-full bg-[var(--gold-light)] text-black text-[10px] font-bold px-2 py-0.5 mt-px">
                Step {nextStep.step}
              </span>
            )}
            <span className="text-[13px] text-white/85 font-medium leading-snug">{nextStep.text}</span>
          </div>
        )}

        {/* Inline complete-work blockers — replaces the native browser confirm.
            Each missing item shows its fix right here so nothing needs searching. */}
        {completeBlocker?.jobId === job.id && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-900/30 p-4 space-y-3" data-testid={`complete-blocker-${job.id}`}>
            <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {completeBlocker.text}
            </div>
            <div className="space-y-2">
              {completeBlocker.missing.map((m, i) => {
                const code = completeBlocker.codes[i] ?? "";
                return (
                  <div key={m} className="bg-white/5 rounded-lg px-3 py-2.5 flex items-start justify-between gap-3">
                    <span className="text-sm text-white/80 leading-snug">{m}</span>
                    <div className="shrink-0 flex items-center gap-2">
                      {/* PO missing → open the PO inline input */}
                      {code === "po" && (
                        <button
                          onClick={() => { setPoJobId(job.id); setPoDraft(job.woNo ?? ""); setCompleteBlocker(null); }}
                          className="text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--gold-light)] text-black hover:opacity-90 whitespace-nowrap"
                        >
                          Add PO#
                        </button>
                      )}
                      {/* Checklist incomplete → override or view checklist */}
                      {code === "checklist" && (
                        <>
                          <button
                            onClick={() => setOpenLineItemsJobId(openLineItemsJobId === job.id ? null : job.id)}
                            className="text-xs font-bold px-3 py-1.5 rounded-full bg-white/10 text-white hover:bg-white/20 whitespace-nowrap"
                          >
                            View checklist
                          </button>
                          <button
                            onClick={() => {
                              setCompleteBlocker(null);
                              completeJob.mutate(
                                { id: job.id, data: { force: true } },
                                {
                                  onSuccess: invalidateJobLists,
                                  onError: (err) =>
                                    toast({ title: "Couldn't complete", description: (err as Error).message, variant: "destructive" }),
                                },
                              );
                            }}
                            disabled={completeJob.isPending}
                            className="text-xs font-bold px-3 py-1.5 rounded-full bg-amber-400 text-black hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                          >
                            Complete anyway
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setCompleteBlocker(null)}
              className="text-[11px] font-semibold text-amber-400/70 hover:text-amber-300 underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="flex items-center gap-3 pt-3 border-t border-white/10">
          {renderPrimaryAction()}
          {!job.clearedAt && !job.crewLeaderId && (crews ?? []).some((c) => c.active !== false) && (
            broadcastJobId === job.id ? (
              <select
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  setBroadcastJobId(null);
                  if (!v) return;
                  const data =
                    v === "all"
                      ? { mode: "all" }
                      : v.startsWith("trade:")
                        ? { mode: "trade", trade: v.slice(6) }
                        : { mode: "crews", crewIds: [v.slice(5)] };
                  broadcast.mutate(
                    { id: job.id, data },
                    {
                      onSuccess: (r) => {
                        invalidateJobLists();
                        toast({
                          title: "Job broadcast sent",
                          description:
                            (r as { message?: string }).message ??
                            "Crews can now claim this job from their portal.",
                        });
                      },
                      onError: (err) =>
                        toast({ title: "Couldn't broadcast", description: err.message, variant: "destructive" }),
                    },
                  );
                }}
                onBlur={() => setBroadcastJobId(null)}
                className="px-4 py-2.5 bg-white text-black text-sm font-bold rounded-xl outline-none max-w-[220px]"
                data-testid="select-broadcast-target"
              >
                <option value="">Broadcast to…</option>
                <option value="all">All crews</option>
                {(() => {
                  const activeCrews = (crews ?? []).filter((c) => c.active !== false);
                  const trades = Array.from(
                    new Set(activeCrews.filter((c) => c.trade).map((c) => c.trade as string)),
                  ).sort();
                  return trades.length > 0 ? (
                    <optgroup label="Groups">
                      {trades.map((t) => (
                        <option key={t} value={`trade:${t}`}>{t}</option>
                      ))}
                    </optgroup>
                  ) : null;
                })()}
                <optgroup label="Individuals">
                  {(crews ?? []).filter((c) => c.active !== false).map((c) => (
                    <option key={c.id} value={`crew:${c.id}`}>{c.name}</option>
                  ))}
                </optgroup>
              </select>
            ) : (
              <button
                onClick={() => setBroadcastJobId(job.id)}
                disabled={broadcast.isPending}
                className="px-5 py-2.5 bg-transparent border border-white/20 text-white text-sm font-bold rounded-xl hover:bg-white/5 transition-colors flex items-center gap-2 disabled:opacity-50"
                data-testid="button-broadcast-job"
              >
                <Radio className="w-4 h-4" /> {broadcast.isPending ? "Sending…" : "Broadcast job"}
              </button>
            )
          )}
          <button
            onClick={() => setExpenseJobId(job.id)}
            className="px-5 py-2.5 bg-transparent border border-white/20 text-white text-sm font-bold rounded-xl hover:bg-white/5 transition-colors"
          >
            Log expense
          </button>
          
          {invoice && (
            <Link 
              href={`/invoices/${invoice.id}`}
              className="px-5 py-2.5 bg-transparent text-white/70 hover:text-white text-sm font-bold rounded-xl transition-colors"
            >
              Open invoice
            </Link>
          )}

          <button
            onClick={() => setOpenLineItemsJobId(openLineItemsJobId === job.id ? null : job.id)}
            className="px-5 py-2.5 bg-transparent text-white/70 hover:text-white text-sm font-bold rounded-xl transition-colors ml-auto flex items-center gap-2"
          >
            Line items <ChevronDown className={`w-4 h-4 transition-transform ${openLineItemsJobId === job.id ? 'rotate-180' : ''}`} />
          </button>
        </div>
        
        {openLineItemsJobId === job.id && (
          <div className="bg-white/5 rounded-2xl p-4 mt-2">
            <JobLineItemsPanel
              jobId={job.id}
              propertyId={id}
              lineItems={job.lineItems ?? []}
              priceItems={priceItems}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link href="/properties" className="flex items-center gap-2 text-muted-foreground text-sm font-semibold mb-4 w-fit hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to Properties
      </Link>
      
      <header className="flex justify-between items-start">
        <div>
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)]">{property.name}</h1>
          <p className="text-muted-foreground mt-1">{property.pmcName || property.city || "No location data"} {property.units ? `· ${property.units} units` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWizardOpen(true)}
            className="flex items-center gap-2 bg-[var(--gold-light,#B4FF44)] text-black px-5 py-2.5 rounded-full font-bold shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:opacity-90 transition-opacity"
            data-testid="button-invoice-wizard"
          >
            <Wand2 className="w-4 h-4" /> Invoice wizard
          </button>
          <button
            onClick={() => setEditOpen(true)}
            className="flex items-center gap-2 bg-card text-[var(--ink)] px-5 py-2.5 rounded-full font-medium border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:border-[var(--ink)] transition-colors"
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>
        </div>
      </header>

      <InvoiceWizardDialog open={wizardOpen} onOpenChange={setWizardOpen} propertyId={id} propertyName={property.name} />
      {summaryJobId && (
        <JobSummaryDialog
          jobId={summaryJobId}
          onClose={() => setSummaryJobId(null)}
          closeOutPending={clearJob.isPending}
          onCloseOut={() => {
            const doClear = () =>
              clearJob.mutate(
                { id: summaryJobId },
                {
                  onSuccess: () => {
                    invalidateJobLists();
                    setSummaryJobId(null);
                    // Move the whole card to the History tab right away.
                    setJobTab("history");
                    toast({ title: "Job closed out", description: "Moved to History." });
                  },
                  onError: (err) => {
                    const data = (err as any)?.data as
                      | { missing?: string[]; missingCodes?: string[]; error?: string }
                      | undefined;
                    const job = jobs.find((j) => j.id === summaryJobId);
                    // Crew-pay blocker: offer the fix right here instead of a dead end.
                    if (data?.missingCodes?.includes("crew_pay") && job?.crewLeaderId) {
                      const amt = job.crewRate ?? 0;
                      if (
                        window.confirm(
                          `The crew hasn't been marked paid for this job yet.\n\nMark ${job.crewLeaderName ?? "the crew"} paid${amt ? ` ($${amt.toLocaleString()})` : ""} now and finish the close-out?`,
                        )
                      ) {
                        createCrewPayment.mutate(
                          {
                            data: {
                              crewId: job.crewLeaderId,
                              amount: amt,
                              status: "completed",
                              jobId: job.id,
                              note: `Job ${job.jobNo} close-out`,
                            },
                          },
                          {
                            onSuccess: () => {
                              invalidateJobLists();
                              doClear();
                            },
                            onError: (e) =>
                              toast({ title: "Couldn't record the crew payment", description: (e as any)?.data?.error ?? e.message, variant: "destructive" }),
                          },
                        );
                        return;
                      }
                    }
                    toast({
                      title: "Can't close out yet",
                      description: data?.missing?.length ? data.missing.join(" ") : data?.error ?? err.message,
                      variant: "destructive",
                    });
                  },
                },
              );
            doClear();
          }}
        />
      )}
      <EditPropertyDialog open={editOpen} onOpenChange={setEditOpen} property={property} />
      <AddPriceItemDialog open={priceOpen} onOpenChange={setPriceOpen} propertyId={id} />
      <ImportFromCatalogDialog open={importOpen} onOpenChange={setImportOpen} propertyId={id} existingServices={priceItems.map((p) => p.service)} />
      <ImportPriceSheetDialog open={priceSheetOpen} onOpenChange={setPriceSheetOpen} propertyId={id} />
      <AddContactDialog open={contactOpen} onOpenChange={setContactOpen} propertyId={id} />
      <AddJobDialog open={jobOpen} onOpenChange={setJobOpen} propertyId={id} priceItems={priceItems} onCreated={setNewJobId} />
      <QuickJobDialog open={quickJobOpen} onOpenChange={setQuickJobOpen} propertyId={id} onCreated={setNewJobId} />
      {expenseJobId && (
        <AddExpenseDialog
          key={expenseJobId}
          open={!!expenseJobId}
          onOpenChange={(o) => { if (!o) setExpenseJobId(null); }}
          propertyId={id}
          jobId={expenseJobId}
        />
      )}
      {(() => {
        const j = jobs.find((x) => x.id === editJobId);
        return j ? (
          <EditJobDialog
            open={!!editJobId}
            onOpenChange={(o) => !o && setEditJobId(null)}
            job={j}
            propertyId={id}
          />
        ) : null;
      })()}
      {(() => {
        const c = contacts.find((x) => x.id === editContactId);
        return c ? (
          <EditContactDialog
            open={!!editContactId}
            onOpenChange={(o) => !o && setEditContactId(null)}
            contact={c}
            propertyId={id}
          />
        ) : null;
      })()}
      {(() => {
        const p = priceItems.find((x) => x.id === editPriceId);
        return p ? (
          <EditPriceItemDialog
            open={!!editPriceId}
            onOpenChange={(o) => !o && setEditPriceId(null)}
            item={p}
            propertyId={id}
          />
        ) : null;
      })()}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        {([
          ["Owed", `$${stats.owed.toLocaleString()}`],
          ["Collected", `$${stats.collectedTotal.toLocaleString()}`],
          ["Invoiced", `$${stats.invoicedTotal.toLocaleString()}`],
          ["Expenses", `$${stats.expensesTotal.toLocaleString()}`],
          ["Open Jobs", String(stats.openJobs)],
        ] as const).map(([label, value]) => (
          <div key={label} className="bg-[var(--ink)] rounded-[20px] p-4">
            <div className="text-white/60 uppercase text-[11px] font-bold tracking-[0.1em] mb-1">{label}</div>
            <div className="font-display font-bold text-[28px] text-white tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="space-y-8">

        {/* ── SITE MAP (full-width) ──────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-display font-bold text-[var(--ink)]">Jobs</h2>
            <button
              onClick={() => setQuickJobOpen(true)}
              className="flex items-center gap-1.5 text-sm font-bold bg-[var(--gold-light,#B4FF44)] text-black px-4 py-1.5 rounded-full hover:opacity-90 transition-opacity"
              data-testid="button-quick-job"
            >
              <Zap className="w-4 h-4" /> Quick job
            </button>
          </div>
          <div className="flex items-center gap-2 mb-3 w-fit">
            {([
              ["active", "Active", activeJobs.length],
              ["history", "History", historyJobs.length],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setJobTab(key)}
                data-testid={`tab-jobs-${key}`}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                  jobTab === key
                    ? "bg-[var(--ink)] text-white"
                    : "bg-card border border-[var(--hairline)] text-muted-foreground hover:text-[var(--ink)]"
                }`}
              >
                {label}
                {count > 0 && (
                  <span className={`ml-1.5 text-xs font-normal ${jobTab === key ? "text-white/60" : "text-muted-foreground"}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {jobTab !== "history" && (
            <div data-testid="jobs-sitemap">
              {activeJobs.length > 0 && (
                <p className="text-xs font-semibold text-muted-foreground px-1 mb-3">
                  {activeJobs.length} active job{activeJobs.length === 1 ? "" : "s"} — tap a box to open the full card · invoice strip links directly to the invoice.
                </p>
              )}
              {/* Grid: each job box = dark tile + attached invoice strip at bottom */}
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                {activeJobs.map((job) => {
                  const invoice = invoiceForJob(job.id);
                  const allJobInvoices = invoices.filter((inv) => inv.jobId === job.id);
                  const paymentReceived = invoice?.status === "paid";
                  const crewPaid = job.crewPaymentStatus === "paid";
                  const workStarted =
                    !!job.workStartedAt ||
                    ["in_progress", "complete", "paid"].includes(job.status) ||
                    ["completed", "billing", "pay_alert"].includes(job.boardStatus ?? "");
                  const stages = [
                    !!job.crewLeaderId,
                    workStarted,
                    !!invoice && invoice.status !== "draft",
                    paymentReceived && crewPaid,
                    !!job.clearedAt,
                  ];
                  const doneCount = stages.filter(Boolean).length;
                  const isNew = job.id === newJobId;
                  const invBadgeCls =
                    invoice?.status === "paid"
                      ? "bg-emerald-500/25 text-emerald-300"
                      : invoice?.status === "past_due"
                        ? "bg-red-500/25 text-red-300"
                        : invoice?.status === "sent"
                          ? "bg-sky-500/25 text-sky-300"
                          : "bg-white/10 text-white/35";
                  return (
                    <div
                      key={job.id}
                      className={`rounded-xl overflow-hidden ${isNew ? "card-move-flash" : ""}`}
                      data-testid={`job-box-${job.id}`}
                    >
                      {/* Tap upper area → opens full job card */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedJobId(job.id)}
                        onKeyDown={(e) => e.key === "Enter" && setExpandedJobId(job.id)}
                        className="bg-[var(--ink)] text-white p-3 cursor-pointer hover:opacity-90 transition-all active:scale-[0.97] text-left select-none"
                      >
                        <div className="font-display font-bold text-lg leading-tight truncate">
                          {job.unitNo || "Common"}
                        </div>
                        <div className="text-[10.5px] text-white/50 truncate">
                          {job.category || "General"}
                          {isNew && (
                            <span className="ml-1 text-[9px] font-bold uppercase tracking-wide text-[var(--gold-light)]">New</span>
                          )}
                        </div>
                        <div className="mt-2 flex gap-[3px]">
                          {stages.map((done, i) => (
                            <span
                              key={i}
                              className={`h-[4px] flex-1 rounded-full ${done ? "bg-[var(--gold-light)]" : "bg-white/15"}`}
                            />
                          ))}
                        </div>
                        <div className="mt-1 text-[9.5px] font-bold uppercase tracking-wide text-white/45">
                          {doneCount >= 5 ? "Closed" : ["Needs crew", "Work", "Invoice", "Get paid", "Close out"][doneCount]}
                        </div>
                      </div>
                      {/* Invoice strip — tap to open invoice (view, scan check, mark paid, etc.) */}
                      {invoice ? (
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="flex items-center gap-1.5 px-2.5 py-[7px] bg-[var(--ink)] border-t border-white/[0.09] hover:brightness-[1.15] transition-all group"
                        >
                          <Receipt className="w-3 h-3 text-white/28 shrink-0 group-hover:text-white/55 transition-colors" />
                          <span className="text-[8.5px] font-mono text-white/44 flex-1 truncate min-w-0">
                            {invoice.invoiceNo || "INV"}
                            {allJobInvoices.length > 1 && (
                              <span className="ml-0.5 text-white/28"> +{allJobInvoices.length - 1}</span>
                            )}
                          </span>
                          <span className={`text-[7.5px] font-bold uppercase px-1 py-0.5 rounded-full shrink-0 ${invBadgeCls}`}>
                            {invoice.status === "past_due" ? "Due" : invoice.status}
                          </span>
                          <span className="text-[8.5px] font-mono font-bold text-white/58 shrink-0 tabular-nums">
                            ${invoice.amount.toLocaleString()}
                          </span>
                        </Link>
                      ) : (
                        <div
                          role="button"
                          tabIndex={-1}
                          onClick={() => setExpandedJobId(job.id)}
                          className="flex items-center gap-1.5 px-2.5 py-[7px] bg-[var(--ink)] border-t border-white/[0.09] cursor-pointer hover:brightness-[1.1] transition-all"
                        >
                          <Receipt className="w-3 h-3 text-white/18 shrink-0" />
                          <span className="text-[8.5px] font-mono text-white/20">No invoice</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {!activeJobs.length && (
                <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6 text-center text-sm text-muted-foreground">
                  No active jobs yet — tap <b>Add</b> above, fill in the details, and your first box appears right here.
                </div>
              )}
            </div>
          )}

          {/* Full job card dialog — opens when a box is tapped */}
          <Dialog open={!!expandedJobId} onOpenChange={(o) => { if (!o) setExpandedJobId(null); }}>
            <DialogContent className="max-w-2xl max-h-[88dvh] overflow-y-auto custom-scrollbar p-4 sm:p-6">
              <DialogTitle className="sr-only">Job card</DialogTitle>
              {(() => {
                const job = [...activeJobs, ...historyJobs].find((j) => j.id === expandedJobId);
                return job ? renderJobCard(job, invoiceForJob(job.id)) : null;
              })()}
            </DialogContent>
          </Dialog>

          {jobTab === "history" && (
            <div className="space-y-4 max-h-[72dvh] overflow-y-auto pr-1 custom-scrollbar">
              {historyJobs.map((job) => renderJobCard(job, invoiceForJob(job.id)))}
              {!historyJobs.length && (
                <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6 text-center text-sm text-muted-foreground">
                  No cleared jobs yet — completed jobs you clear land here.
                </div>
              )}
            </div>
          )}

          {/* Unassigned invoices (not tied to any job) shown inline if they exist */}
          {(() => {
            const unassigned = invoices.filter((inv) => !inv.jobId || !jobs.some((j) => j.id === inv.jobId));
            if (!unassigned.length) return null;
            return (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Unassigned invoices</div>
                <div className="bg-card rounded-[20px] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
                  {unassigned.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-3 p-3">
                      <Link href={`/invoices/${inv.id}`} className="flex-1 min-w-0 hover:opacity-70 transition-opacity">
                        <div className="font-semibold text-sm">{inv.invoiceNo || "Invoice"}</div>
                        <div className={`text-xs font-medium px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${invoiceStatusCls[inv.status] ?? "text-muted-foreground"}`}>
                          {inv.status === "past_due" ? `Past due${inv.daysLate ? ` · ${inv.daysLate}d late` : ""}` : invoiceStatusLabel[inv.status] ?? inv.status}
                        </div>
                      </Link>
                      <div className="font-mono font-bold shrink-0 tabular-nums text-sm">${inv.amount.toLocaleString()}</div>
                      {inv.status === "paid" ? (
                        <button disabled={setStatus.isPending} onClick={() => toggleInvoice(inv.id, "sent")} className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-black/[0.05] text-muted-foreground hover:bg-black/[0.08] transition-colors disabled:opacity-50">
                          Mark pending
                        </button>
                      ) : (
                        <button disabled={setStatus.isPending} onClick={() => toggleInvoice(inv.id, "paid")} className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full text-[var(--ink)] bg-[var(--primary)] hover:brightness-105 transition-all disabled:opacity-50">
                          Mark paid
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <CrewPhotosSection photos={crewPhotos ?? []} showJob />
        </section>

        {/* ── MARGIN & PRICE LIST ───────────────────────────────────────────── */}
        <MarginSection
          title="Margin & Price List"
          currentPct={stats.marginPct ?? null}
          minFrac={property.marginMin}
          targetFrac={property.marginTarget}
          saving={updateProperty.isPending}
          onSave={({ minFrac, targetFrac }) =>
            updateProperty.mutate(
              { id, data: { marginMin: minFrac, marginTarget: targetFrac } },
              {
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) });
                  queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
                  queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
                },
              },
            )
          }
        >
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Agreed rates{priceItems.length > 0 && <span className="font-normal"> · {priceItems.length}</span>}
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setPriceSheetOpen(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
                  data-testid="button-import-price-sheet"
                >
                  <FileUp className="w-3.5 h-3.5" /> Import price list
                </button>
                <button
                  onClick={() => setImportOpen(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
                >
                  <BookOpen className="w-3.5 h-3.5" /> From Price Book
                </button>
                <button
                  onClick={() => setPriceOpen(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
            </div>
            <div className="-mx-1">
              {(() => {
                const byCat = new Map<string, typeof priceItems>();
                for (const item of priceItems) {
                  const cat = item.category?.trim() || "Other";
                  byCat.set(cat, [...(byCat.get(cat) ?? []), item]);
                }
                const stripBr = (s: string) => s.replace(/\s*[—–-]\s*\d\s*BR\s*$/i, "").trim();
                const sizeOf = (it: (typeof priceItems)[number]): number | null => {
                  const m = /(\d)\s*BR\s*$/i.exec(it.service) ?? /^(\d)\s*BR$/i.exec(it.unit ?? "");
                  return m ? Number(m[1]) : null;
                };
                const catEntries = [...byCat.entries()].sort(([a], [b]) => {
                  const isMR = (s: string) => /make[\s-]?ready/i.test(s);
                  return Number(isMR(b)) - Number(isMR(a));
                });
                return catEntries.map(([cat, list]) => {
                  type Row =
                    | { kind: "single"; item: (typeof priceItems)[number] }
                    | { kind: "sized"; base: string; variants: { size: number; item: (typeof priceItems)[number] }[] };
                  const byBase = new Map<string, { size: number; item: (typeof priceItems)[number] }[]>();
                  const rows: Row[] = [];
                  for (const item of list) {
                    const size = sizeOf(item);
                    if (size == null) { rows.push({ kind: "single", item }); continue; }
                    const base = stripBr(item.service);
                    const family = byBase.get(base);
                    if (family) { family.push({ size, item }); }
                    else { const fresh = [{ size, item }]; byBase.set(base, fresh); rows.push({ kind: "sized", base, variants: fresh }); }
                  }
                  return (
                    <div key={cat} className="mb-3 last:mb-0 rounded-xl border border-border overflow-hidden">
                      <div className="bg-[var(--muted)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                        {cat}
                      </div>
                      <div className="divide-y divide-border px-2">
                        {rows.map((row) => {
                          if (row.kind === "sized" && row.variants.length > 1) {
                            const variants = [...row.variants].sort((a, b) => a.size - b.size);
                            return (
                              <div key={`sized-${row.base}`} className="flex items-center gap-3 px-1 py-2.5">
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-semibold truncate">{row.base}</div>
                                  {variants[0].item.detail && <div className="text-xs text-muted-foreground truncate">{variants[0].item.detail}</div>}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {variants.map(({ size, item }) => (
                                    <button key={item.id} onClick={() => setEditPriceId(item.id)} title={`Edit ${size} BR price`}
                                      className="flex items-baseline gap-1 rounded-full border border-border bg-card px-2.5 py-1 hover:border-[var(--gold)] hover:shadow-[var(--shadow-card)] transition-all"
                                      data-testid={`edit-price-${item.id}`}>
                                      <span className="text-[10px] font-bold uppercase text-muted-foreground">{size} BR</span>
                                      <span className="font-mono font-bold text-sm tabular-nums">${item.rate}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          }
                          const item = row.kind === "sized" ? row.variants[0].item : row.item;
                          return (
                            <div key={item.id} className="flex items-center gap-3 px-1 py-2.5">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold truncate">{item.service}</div>
                                {item.detail && <div className="text-xs text-muted-foreground truncate">{item.detail}</div>}
                              </div>
                              <div className="text-right shrink-0 font-mono font-bold text-sm tabular-nums">
                                ${item.rate}{item.unit && <span className="text-xs text-muted-foreground font-normal">/{item.unit}</span>}
                              </div>
                              <button aria-label="Edit price item" onClick={() => setEditPriceId(item.id)}
                                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-black/[0.05] transition-colors"
                                data-testid={`edit-price-${item.id}`}>
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
              {!priceItems.length && (
                <div className="py-4 text-center text-sm text-muted-foreground">No agreed rates yet.</div>
              )}
            </div>
          </div>
        </MarginSection>

        {/* ── SCHEDULE + CONTACTS (two compact columns) ─────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-display font-bold text-[var(--ink)]">Upcoming Visits</h2>
              <Link href="/calendar" className="flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors">
                <CalendarDays className="w-4 h-4" /> Schedule
              </Link>
            </div>
            <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
              {upcomingVisits.map((v) => (
                <div key={v.id} className="flex items-center gap-2 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm leading-tight">
                      {new Date(`${v.scheduledOn}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                      {v.windowStart ? ` · ${v.windowStart}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {[v.jobDescription, v.unitNo ? `Unit ${v.unitNo}` : null].filter(Boolean).join(" · ") || "Scheduled visit"}
                    </div>
                  </div>
                  {v.crewLeaderName && <div className="text-xs text-muted-foreground shrink-0">{v.crewLeaderName}</div>}
                </div>
              ))}
              {!upcomingVisits.length && (
                <div className="px-4 py-5 text-center text-sm text-muted-foreground">No upcoming visits.</div>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-display font-bold text-[var(--ink)]">Contacts</h2>
              <button onClick={() => setContactOpen(true)}
                className="flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors">
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
              {contacts.map((contact) => (
                <div key={contact.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{contact.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{contact.role}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    {contact.phone && <div>{contact.phone}</div>}
                    {contact.email && <div className="truncate max-w-[120px]">{contact.email}</div>}
                  </div>
                  <button aria-label="Edit contact" onClick={() => setEditContactId(contact.id)}
                    className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-black/[0.05] transition-colors">
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {!contacts.length && <div className="px-4 py-5 text-center text-sm text-muted-foreground">No contacts.</div>}
            </div>
          </section>
        </div>

        {/* ── EXPENSES ──────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-base font-display font-bold text-[var(--ink)] mb-3">Expenses</h2>
          <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
            {expenses.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                {e.receiptPath && (
                  <a href={`/api/storage${e.receiptPath}`} target="_blank" rel="noreferrer" title="View receipt"
                    className="shrink-0 block w-9 h-9 rounded-lg overflow-hidden border border-[var(--hairline)] bg-muted"
                    data-testid={`expense-receipt-${e.id}`}>
                    <img src={`/api/storage${e.receiptPath}`} alt="Receipt" loading="lazy" className="w-full h-full object-cover" />
                  </a>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    <span className="truncate">{e.vendor || e.category || "Expense"}</span>
                    {e.unitNo && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--ink)]/8 shrink-0">Unit {e.unitNo}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[e.category, e.spentOn ? new Date(e.spentOn).toLocaleDateString() : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="font-mono font-bold text-sm shrink-0 tabular-nums">${e.amount.toLocaleString()}</div>
              </div>
            ))}
            {!expenses.length && <div className="px-4 py-5 text-center text-sm text-muted-foreground">No expenses logged.</div>}
          </div>
        </section>

        {/* ── PROPERTY BRIEF ────────────────────────────────────────────────── */}
        {property.brief && (
          <div className="bg-[var(--gold-tint)] border border-[var(--hairline)] rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            <div className="font-display font-bold text-[11px] tracking-[0.2em] uppercase text-[var(--ink)] mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--gold-light)]" /> Property Brief
            </div>
            <div className="text-sm text-[var(--ink2)] leading-relaxed whitespace-pre-line">{property.brief}</div>
          </div>
        )}

      </div>
    </div>
  );
}
