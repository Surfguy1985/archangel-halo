import { useGetProperty, getGetPropertyQueryKey, useSetInvoiceStatus, useUpdateProperty, getGetMoneySummaryQueryKey, getListInvoicesQueryKey, getGetTodayQueryKey, getListPropertiesQueryKey } from "@workspace/api-client-react";
import { MarginSection } from "@/components/MarginSection";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { CalendarDays, ChevronDown, ChevronLeft, Pencil, Plus, Repeat } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { JobLineItemsPanel } from "@/components/JobLineItemsPanel";
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
  const [contactOpen, setContactOpen] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [editPriceId, setEditPriceId] = useState<string | null>(null);
  const [openLineItemsJobId, setOpenLineItemsJobId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const setStatus = useSetInvoiceStatus();
  const updateProperty = useUpdateProperty();
  const { data, isLoading } = useGetProperty(id, { query: { enabled: !!id, queryKey: getGetPropertyQueryKey(id) } });

  if (isLoading) {
    return <div className="p-8 max-w-6xl mx-auto"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!data) return <div className="p-8 text-center text-muted-foreground">Property not found</div>;

  const { property, stats, jobs, priceItems, contacts, expenses, invoices, upcomingVisits } = data;

  const toggleInvoice = (invoiceId: string, next: "paid" | "sent") => {
    setStatus.mutate(
      { id: invoiceId, data: { status: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        },
      },
    );
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link href="/properties" className="flex items-center gap-2 text-muted-foreground text-sm font-semibold mb-4 w-fit hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to Properties
      </Link>
      
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">{property.name}</h1>
          <p className="text-muted-foreground">{property.pmcName || property.city || "No location data"} {property.units ? `· ${property.units} units` : ''}</p>
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
      <AddContactDialog open={contactOpen} onOpenChange={setContactOpen} propertyId={id} />
      <AddJobDialog open={jobOpen} onOpenChange={setJobOpen} propertyId={id} />
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

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <div className="bg-card rounded-xl shadow-sm border border-border p-5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Owed</div>
          <div className="text-2xl font-mono font-bold text-[var(--ink)]">${stats.owed.toLocaleString()}</div>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border p-5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Collected</div>
          <div className="text-2xl font-mono font-bold text-[var(--ink)]">${stats.collectedTotal.toLocaleString()}</div>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border p-5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Invoiced</div>
          <div className="text-2xl font-mono font-bold text-[var(--ink)]">${stats.invoicedTotal.toLocaleString()}</div>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border p-5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Expenses</div>
          <div className="text-2xl font-mono font-bold text-[var(--ink)]">${stats.expensesTotal.toLocaleString()}</div>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border p-5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Open Jobs</div>
          <div className="text-2xl font-mono font-bold text-[var(--ink)]">{stats.openJobs}</div>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border p-5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Margin</div>
          <div className="text-2xl font-mono font-bold text-[var(--ink)]">{stats.marginPct ?? 0}%</div>
        </div>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-display font-bold text-[var(--ink)]">Active Jobs</h2>
              <button
                onClick={() => setJobOpen(true)}
                className="flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
              {jobs.map(job => (
                <div key={job.id} className="p-4 hover:bg-black/[0.02] transition-colors">
                  <div className="flex items-center gap-3">
                    <Link href={`/jobs/${job.id}`} className="flex-1 min-w-0">
                      <div className="font-semibold">{job.category || 'General'} · {job.unitNo || 'Common'}</div>
                      <div className="text-sm text-muted-foreground">{job.description}</div>
                      {job.isRecurring && (
                        <div className="flex items-center gap-1.5 mt-1 text-xs font-semibold text-[var(--gold-dark)]">
                          <Repeat className="w-3 h-3" />
                          {{ daily: "Daily", weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly", quarterly: "Quarterly" }[job.recurrence ?? ""] ?? "Recurring"}
                          <span className="text-muted-foreground font-normal">
                            · {job.crewLeaderName ? `${job.crewLeaderName} goes` : "No crew assigned"}
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
                </div>
              ))}
              {!jobs.length && <div className="p-6 text-center text-sm text-muted-foreground">No active jobs.</div>}
            </div>
          </section>

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
              <div className="font-display font-semibold text-xs tracking-widest uppercase text-[var(--gold-dark)] mb-2">Property Brief</div>
              <div className="text-sm text-[var(--ink2)] leading-relaxed whitespace-pre-line">{property.brief}</div>
            </div>
          )}

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-display font-bold text-[var(--ink)]">Price List</h2>
              <button
                onClick={() => setPriceOpen(true)}
                className="flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
              {priceItems.map(item => (
                <div key={item.id} className="flex items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{item.service}</div>
                    <div className="text-sm text-muted-foreground">{item.detail}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold">${item.rate}</div>
                    {item.unit && <div className="text-xs text-muted-foreground">/{item.unit}</div>}
                  </div>
                  <button
                    aria-label="Edit price item"
                    onClick={() => setEditPriceId(item.id)}
                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-black/[0.05] transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {!priceItems.length && <div className="p-6 text-center text-sm text-muted-foreground">No agreed rates.</div>}
            </div>
          </section>

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
                          ? `Past due${inv.daysLate ? ` · ${inv.daysLate}d late` : ""}`
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
                      className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] hover:brightness-105 transition-all disabled:opacity-50"
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
