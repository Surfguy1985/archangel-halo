import { useState} from "react";
import { useListInventory, useListPurchaseOrders} from "@workspace/api-client-react";
import { Plus} from "lucide-react";
import { Skeleton} from "@/components/ui/skeleton";

export default function Supply() {
  const [tab, setTab] = useState<"inventory" | "pos">("inventory");
  const { data: inventory, isLoading: invLoading } = useListInventory();
  const { data: pos, isLoading: poLoading } = useListPurchaseOrders();

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)]">Supply</h1>
          <p className="text-muted-foreground">Inventory and purchase orders.</p>
        </div>
        <div className="flex gap-2">
          {tab === "inventory" ? (
             <button className="btn-gold inline-flex items-center gap-2 px-4 py-2 text-sm">
               <Plus className="w-4 h-4" strokeWidth={2.4} /> Add Item
             </button>
          ) : (
             <button className="btn-gold inline-flex items-center gap-2 px-4 py-2 text-sm">
               <Plus className="w-4 h-4" strokeWidth={2.4} /> New PO
             </button>
          )}
        </div>
      </header>

      <div className="flex gap-1.5">
        <button
          onClick={() => setTab("inventory")}
          className={`px-4 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
            tab === "inventory"
              ? "bg-[var(--ink)] text-white border-[var(--ink)]"
              : "bg-card text-muted-foreground border-[var(--hairline)] hover:text-foreground"
          }`}
        >
          Inventory
        </button>
        <button
          onClick={() => setTab("pos")}
          className={`px-4 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
            tab === "pos"
              ? "bg-[var(--ink)] text-white border-[var(--ink)]"
              : "bg-card text-muted-foreground border-[var(--hairline)] hover:text-foreground"
          }`}
        >
          Purchase Orders
        </button>
      </div>

      {tab === "inventory" && (
        invLoading ? <Skeleton className="h-40 w-full rounded-[20px]" /> : 
        <div className="bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--paper)] border-b border-[var(--hairline)]">
              <tr>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Item</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Vendor</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs text-right">On Hand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {inventory?.map(it => (
                <tr key={it.id} className="hover:bg-black/[0.02] transition-colors">
                  <td className="px-6 py-4 font-semibold text-[var(--ink)]">
                    {it.name}
                    {it.low && <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 uppercase tracking-widest">Low</span>}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">{it.preferredVendor || '—'}</td>
                  <td className={`px-6 py-4 text-right font-mono font-bold ${it.low ? 'text-purple-700' : ''}`}>{it.qty}</td>
                </tr>
              ))}
              {(!inventory || inventory.length === 0) && <tr><td colSpan={3} className="px-6 py-8 text-center text-muted-foreground">No inventory items.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "pos" && (
        poLoading ? <Skeleton className="h-40 w-full rounded-[20px]" /> : 
        <div className="bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--paper)] border-b border-[var(--hairline)]">
              <tr>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">PO Number</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Vendor</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Expected</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {pos?.map(po => (
                <tr key={po.id} className="hover:bg-black/[0.02] transition-colors">
                  <td className="px-6 py-4 font-mono text-[var(--ink)]">{po.poNo}</td>
                  <td className="px-6 py-4 font-medium">{po.vendorName || '—'}</td>
                  <td className="px-6 py-4 text-muted-foreground">{po.expectedOn ? new Date(po.expectedOn).toLocaleDateString() : '—'}</td>
                  <td className="px-6 py-4 text-right">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${po.late ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"}`}>
                      {po.late ? "Late" : po.status}
                    </span>
                  </td>
                </tr>
              ))}
              {(!pos || pos.length === 0) && <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No purchase orders.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
