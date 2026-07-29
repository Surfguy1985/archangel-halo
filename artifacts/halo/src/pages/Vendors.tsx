import { useState } from "react";
import { useListVendors } from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { AddVendorSheet } from "@/components/AddVendorSheet";

export default function Vendors() {
  const { data: vendors, isLoading } = useListVendors();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300 pb-20 px-2">
      <div className="font-display font-bold text-[32px] tracking-[-0.02em] leading-[1.1] mb-[2px] text-[var(--ink)]">Vendors</div>
      <div className="text-[13px] text-muted-foreground mb-[16px]">COI compliance, tracked so it never lapses on you.</div>
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[16px] flex items-center justify-center gap-[7px] rounded-full py-[13px] font-display font-bold text-[14px] btn-gold transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> Add vendor
      </button>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[20px] border border-[var(--hairline)]" />
      ) : !vendors || vendors.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">No vendors yet.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {vendors.map((v) => (
            <div key={v.id} className="bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px] flex items-center gap-[10px]">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14.5px] truncate text-[var(--ink)]">{v.name}</div>
                <div className="text-[12px] text-muted-foreground truncate">
                  {[v.trade, v.phone, v.email].filter(Boolean).join(" · ") || "No details"}
                </div>
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`text-[10.5px] font-bold uppercase tracking-[0.06em] px-[8px] py-[3px] rounded-full text-white ${
                    v.compliant === false ? "bg-[var(--red)]" : "bg-[var(--green)]"
                  }`}
                >
                  {v.compliant === false ? "COI lapsing" : "Compliant"}
                </span>
                {v.coiExpiresOn && (
                  <div className="text-[11px] text-muted-foreground mt-[3px]">
                    exp {new Date(v.coiExpiresOn).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <AddVendorSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
