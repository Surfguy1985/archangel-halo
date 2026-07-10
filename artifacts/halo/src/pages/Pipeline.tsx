import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLeads,
  useListBids,
  useUpdateBid,
  useNudgeBid,
  getListBidsQueryKey,
  getGetTodayQueryKey,
} from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { AddLeadSheet } from "@/components/AddLeadSheet";
import { AddBidSheet } from "@/components/AddBidSheet";

type Tab = "bids" | "leads";

const bidStatusColor: Record<string, string> = {
  approved: "#3c7a4e",
  declined: "#be3c3c",
  expired: "#be3c3c",
  sent: "#8f6a1f",
  draft: "#8B8577",
};

function Bids() {
  const queryClient = useQueryClient();
  const { data: bids, isLoading } = useListBids();
  const [addOpen, setAddOpen] = useState(false);
  const update = useUpdateBid();
  const nudge = useNudgeBid();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListBidsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
  };

  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> New bid
      </button>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[16px]" />
      ) : !bids || bids.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">No bids yet.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {bids.map((b) => (
            <div key={b.id} className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px]">
              <div className="flex items-start gap-[10px]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px]">
                    <span className="font-mono text-[12.5px] text-muted-foreground">{b.bidNo}</span>
                    <span
                      className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full text-white"
                      style={{ backgroundColor: bidStatusColor[b.status] || "#8B8577" }}
                    >
                      {b.status}
                    </span>
                  </div>
                  <div className="font-semibold text-[14.5px] mt-[3px]">{b.propertyName || "No property"}{b.unitNo ? ` · ${b.unitNo}` : ""}</div>
                  {b.scope && <div className="text-[12.5px] text-muted-foreground mt-[1px] line-clamp-2">{b.scope}</div>}
                </div>
                <div className="font-display font-bold text-[19px] tabular-nums shrink-0">${b.amount.toLocaleString()}</div>
              </div>
              <div className="flex gap-[8px] mt-[12px]">
                {(b.status === "draft" || b.status === "sent") && (
                  <button
                    className="flex-1 rounded-[11px] py-[9px] text-[13px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                    onClick={() => update.mutate({ id: b.id, data: { status: "approved" } }, { onSuccess: invalidate })}
                    disabled={update.isPending}
                  >
                    Mark approved
                  </button>
                )}
                {b.status === "sent" && (
                  <button
                    className="flex-1 rounded-[11px] py-[9px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                    onClick={() => nudge.mutate({ id: b.id }, { onSuccess: invalidate })}
                    disabled={nudge.isPending}
                  >
                    Nudge
                  </button>
                )}
                {b.status === "draft" && (
                  <button
                    className="flex-1 rounded-[11px] py-[9px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                    onClick={() => update.mutate({ id: b.id, data: { status: "sent" } }, { onSuccess: invalidate })}
                    disabled={update.isPending}
                  >
                    Mark sent
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <AddBidSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function Leads() {
  const { data: leads, isLoading } = useListLeads();
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> New lead
      </button>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[16px]" />
      ) : !leads || leads.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">No leads yet.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {leads.map((l) => (
            <div key={l.id} className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px]">
              <div className="flex items-center gap-[8px] mb-[4px]">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full bg-[var(--muted)] text-muted-foreground">{l.status}</span>
                {l.source && <span className="text-[12px] text-muted-foreground">{l.source}</span>}
              </div>
              {l.propertyName && <div className="font-semibold text-[14.5px]">{l.propertyName}</div>}
              {l.summary && <div className="text-[13px] text-[var(--ink2)] mt-[1px]">{l.summary}</div>}
            </div>
          ))}
        </div>
      )}
      <AddLeadSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

export default function Pipeline() {
  const [tab, setTab] = useState<Tab>("bids");
  const tabs: { key: Tab; label: string }[] = [
    { key: "bids", label: "Bids" },
    { key: "leads", label: "Leads" },
  ];
  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="font-display font-bold text-[26px] tracking-[-0.015em] leading-[1.1] mb-[2px]">Pipeline</div>
      <div className="text-[13px] text-muted-foreground mb-[14px]">Leads become bids. Bids become jobs.</div>
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
      {tab === "bids" ? <Bids /> : <Leads />}
    </div>
  );
}
