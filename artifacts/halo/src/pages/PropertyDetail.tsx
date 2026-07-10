import { useGetProperty, getGetPropertyQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { ChevronLeft, Pencil } from "lucide-react";
import { useState } from "react";
import { EditPropertySheet } from "@/components/EditPropertySheet";

export default function PropertyDetail() {
  const params = useParams();
  const id = params.id as string;
  const [editOpen, setEditOpen] = useState(false);
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

  const { property, stats, jobs, priceItems, contacts } = data;

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

      {jobs.length > 0 && (
        <div className="mb-[18px]">
          <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground mb-[8px] mx-[2px]">Active Jobs</div>
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
            {jobs.map((job, idx) => (
              <Link key={job.id} href={`/jobs/${job.id}`} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{job.category || 'General'} · {job.unitNo || 'Common'}</div>
                  <div className="text-[12px] text-muted-foreground truncate">{job.description}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[12px] font-mono text-muted-foreground">{job.jobNo}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {priceItems.length > 0 && (
        <div className="mb-[18px]">
          <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground mb-[8px] mx-[2px]">Price List</div>
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
              </div>
            ))}
          </div>
        </div>
      )}

      {contacts.length > 0 && (
        <div className="mb-[18px]">
          <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground mb-[8px] mx-[2px]">Contacts</div>
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
              </div>
            ))}
          </div>
        </div>
      )}

      <EditPropertySheet open={editOpen} onOpenChange={setEditOpen} property={property} />
    </div>
  );
}
