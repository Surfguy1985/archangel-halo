import { useState } from "react";
import {
  useListLeads,
  useListBids,
} from "@workspace/api-client-react";
import { Plus, Zap, Mail } from "lucide-react";
import { AddLeadSheet } from "@/components/AddLeadSheet";
import { AddBidSheet } from "@/components/AddBidSheet";
import { BidDetailSheet } from "@/components/BidDetailSheet";
import { LeadDetailSheet, type MobileLeadRow } from "@/components/LeadDetailSheet";

type Tab = "bids" | "leads";

const bidStatusColor: Record<string, string> = {
  approved: "#3c7a4e",
  won: "#3c7a4e",
  declined: "#be3c3c",
  lost: "#be3c3c",
  expired: "#be3c3c",
  sent: "#8f6a1f",
  draft: "#8B8577",
};

function Bids() {
  const { data: bids, isLoading } = useListBids();
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
        data-testid="button-new-bid"
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
            <button
              key={b.id}
              onClick={() => setDetailId(b.id)}
              className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px] text-left w-full transition-transform active:scale-[0.99]"
              data-testid={`card-bid-${b.id}`}
            >
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
            </button>
          ))}
        </div>
      )}
      <AddBidSheet open={addOpen} onOpenChange={setAddOpen} onCreated={(id) => setDetailId(id)} />
      <BidDetailSheet open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} bidId={detailId} />
    </div>
  );
}

function Leads() {
  const { data: leads, isLoading } = useListLeads();
  const [addOpen, setAddOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<MobileLeadRow | null>(null);

  const selected =
    (detailLead && (leads?.find((l) => l.id === detailLead.id) as MobileLeadRow | undefined)) ||
    detailLead;

  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
        data-testid="button-new-lead"
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
            <button
              key={l.id}
              onClick={() => setDetailLead(l as MobileLeadRow)}
              className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px] text-left w-full transition-transform active:scale-[0.99]"
              data-testid={`card-lead-${l.id}`}
            >
              <div className="flex items-center gap-[8px] mb-[4px]">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full bg-[var(--muted)] text-muted-foreground">{l.status}</span>
                {l.campaignStatus === "active" && (
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full bg-[rgba(143,106,31,0.12)] text-[var(--gold-dark)] flex items-center gap-[3px]">
                    <Zap className="w-[10px] h-[10px]" /> drip
                  </span>
                )}
                {l.lastContactAt && (
                  <span className="text-[11px] text-muted-foreground flex items-center gap-[3px]">
                    <Mail className="w-[10px] h-[10px]" />
                    {new Date(l.lastContactAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
                {l.source && <span className="text-[12px] text-muted-foreground">{l.source}</span>}
              </div>
              {(l.propertyName || l.contactName) && (
                <div className="font-semibold text-[14.5px]">{l.propertyName || l.contactName}</div>
              )}
              {l.summary && <div className="text-[13px] text-[var(--ink2)] mt-[1px]">{l.summary}</div>}
            </button>
          ))}
        </div>
      )}
      <AddLeadSheet open={addOpen} onOpenChange={setAddOpen} />
      <LeadDetailSheet
        open={!!detailLead}
        onOpenChange={(o) => !o && setDetailLead(null)}
        lead={selected as MobileLeadRow | null}
      />
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
