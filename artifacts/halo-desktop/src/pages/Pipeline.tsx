import { useState} from "react";
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
import { Skeleton} from "@/components/ui/skeleton";
import { Plus, Target, FileText, Zap, Mail, Phone, Inbox, Check, X, CalendarClock, Loader2} from "lucide-react";
import { Card, CardContent} from "@/components/ui/card";
import { format} from "date-fns";
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

  if (isLoading || !requests || requests.length === 0) return null;

  return (
    <section className="shrink-0">
      <div className="flex items-center gap-2 mb-3">
        <Inbox className="w-4 h-4 text-[var(--gold-dark,#4a7000)]" />
        <h2 className="font-display font-bold text-[16px] text-[var(--ink)]">Client Requests</h2>
        <span className="text-[11px] font-bold bg-[var(--gold-light,#B4FF44)] text-black rounded-full px-2 py-0.5" data-testid="badge-request-count">
          {requests.length}
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {requests.map((r) => (
          <Card key={r.id} className="border-[var(--gold-light,#B4FF44)]/60" data-testid={`card-request-${r.id}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-[14px] text-[var(--ink)] truncate">
                    {r.serviceLabel}
                    {r.unitNo ? <span className="text-muted-foreground font-normal"> · Unit {r.unitNo}</span> : null}
                  </div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">
                    {r.propertyName}
                    {r.requesterName ? ` — ${r.requesterName}` : ""}
                    {" · "}
                    {format(new Date(r.createdAt), "MMM d, h:mm a")}
                  </div>
                  {r.neededBy && (
                    <div className="flex items-center gap-1 text-[12px] font-semibold text-[var(--gold-dark,#4a7000)] mt-1">
                      <CalendarClock className="w-3.5 h-3.5" /> Complete by {format(new Date(`${r.neededBy}T12:00:00`), "MMM d, yyyy")}
                    </div>
                  )}
                  {r.poNumber ? (
                    <div className="text-[12px] font-semibold text-[var(--ink)] mt-1" data-testid={`text-request-po-${r.id}`}>
                      PO {r.poNumber}
                    </div>
                  ) : (
                    <div className="text-[12px] font-bold text-destructive mt-1" data-testid={`text-request-nopo-${r.id}`}>
                      No PO — approve manually
                    </div>
                  )}
                  {r.notes && <p className="text-[12.5px] text-[var(--ink)] mt-1.5 whitespace-pre-wrap">{r.notes}</p>}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() =>
                      accept.mutate(
                        { id: r.id },
                        {
                          onSuccess: (rec) => {
                            toast({ title: `Job ${rec.jobNo ?? ""} created`, description: `${rec.serviceLabel} at ${rec.propertyName}` });
                            refresh();
                          },
                          onError: (e) => toast({ title: "Couldn't accept", description: e.message, variant: "destructive" }),
                        },
                      )
                    }
                    disabled={accept.isPending || decline.isPending}
                    className="flex items-center gap-1.5 bg-[var(--gold-light,#B4FF44)] text-black text-[12.5px] font-bold rounded-full px-4 py-1.5 disabled:opacity-50"
                    data-testid={`button-accept-${r.id}`}
                  >
                    {accept.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept
                  </button>
                  <button
                    onClick={() => { setDeclining(declining === r.id ? null : r.id); setReason(""); }}
                    disabled={accept.isPending || decline.isPending}
                    className="flex items-center gap-1.5 border border-[var(--hairline)] text-[12.5px] font-medium rounded-full px-4 py-1.5 text-[var(--ink)] hover:border-destructive hover:text-destructive disabled:opacity-50"
                    data-testid={`button-decline-${r.id}`}
                  >
                    <X className="w-3.5 h-3.5" /> Decline
                  </button>
                </div>
              </div>
              {declining === r.id && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (optional)"
                    className="flex-1 border border-[var(--hairline)] rounded-[8px] px-3 py-1.5 text-[12.5px]"
                    data-testid={`input-decline-reason-${r.id}`}
                  />
                  <button
                    onClick={() =>
                      decline.mutate(
                        { id: r.id, data: { reason: reason || null } },
                        {
                          onSuccess: () => { toast({ title: "Request declined" }); setDeclining(null); refresh(); },
                          onError: (e) => toast({ title: "Couldn't decline", description: e.message, variant: "destructive" }),
                        },
                      )
                    }
                    disabled={decline.isPending}
                    className="bg-destructive text-destructive-foreground text-[12.5px] font-bold rounded-[8px] px-4 py-1.5 disabled:opacity-50"
                    data-testid={`button-confirm-decline-${r.id}`}
                  >
                    Confirm
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
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

  const selectedLead =
    (leadDetail && leads?.find((l) => l.id === leadDetail.id)) || leadDetail;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 h-screen flex flex-col">
      <WorkRequestsPanel />
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)]">Pipeline</h1>
          <p className="text-muted-foreground mt-1 text-sm">Leads & Active Bids</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAddLeadOpen(true)}
            className="flex items-center gap-2 bg-card border border-[var(--hairline)] text-[var(--ink)] px-5 py-2.5 rounded-full font-medium hover:border-[var(--ink)] transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
            data-testid="button-new-lead"
          >
            <Plus className="w-4 h-4" /> New Lead
          </button>
          <button
            onClick={() => {
              setEditBidId(null);
              setBuilderOpen(true);
            }}
            className="btn-gold px-5 py-2.5 flex items-center gap-2"
            data-testid="button-new-bid"
          >
            <Plus className="w-4 h-4" /> New Bid
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 overflow-hidden pb-8">
        {/* Leads Column */}
        <div className="flex flex-col h-full bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          <div className="p-4 border-b border-[var(--hairline)] flex items-center justify-between bg-[var(--paper)] rounded-t-[20px]">
            <h2 className="font-display font-bold text-[11px] tracking-[0.2em] uppercase flex items-center gap-2 text-[var(--ink)]">
              <span className="w-2 h-2 rounded-full bg-[var(--gold)]" />
              <Target className="w-4 h-4 text-[var(--gold)]" />
              Leads
            </h2>
            <span className="text-xs font-bold bg-card px-2.5 py-1 rounded-full border border-[var(--hairline)]">{leads?.length || 0}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loadingLeads ? (
              <>
                <Skeleton className="h-24 w-full rounded-lg" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </>
            ) : leads?.map(lead => (
              <Card
                key={lead.id}
                onClick={() => setLeadDetail(lead as LeadRow)}
                className="cursor-pointer rounded-[16px] border-[var(--hairline)] hover:border-[var(--ink)] transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                data-testid={`card-lead-${lead.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink)] px-2 py-0.5 rounded-full bg-[var(--paper)] border border-[var(--hairline)]">
                        {lead.status}
                      </span>
                      {lead.source === "phone" && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--gold)] px-2 py-0.5 rounded-full bg-[var(--gold-tint)] flex items-center gap-1">
                          <Phone className="w-2.5 h-2.5" /> call
                        </span>
                      )}
                      {lead.campaignStatus === "active" && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--gold)] px-2 py-0.5 rounded-full bg-[var(--gold-tint)] flex items-center gap-1">
                          <Zap className="w-2.5 h-2.5" /> drip
                        </span>
                      )}
                      {lead.lastContactAt && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Mail className="w-2.5 h-2.5" />
                          {format(new Date(lead.lastContactAt), "MMM d")}
                        </span>
                      )}
                    </div>
                    {lead.createdAt && (
                      <span className="text-xs text-muted-foreground">{format(new Date(lead.createdAt), "MMM d")}</span>
                    )}
                  </div>
                  <h3 className="font-semibold text-base mb-1">
                    {lead.propertyName || lead.contactName || 'Unknown Property'}
                  </h3>
                  {lead.summary && <p className="text-sm text-muted-foreground line-clamp-2">{lead.summary}</p>}
                </CardContent>
              </Card>
            ))}
            {leads?.length === 0 && (
              <div className="text-center p-8 text-muted-foreground text-sm border border-dashed border-[var(--hairline)] rounded-[16px]">
                No active leads.
              </div>
            )}
          </div>
        </div>

        {/* Bids Column */}
        <div className="flex flex-col h-full bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          <div className="p-4 border-b border-[var(--hairline)] flex items-center justify-between bg-[var(--paper)] rounded-t-[20px]">
            <h2 className="font-display font-bold text-[11px] tracking-[0.2em] uppercase flex items-center gap-2 text-[var(--ink)]">
              <span className="w-2 h-2 rounded-full bg-[var(--gold)]" />
              <FileText className="w-4 h-4 text-[var(--gold)]" />
              Active Bids
            </h2>
            <span className="text-xs font-bold bg-card px-2.5 py-1 rounded-full border border-[var(--hairline)]">{bids?.length || 0}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loadingBids ? (
              <>
                <Skeleton className="h-32 w-full rounded-lg" />
                <Skeleton className="h-32 w-full rounded-lg" />
              </>
            ) : bids?.map(bid => (
              <Card
                key={bid.id}
                onClick={() => setDetailBidId(bid.id)}
                className="cursor-pointer rounded-[16px] border-[var(--hairline)] hover:border-[var(--ink)] transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                data-testid={`card-bid-${bid.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium text-muted-foreground">{bid.bidNo}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        bid.status === 'won' ? 'bg-emerald-100 text-emerald-800' :
                        bid.status === 'lost' ? 'bg-red-100 text-red-800' :
                        bid.status === 'draft' ? 'bg-[var(--paper)] text-muted-foreground border border-[var(--hairline)]' :
                        'bg-[var(--gold-tint)] text-[var(--gold)]'
                      }`}>
                        {bid.status}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-[var(--ink)]">${bid.amount.toLocaleString()}</span>
                  </div>
                  <h3 className="font-semibold text-base mb-1">
                    {bid.propertyName || 'Unknown Property'}
                    {bid.unitNo && <span className="text-muted-foreground font-normal ml-1">#{bid.unitNo}</span>}
                  </h3>
                  {bid.scope && <p className="text-sm text-muted-foreground line-clamp-2">{bid.scope}</p>}
                </CardContent>
              </Card>
            ))}
            {bids?.length === 0 && (
              <div className="text-center p-8 text-muted-foreground text-sm border border-dashed border-[var(--hairline)] rounded-[16px]">
                No active bids.
              </div>
            )}
          </div>
        </div>
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
