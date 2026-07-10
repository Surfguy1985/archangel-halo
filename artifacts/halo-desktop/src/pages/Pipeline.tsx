import { useListLeads, useListBids } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Target, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { format } from "date-fns";

export default function Pipeline() {
  const { data: leads, isLoading: loadingLeads } = useListLeads();
  const { data: bids, isLoading: loadingBids } = useListBids();

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 h-screen flex flex-col">
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Pipeline</h1>
          <p className="text-muted-foreground">Leads & Active Bids</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 bg-card border border-border text-[var(--ink)] px-4 py-2 rounded-md font-medium hover:bg-black/5 transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> New Lead
          </button>
          <button className="flex items-center gap-2 bg-[var(--gold)] text-white px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> New Bid
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 overflow-hidden pb-8">
        {/* Leads Column */}
        <div className="flex flex-col h-full bg-card rounded-xl border border-border shadow-sm">
          <div className="p-4 border-b border-border flex items-center justify-between bg-[var(--paper)] rounded-t-xl">
            <h2 className="font-display font-bold text-lg flex items-center gap-2">
              <Target className="w-5 h-5 text-[var(--gold-dark)]" />
              Leads
            </h2>
            <span className="text-xs font-bold bg-white px-2 py-1 rounded-full border border-border">{leads?.length || 0}</span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loadingLeads ? (
              <>
                <Skeleton className="h-24 w-full rounded-lg" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </>
            ) : leads?.map(lead => (
              <Card key={lead.id} className="cursor-pointer hover:border-[var(--gold)]/50 transition-colors shadow-sm">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink)] px-2 py-0.5 rounded-full bg-black/5 border border-border">
                      {lead.status}
                    </span>
                    {lead.createdAt && (
                      <span className="text-xs text-muted-foreground">{format(new Date(lead.createdAt), "MMM d")}</span>
                    )}
                  </div>
                  <h3 className="font-semibold text-base mb-1">{lead.propertyName || 'Unknown Property'}</h3>
                  {lead.summary && <p className="text-sm text-muted-foreground line-clamp-2">{lead.summary}</p>}
                </CardContent>
              </Card>
            ))}
            {leads?.length === 0 && (
              <div className="text-center p-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                No active leads.
              </div>
            )}
          </div>
        </div>

        {/* Bids Column */}
        <div className="flex flex-col h-full bg-card rounded-xl border border-border shadow-sm">
          <div className="p-4 border-b border-border flex items-center justify-between bg-[var(--paper)] rounded-t-xl">
            <h2 className="font-display font-bold text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-[var(--gold-dark)]" />
              Active Bids
            </h2>
            <span className="text-xs font-bold bg-white px-2 py-1 rounded-full border border-border">{bids?.length || 0}</span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loadingBids ? (
              <>
                <Skeleton className="h-32 w-full rounded-lg" />
                <Skeleton className="h-32 w-full rounded-lg" />
              </>
            ) : bids?.map(bid => (
              <Card key={bid.id} className="cursor-pointer hover:border-[var(--gold)]/50 transition-colors shadow-sm">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium text-muted-foreground">{bid.bidNo}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        bid.status === 'won' ? 'bg-[var(--green)]/10 text-[var(--green)] border-[var(--green)]/20' :
                        bid.status === 'lost' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                        'bg-[var(--gold-tint)] text-[var(--gold-dark)] border-[var(--gold)]/20'
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
              <div className="text-center p-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                No active bids.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
