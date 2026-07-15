import { useGetProperty, getGetPropertyQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { ChevronLeft, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { EditPropertySheet } from "@/components/EditPropertySheet";
import { AddContactSheet } from "@/components/AddContactSheet";
import { AddPriceItemSheet } from "@/components/AddPriceItemSheet";
import { AddExpenseSheet } from "@/components/AddExpenseSheet";
import { AddJobSheet } from "@/components/AddJobSheet";
import { EditJobSheet } from "@/components/EditJobSheet";
import { EditContactSheet } from "@/components/EditContactSheet";
import { EditPriceItemSheet } from "@/components/EditPriceItemSheet";
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
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [editPriceId, setEditPriceId] = useState<string | null>(null);
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

  const { property, stats, jobs, priceItems, contacts, expenses, agreements } = data;

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
          className="w-[36px] h-[36px] shrink-0 rounded-full grid place-items-center bg-card border border-border shadow-[var(--shadow)] text-muted-foreground transition-transform active:scale-[0.9]"
        >
          <Pencil className="w-[16px] h-[16px]" />
        </button>
      </div>

      <div className="flex gap-[9px] mb-[16px]">
        <div className="flex-1 bg-card rounded-[14px] shadow-[var(--shadow)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">${stats.owed.toLocaleString()}</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Owed</span>
        </div>
        <div className="flex-1 bg-card rounded-[14px] shadow-[var(--shadow)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">{stats.openJobs}</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Open Jobs</span>
        </div>
        <div className="flex-1 bg-card rounded-[14px] shadow-[var(--shadow)] p-[11px_12px]">
          <b className="block font-display font-bold text-[18px] tabular-nums">{stats.marginPct ?? 0}%</b>
          <span className="text-[11px] text-muted-foreground tracking-[0.04em] uppercase">Margin</span>
        </div>
      </div>

      {property.brief && (
        <div className="bg-[linear-gradient(135deg,#FFFDF8,#FBF6EA)] border border-[rgba(185,138,47,0.28)] rounded-[16px] p-[14px_15px] shadow-[var(--shadow)] mb-[18px]">
          <div className="font-display font-semibold text-[11px] tracking-[0.18em] uppercase text-[var(--gold-dark)] mb-[6px]">Property Brief</div>
          <div className="text-[14px] text-[var(--ink2)] leading-relaxed whitespace-pre-line">{property.brief}</div>
        </div>
      )}

      <div className="mb-[18px]">
        <SectionHeader title="Active Jobs" onAdd={() => setJobOpen(true)} />
        {jobs.length > 0 ? (
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
            {jobs.map((job, idx) => (
              <div key={job.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <Link href={`/jobs/${job.id}`} className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{job.category || 'General'} · {job.unitNo || 'Common'}</div>
                  <div className="text-[12px] text-muted-foreground truncate">{job.description}</div>
                  {job.isRecurring && (
                    <div className="flex items-center gap-[5px] mt-[3px] text-[11.5px] font-semibold text-[var(--gold-dark)]">
                      <Repeat className="w-[12px] h-[12px]" />
                      {recurrenceLabels[job.recurrence ?? ""] ?? "Recurring"}
                      <span className="text-muted-foreground font-normal">
                        · {job.crewLeaderName ? `${job.crewLeaderName} goes` : "No crew assigned"}
                      </span>
                    </div>
                  )}
                </Link>
                <div className="text-right shrink-0">
                  <div className="text-[12px] font-mono text-muted-foreground">{job.jobNo}</div>
                  {!job.isRecurring && job.crewLeaderName && (
                    <div className="text-[11.5px] text-muted-foreground">{job.crewLeaderName}</div>
                  )}
                </div>
                <button
                  aria-label="Edit job"
                  onClick={() => setEditJobId(job.id)}
                  className="shrink-0 w-[30px] h-[30px] rounded-full flex items-center justify-center bg-[rgba(23,24,28,0.05)] text-muted-foreground active:scale-[0.94]"
                >
                  <Pencil className="w-[13px] h-[13px]" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[16px] text-[13px] text-muted-foreground text-center">No jobs yet. Tap Add to create one.</div>
        )}
      </div>

      <div className="mb-[18px]">
        <SectionHeader title="Price List" onAdd={() => setPriceOpen(true)} />
        {priceItems.length > 0 ? (
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
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
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[16px] text-[13px] text-muted-foreground text-center">No agreed rates yet.</div>
        )}
      </div>

      <div className="mb-[18px]">
        <SectionHeader title="Contacts" onAdd={() => setContactOpen(true)} />
        {contacts.length > 0 ? (
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
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
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[16px] text-[13px] text-muted-foreground text-center">No contacts yet.</div>
        )}
      </div>

      <div className="mb-[18px]">
        <SectionHeader title="Expenses" onAdd={() => setExpenseOpen(true)} />
        {expenses.length > 0 ? (
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
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
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[16px] text-[13px] text-muted-foreground text-center">No expenses logged.</div>
        )}
      </div>

      {agreements.length > 0 && (
        <div className="mb-[18px]">
          <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground mb-[8px] mx-[2px]">Agreements</div>
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
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
      <AddExpenseSheet open={expenseOpen} onOpenChange={setExpenseOpen} propertyId={id} />
      <AddJobSheet open={jobOpen} onOpenChange={setJobOpen} propertyId={id} />
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
