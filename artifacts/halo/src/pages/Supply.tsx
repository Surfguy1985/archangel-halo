import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInventory,
  useListPurchaseOrders,
  useReceivePurchaseOrder,
  getListPurchaseOrdersQueryKey,
  getGetTodayQueryKey,
  type InventoryItem,
} from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { AddInventorySheet } from "@/components/AddInventorySheet";
import { AdjustInventorySheet } from "@/components/AdjustInventorySheet";
import { AddPurchaseOrderSheet } from "@/components/AddPurchaseOrderSheet";

type Tab = "inventory" | "pos";

const poStatusColor: Record<string, string> = {
  received: "var(--green)",
  cancelled: "var(--faint)",
  ordered: "var(--yellow)",
  sent: "var(--yellow)",
  draft: "var(--faint)",
};

function Inventory() {
  const { data: items, isLoading } = useListInventory();
  const [addOpen, setAddOpen] = useState(false);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[16px] flex items-center justify-center gap-[7px] rounded-full py-[13px] font-display font-bold text-[14px] bg-card border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> Add item
      </button>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[20px] border border-[var(--hairline)]" />
      ) : !items || items.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">No inventory tracked.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => setAdjustItem(it)}
              className="w-full text-left bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px] flex items-center gap-[10px] transition-transform active:scale-[0.99]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14.5px] truncate text-[var(--ink)]">{it.name}</div>
                <div className="text-[12px] text-muted-foreground truncate">
                  Reorder at {it.reorderAt}{it.preferredVendor ? ` · ${it.preferredVendor}` : ""}
                </div>
              </div>
              {it.low && (
                <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[8px] py-[3px] rounded-full text-white bg-[var(--purple)]">Low</span>
              )}
              <div className="text-right shrink-0">
                <div className={`font-display font-bold text-[19px] tabular-nums ${it.low ? "text-[var(--purple)]" : "text-[var(--ink)]"}`}>{it.qty}</div>
                <div className="text-[11px] text-muted-foreground">on hand</div>
              </div>
            </button>
          ))}
        </div>
      )}
      <AddInventorySheet open={addOpen} onOpenChange={setAddOpen} />
      <AdjustInventorySheet open={!!adjustItem} onOpenChange={(o) => !o && setAdjustItem(null)} item={adjustItem} />
    </div>
  );
}

function PurchaseOrders() {
  const queryClient = useQueryClient();
  const { data: pos, isLoading } = useListPurchaseOrders();
  const [addOpen, setAddOpen] = useState(false);
  const receive = useReceivePurchaseOrder();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListPurchaseOrdersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
  };

  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[16px] flex items-center justify-center gap-[7px] rounded-full py-[13px] font-display font-bold text-[14px] bg-card border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> New PO
      </button>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[20px] border border-[var(--hairline)]" />
      ) : !pos || pos.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">No purchase orders.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {pos.map((po) => (
            <div key={po.id} className="bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px]">
              <div className="flex items-start gap-[10px]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px]">
                    <span className="font-mono text-[12.5px] text-muted-foreground">{po.poNo}</span>
                    <span
                      className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[8px] py-[3px] rounded-full text-white"
                      style={{ backgroundColor: po.late ? "var(--red)" : poStatusColor[po.status] || "var(--faint)" }}
                    >
                      {po.late ? "Late" : po.status}
                    </span>
                  </div>
                  <div className="font-semibold text-[14.5px] truncate mt-[3px] text-[var(--ink)]">{po.vendorName || "—"}</div>
                  <div className="text-[12px] text-muted-foreground truncate">
                    {[po.jobNo, po.expectedOn ? `expected ${new Date(po.expectedOn).toLocaleDateString()}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
              {po.status !== "received" && po.status !== "cancelled" && (
                <button
                  className="w-full mt-[14px] rounded-full py-[11px] text-[13px] font-display font-bold btn-gold disabled:opacity-50 transition-transform active:scale-[0.98]"
                  onClick={() => receive.mutate({ id: po.id }, { onSuccess: invalidate })}
                  disabled={receive.isPending}
                >
                  Mark received
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <AddPurchaseOrderSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

export default function Supply() {
  const [tab, setTab] = useState<Tab>("inventory");
  const tabs: { key: Tab; label: string }[] = [
    { key: "inventory", label: "Inventory" },
    { key: "pos", label: "Purchase Orders" },
  ];
  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300 pb-20 px-2">
      <div className="font-display font-bold text-[32px] tracking-[-0.02em] leading-[1.1] mb-[2px] text-[var(--ink)]">Supply</div>
      <div className="text-[13px] text-muted-foreground mb-[16px]">Stock and orders. Quiet until something needs you.</div>
      <div className="flex gap-[8px] mb-[16px]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-[16px] py-[9px] text-[13px] font-display font-bold transition-colors ${
              tab === t.key
                ? "bg-[var(--ink)] text-white"
                : "bg-card border border-[var(--hairline)] text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "inventory" ? <Inventory /> : <PurchaseOrders />}
    </div>
  );
}
