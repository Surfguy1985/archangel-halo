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
  received: "#3c7a4e",
  cancelled: "#8B8577",
  ordered: "#8f6a1f",
  sent: "#8f6a1f",
  draft: "#8B8577",
};

function Inventory() {
  const { data: items, isLoading } = useListInventory();
  const [addOpen, setAddOpen] = useState(false);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> Add item
      </button>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[16px]" />
      ) : !items || items.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">No inventory tracked.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => setAdjustItem(it)}
              className="w-full text-left bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px] flex items-center gap-[10px] transition-transform active:scale-[0.99]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14.5px] truncate">{it.name}</div>
                <div className="text-[12px] text-muted-foreground truncate">
                  Reorder at {it.reorderAt}{it.preferredVendor ? ` · ${it.preferredVendor}` : ""}
                </div>
              </div>
              {it.low && (
                <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full text-white bg-[#8b4fbe]">Low</span>
              )}
              <div className="text-right shrink-0">
                <div className={`font-display font-bold text-[19px] tabular-nums ${it.low ? "text-[#8b4fbe]" : ""}`}>{it.qty}</div>
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
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> New PO
      </button>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[16px]" />
      ) : !pos || pos.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">No purchase orders.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {pos.map((po) => (
            <div key={po.id} className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px]">
              <div className="flex items-start gap-[10px]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px]">
                    <span className="font-mono text-[12.5px] text-muted-foreground">{po.poNo}</span>
                    <span
                      className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full text-white"
                      style={{ backgroundColor: po.late ? "#be3c3c" : poStatusColor[po.status] || "#8B8577" }}
                    >
                      {po.late ? "Late" : po.status}
                    </span>
                  </div>
                  <div className="font-semibold text-[14.5px] truncate mt-[3px]">{po.vendorName || "—"}</div>
                  <div className="text-[12px] text-muted-foreground truncate">
                    {[po.jobNo, po.expectedOn ? `expected ${new Date(po.expectedOn).toLocaleDateString()}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
              {po.status !== "received" && po.status !== "cancelled" && (
                <button
                  className="w-full mt-[12px] rounded-[11px] py-[9px] text-[13px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] shadow-[0_4px_14px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
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
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="font-display font-bold text-[26px] tracking-[-0.015em] leading-[1.1] mb-[2px]">Supply</div>
      <div className="text-[13px] text-muted-foreground mb-[14px]">Stock and orders. Quiet until something needs you.</div>
      <div className="flex gap-[4px] bg-card rounded-[13px] p-[4px] shadow-[var(--shadow)] mb-[16px]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-[10px] py-[8px] text-[13px] font-display font-bold transition-colors ${
              tab === t.key ? "bg-[var(--ink)] text-white" : "text-muted-foreground"
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
