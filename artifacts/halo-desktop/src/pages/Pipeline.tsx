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
    <div className="cl-subpanel w-full lg:w-[320px] shrink-0 rounded-2xl p-5 flex flex-col relative overflow-hidden">
      {/* soft glow top right */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--gold-light)]/20 rounded-full blur-3xl pointer-events-none" />
      
      <div className="flex items-center justify-between mb-5 relative">
        <h2 className="text-[var(--ink)] font-display font-bold text-lg flex items-center gap-2">
          Client Requests
        </h2>
        {requests && requests.length > 0 && (
          <span className="bg-[var(--gold-light)] text-[var(--ink)] text-xs font-bold px-2.5 py-0.5 rounded-full" data-testid="badge-request-count">
            {requests.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar -mr-2 pr-2">
        {isLoading ? (
          <div className="space-y-3">
             <Skeleton className="h-24 w-full rounded-xl bg-[var(--muted)]" />
             <Skeleton className="h-24 w-full rounded-xl bg-[var(--muted)]" />
          </div>
        ) : !requests || requests.length === 0 ? (
          <div className="py-10 text-center text-[var(--ink2)] text-sm">
            Inbox is clear.
          </div>
        ) : (
          <div className="flex flex-col gap-3 relative">
            {requests.map((r) => (
              <div key={r.id} className="bg-white border border-[var(--hairline)] rounded-xl p-4 flex flex-col transition-all hover:shadow-[var(--shadow-card)]" data-testid={`card-request-${r.id}`}>
                <div className="font-bold text-[var(--ink)] text-sm truncate">
                  {r.serviceLabel}
                  {r.unitNo ? <span className="text-[var(--ink2)] font-normal"> · #{r.unitNo}</span> : null}
                </div>
                <div className="text-[11px] text-[var(--ink2)] mt-1">
                  {r.propertyName}
                  {r.requesterName ? ` — ${r.requesterName}` : ""}
                </div>
                
                {r.neededBy && (
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#3D6B00] mt-2">
                    <CalendarClock className="w-3.5 h-3.5" /> Complete by {format(new Date(`${r.neededBy}T12:00:00`), "MMM d")}
                  </div>
                )}
                
                {r.budgetEstimate != null && (() => {
                  const unitCount = Math.max(r.units?.length ?? 0, 1);
                  const listTotal = r.listRate != null ? r.listRate * unitCount : null;
                  const overList = listTotal != null && r.budgetEstimate! > listTotal;
                  return (
                    <div className="flex items-center flex-wrap gap-1.5 text-[11px] mt-2" data-testid={`text-request-budget-${r.id}`}>
                      <span className="font-semibold text-[var(--ink)] tabular-nums">
                        Budget ${r.budgetEstimate!.toLocaleString()}
                      </span>
                      {overList && (
                        <span className="flex items-center gap-1 font-bold text-[#B91C1C] bg-[#FEE2E2] rounded-full px-2 py-0.5">
                          <TriangleAlert className="w-3 h-3" /> Above list
                        </span>
                      )}
                    </div>
                  );
                })()}
                
                {r.poNumber ? (
                  <div className="text-[11px] font-semibold text-[var(--ink2)] mt-1.5" data-testid={`text-request-po-${r.id}`}>PO {r.poNumber}</div>
                ) : (
                  <div className="text-[11px] font-bold text-[#B91C1C] mt-1.5" data-testid={`text-request-nopo-${r.id}`}>No PO — approve manually</div>
                )}
                
                {r.notes && <p className="text-[11px] text-[var(--ink2)] mt-2 line-clamp-3 leading-relaxed">{r.notes}</p>}

                {declining === r.id ? (
                  <div className="mt-4 flex flex-col gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason (optional)"
                      className="bg-white border border-[var(--hairline)] rounded-lg px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--hairline2)] focus:outline-none focus:border-[var(--secondary)] focus:ring-2 focus:ring-[var(--secondary)]/20"
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
                        className="flex-1 bg-[#EF4444] hover:bg-[#DC2626] transition-colors text-white text-xs font-bold rounded-lg py-2"
                        data-testid={`button-confirm-decline-${r.id}`}
                      >
                        Confirm
                      </button>
                      <button onClick={() => setDeclining(null)} className="flex-1 bg-[var(--muted)] hover:bg-[var(--hairline)] transition-colors text-[var(--ink)] text-xs font-bold rounded-lg py-2">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[var(--hairline)]">
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
                      className="flex-1 bg-[var(--gold-light)] text-[var(--ink)] text-xs font-bold rounded-lg py-2 flex items-center justify-center gap-1.5 hover:bg-[#A3E63D] transition-colors disabled:opacity-50"
                      data-testid={`button-accept-${r.id}`}
                    >
                      {accept.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept
                    </button>
                    <button
                      onClick={() => { setDeclining(r.id); setReason(""); }}
                      disabled={accept.isPending || decline.isPending}
                      className="flex-1 border border-[var(--hairline)] hover:bg-[var(--muted)] text-[var(--ink)] text-xs font-bold rounded-lg py-2 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
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
    <div className="theme-light p-8 max-w-[1200px] mx-auto animate-in fade-in duration-500 h-[calc(100vh-88px)] flex flex-col">
      <div className="cl-panel rounded-[24px] p-6 lg:p-8 flex flex-col lg:flex-row gap-8 flex-1 min-h-0">
        
        {/* Left: Leads & Bids */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 shrink-0">
            <div>
              <h1 className="font-display font-bold text-2xl text-[var(--ink)] tracking-tight">Pipeline</h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAddLeadOpen(true)}
                className="bg-white hover:bg-[var(--muted)] border border-[var(--hairline)] text-[var(--ink)] px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2 shadow-sm"
                data-testid="button-new-lead"
              >
                <Plus className="w-4 h-4" /> New Lead
              </button>
              <button
                onClick={() => { setEditBidId(null); setBuilderOpen(true); }}
                className="bg-[var(--gold-light)] text-[var(--ink)] px-4 py-2 rounded-xl text-sm font-bold hover:bg-[#A3E63D] transition-colors flex items-center gap-2 shadow-sm"
                data-testid="button-new-bid"
              >
                <Plus className="w-4 h-4" /> New Bid
              </button>
            </div>
          </header>

          {/* Tabs */}
          <div className="flex gap-2 mb-4 border-b border-[var(--hairline)] pb-4 shrink-0">
            <button
              onClick={() => setActiveTab('leads')}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'leads' ? 'bg-[var(--gold-light)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink2)] hover:text-[var(--ink)] hover:bg-[var(--muted)]'}`}
            >
              Leads <span className="ml-1 opacity-70 text-xs">({leads?.length || 0})</span>
            </button>
            <button
              onClick={() => setActiveTab('bids')}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'bids' ? 'bg-[var(--gold-light)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink2)] hover:text-[var(--ink)] hover:bg-[var(--muted)]'}`}
            >
              Active Bids <span className="ml-1 opacity-70 text-xs">({bids?.length || 0})</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {activeTab === 'leads' ? (
              <div className="flex flex-col">
                <div className="grid grid-cols-[80px_1fr_1.5fr_80px] gap-4 pb-2 border-b border-[var(--hairline)] text-[var(--ink2)] text-xs font-bold uppercase tracking-wider px-2">
                  <div>Status</div>
                  <div>Property / Contact</div>
                  <div>Summary</div>
                  <div className="text-right">Created</div>
                </div>
                {loadingLeads ? (
                  <div className="py-4 space-y-3">
                    <Skeleton className="h-14 w-full rounded-xl bg-[var(--muted)]" />
                    <Skeleton className="h-14 w-full rounded-xl bg-[var(--muted)]" />
                  </div>
                ) : leads?.map((lead, i) => (
                  <div
                    key={lead.id}
                    onClick={() => setLeadDetail(lead as LeadRow)}
                    className={`grid grid-cols-[80px_1fr_1.5fr_80px] gap-4 py-3 items-center border-b border-[var(--hairline)] transition-colors cursor-pointer px-2 rounded-xl group ${i % 2 === 1 ? "bg-[#F8FAFC]" : ""} hover:bg-[#EEF2F7]`}
                    data-testid={`card-lead-${lead.id}`}
                  >
                    <div>
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        lead.status === 'new' ? 'bg-[#EAFFC7] text-[#3D6B00] border border-[#B4FF44]' :
                        lead.status === 'contacted' ? 'bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D]' :
                        'bg-[var(--muted)] text-[var(--ink2)] border border-[var(--hairline)]'
                      }`}>
                        {lead.status}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--ink)] truncate text-sm group-hover:text-[var(--secondary)] transition-colors">
                        {lead.propertyName || lead.contactName || 'Unknown Property'}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {lead.source === 'phone' && <span className="text-[10px] text-[var(--ink2)] flex items-center gap-1"><Phone className="w-2.5 h-2.5"/> Call</span>}
                        {lead.campaignStatus === 'active' && <span className="text-[10px] text-[#3D6B00] font-semibold flex items-center gap-1"><Zap className="w-2.5 h-2.5"/> Drip</span>}
                        {lead.lastContactAt && <span className="text-[10px] text-[var(--ink2)] flex items-center gap-1"><Mail className="w-2.5 h-2.5"/> {format(new Date(lead.lastContactAt), "MMM d")}</span>}
                      </div>
                    </div>
                    <div className="text-[var(--ink2)] text-xs truncate">
                      {lead.summary || <span className="text-[var(--hairline2)] italic">No summary</span>}
                    </div>
                    <div className="text-[var(--ink2)] text-xs text-right font-medium tabular-nums">
                      {lead.createdAt ? format(new Date(lead.createdAt), "MMM d") : '—'}
                    </div>
                  </div>
                ))}
                {leads?.length === 0 && !loadingLeads && (
                  <div className="py-12 text-center text-[var(--ink2)] text-sm">No active leads.</div>
                )}
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="grid grid-cols-[80px_1fr_1.5fr_100px] gap-4 pb-2 border-b border-[var(--hairline)] text-[var(--ink2)] text-xs font-bold uppercase tracking-wider px-2">
                  <div>Status</div>
                  <div>Property</div>
                  <div>Scope</div>
                  <div className="text-right">Amount</div>
                </div>
                {loadingBids ? (
                  <div className="py-4 space-y-3">
                    <Skeleton className="h-14 w-full rounded-xl bg-[var(--muted)]" />
                    <Skeleton className="h-14 w-full rounded-xl bg-[var(--muted)]" />
                  </div>
                ) : bids?.map((bid, i) => (
                  <div
                    key={bid.id}
                    onClick={() => setDetailBidId(bid.id)}
                    className={`grid grid-cols-[80px_1fr_1.5fr_100px] gap-4 py-3 items-center border-b border-[var(--hairline)] transition-colors cursor-pointer px-2 rounded-xl group ${i % 2 === 1 ? "bg-[#F8FAFC]" : ""} hover:bg-[#EEF2F7]`}
                    data-testid={`card-bid-${bid.id}`}
                  >
                    <div>
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        bid.status === 'won' ? 'bg-[#EAFFC7] text-[#3D6B00] border border-[#B4FF44]' :
                        bid.status === 'lost' ? 'bg-[#FEE2E2] text-[#B91C1C] border border-[#FCA5A5]' :
                        bid.status === 'draft' ? 'bg-[var(--muted)] text-[var(--ink2)] border border-[var(--hairline)]' :
                        'bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D]'
                      }`}>
                        {bid.status}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--ink)] truncate text-sm group-hover:text-[var(--secondary)] transition-colors">
                        {bid.propertyName || 'Unknown Property'}
                        {bid.unitNo && <span className="text-[var(--ink2)] font-normal ml-1">#{bid.unitNo}</span>}
                      </div>
                      <div className="text-[10px] text-[var(--ink2)] font-mono mt-1">{bid.bidNo}</div>
                    </div>
                    <div className="text-[var(--ink2)] text-xs truncate">
                      {bid.scope || <span className="text-[var(--hairline2)] italic">No scope</span>}
                    </div>
                    <div className="text-[var(--ink)] font-mono font-bold text-sm text-right tabular-nums">
                      ${bid.amount.toLocaleString()}
                    </div>
                  </div>
                ))}
                {bids?.length === 0 && !loadingBids && (
                  <div className="py-12 text-center text-[var(--ink2)] text-sm">No active bids.</div>
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
