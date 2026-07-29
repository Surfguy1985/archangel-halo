import { useGetProperty, getGetPropertyQueryKey, useSetInvoiceStatus, useUpdateProperty, useUpdateJob, useClearJob, useRestartJob, useCompleteJob, getGetMoneySummaryQueryKey, getListInvoicesQueryKey, getGetTodayQueryKey, getListPropertiesQueryKey, getListJobsQueryKey, getGetCalendarQueryKey, getGetJobQueryKey } from "@workspace/api-client-react";
import { MarginSection } from "@/components/MarginSection";
import { CrewPhotosSection } from "@/components/CrewPhotosSection";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ChevronLeft, ChevronDown, ChevronRight, Pencil, Plus, CalendarDays, Check, Archive, RotateCcw, History, Receipt, ArrowRight, LayoutGrid } from "lucide-react";
import { useState } from "react";
import { JobLineItemsPanel } from "@/components/JobLineItemsPanel";
import { EditPropertySheet } from "@/components/EditPropertySheet";
import { AddContactSheet } from "@/components/AddContactSheet";
import { AddPriceItemSheet } from "@/components/AddPriceItemSheet";
import { ImportFromCatalogSheet } from "@/components/ImportFromCatalogSheet";
import { AddExpenseSheet } from "@/components/AddExpenseSheet";
import { AddJobSheet } from "@/components/AddJobSheet";
import { EditJobSheet } from "@/components/EditJobSheet";
import { EditContactSheet } from "@/components/EditContactSheet";
import { EditPriceItemSheet } from "@/components/EditPriceItemSheet";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { Repeat } from "lucide-react";

const recurrenceLabels: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

function SectionHeader({ title, onAdd }: { title: string; onAdd?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-[8px] mx-[2px]">
      <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground">{title}</div>
      {onAdd && (
        <button
          onClick={onAdd}
          className="flex items-center gap-[4px] text-[12px] font-display font-bold text-[var(--gold-dark)] transition-transform active:scale-[0.95]"
        >
          <Plus className="w-[14px] h-[14px]" /> Add
        </button>
      )}
    </div>
  );
}

