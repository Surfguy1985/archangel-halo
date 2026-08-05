import { useState } from "react";
import {
  useListLeads,
  useListBids,
  getListLeadsQueryKey,
  getListBidsQueryKey,
  useListWorkRequests,
  getListWorkRequestsQueryKey,
  useAcceptWorkRequest,
  useDeclineWorkRequest,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Target, FileText, Zap, Mail, Phone, Inbox, Check, X, CalendarClock, Loader2, TriangleAlert } from "lucide-react";
import { format } from "date-fns";
import {
  AddLeadDialog,
  LeadDetailDialog,
  BidBuilderDialog,
  BidDetailDialog,
  type LeadRow,
} from "@/components/PipelineDialogs";

function WorkRequestsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: requests, isLoading } = useListWorkRequests(
    { status: "pending" },
    {
      query: {
        queryKey: getListWorkRequestsQueryKey({ status: "pending" }),
        refetchInterval: 10_000,
      },
    },
  );
  const accept = useAcceptWorkRequest();
  const decline = useDeclineWorkRequest();
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListWorkRequestsQueryKey({ status: "pending" }) });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
  };

  return (
    <div className="w-full lg:w-[320px] shrink-0 bg-[#061022] rounded-2xl p-5 flex flex-col border border-white/5 relative overflow-hidden">
      {/* soft glow top right */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--gold-light)]/5 rounded-full blur-3xl pointer-events-none" />
      
      <div className="flex items-center justify-between mb-5 relative">
        <h2 className="text-white font-display font-bold text-lg flex items-center gap-2">
          Client Requests
        </h2>
        {requests && requests.length > 0 && (
          <span className="bg-[var(--gold-light)] text-black text-xs font-bold px-2.5 py-0.5 rounded-full" data-testid="badge-request-count">
            {requests.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar -mr-2 pr-2">
        {isLoading ? (
          <div className="space-y-3">
             <Skeleton className="h-24 w-full rounded-xl bg-white/5" />
             <Skeleton className="h-24 w-full rounded-xl bg-white/5" />
          </div>
        ) : !requests || requests.length === 0 ? (
          <div className="py-10 text-center text-white/30 text-sm">
            Inbox is clear.
          </div>
        ) : (
          <div className="flex flex-col gap-3 relative">
            {requests.map((r) => (
              <div key={r.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col transition-all hover:bg-white/10" data-testid={`card-request-${r.id}`}>
                <div className="font-bold text-white text-sm truncate">
                  {r.serviceLabel}
                  {r.unitNo ? <span className="text-white/40 font-normal"> · #{r.unitNo}</span> : null}
                </div>
                <div className="text-[11px] text-white/50 mt-1">
                  {r.propertyName}
                  {r.requesterName ? ` — ${r.requesterName}` : ""}
                </div>
                
                {r.neededBy && (
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--gold-light)] mt-2">
                    <CalendarClock className="w-3.5 h-3.5" /> Complete by {format(new Date(`${r.neededBy}T12:00:00`), "MMM d")}
                  </div>
                )}
                
                {r.budgetEstimate != null && (() => {
                  const unitCount = Math.max(r.units?.length ?? 0, 1);
                  const listTotal = r.listRate != null ? r.listRate * unitCount : null;
                  const overList = listTotal != null && r.budgetEstimate! > listTotal;
                  return (
                    <div className="flex items-center flex-wrap gap-1.5 text-[11px] mt-2" data-testid={`text-request-budget-${r.id}`}>
                      <span className="font-semibold text-white/80">
                        Budget ${r.budgetEstimate!.toLocaleString()}
                      </span>
                      {overList && (
                        <span className="flex items-center gap-1 font-bold text-[#EF4444] bg-[#EF4444]/10 rounded-full px-2 py-0.5">
                          <TriangleAlert className="w-3 h-3" /> Above list
                        </span>
                      )}
                    </div>
                  );
                })()}
                
                {r.poNumber ? (
                  <div className="text-[11px] font-semibold text-white/70 mt-1.5" data-testid={`text-request-po-${r.id}`}>PO {r.poNumber}</div>
                ) : (
                  <div className="text-[11px] font-bold text-[#EF4444] mt-1.5" data-testid={`text-request-nopo-${r.id}`}>No PO — approve manually</div>
                )}
                
                {r.notes && <p className="text-[11px] text-white/60 mt-2 line-clamp-3 leading-relaxed">{r.notes}</p>}

                {declining === r.id ? (
                  <div className="mt-4 flex flex-col gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason (optional)"
                      className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--gold-light)]"
                      data-testid={`input-decline-reason-${r.id}`}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => decline.mutate(
                          { id: r.id, data: { reason: reason || null } },
                          {
                            onSuccess: () => { toast({ title: "Request declined" }); setDeclining(null); refresh(); },
                            onError: (e) => toast({ title: "Couldn't decline", description: e.message, variant: "destructive" }),
                          }
                        )}
                        disabled={decline.isPending}
                        className="flex-1 bg-[#EF4444] hover:bg-red-600 transition-colors text-white text-xs font-bold rounded-lg py-2"
                        data-testid={`button-confirm-decline-${r.id}`}
                      >
                        Confirm
                      </button>
                      <button onClick={() => setDeclining(null)} className="flex-1 bg-white/10 hover:bg-white/20 transition-colors text-white text-xs font-bold rounded-lg py-2">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/10">
                    <button
                      onClick={() => accept.mutate(
                        { id: r.id },
                        {
                          onSuccess: (rec) => {
                            toast({ title: `Job ${rec.jobNo ?? ""} created`, description: `${rec.serviceLabel} at ${rec.propertyName}` });
                            refresh();
                          },
                          onError: (e) => toast({ title: "Couldn't accept", description: e.message, variant: "destructive" }),
                        }
                      )}
                      disabled={accept.isPending || decline.isPending}
                      className="flex-1 bg-[var(--gold-light)] text-black text-xs font-bold rounded-lg py-2 flex items-center justify-center gap-1.5 hover:bg-[#A1E44D] transition-colors disabled:opacity-50"
                      data-testid={`button-accept-${r.id}`}
                    >
                      {accept.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept
                    </button>
                    <button
                      onClick={() => { setDeclining(r.id); setReason(""); }}
                      disabled={accept.isPending || decline.isPending}
                      className="flex-1 border border-white/20 hover:bg-white/10 text-white text-xs font-bold rounded-lg py-2 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                      data-testid={`button-decline-${r.id}`}
                    >
                      <X className="w-3.5 h-3.5" /> Decline
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Pipeline() {
  const { data: leads, isLoading: loadingLeads } = useListLeads({
    query: { queryKey: getListLeadsQueryKey(), refetchInterval: 10_000 },
  });
  const { data: bids, isLoading: loadingBids } = useListBids(undefined, {
    query: { queryKey: getListBidsQueryKey(), refetchInterval: 10_000 },
  });

  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [leadDetail, setLeadDetail] = useState<LeadRow | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editBidId, setEditBidId] = useState<string | null>(null);
  const [detailBidId, setDetailBidId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'leads' | 'bids'>('leads');

  const selectedLead = (leadDetail && leads?.find((l) => l.id === leadDetail.id)) || leadDetail;

  return (
    <div className="p-8 max-w-[1200px] mx-auto animate-in fade-in duration-500 h-[calc(100vh-88px)] flex flex-col">
      <div className="bg-[var(--secondary)] rounded-[24px] p-6 lg:p-8 shadow-2xl flex flex-col lg:flex-row gap-8 flex-1 min-h-0 border border-white/5">
        
        {/* Left: Leads & Bids */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 shrink-0">
            <div>
              <h1 className="font-display font-bold text-2xl text-white tracking-tight">Pipeline</h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAddLeadOpen(true)}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"
                data-testid="button-new-lead"
              >
                <Plus className="w-4 h-4" /> New Lead
              </button>
              <button
                onClick={() => { setEditBidId(null); setBuilderOpen(true); }}
                className="bg-[var(--gold-light)] text-black px-4 py-2 rounded-xl text-sm font-bold hover:bg-[#A1E44D] transition-colors flex items-center gap-2"
                data-testid="button-new-bid"
              >
                <Plus className="w-4 h-4" /> New Bid
              </button>
            </div>
          </header>

          {/* Tabs */}
          <div className="flex gap-2 mb-4 border-b border-white/10 pb-4 shrink-0">
            <button
              onClick={() => setActiveTab('leads')}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'leads' ? 'bg-[var(--gold-light)] text-black shadow-[0_0_12px_rgba(180,255,68,0.2)]' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
            >
              Leads <span className="ml-1 opacity-70 text-xs">({leads?.length || 0})</span>
            </button>
            <button
              onClick={() => setActiveTab('bids')}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'bids' ? 'bg-[var(--gold-light)] text-black shadow-[0_0_12px_rgba(180,255,68,0.2)]' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
            >
              Active Bids <span className="ml-1 opacity-70 text-xs">({bids?.length || 0})</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {activeTab === 'leads' ? (
              <div className="flex flex-col">
                <div className="grid grid-cols-[80px_1fr_1.5fr_80px] gap-4 pb-2 border-b border-white/10 text-white/40 text-xs font-bold uppercase tracking-wider px-2">
                  <div>Status</div>
                  <div>Property / Contact</div>
                  <div>Summary</div>
                  <div className="text-right">Created</div>
                </div>
                {loadingLeads ? (
                  <div className="py-4 space-y-3">
                    <Skeleton className="h-14 w-full rounded-xl bg-white/5" />
                    <Skeleton className="h-14 w-full rounded-xl bg-white/5" />
                  </div>
                ) : leads?.map(lead => (
                  <div
                    key={lead.id}
                    onClick={() => setLeadDetail(lead as LeadRow)}
                    className="grid grid-cols-[80px_1fr_1.5fr_80px] gap-4 py-3 items-center border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer px-2 rounded-xl group"
                    data-testid={`card-lead-${lead.id}`}
                  >
                    <div>
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        lead.status === 'new' ? 'bg-[#B4FF44] text-black' :
                        lead.status === 'contacted' ? 'bg-[#EAB308] text-black' :
                        'bg-white/10 text-white'
                      }`}>
                        {lead.status}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-white truncate text-sm group-hover:text-[var(--gold-light)] transition-colors">
                        {lead.propertyName || lead.contactName || 'Unknown Property'}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {lead.source === 'phone' && <span className="text-[10px] text-white/50 flex items-center gap-1"><Phone className="w-2.5 h-2.5"/> Call</span>}
                        {lead.campaignStatus === 'active' && <span className="text-[10px] text-[var(--gold-light)] flex items-center gap-1"><Zap className="w-2.5 h-2.5"/> Drip</span>}
                        {lead.lastContactAt && <span className="text-[10px] text-white/40 flex items-center gap-1"><Mail className="w-2.5 h-2.5"/> {format(new Date(lead.lastContactAt), "MMM d")}</span>}
                      </div>
                    </div>
                    <div className="text-white/60 text-xs truncate">
                      {lead.summary || <span className="text-white/20 italic">No summary</span>}
                    </div>
                    <div className="text-white/40 text-xs text-right font-medium">
                      {lead.createdAt ? format(new Date(lead.createdAt), "MMM d") : '—'}
                    </div>
                  </div>
                ))}
                {leads?.length === 0 && !loadingLeads && (
                  <div className="py-12 text-center text-white/30 text-sm">No active leads.</div>
                )}
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="grid grid-cols-[80px_1fr_1.5fr_100px] gap-4 pb-2 border-b border-white/10 text-white/40 text-xs font-bold uppercase tracking-wider px-2">
                  <div>Status</div>
                  <div>Property</div>
                  <div>Scope</div>
                  <div className="text-right">Amount</div>
                </div>
                {loadingBids ? (
                  <div className="py-4 space-y-3">
                    <Skeleton className="h-14 w-full rounded-xl bg-white/5" />
                    <Skeleton className="h-14 w-full rounded-xl bg-white/5" />
                  </div>
                ) : bids?.map(bid => (
                  <div
                    key={bid.id}
                    onClick={() => setDetailBidId(bid.id)}
                    className="grid grid-cols-[80px_1fr_1.5fr_100px] gap-4 py-3 items-center border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer px-2 rounded-xl group"
                    data-testid={`card-bid-${bid.id}`}
                  >
                    <div>
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        bid.status === 'won' ? 'bg-[#B4FF44] text-black' :
                        bid.status === 'lost' ? 'bg-[#EF4444] text-white' :
                        bid.status === 'draft' ? 'bg-white/10 text-white/60' :
                        'bg-[#EAB308] text-black'
                      }`}>
                        {bid.status}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-white truncate text-sm group-hover:text-[var(--gold-light)] transition-colors">
                        {bid.propertyName || 'Unknown Property'}
                        {bid.unitNo && <span className="text-white/40 font-normal ml-1">#{bid.unitNo}</span>}
                      </div>
                      <div className="text-[10px] text-white/40 font-mono mt-1">{bid.bidNo}</div>
                    </div>
                    <div className="text-white/60 text-xs truncate">
                      {bid.scope || <span className="text-white/20 italic">No scope</span>}
                    </div>
                    <div className="text-white font-mono font-bold text-sm text-right">
                      ${bid.amount.toLocaleString()}
                    </div>
                  </div>
                ))}
                {bids?.length === 0 && !loadingBids && (
                  <div className="py-12 text-center text-white/30 text-sm">No active bids.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Work Requests */}
        <WorkRequestsPanel />
        
      </div>

      <AddLeadDialog open={addLeadOpen} onOpenChange={setAddLeadOpen} />
      <LeadDetailDialog
        open={!!leadDetail}
        onOpenChange={(o) => !o && setLeadDetail(null)}
        lead={selectedLead as LeadRow | null}
      />
      <BidBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        editBidId={editBidId}
        onSaved={(id) => setDetailBidId(id)}
      />
      <BidDetailDialog
        open={!!detailBidId && !builderOpen}
        onOpenChange={(o) => !o && setDetailBidId(null)}
        bidId={detailBidId}
        onEdit={(id) => {
          setEditBidId(id);
          setBuilderOpen(true);
        }}
      />
    </div>
  );
}
