import { useGetProperty, getGetPropertyQueryKey, useSetInvoiceStatus, useUpdateProperty, useUpdateJob, useClearJob, useRestartJob, useCompleteJob, getGetMoneySummaryQueryKey, getListInvoicesQueryKey, getGetTodayQueryKey, getListPropertiesQueryKey, getListJobsQueryKey, getGetCalendarQueryKey, getGetJobQueryKey, getListExpensesQueryKey} from "@workspace/api-client-react";
import { AddExpenseDialog} from "@/components/MoneyDialogs";
import { MarginSection} from "@/components/MarginSection";
import { CrewPhotosSection} from "@/components/CrewPhotosSection";
import { useQueryClient} from "@tanstack/react-query";
import { useParams, Link} from "wouter";
import { CalendarDays, Check, ChevronDown, ChevronLeft, Archive, RotateCcw, Pencil, Plus, Repeat, BookOpen, Receipt} from "lucide-react";
import { Skeleton} from "@/components/ui/skeleton";
import { useState} from "react";
import { JobLineItemsPanel} from "@/components/JobLineItemsPanel";
import { JobFunnel} from "@/components/JobFunnel";
import { ImportFromCatalogDialog} from "@/components/ImportFromCatalogDialog";
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
  const [priceOpen, setPriceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [editPriceId, setEditPriceId] = useState<string | null>(null);
  const [openLineItemsJobId, setOpenLineItemsJobId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [jobTab, setJobTab] = useState<"active" | "history">("active");
  const [expenseJobId, setExpenseJobId] = useState<string | null>(null);
  const [rateJobId, setRateJobId] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const updateJob = useUpdateJob();
  const setStatus = useSetInvoiceStatus();
  const clearJob = useClearJob();
  const restartJob = useRestartJob();
  const completeJob = useCompleteJob();
  const updateProperty = useUpdateProperty();
  const { data, isLoading} = useGetProperty(id, { query: { enabled: !!id, queryKey: getGetPropertyQueryKey(id), refetchInterval: 15000}});

  if (isLoading) {
    return <div className="p-8 max-w-6xl mx-auto"><Skeleton className="h-64 w-full" /></div>;
 }

  if (!data) return <div className="p-8 text-center text-muted-foreground">Property not found</div>;

  const { property, stats, jobs, priceItems, contacts, expenses, invoices, upcomingVisits, crewPhotos} = data;
  const activeJobs = jobs.filter((j) => !j.clearedAt);
  const historyJobs = jobs.filter((j) => !!j.clearedAt);
  const invoiceStatusRank: Record<string, number> = { paid: 0, past_due: 1, sent: 2, draft: 3};
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
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(id)});
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey()});
 };

  const invalidateMoney = (jobId?: string) => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(id)});
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey()});
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey()});
    queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
    if (jobId) queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId)});
 };

  const saveRate = (jobId: string) => {
    const parsed = rateDraft.trim() === "" ? null : Number(rateDraft);
    if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) return;
    updateJob.mutate(
      { id: jobId, data: { crewRate: parsed}},
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
      <span className={`inline-flex items-center text-[10px] font-bold   rounded-full px-2 py-0.5 ${cls}`}>
        {val}% margin
      </span>
    );
 };

  const toggleInvoice = (invoiceId: string, next: "paid" | "sent") => {
    const jobId = invoices.find((inv) => inv.id === invoiceId)?.jobId ?? undefined;
    setStatus.mutate(
      { id: invoiceId, data: { status: next}},
      { onSuccess: () => invalidateMoney(jobId)},
    );
 };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link href="/properties" className="flex items-center gap-2 text-muted-foreground text-sm font-semibold mb-4 w-fit hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to Properties
      </Link>
      
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)]">{property.name}</h1>
          <p className="text-muted-foreground">{property.pmcName || property.city || "No location data"} {property.units ?`· ${property.units} units` : ''}</p>
        </div>
        <button
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-2 bg-card text-[var(--ink)] px-4 py-2 rounded-md font-medium border border-border shadow-sm hover:bg-black/[0.03] transition-colors"
        >
          <Pencil className="w-4 h-4" /> Edit
        </button>
      </header>

      <EditPropertyDialog open={editOpen} onOpenChange={setEditOpen} property={property} />
      <AddPriceItemDialog open={priceOpen} onOpenChange={setPriceOpen} propertyId={id} />
      <ImportFromCatalogDialog open={importOpen} onOpenChange={setImportOpen} propertyId={id} existingServices={priceItems.map((p) => p.service)} />
      <AddContactDialog open={contactOpen} onOpenChange={setContactOpen} propertyId={id} />
      <AddJobDialog open={jobOpen} onOpenChange={setJobOpen} propertyId={id} priceItems={priceItems} />
      {expenseJobId && (
        <AddExpenseDialog
          key={expenseJobId}
          open={!!expenseJobId}
          onOpenChange={(o) => { if (!o) setExpenseJobId(null);}}
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

      <div className="bg-card rounded-xl shadow-sm border border-border grid grid-cols-2 md:grid-cols-5 divide-x divide-border mb-8">
        {([
          ["Owed",`$${stats.owed.toLocaleString()}`],
          ["Collected",`$${stats.collectedTotal.toLocaleString()}`],
          ["Invoiced",`$${stats.invoicedTotal.toLocaleString()}`],
          ["Expenses",`$${stats.expensesTotal.toLocaleString()}`],
          ["Open Jobs", String(stats.openJobs)],
        ] as const).map(([label, value]) => (
          <div key={label} className="p-4">
            <div className="text-[11px] font-semibold text-muted-foreground mb-1">{label}</div>
            <div className="text-xl font-mono font-bold text-[var(--ink)] tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-display font-bold text-[var(--ink)]">Jobs</h2>
              <button
                onClick={() => setJobOpen(true)}
                className="flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="flex items-center gap-1 mb-3 bg-black/[0.04] rounded-full p-1 w-fit">
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
                      ? "bg-card text-[var(--ink)] shadow-sm border border-border"
                      : "text-muted-foreground hover:text-[var(--ink)]"
                 }`}
                >
                  {label}
                  {count > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{count}</span>}
                </button>
              ))}
            </div>
            {jobTab !== "history" && (
            <div className="space-y-3">
              {activeJobs.map(job => (
                <div key={job.id} className="bg-card rounded-xl shadow-sm border border-border border-l-4 border-l-[var(--primary)] p-4 hover:bg-black/[0.02] transition-colors">
                  <div className="flex items-center gap-3">
                    <Link href={`/jobs/${job.id}`} className="flex-1 min-w-0">
                      <div className="font-semibold flex items-center gap-2">
                        <span className="truncate">{job.category || 'General'} · {job.unitNo || 'Common'}</span>
                        {job.status === "complete" && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                            <Check className="w-2.5 h-2.5" /> Completed
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">{job.description}</div>
                      {job.isRecurring && (
                        <div className="flex items-center gap-1.5 mt-1 text-xs font-semibold text-[var(--gold-dark)]">
                          <Repeat className="w-3 h-3" />
                          {{ daily: "Daily", weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly", quarterly: "Quarterly"}[job.recurrence ?? ""] ?? "Recurring"}
                          <span className="text-muted-foreground font-normal">
                            · {job.crewLeaderName ?`${job.crewLeaderName} goes` : "No crew assigned"}
                          </span>
                        </div>
                      )}
                    </Link>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm text-muted-foreground">{job.jobNo}</div>
                      {!job.isRecurring && job.crewLeaderName && (
                        <div className="text-xs text-muted-foreground">{job.crewLeaderName}</div>
                      )}
                    </div>
                    <button
                      aria-label="Edit job"
                      onClick={() => setEditJobId(job.id)}
                      className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-black/[0.05] transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => setOpenLineItemsJobId(openLineItemsJobId === job.id ? null : job.id)}
                    className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openLineItemsJobId === job.id ? 'rotate-180' : ''}`} />
                    Line items
                    {(job.lineItems?.length ?? 0) > 0 && (
                      <span className="text-muted-foreground font-normal">
                        · {job.lineItems!.length} · ${(job.lineTotal ?? 0).toLocaleString()}
                      </span>
                    )}
                  </button>
                  {openLineItemsJobId === job.id && (
                    <JobLineItemsPanel
                      jobId={job.id}
                      propertyId={id}
                      lineItems={job.lineItems ?? []}
                      priceItems={priceItems}
                    />
                  )}
                  <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 mt-2 text-xs text-muted-foreground">
                    {rateJobId === job.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        Crew $
                        <input
                          autoFocus
                          inputMode="decimal"
                          value={rateDraft}
                          onChange={(e) => setRateDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveRate(job.id); if (e.key === "Escape") setRateJobId(null);}}
                          className="w-20 px-1.5 py-0.5 rounded-md border border-border bg-background text-xs tabular-nums"
                        />
                        <button
                          disabled={updateJob.isPending}
                          onClick={() => saveRate(job.id)}
                          className="font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] disabled:opacity-50"
                        >
                          Save
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => { setRateJobId(job.id); setRateDraft(job.crewRate != null ? String(job.crewRate) : "");}}
                        className="inline-flex items-center gap-1 font-semibold text-[var(--ink)] hover:opacity-70"
                      >
                        Crew {job.crewRate != null ?`$${job.crewRate.toLocaleString()}` : "rate —"}
                        <Pencil className="w-2.5 h-2.5 text-muted-foreground" />
                      </button>
                    )}
                    <span>Invoiced <b className="text-[var(--ink)] tabular-nums">${(job.invoicedTotal ?? 0).toLocaleString()}</b></span>
                    <span>Paid <b className="text-emerald-700 tabular-nums">${(job.paidTotal ?? 0).toLocaleString()}</b></span>
                    <span>Expenses <b className="text-[var(--ink)] tabular-nums">${(job.expensesTotal ?? 0).toLocaleString()}</b></span>
                    {marginBadge(job.marginPct)}
                  </div>
                  <JobFunnel
                    job={job}
                    invoice={invoiceForJob(job.id)}
                    propertyId={id}
                    onCompleteWork={() => completeJob.mutate({ id: job.id}, { onSuccess: () => invalidateJobLists()})}
                    completePending={completeJob.isPending}
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setExpenseJobId(job.id)}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-black/[0.05] text-[var(--ink)] hover:bg-black/[0.08] transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Expense
                    </button>
                    {job.status === "complete" && (
                      <button
                        disabled={restartJob.isPending}
                        onClick={() => restartJob.mutate({ id: job.id}, { onSuccess: invalidateJobLists})}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-[rgba(143,106,31,0.1)] text-[var(--gold-dark)] hover:bg-[rgba(143,106,31,0.16)] transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" /> Reopen for corrections
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!activeJobs.length && (
                <div className="bg-card rounded-xl shadow-sm border border-border p-6 text-center text-sm text-muted-foreground">
                  No active jobs — closed-out jobs live in History.
                </div>
              )}
            </div>
            )}
            {jobTab === "history" && (
              <div className="space-y-3">
                {historyJobs.map((job) => (
                  <div key={job.id} className="bg-card rounded-xl shadow-sm border border-border border-l-4 border-l-[rgba(180,255,68,0.45)] flex items-center gap-3 p-4">
                    <Link href={`/jobs/${job.id}`} className="flex-1 min-w-0">
                      <div className="font-semibold text-muted-foreground truncate">{job.category || 'General'} · {job.unitNo || 'Common'}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {job.jobNo}{job.completedAt ?` · Completed ${new Date(job.completedAt).toLocaleDateString()}` : ''}
                      </div>
                    </Link>
                    {(() => {
                      const inv = invoiceForJob(job.id);
                      return inv ? (
                        <Link
                          href={`/invoices/${inv.id}`}
                          className={`shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full hover:opacity-80 transition-opacity ${invoiceStatusCls[inv.status] ?? invoiceStatusCls.draft}`}
                        >
                          <Receipt className="w-3 h-3" /> {invoiceStatusLabel[inv.status] ?? "Invoice"}
                        </Link>
                      ) : null;
                   })()}
                    <button
                      disabled={restartJob.isPending}
                      onClick={() => restartJob.mutate({ id: job.id}, { onSuccess: invalidateJobLists})}
                      className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-[rgba(143,106,31,0.1)] text-[var(--gold-dark)] hover:bg-[rgba(143,106,31,0.16)] transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="w-3 h-3" /> Restart
                    </button>
                  </div>
                ))}
                {!historyJobs.length && (
                  <div className="bg-card rounded-xl shadow-sm border border-border p-6 text-center text-sm text-muted-foreground">
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
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
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
            <div className="bg-[linear-gradient(135deg,#FFFDF8,#FBF6EA)] border border-[var(--gold-tint)] rounded-xl p-6 shadow-sm">
              <div className="font-display font-semibold text-xs text-[var(--gold-dark)] mb-2">Property Brief</div>
              <div className="text-sm text-[var(--ink2)] leading-relaxed whitespace-pre-line">{property.brief}</div>
            </div>
          )}

          <MarginSection
            title="Margin & Price List"
            currentPct={stats.marginPct ?? null}
            minFrac={property.marginMin}
            targetFrac={property.marginTarget}
            saving={updateProperty.isPending}
            onSave={({ minFrac, targetFrac}) =>
              updateProperty.mutate(
                { id, data: { marginMin: minFrac, marginTarget: targetFrac}},
                {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(id)});
                    queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey()});
                    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
                 },
               },
              )
           }
          >
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-muted-foreground">
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
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
              {upcomingVisits.map((v) => (
                <div key={v.id} className="flex items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">
                      {new Date(`${v.scheduledOn}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric"})}
                      {v.windowStart ?` · ${v.windowStart}` : ""}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {[v.jobDescription, v.unitNo ?`Unit ${v.unitNo}` : null].filter(Boolean).join(" · ") || "Scheduled visit"}
                    </div>
                  </div>
                  {v.crewLeaderName && <div className="text-sm text-muted-foreground shrink-0">{v.crewLeaderName}</div>}
                </div>
              ))}
              {!upcomingVisits.length && <div className="p-6 text-center text-sm text-muted-foreground">No upcoming visits scheduled.</div>}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-display font-bold text-[var(--ink)] mb-4">Invoices</h2>
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{inv.invoiceNo || "Invoice"}</div>
                    <div className="text-sm text-muted-foreground">
                      {inv.status === "paid"
                        ? "Paid"
                        : inv.status === "past_due"
                          ?`Past due${inv.daysLate ?` · ${inv.daysLate}d late` : ""}`
                          : inv.status === "sent"
                            ? "Sent"
                            : "Draft"}
                    </div>
                  </div>
                  <div className="font-mono font-bold shrink-0">${inv.amount.toLocaleString()}</div>
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
              {!invoices.length && <div className="p-6 text-center text-sm text-muted-foreground">No invoices for this property.</div>}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-display font-bold text-[var(--ink)] mb-4">Expenses</h2>
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
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
