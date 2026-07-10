import { useState } from "react";
import { useListVendors } from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { AddVendorSheet } from "@/components/AddVendorSheet";

export default function Vendors() {
  const { data: vendors, isLoading } = useListVendors();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="font-display font-bold text-[26px] tracking-[-0.015em] leading-[1.1] mb-[2px]">Vendors</div>
      <div className="text-[13px] text-muted-foreground mb-[14px]">COI compliance, tracked so it never lapses on you.</div>
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> Add vendor
      </button>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[16px]" />
      ) : !vendors || vendors.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">No vendors yet.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {vendors.map((v) => (
            <div key={v.id} className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px] flex items-center gap-[10px]">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14.5px] truncate">{v.name}</div>
                <div className="text-[12px] text-muted-foreground truncate">
                  {[v.trade, v.phone, v.email].filter(Boolean).join(" · ") || "No details"}
                </div>
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full text-white ${
                    v.compliant === false ? "bg-[#be3c3c]" : "bg-[#3c7a4e]"
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
