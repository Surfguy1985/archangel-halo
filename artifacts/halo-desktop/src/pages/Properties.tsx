import { useListProperties } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Building, Plus, Search } from "lucide-react";
import { useState } from "react";
import { AddPropertyDialog } from "@/components/PropertyDialogs";

export default function Properties() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const { data: properties, isLoading } = useListProperties();

  const filtered = properties?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.pmcName?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Properties</h1>
          <p className="text-muted-foreground">{properties?.length || 0} active locations</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 bg-[var(--gold)] text-white px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Property
        </button>
      </header>

      <AddPropertyDialog open={addOpen} onOpenChange={setAddOpen} />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input 
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search properties or PMCs..."
          className="w-full max-w-md pl-10 pr-4 py-2.5 rounded-md border border-input bg-card text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--paper)] border-b border-border">
              <tr>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Property</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Location</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs text-right">Owed</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs text-right">Open Jobs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-black/[0.02] transition-colors group">
                  <td className="px-6 py-4">
                    <Link href={`/properties/${p.id}`} className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[var(--gold-tint)] flex items-center justify-center text-[var(--gold-dark)] group-hover:bg-[var(--gold)] group-hover:text-white transition-colors">
                        <Building className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-[var(--ink)] text-base group-hover:text-[var(--gold-dark)] transition-colors">{p.name}</div>
                        <div className="text-muted-foreground">{p.pmcName || 'Independent'}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {p.city || '—'}
                    {p.units ? <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-black/5">{p.units} units</span> : null}
                  </td>
                  <td className="px-6 py-4 text-right font-mono font-medium">
                    {p.owed > 0 ? (
                      <span className="text-destructive">${p.owed.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground">$0</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {p.openJobs > 0 ? (
                      <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full bg-[var(--gold-tint)] text-[var(--gold-dark)] font-bold text-xs">
                        {p.openJobs}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                    No properties found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
