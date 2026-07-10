import { useGetProperty, getGetPropertyQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function PropertyDetail() {
  const params = useParams();
  const id = params.id as string;
  const { data, isLoading } = useGetProperty(id, { query: { enabled: !!id, queryKey: getGetPropertyQueryKey(id) } });

  if (isLoading) {
    return <div className="p-8 max-w-6xl mx-auto"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!data) return <div className="p-8 text-center text-muted-foreground">Property not found</div>;

  const { property, stats, jobs, priceItems, contacts } = data;

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
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
          <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Owed</div>
          <div className="text-3xl font-mono font-bold text-[var(--ink)]">${stats.owed.toLocaleString()}</div>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
          <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Open Jobs</div>
          <div className="text-3xl font-mono font-bold text-[var(--ink)]">{stats.openJobs}</div>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
          <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Margin</div>
          <div className="text-3xl font-mono font-bold text-[var(--ink)]">{stats.marginPct ?? 0}%</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <section>
            <h2 className="text-xl font-display font-bold mb-4 text-[var(--ink)]">Active Jobs</h2>
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
              {jobs.map(job => (
                <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between p-4 hover:bg-black/[0.02] transition-colors">
                  <div>
                    <div className="font-semibold">{job.category || 'General'} · {job.unitNo || 'Common'}</div>
                    <div className="text-sm text-muted-foreground">{job.description}</div>
                  </div>
                  <div className="text-right font-mono text-sm text-muted-foreground">{job.jobNo}</div>
                </Link>
              ))}
              {!jobs.length && <div className="p-6 text-center text-sm text-muted-foreground">No active jobs.</div>}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-display font-bold mb-4 text-[var(--ink)]">Contacts</h2>
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
              {contacts.map(contact => (
                <div key={contact.id} className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-semibold">{contact.name}</div>
                    <div className="text-sm text-muted-foreground">{contact.role}</div>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <div>{contact.phone}</div>
                    <div>{contact.email}</div>
                  </div>
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
            <h2 className="text-xl font-display font-bold mb-4 text-[var(--ink)]">Price List</h2>
            <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
              {priceItems.map(item => (
                <div key={item.id} className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-semibold">{item.service}</div>
                    <div className="text-sm text-muted-foreground">{item.detail}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold">${item.rate}</div>
                    {item.unit && <div className="text-xs text-muted-foreground">/{item.unit}</div>}
                  </div>
                </div>
              ))}
              {!priceItems.length && <div className="p-6 text-center text-sm text-muted-foreground">No agreed rates.</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
