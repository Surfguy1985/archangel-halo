import { useGetProperty, getGetPropertyQueryKey, useSetInvoiceStatus, useUpdateProperty, useUpdateJob, useClearJob, useRestartJob, useCompleteJob, getGetMoneySummaryQueryKey, getListInvoicesQueryKey, getGetTodayQueryKey, getListPropertiesQueryKey, getListJobsQueryKey, getGetCalendarQueryKey, getGetJobQueryKey, getListExpensesQueryKey, useCreateInvoice, useListCrews, useBroadcastJob} from "@workspace/api-client-react";
import type { Job, Invoice } from "@workspace/api-client-react";
import { AddExpenseDialog} from "@/components/MoneyDialogs";
import { MarginSection} from "@/components/MarginSection";
import { CrewPhotosSection} from "@/components/CrewPhotosSection";
import { useQueryClient} from "@tanstack/react-query";
import { useParams, Link} from "wouter";
import { CalendarDays, Check, ChevronDown, ChevronLeft, Archive, RotateCcw, Pencil, Plus, Radio, Repeat, BookOpen, Receipt, Users, Wand2, Zap} from "lucide-react";
import { InvoiceWizardDialog} from "@/components/InvoiceWizardDialog";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton} from "@/components/ui/skeleton";

import { useState} from "react";
import { useToast} from "@/hooks/use-toast";
import { JobLineItemsPanel} from "@/components/JobLineItemsPanel";
import { JobSummaryDialog} from "@/components/JobSummaryDialog";
import { ImportFromCatalogDialog} from "@/components/ImportFromCatalogDialog";
import { QuickJobDialog} from "@/components/QuickJobDialog";
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
  const [contactOpen, setContactOpen] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [quickJobOpen, setQuickJobOpen] = useState(false);
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
  const [rateDraft, setRateDraft] = useState("");
  const updateJob = useUpdateJob();
  const setStatus = useSetInvoiceStatus();
  const clearJob = useClearJob();
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
  const activeJobs = jobs.filter((j) => !j.clearedAt);
  const historyJobs = jobs.filter((j) => !!j.clearedAt);
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
  };

  const invalidateMoney = (jobId?: string) => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
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
      { onSuccess: () => invalidateMoney(jobId) },
    );
  };

  const renderJobCard = (job: Job, invoice: Invoice | undefined) => {
    const isComplete = job.status === "complete";
    const STAGES = [
      { label: "Crew", done: !!job.crewLeaderId },
      { label: "Work", done: isComplete },
      { label: "Invoice", done: invoice?.status === "paid" },
      { label: "Close", done: !!job.clearedAt }
    ];

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

      let label = "";
      let action = () => {};

      if (job.clearedAt) {
        label = "Reopen";
        action = () => restartJob.mutate({ id: job.id }, { onSuccess: invalidateJobLists });
      } else if (!job.crewLeaderId) {
        label = "Assign crew";
        action = () => setAssignJobId(job.id);
      } else if (!isComplete) {
        label = "Complete work";
        action = () => completeJob.mutate({ id: job.id }, { onSuccess: invalidateJobLists });
      } else if (!invoice) {
        label = "Create invoice";
        action = () => createInvoice.mutate({ data: { propertyId: id, jobId: job.id, amount: job.lineTotal || 0 } }, { onSuccess: () => invalidateMoney(job.id) });
      } else if (invoice.status === "draft") {
        label = "Send invoice";
        action = () => setStatus.mutate({ id: invoice.id, data: { status: "sent" } }, { onSuccess: () => invalidateMoney(job.id) });
      } else if (invoice.status === "sent" || invoice.status === "past_due") {
        label = "Mark paid";
        action = () => setStatus.mutate({ id: invoice.id, data: { status: "paid" } }, { onSuccess: () => invalidateMoney(job.id) });
      } else if (invoice.status === "paid") {
        label = "Close out";
        // Close-out first opens the job summary form (prefilled recap for the PM).
        action = () => setSummaryJobId(job.id);
      }

      return (
        <button
          onClick={action}
          className="px-5 py-2.5 bg-white text-black text-sm font-bold rounded-xl hover:bg-white/90 transition-colors"
        >
          {label}
        </button>
      );
    };

    return (
      <div key={job.id} className="bg-[var(--ink)] text-white rounded-2xl p-6 shadow-sm flex flex-col gap-5 relative z-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <Link href={`/jobs/${job.id}`} className="block hover:opacity-80 transition-opacity">
            <h3 className="text-xl font-display font-bold text-white mb-1 flex items-center gap-2">
              {job.category || 'General'} · {job.unitNo || 'Common'}
              <button
                aria-label="Edit job"
                onClick={(e) => { e.preventDefault(); setEditJobId(job.id); }}
                className="w-6 h-6 rounded-full flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white transition-colors"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </h3>
            <p className="text-white/70 text-sm font-medium">{job.description}</p>
          </Link>
          
          {job.clearedAt ? (
             <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 bg-white/10 text-white rounded-full">
               <Archive className="w-3.5 h-3.5" /> Closed
             </span>
          ) : isComplete && invoice?.status === "paid" ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 bg-[var(--primary)] text-black rounded-full">
              <Check className="w-3.5 h-3.5" /> Completed
            </span>
          ) : (
            <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 bg-white/10 text-white rounded-full">
              In progress
            </span>
          )}
        </div>

        {/* Info Grid */}
        <div className="flex items-center flex-wrap gap-x-5 gap-y-2 text-sm text-white/70 font-medium">
          <span className="font-mono text-white/50">{job.jobNo}</span>
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

        {/* Progress Track */}
        <div className="flex items-center gap-2">
          {STAGES.map((s, i, arr) => {
            const isActive = i === 0 || arr[i - 1].done;
            const highlight = isActive || s.done;
            return (
              <div key={s.label} className="flex-1 flex flex-col items-start gap-2">
                <div className={`h-1.5 w-full rounded-full transition-colors ${highlight ? "bg-[var(--primary)]" : "bg-white/10"}`} />
                <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${highlight ? "text-[var(--primary)]" : "text-white/40"}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

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
          onCloseOut={() =>
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
                onError: (err) =>
                  toast({ title: "Can't close out yet", description: err.message, variant: "destructive" }),
              },
            )
          }
        />
      )}
      <EditPropertyDialog open={editOpen} onOpenChange={setEditOpen} property={property} />
      <AddPriceItemDialog open={priceOpen} onOpenChange={setPriceOpen} propertyId={id} />
      <ImportFromCatalogDialog open={importOpen} onOpenChange={setImportOpen} propertyId={id} existingServices={priceItems.map((p) => p.service)} />
      <AddContactDialog open={contactOpen} onOpenChange={setContactOpen} propertyId={id} />
      <AddJobDialog open={jobOpen} onOpenChange={setJobOpen} propertyId={id} priceItems={priceItems} />
      <QuickJobDialog open={quickJobOpen} onOpenChange={setQuickJobOpen} propertyId={id} />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-display font-bold text-[var(--ink)]">Jobs</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuickJobOpen(true)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
                  data-testid="button-quick-job"
                >
                  <Zap className="w-4 h-4" /> Quick job
                </button>
                <button
                  onClick={() => setJobOpen(true)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
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
                  {count > 0 && <span className={`ml-1.5 text-xs font-normal ${jobTab === key ? "text-white/60" : "text-muted-foreground"}`}>{count}</span>}
                </button>
              ))}
            </div>
            {jobTab !== "history" && (
            <div className="space-y-4">
              {activeJobs.map(job => renderJobCard(job, invoiceForJob(job.id)))}
              {!activeJobs.length && (
                <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6 text-center text-sm text-muted-foreground">
                  No active jobs — closed-out jobs live in History.
                </div>
              )}
            </div>
            )}
            {jobTab === "history" && (
              <div className="space-y-4">
                {historyJobs.map((job) => renderJobCard(job, invoiceForJob(job.id)))}
                {!historyJobs.length && (
                  <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6 text-center text-sm text-muted-foreground">
                    No cleared jobs yet — completed jobs you clear land here.
                  </div>
                )}
              </div>
            )}
          </section>

          <CrewPhotosSection photos={crewPhotos ?? []} showJob />

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-display font-bold text-[var(--ink)]">Contacts</h2>
              <button
                onClick={() => setContactOpen(true)}
                className="flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
              {contacts.map(contact => (
                <div key={contact.id} className="flex items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{contact.name}</div>
                    <div className="text-sm text-muted-foreground">{contact.role}</div>
                  </div>
                  <div className="text-right text-sm text-muted-foreground shrink-0">
                    <div>{contact.phone}</div>
                    <div>{contact.email}</div>
                  </div>
                  <button
                    aria-label="Edit contact"
                    onClick={() => setEditContactId(contact.id)}
                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-black/[0.05] transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {!contacts.length && <div className="p-6 text-center text-sm text-muted-foreground">No contacts.</div>}
            </div>
          </section>
        </div>

        <div className="space-y-6">
           {property.brief && (
            <div className="bg-[var(--gold-tint)] border border-[var(--hairline)] rounded-[20px] p-6 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
              <div className="font-display font-bold text-[11px] tracking-[0.2em] uppercase text-[var(--ink)] mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--gold-light)]" /> Property Brief
              </div>
              <div className="text-sm text-[var(--ink2)] leading-relaxed whitespace-pre-line">{property.brief}</div>
            </div>
          )}

          <section>
            <h2 className="text-xl font-display font-bold text-[var(--ink)] mb-4">Invoices</h2>
            <div className="space-y-3">
              {(() => {
                const groups: { key: string; label: string; sub: string | null; items: Invoice[] }[] = [];
                for (const job of jobs) {
                  const items = invoices.filter((inv) => inv.jobId === job.id);
                  if (items.length) {
                    groups.push({
                      key: job.id,
                      label: `${job.category || "General"} · ${job.unitNo || "Common"}`,
                      sub: job.description || null,
                      items,
                    });
                  }
                }
                const unassigned = invoices.filter((inv) => !inv.jobId || !jobs.some((j) => j.id === inv.jobId));
                if (unassigned.length) groups.push({ key: "unassigned", label: "Not tied to a job", sub: null, items: unassigned });
                if (!groups.length) {
                  return (
                    <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6 text-center text-sm text-muted-foreground">
                      No invoices for this property.
                    </div>
                  );
                }
                return groups.map((g) => {
                  const open = expandedInvoiceGroup === g.key;
                  const total = g.items.reduce((s, inv) => s + inv.amount, 0);
                  const unpaid = g.items.filter((inv) => inv.status !== "paid").length;
                  return (
                    <div key={g.key} className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] overflow-hidden">
                      <button
                        onClick={() => setExpandedInvoiceGroup(open ? null : g.key)}
                        data-testid={`invoice-group-${g.key}`}
                        aria-expanded={open}
                        className="w-full flex items-center gap-3 p-4 text-left hover:bg-black/[0.02] transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate">{g.label}</div>
                          <div className="text-sm text-muted-foreground truncate">
                            {g.items.length} invoice{g.items.length === 1 ? "" : "s"}
                            {unpaid > 0 ? ` · ${unpaid} unpaid` : " · all paid"}
                            {g.sub ? ` · ${g.sub}` : ""}
                          </div>
                        </div>
                        <div className="font-mono font-bold shrink-0 tabular-nums">${total.toLocaleString()}</div>
                        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
                      </button>
                      <AnimatePresence initial={false}>
                        {open && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                          >
                            <div className="divide-y divide-[var(--hairline)] border-t border-[var(--hairline)]">
                              {g.items.map((inv) => (
                                <div key={inv.id} className="flex items-center gap-3 p-4 pl-6">
                                  <Link href={`/invoices/${inv.id}`} className="flex-1 min-w-0 hover:opacity-70 transition-opacity">
                                    <div className="font-semibold">{inv.invoiceNo || "Invoice"}</div>
                                    <div className={`text-sm font-medium ${invoiceStatusCls[inv.status] ?? "text-muted-foreground"}`}>
                                      {inv.status === "past_due"
                                        ? `Past due${inv.daysLate ? ` · ${inv.daysLate}d late` : ""}`
                                        : invoiceStatusLabel[inv.status] ?? inv.status}
                                    </div>
                                  </Link>
                                  <div className="font-mono font-bold shrink-0 tabular-nums">${inv.amount.toLocaleString()}</div>
                                  {inv.status === "paid" ? (
                                    <button
                                      disabled={setStatus.isPending}
                                      onClick={() => toggleInvoice(inv.id, "sent")}
                                      className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-black/[0.05] text-muted-foreground hover:bg-black/[0.08] transition-colors disabled:opacity-50"
                                    >
                                      Mark pending
                                    </button>
                                  ) : (
                                    <button
                                      disabled={setStatus.isPending}
                                      onClick={() => toggleInvoice(inv.id, "paid")}
                                      className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full text-[var(--ink)] bg-[var(--primary)] hover:brightness-105 transition-all disabled:opacity-50"
                                    >
                                      Mark paid
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                });
              })()}
            </div>
          </section>

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
              <div className="divide-y divide-border -mx-1">
                {priceItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 px-1 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{item.service}</div>
                      {item.detail && <div className="text-xs text-muted-foreground truncate">{item.detail}</div>}
                    </div>
                    <div className="text-right shrink-0 font-mono font-bold text-sm tabular-nums">
                      ${item.rate}
                      {item.unit && <span className="text-xs text-muted-foreground font-normal">/{item.unit}</span>}
                    </div>
                    <button
                      aria-label="Edit price item"
                      onClick={() => setEditPriceId(item.id)}
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-black/[0.05] transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {!priceItems.length && (
                  <div className="py-4 text-center text-sm text-muted-foreground">No agreed rates yet.</div>
                )}
              </div>
            </div>
          </MarginSection>

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-display font-bold text-[var(--ink)]">Upcoming Visits</h2>
              <Link href="/calendar" className="flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors">
                <CalendarDays className="w-4 h-4" /> Schedule
              </Link>
            </div>
            <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
              {upcomingVisits.map((v) => (
                <div key={v.id} className="flex items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">
                      {new Date(`${v.scheduledOn}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                      {v.windowStart ? ` · ${v.windowStart}` : ""}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {[v.jobDescription, v.unitNo ? `Unit ${v.unitNo}` : null].filter(Boolean).join(" · ") || "Scheduled visit"}
                    </div>
                  </div>
                  {v.crewLeaderName && <div className="text-sm text-muted-foreground shrink-0">{v.crewLeaderName}</div>}
                </div>
              ))}
              {!upcomingVisits.length && <div className="p-6 text-center text-sm text-muted-foreground">No upcoming visits scheduled.</div>}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-display font-bold text-[var(--ink)] mb-4">Expenses</h2>
            <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
              {expenses.map((e) => (
                <div key={e.id} className="flex items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{e.vendor || e.category || "Expense"}</div>
                    <div className="text-sm text-muted-foreground truncate">
                      {[e.category, e.spentOn ? new Date(e.spentOn).toLocaleDateString() : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="font-mono font-bold shrink-0">${e.amount.toLocaleString()}</div>
                </div>
              ))}
              {!expenses.length && <div className="p-6 text-center text-sm text-muted-foreground">No expenses logged.</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