export default function PropertyDetail() {
  const params = useParams();
  const id = params.id as string;
  const [editOpen, setEditOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [importCatalogOpen, setImportCatalogOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [editPriceId, setEditPriceId] = useState<string | null>(null);
  const [openLineItemsJobId, setOpenLineItemsJobId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [invoiceJobId, setInvoiceJobId] = useState<string | null>(null);
  const [expenseJobId, setExpenseJobId] = useState<string | null>(null);
  const [rateJobId, setRateJobId] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const setStatus = useSetInvoiceStatus();
  const updateJob = useUpdateJob();
  const updateProperty = useUpdateProperty();
  const clearJob = useClearJob();
  const [clearErrorJobId, setClearErrorJobId] = useState<string | null>(null);
  const restartJob = useRestartJob();
  const completeJob = useCompleteJob();
  const { data, isLoading } = useGetProperty(id, { query: { enabled: !!id, queryKey: getGetPropertyQueryKey(id) } });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 pt-4">
        <div className="h-8 bg-muted rounded w-1/3"></div>
        <div className="h-32 bg-card rounded-[16px]"></div>
      </div>
    );
  }

  if (!data) return <div className="p-4 text-center text-muted-foreground">Property not found</div>;

  const { property, stats, jobs, priceItems, contacts, expenses, agreements, invoices, upcomingVisits, crewPhotos } = data;
  const activeJobs = jobs.filter((j) => !j.clearedAt && j.status !== "complete");
  const completedJobs = jobs.filter((j) => !j.clearedAt && j.status === "complete");
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
    draft: "bg-[rgba(23,24,28,0.05)] text-muted-foreground",
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
      pct < (property?.marginMin ?? 0.25)
        ? "bg-red-50 text-red-700 border border-red-200"
        : "bg-emerald-50 text-emerald-700 border border-emerald-200";
    return (
      <span className={`inline-flex items-center text-[10.5px] font-display font-bold uppercase tracking-[0.06em] rounded-full px-[8px] py-[2px] ${cls}`}>
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

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <Link href="/properties" className="flex items-center gap-[6px] text-muted-foreground text-[13.5px] font-semibold mb-[10px] w-fit">
        <ChevronLeft className="w-[16px] h-[16px]" /> Back
      </Link>
      
      <div className="flex items-start gap-[10px]">
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[26px] tracking-[-0.015em] leading-[1.1]">{property.name}</div>
          <div className="text-[13px] text-muted-foreground mt-[3px] mb-[14px]">
            {property.pmcName || property.city || "No location data"} {property.units ? `· ${property.units} units` : ''}
          </div>
        </div>
        <button
          onClick={() => setEditOpen(true)}
          aria-label="Edit property"
          className="w-[36px] h-[36px] shrink-0 rounded-full grid place-items-center bg-card border border-border shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-muted-foreground transition-transform active:scale-[0.9]"
        >
          <Pencil className="w-[16px] h-[16px]" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-[9px] mb-[16px]">
        <div className="bg-card rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">${stats.owed.toLocaleString()}</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Owed</span>
        </div>
        <div className="bg-card rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">${stats.collectedTotal.toLocaleString()}</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Collected</span>
        </div>
        <div className="bg-card rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">${stats.invoicedTotal.toLocaleString()}</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Invoiced</span>
        </div>
        <div className="bg-card rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">${stats.expensesTotal.toLocaleString()}</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Expenses</span>
        </div>
        <div className="bg-card rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">{stats.openJobs}</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Open Jobs</span>
        </div>
        <div className="bg-card rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">{stats.marginPct ?? 0}%</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Margin</span>
        </div>
        <div className="bg-card rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">{stats.activeMarginPct != null ? `${stats.activeMarginPct}%` : "—"}</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Active Margin</span>
        </div>
        <div className="bg-card rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">{stats.historicalMarginPct != null ? `${stats.historicalMarginPct}%` : "—"}</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Past Margin</span>
        </div>
      </div>

      <Link
        href={`/properties/${id}/board`}
        className="flex items-center justify-between bg-card rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-border p-[12px_14px] mb-[16px] active:scale-[0.99] transition-transform"
        data-testid="link-client-board"
      >
        <div className="flex items-center gap-[10px]">
          <LayoutGrid className="w-[18px] h-[18px] text-[var(--gold-dark)]" />
          <div>
            <div className="font-display font-bold text-[14.5px] leading-tight">Client board</div>
            <div className="text-[12px] text-muted-foreground">See what the client sees · send a card</div>
          </div>
        </div>
        <ArrowRight className="w-[16px] h-[16px] text-muted-foreground" />
      </Link>

      <MarginSection
        currentPct={stats.marginPct ?? null}
        minFrac={property.marginMin}
        targetFrac={property.marginTarget}
        saving={updateProperty.isPending}
        helperText="Current is the average margin across this property's jobs. Jobs below the minimum get flagged in Today."
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
      />

      {property.brief && (
        <div className="bg-[linear-gradient(135deg,#FFFDF8,#FBF6EA)] border border-[rgba(185,138,47,0.28)] rounded-[16px] p-[14px_15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] mb-[18px]">
          <div className="font-display font-semibold text-[11px] tracking-[0.18em] uppercase text-[var(--gold-dark)] mb-[6px]">Property Brief</div>
          <div className="text-[14px] text-[var(--ink2)] leading-relaxed whitespace-pre-line">{property.brief}</div>
        </div>
      )}

      {([
        ["Active Jobs", activeJobs],
        ["Completed Jobs", completedJobs],
      ] as const).map(([sectionTitle, sectionJobs]) => (
      <div key={sectionTitle} className="mb-[18px]">
        <SectionHeader
          title={sectionJobs.length > 0 ? `${sectionTitle} · ${sectionJobs.length}` : sectionTitle}
          onAdd={sectionTitle === "Active Jobs" ? () => setJobOpen(true) : undefined}
        />
        {sectionJobs.length > 0 ? (
          <div className="space-y-[10px]">
            {sectionJobs.map((job) => (
              <div key={job.id} className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-border border-l-[4px] border-l-[var(--primary)] overflow-hidden transition-all duration-200">
                {/* Header / collapsed state */}
                <div 
                  className="p-[12px_14px] flex items-center gap-[10px] cursor-pointer active:bg-[rgba(23,24,28,0.02)]"
                  onClick={() => {
                    setExpandedJobId(expandedJobId === job.id ? null : job.id);
                    setRateJobId(null);
                    setOpenLineItemsJobId(null);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[15px] truncate flex items-center gap-[7px]">
                      <span className="truncate">{job.category || 'General'} · {job.unitNo || 'Common'}</span>
                      {job.status === "complete" && (
                        <span className="shrink-0 inline-flex items-center gap-[4px] text-[10.5px] font-display font-bold uppercase tracking-[0.08em] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-[8px] py-[2px]">
                          <Check className="w-[10px] h-[10px]" /> Completed
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] text-muted-foreground truncate mt-[2px]">{job.description}</div>
                    {job.isRecurring && (
                      <div className="flex items-center gap-[5px] mt-[4px] text-[11.5px] font-semibold text-[var(--gold-dark)]">
                        <Repeat className="w-[12px] h-[12px]" />
                        {recurrenceLabels[job.recurrence ?? ""] ?? "Recurring"}
                        <span className="text-muted-foreground font-normal">
                          · {job.crewLeaderName ? `${job.crewLeaderName} goes` : "No crew assigned"}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-[4px]">
                    <div className="text-[12px] font-mono text-muted-foreground">{job.jobNo}</div>
                    {!job.isRecurring && job.crewLeaderName && (
                      <div className="text-[11.5px] text-[var(--ink)] font-medium bg-[rgba(23,24,28,0.05)] px-[6px] py-[2px] rounded-[4px]">{job.crewLeaderName}</div>
                    )}
                  </div>
                  <ChevronDown className={`w-[16px] h-[16px] text-muted-foreground transition-transform duration-200 shrink-0 ${expandedJobId === job.id ? 'rotate-180' : ''}`} />
                </div>

                {/* Expanded state */}
                {expandedJobId === job.id && (
                  <div className="p-[0_14px_14px_14px] border-t border-border animate-in slide-in-from-top-2 fade-in duration-200">
                    
                    {/* Primary actions row */}
                    <div className="flex items-center gap-[8px] mt-[14px]">
                      <Link href={`/jobs/${job.id}`} className="flex-1 flex items-center justify-center gap-[6px] text-[13.5px] font-display font-bold px-[12px] py-[8px] rounded-[10px] bg-[var(--ink)] text-white active:scale-[0.98]">
                        Open Job
                        <ArrowRight className="w-[14px] h-[14px]" />
                      </Link>
                      <button
                        onClick={() => setEditJobId(job.id)}
                        className="w-[36px] h-[36px] flex items-center justify-center rounded-[10px] bg-[rgba(23,24,28,0.05)] text-[var(--ink)] active:scale-[0.96]"
                        aria-label="Edit job"
                      >
                        <Pencil className="w-[15px] h-[15px]" />
                      </button>
                    </div>

                    {/* Financials & Line Items */}
                    <div className="mt-[16px] space-y-[12px]">
                      {/* Financials summary grid */}
                      <div className="grid grid-cols-3 gap-[8px]">
                        <div className="bg-[rgba(23,24,28,0.03)] rounded-[8px] p-[8px_10px]">
                          <div className="text-[11px] text-muted-foreground uppercase tracking-[0.05em] mb-[2px]">Invoiced</div>
                          <div className="font-semibold text-[13px] tabular-nums">${(job.invoicedTotal ?? 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-emerald-50/50 rounded-[8px] p-[8px_10px]">
                          <div className="text-[11px] text-emerald-700/70 uppercase tracking-[0.05em] mb-[2px]">Paid</div>
                          <div className="font-semibold text-emerald-700 text-[13px] tabular-nums">${(job.paidTotal ?? 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-[rgba(23,24,28,0.03)] rounded-[8px] p-[8px_10px]">
                          <div className="text-[11px] text-muted-foreground uppercase tracking-[0.05em] mb-[2px]">Expenses</div>
                          <div className="font-semibold text-[13px] tabular-nums">${(job.expensesTotal ?? 0).toLocaleString()}</div>
                        </div>
                      </div>

                      {/* Crew Rate & Margin */}
                      <div className="flex items-center justify-between bg-[rgba(23,24,28,0.03)] rounded-[8px] p-[8px_10px]">
                        {rateJobId === job.id ? (
                          <div className="flex items-center gap-[6px]">
                            <span className="text-[12px] text-muted-foreground">Crew rate</span>
                            <span className="text-[13px] font-medium">$</span>
                            <input
                              autoFocus
                              inputMode="decimal"
                              value={rateDraft}
                              onChange={(e) => setRateDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") saveRate(job.id); if (e.key === "Escape") setRateJobId(null); }}
                              className="w-[60px] px-[6px] py-[2px] rounded-[6px] border border-border bg-background text-[13px] tabular-nums focus:outline-none focus:border-[var(--primary)]"
                            />
                            <button
                              disabled={updateJob.isPending}
                              onClick={() => saveRate(job.id)}
                              className="text-[12.5px] font-display font-bold text-[var(--gold-dark)] disabled:opacity-50 ml-[2px]"
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setRateJobId(job.id); setRateDraft(job.crewRate != null ? String(job.crewRate) : ""); }}
                            className="flex items-center gap-[6px] active:opacity-70 transition-opacity"
                          >
                            <span className="text-[12px] text-muted-foreground">Crew rate</span>
                            <span className="text-[13px] font-semibold tabular-nums text-[var(--ink)]">{job.crewRate != null ? `$${job.crewRate.toLocaleString()}` : "—"}</span>
                            <Pencil className="w-[11px] h-[11px] text-muted-foreground/60" />
                          </button>
                        )}
                        <div>{marginBadge(job.marginPct)}</div>
                      </div>

                      {/* Line items toggle */}
                      <div>
                        <button
                          onClick={() => setOpenLineItemsJobId(openLineItemsJobId === job.id ? null : job.id)}
                          className="flex items-center justify-between w-full py-[6px] active:opacity-70 transition-opacity"
                        >
                          <span className="text-[13px] font-semibold text-[var(--ink)]">Line Items</span>
                          <div className="flex items-center gap-[6px] text-[12.5px] text-muted-foreground">
                            {(job.lineItems?.length ?? 0) > 0 && (
                              <span className="tabular-nums">{job.lineItems!.length} items · ${(job.lineTotal ?? 0).toLocaleString()}</span>
                            )}
                            <ChevronDown className={`w-[14px] h-[14px] transition-transform ${openLineItemsJobId === job.id ? 'rotate-180' : ''}`} />
                          </div>
                        </button>
                        {openLineItemsJobId === job.id && (
                          <div className="mt-[8px] mb-[4px]">
                            <JobLineItemsPanel
                              jobId={job.id}
                              propertyId={id}
                              lineItems={job.lineItems ?? []}
                              priceItems={priceItems}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action buttons section */}
                    <div className="mt-[16px] pt-[14px] border-t border-border flex flex-col gap-[8px]">
                      {job.status !== "complete" ? (
                        <>
                          <div className="flex gap-[8px]">
                            <button
                              onClick={() => setInvoiceJobId(job.id)}
                              className="flex-1 flex justify-center items-center gap-[6px] text-[13px] font-semibold py-[9px] rounded-[8px] bg-[rgba(23,24,28,0.04)] text-[var(--ink)] active:scale-[0.98]"
                            >
                              <Plus className="w-[14px] h-[14px]" /> Invoice
                            </button>
                            <button
                              onClick={() => setExpenseJobId(job.id)}
                              className="flex-1 flex justify-center items-center gap-[6px] text-[13px] font-semibold py-[9px] rounded-[8px] bg-[rgba(23,24,28,0.04)] text-[var(--ink)] active:scale-[0.98]"
                            >
                              <Plus className="w-[14px] h-[14px]" /> Expense
                            </button>
                          </div>
                          <button
                            disabled={completeJob.isPending}
                            onClick={() => completeJob.mutate({ id: job.id }, { onSuccess: () => invalidateJobLists() })}
                            className="w-full flex justify-center items-center gap-[6px] text-[13px] font-semibold py-[10px] rounded-[8px] bg-emerald-50 text-emerald-700 border border-emerald-200 active:scale-[0.98] disabled:opacity-50 mt-[2px]"
                          >
                            <Check className="w-[15px] h-[15px]" /> Verify & Complete
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col gap-[8px]">
                          {(() => {
                            const inv = invoiceForJob(job.id);
                            return inv ? (
                              <Link
                                href={`/invoices/${inv.id}`}
                                className={`flex justify-center items-center gap-[6px] text-[13px] font-semibold py-[10px] rounded-[8px] active:scale-[0.98] ${invoiceStatusCls[inv.status] ?? invoiceStatusCls.draft}`}
                              >
                                <Receipt className="w-[15px] h-[15px]" /> {invoiceStatusLabel[inv.status] ?? "Invoice"} · {inv.invoiceNo}
                              </Link>
                            ) : (
                              <button
                                onClick={() => setInvoiceJobId(job.id)}
                                className="flex justify-center items-center gap-[6px] text-[13px] font-semibold py-[10px] rounded-[8px] bg-[rgba(23,24,28,0.04)] text-[var(--ink)] active:scale-[0.98]"
                              >
                                <Plus className="w-[15px] h-[15px]" /> Create Invoice
                              </button>
                            );
                          })()}
                          <div className="flex gap-[8px]">
                            <button
                              disabled={restartJob.isPending}
                              onClick={() => restartJob.mutate({ id: job.id }, { onSuccess: invalidateJobLists })}
                              className="flex-1 flex justify-center items-center gap-[6px] text-[12.5px] font-semibold py-[9px] rounded-[8px] bg-[rgba(143,106,31,0.08)] text-[var(--gold-dark)] active:scale-[0.98] disabled:opacity-50"
                            >
                              <RotateCcw className="w-[14px] h-[14px]" /> Reopen
                            </button>
                            <button
                              disabled={clearJob.isPending}
                              onClick={() => {
                                setClearErrorJobId(job.id);
                                clearJob.mutate({ id: job.id }, { onSuccess: invalidateJobLists });
                              }}
                              className="flex-1 flex justify-center items-center gap-[6px] text-[12.5px] font-semibold py-[9px] rounded-[8px] bg-[rgba(23,24,28,0.04)] text-muted-foreground active:scale-[0.98] disabled:opacity-50"
                            >
                              <Archive className="w-[14px] h-[14px]" /> Archive
                            </button>
                          </div>
                          {clearJob.isError && clearErrorJobId === job.id && (
                            <div className="text-[12px] font-medium text-red-600 text-center mt-[2px]">
                              {(clearJob.error as { data?: { error?: string } } | null)?.data?.error ?? clearJob.error?.message ?? "Couldn't clear this job."}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px] text-[13px] text-muted-foreground text-center">
            {sectionTitle === "Active Jobs"
              ? "No active jobs. Tap Add to create one."
              : "Nothing completed yet — once a job is verified finished, mark it complete and it moves here."}
          </div>
        )}
      </div>
      ))}

      {historyJobs.length > 0 && (
        <div className="mb-[18px]">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex items-center gap-[6px] mb-[8px] mx-[2px] font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground active:scale-[0.97]"
          >
            <History className="w-[13px] h-[13px]" />
            Job History · {historyJobs.length}
            <ChevronDown className={`w-[13px] h-[13px] transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
          </button>
          {historyOpen && (
            <div className="space-y-[10px]">
              {historyJobs.map((job) => (
                <div key={job.id} className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-border border-l-[4px] border-l-[var(--gold-light)] flex items-center gap-[10px] p-[12px_14px] text-[14px]">
                  <Link href={`/jobs/${job.id}`} className="flex-1 min-w-0">
                    <div className="font-semibold truncate text-muted-foreground">{job.category || 'General'} · {job.unitNo || 'Common'}</div>
                    <div className="text-[12px] text-muted-foreground truncate">
                      {job.jobNo}{job.completedAt ? ` · Completed ${new Date(job.completedAt).toLocaleDateString()}` : ''}
                    </div>
                  </Link>
                  {(() => {
                    const inv = invoiceForJob(job.id);
                    return inv ? (
                      <Link
                        href={`/invoices/${inv.id}`}
                        className={`shrink-0 flex items-center gap-[4px] text-[11px] font-display font-bold px-[9px] py-[4px] rounded-full active:scale-[0.95] ${invoiceStatusCls[inv.status] ?? invoiceStatusCls.draft}`}
                      >
                        <Receipt className="w-[11px] h-[11px]" /> {invoiceStatusLabel[inv.status] ?? "Invoice"}
                      </Link>
                    ) : null;
                  })()}
                  <button
                    disabled={restartJob.isPending}
                    onClick={() => restartJob.mutate({ id: job.id }, { onSuccess: invalidateJobLists })}
                    className="shrink-0 flex items-center gap-[5px] text-[12px] font-display font-bold px-[11px] py-[6px] rounded-full bg-[rgba(143,106,31,0.1)] text-[var(--gold-dark)] active:scale-[0.95] disabled:opacity-50"
                  >
                    <RotateCcw className="w-[12px] h-[12px]" /> Restart
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <CrewPhotosSection photos={crewPhotos ?? []} showJob />

      <div className="mb-[18px]">
        <div className="flex items-center justify-between mb-[8px] mx-[2px]">
          <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground">Upcoming Visits</div>
          <Link href="/calendar" className="flex items-center gap-[4px] text-[12px] font-display font-bold text-[var(--gold-dark)] active:scale-[0.95]">
            <CalendarDays className="w-[13px] h-[13px]" /> Schedule
          </Link>
        </div>
        {upcomingVisits.length > 0 ? (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[6px_14px]">
            {upcomingVisits.map((v, idx) => (
              <div key={v.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">
                    {new Date(`${v.scheduledOn}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    {v.windowStart ? ` · ${v.windowStart}` : ""}
                  </div>
                  <div className="text-[12px] text-muted-foreground truncate">
                    {[v.jobDescription, v.unitNo ? `Unit ${v.unitNo}` : null].filter(Boolean).join(" · ") || "Scheduled visit"}
                  </div>
                </div>
                {v.crewLeaderName && <div className="text-[12px] text-muted-foreground shrink-0">{v.crewLeaderName}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px] text-[13px] text-muted-foreground text-center">No upcoming visits scheduled.</div>
        )}
      </div>

      <div className="mb-[18px]">
        <SectionHeader title="Invoices" />
        {invoices.length > 0 ? (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[6px_14px]">
            {invoices.map((inv, idx) => (
              <div key={inv.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{inv.invoiceNo || "Invoice"}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {inv.status === "paid"
                      ? "Paid"
                      : inv.status === "past_due"
                        ? `Past due${inv.daysLate ? ` · ${inv.daysLate}d late` : ""}`
                        : inv.status === "sent"
                          ? "Sent"
                          : "Draft"}
                  </div>
                </div>
                <div className="font-display font-semibold tabular-nums shrink-0">${inv.amount.toLocaleString()}</div>
                {inv.status === "paid" ? (
                  <button
                    disabled={setStatus.isPending}
                    onClick={() => toggleInvoice(inv.id, "sent")}
                    className="shrink-0 text-[12px] font-display font-bold px-[10px] py-[6px] rounded-full bg-[rgba(23,24,28,0.05)] text-muted-foreground active:scale-[0.95] disabled:opacity-50"
                  >
                    Mark pending
                  </button>
                ) : (
                  <button
                    disabled={setStatus.isPending}
                    onClick={() => toggleInvoice(inv.id, "paid")}
                    className="shrink-0 text-[12px] font-display font-bold px-[10px] py-[6px] rounded-full text-[var(--ink)] bg-[var(--gold-light)] active:scale-[0.95] disabled:opacity-50"
                  >
                    Mark paid
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px] text-[13px] text-muted-foreground text-center">No invoices for this property.</div>
        )}
      </div>

      <div className="mb-[18px]">
        <div className="flex items-center justify-between">
          <SectionHeader title="Price List" onAdd={() => setPriceOpen(true)} />
        </div>
        <button
          onClick={() => setImportCatalogOpen(true)}
          className="w-full mb-[10px] rounded-[13px] py-[10px] text-[13.5px] font-display font-bold text-[var(--gold-dark)] bg-card border border-[var(--gold-tint,rgba(143,106,31,0.25))] shadow-[0_2px_8px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform"
        >
          Add from Price Book
        </button>
        {priceItems.length > 0 ? (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[6px_14px]">
            {priceItems.map((item, idx) => (
              <div key={item.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{item.service}</div>
                  {item.detail && <div className="text-[12px] text-muted-foreground truncate">{item.detail}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-display font-semibold tabular-nums">${item.rate}</div>
                  {item.unit && <div className="text-[12px] text-muted-foreground">/{item.unit}</div>}
                </div>
                <button
                  aria-label="Edit price item"
                  onClick={() => setEditPriceId(item.id)}
                  className="shrink-0 w-[30px] h-[30px] rounded-full flex items-center justify-center bg-[rgba(23,24,28,0.05)] text-muted-foreground active:scale-[0.94]"
                >
                  <Pencil className="w-[13px] h-[13px]" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px] text-[13px] text-muted-foreground text-center">No agreed rates yet.</div>
        )}
      </div>

      <div className="mb-[18px]">
        <SectionHeader title="Contacts" onAdd={() => setContactOpen(true)} />
        {contacts.length > 0 ? (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[6px_14px]">
            {contacts.map((contact, idx) => (
              <div key={contact.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{contact.name}</div>
                  <div className="text-[12px] text-muted-foreground truncate">{contact.role}</div>
                </div>
                <div className="text-right shrink-0 text-[12px] text-muted-foreground">
                  {contact.phone && <div>{contact.phone}</div>}
                  {contact.email && <div>{contact.email}</div>}
                </div>
                <button
                  aria-label="Edit contact"
                  onClick={() => setEditContactId(contact.id)}
                  className="shrink-0 w-[30px] h-[30px] rounded-full flex items-center justify-center bg-[rgba(23,24,28,0.05)] text-muted-foreground active:scale-[0.94]"
                >
                  <Pencil className="w-[13px] h-[13px]" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px] text-[13px] text-muted-foreground text-center">No contacts yet.</div>
        )}
      </div>

      <div className="mb-[18px]">
        <SectionHeader title="Expenses" onAdd={() => setExpenseOpen(true)} />
        {expenses.length > 0 ? (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[6px_14px]">
            {expenses.map((e, idx) => (
              <div key={e.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{e.vendor || e.category || "Expense"}</div>
                  <div className="text-[12px] text-muted-foreground truncate">
                    {[e.category, e.spentOn ? new Date(e.spentOn).toLocaleDateString() : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="font-display font-semibold tabular-nums shrink-0">${e.amount.toLocaleString()}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px] text-[13px] text-muted-foreground text-center">No expenses logged.</div>
        )}
      </div>

      {agreements.length > 0 && (
        <div className="mb-[18px]">
          <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground mb-[8px] mx-[2px]">Agreements</div>
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[6px_14px]">
            {agreements.map((a, idx) => (
              <div key={a.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{a.title}</div>
                  <div className="text-[12px] text-muted-foreground truncate">
                    {[
                      a.effectiveFrom ? `from ${new Date(a.effectiveFrom).toLocaleDateString()}` : null,
                      a.renewsOn ? `renews ${new Date(a.renewsOn).toLocaleDateString()}` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <EditPropertySheet open={editOpen} onOpenChange={setEditOpen} property={property} />
      <AddContactSheet open={contactOpen} onOpenChange={setContactOpen} propertyId={id} />
      <AddPriceItemSheet open={priceOpen} onOpenChange={setPriceOpen} propertyId={id} />
      <ImportFromCatalogSheet open={importCatalogOpen} onOpenChange={setImportCatalogOpen} propertyId={id} existingServices={priceItems.map((p) => p.service)} />
      <AddExpenseSheet open={expenseOpen} onOpenChange={setExpenseOpen} propertyId={id} />
      {expenseJobId && (
        <AddExpenseSheet
          key={expenseJobId}
          open={!!expenseJobId}
          onOpenChange={(o) => { if (!o) setExpenseJobId(null); }}
          propertyId={id}
          jobId={expenseJobId}
        />
      )}
      <AddJobSheet open={jobOpen} onOpenChange={setJobOpen} propertyId={id} />
      <InvoiceEditor
        open={!!invoiceJobId}
        onOpenChange={(o) => { if (!o) setInvoiceJobId(null); }}
        initialJobId={invoiceJobId}
      />
      {(() => {
        const j = jobs.find((x) => x.id === editJobId);
        return j ? (
          <EditJobSheet
            open={!!editJobId}
            onOpenChange={(o) => !o && setEditJobId(null)}
            job={{ ...j, propertyId: id }}
          />
        ) : null;
      })()}
      {(() => {
        const c = contacts.find((x) => x.id === editContactId);
        return c ? (
          <EditContactSheet
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
          <EditPriceItemSheet
            open={!!editPriceId}
            onOpenChange={(o) => !o && setEditPriceId(null)}
            item={p}
            propertyId={id}
          />
        ) : null;
      })()}
    </div>
  );
}
