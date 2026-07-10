import { useListVendors } from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Vendors() {
  const { data: vendors, isLoading } = useListVendors();

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Vendors</h1>
          <p className="text-muted-foreground">Manage your third-party vendors and COI compliance.</p>
        </div>
        <button className="flex items-center gap-2 bg-[var(--gold)] text-white px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> Add Vendor
        </button>
      </header>

      {isLoading ? (
        <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
      ) : !vendors?.length ? (
        <div className="text-center py-12 text-muted-foreground bg-card rounded-xl border border-border">No vendors found.</div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--paper)] border-b border-border">
              <tr>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Name</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Trade</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Contact</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vendors.map(v => (
                <tr key={v.id} className="hover:bg-black/[0.02] transition-colors">
                  <td className="px-6 py-4 font-semibold text-[var(--ink)]">{v.name}</td>
                  <td className="px-6 py-4 text-muted-foreground">{v.trade || '—'}</td>
                  <td className="px-6 py-4 text-muted-foreground">{[v.email, v.phone].filter(Boolean).join(" · ") || '—'}</td>
                  <td className="px-6 py-4 text-right">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${v.compliant !== false ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {v.compliant !== false ? 'Compliant' : 'COI Lapsing'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
