import { useState, useMemo } from "react";
import {
  useListJobBoard,
  useBroadcastJob,
  useReopenJob,
  useListCrews,
  getListJobBoardQueryKey,
} from "@workspace/api-client-react";
import type { JobBoardCard, JobBroadcastInfo, Crew, PriceItem, JobPhoto } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  RefreshCw,
  Megaphone,
  CheckCircle2,
  XCircle,
  Clock,
  LogOut,
  MapPin,
  Calendar,
  Image as ImageIcon,
  ClipboardList
} from "lucide-react";
import { Link } from "wouter";

const boardStatusColors: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: "rgba(185,138,47,0.15)", text: "var(--gold-dark)", label: "Open" },
  filled: { bg: "rgba(60,122,78,0.15)", text: "#3c7a4e", label: "Filled" },
  reopened: { bg: "rgba(192,69,58,0.15)", text: "#be3c3c", label: "Reopened" },
  completed: { bg: "rgba(23,24,28,0.08)", text: "var(--muted)", label: "Completed" },
};

const broadcastStatusConfig: Record<string, { icon: any; color: string; label: string }> = {
  pending: { icon: Clock, color: "var(--muted)", label: "Pending" },
  approved: { icon: CheckCircle2, color: "#3c7a4e", label: "Accepted" },
  declined: { icon: XCircle, color: "#be3c3c", label: "Declined" },
  withdrawn: { icon: LogOut, color: "var(--muted)", label: "Withdrawn" },
};

function BroadcastSheet({
  open,
  onOpenChange,
  jobId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const broadcast = useBroadcastJob();
  const { data: crews } = useListCrews();

  const [mode, setMode] = useState<"all" | "trade" | "crews">("all");
  const [selectedTrade, setSelectedTrade] = useState<string>("");
  const [selectedCrews, setSelectedCrews] = useState<string[]>([]);

  const trades = useMemo(() => {
    if (!crews) return [];
    return Array.from(new Set(crews.map(c => c.trade).filter(Boolean))) as string[];
  }, [crews]);

  const handleSend = () => {
    if (!jobId) return;
    const payload = {
      mode,
      ...(mode === "trade" && selectedTrade ? { trade: selectedTrade } : {}),
      ...(mode === "crews" && selectedCrews.length > 0 ? { crewIds: selectedCrews } : {}),
    };

    broadcast.mutate(
      { id: jobId, data: payload },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries();
          toast({
            title: "Job Broadcasted",
            description: `Sent to ${res.sent} crew(s). ${res.alreadySent > 0 ? `(${res.alreadySent} already sent)` : ""}`,
          });
          onOpenChange(false);
        },
        onError: (err: any) => {
          toast({
            title: "Failed to broadcast",
            description: err?.data?.error ?? "Something went wrong",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
              Broadcast Job
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              Notify crews about this open job.
            </div>
          </SheetHeader>

          <div className="space-y-4">
            <div className="flex gap-[6px] bg-card p-[6px] rounded-[14px] shadow-[var(--shadow)]">
              {["all", "trade", "crews"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m as any)}
                  className={`flex-1 rounded-[10px] py-[8px] text-[13px] font-display font-bold capitalize transition-colors ${
                    mode === m ? "bg-[var(--ink)] text-white" : "text-muted-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {mode === "trade" && (
              <div className="bg-card rounded-[14px] p-[12px] shadow-[var(--shadow)]">
                <div className="text-[13px] font-semibold mb-[8px]">Select Trade</div>
                <div className="flex flex-wrap gap-[6px]">
                  {trades.length === 0 && <span className="text-[13px] text-muted-foreground">No trades found in crews.</span>}
                  {trades.map(t => (
                    <button
                      key={t}
                      onClick={() => setSelectedTrade(t)}
                      className={`px-[12px] py-[6px] rounded-[8px] text-[13px] font-medium border ${selectedTrade === t ? "bg-[var(--gold)] text-white border-[var(--gold)]" : "border-border text-muted-foreground"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === "crews" && (
              <div className="bg-card rounded-[14px] p-[12px] shadow-[var(--shadow)] max-h-[200px] overflow-y-auto">
                <div className="text-[13px] font-semibold mb-[8px]">Select Crews</div>
                <div className="flex flex-col gap-[6px]">
                  {crews?.map(c => (
                    <label key={c.id} className="flex items-center gap-[10px] p-[6px]">
                      <input
                        type="checkbox"
                        checked={selectedCrews.includes(c.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedCrews([...selectedCrews, c.id]);
                          else setSelectedCrews(selectedCrews.filter(id => id !== c.id));
                        }}
                        className="rounded-[4px] border-border text-[var(--gold)] focus:ring-[var(--gold)]"
                      />
                      <span className="text-[14px] font-medium">{c.name}</span>
                      {c.trade && <span className="text-[12px] text-muted-foreground ml-auto">{c.trade}</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleSend}
              disabled={broadcast.isPending || (mode === "trade" && !selectedTrade) || (mode === "crews" && selectedCrews.length === 0)}
              className="w-full rounded-[13px] py-[12px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] disabled:opacity-50 transition-transform active:scale-[0.98] mt-[10px]"
            >
              {broadcast.isPending ? "Sending..." : "Send Broadcast"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}


function JobCard({ data, onBroadcast, onReopen }: { data: JobBoardCard; onBroadcast: () => void; onReopen: () => void }) {
  const { job, priceItems, photos, broadcasts } = data;
  const status = job.boardStatus || "active";
  const stConfig = boardStatusColors[status] || boardStatusColors.active;

  return (
    <div className="bg-card rounded-[20px] shadow-[0_4px_20px_rgba(0,0,0,0.06)] border border-border overflow-hidden mb-[16px] transition-all">
      <div className="p-[16px] border-b border-border">
        <div className="flex items-start justify-between mb-[8px]">
          <div>
            <Link href={`/jobs/${job.id}`}>
              <div className="font-display font-bold text-[18px] leading-[1.2] text-[var(--ink)] active:opacity-70 transition-opacity">
                {job.propertyName || "Unknown Property"} {job.unitNo ? `· ${job.unitNo}` : ""}
              </div>
            </Link>
            <div className="flex items-center gap-[8px] mt-[4px]">
              <span className="font-mono text-[12px] text-muted-foreground">{job.jobNo}</span>
              {job.category && (
                <span className="text-[11.5px] font-medium text-[var(--ink2)] bg-[var(--paper)] px-[6px] py-[2px] rounded-[6px]">
                  {job.category}
                </span>
              )}
            </div>
          </div>
          <div
            className="text-[11px] font-bold uppercase tracking-[0.06em] px-[8px] py-[4px] rounded-full shrink-0"
            style={{ backgroundColor: stConfig.bg, color: stConfig.text }}
          >
            {stConfig.label}
          </div>
        </div>

        {job.description && (
          <div className="text-[13.5px] text-[var(--ink2)] mt-[10px] leading-snug line-clamp-3">
            {job.description}
          </div>
        )}

        <div className="flex items-center gap-[14px] mt-[12px] text-[12.5px] text-muted-foreground">
          {job.scheduledOn && (
            <div className="flex items-center gap-[4px]">
              <Calendar className="w-[14px] h-[14px]" />
              {new Date(job.scheduledOn).toLocaleDateString()}
            </div>
          )}
          {job.crewLeaderName && (
            <div className="flex items-center gap-[4px]">
              <MapPin className="w-[14px] h-[14px]" />
              {job.crewLeaderName}
            </div>
          )}
        </div>
      </div>

      {priceItems.length > 0 && (
        <div className="bg-[var(--paper)] p-[12px_16px] border-b border-border">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-[8px]">Price List</div>
          <div className="space-y-[6px]">
            {priceItems.map(p => (
              <div key={p.id} className="flex items-start justify-between text-[13px]">
                <div className="pr-[10px]">
                  <span className="font-medium text-[var(--ink)]">{p.service}</span>
                  {p.detail && <span className="text-muted-foreground block text-[11.5px] mt-[1px]">{p.detail}</span>}
                </div>
                <div className="font-display font-semibold tabular-nums shrink-0">
                  ${p.rate} {p.unit && <span className="text-muted-foreground font-sans text-[11.5px] font-normal">/ {p.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {photos.length > 0 && (
        <div className="p-[12px_16px] border-b border-border flex gap-[8px] overflow-x-auto">
          {photos.map(p => (
            <div key={p.storagePath} className="w-[60px] h-[60px] rounded-[10px] bg-[var(--paper)] shrink-0 overflow-hidden relative border border-border">
              <img src={`/api/storage${p.storagePath}`} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {broadcasts.length > 0 && (
        <div className="p-[12px_16px] border-b border-border bg-[#FAFAFA]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-[8px]">Broadcasts</div>
          <div className="flex flex-col gap-[6px]">
            {broadcasts.map(b => {
              const bConf = broadcastStatusConfig[b.status] || broadcastStatusConfig.pending;
              const Icon = bConf.icon;
              return (
                <div key={b.id} className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-[6px]">
                    <Icon className="w-[14px] h-[14px]" style={{ color: bConf.color }} />
                    <span className="font-medium">{b.crewName}</span>
                  </div>
                  {b.respondedAt ? (
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(b.respondedAt).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="p-[12px_16px] flex gap-[8px]">
        {status === "active" || status === "reopened" ? (
          <button
            onClick={onBroadcast}
            className="flex-1 rounded-[11px] py-[10px] text-[13px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] transition-transform active:scale-[0.98] flex items-center justify-center gap-[6px]"
          >
            <Megaphone className="w-[15px] h-[15px]" /> Broadcast
          </button>
        ) : null}

        {status === "filled" ? (
          <button
            onClick={onReopen}
            className="flex-1 rounded-[11px] py-[10px] text-[13px] font-display font-bold text-[var(--ink)] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98] flex items-center justify-center gap-[6px]"
          >
            <RefreshCw className="w-[15px] h-[15px]" /> Reopen Job
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function JobBoard() {
  const { data: boardData, isLoading } = useListJobBoard();
  const reopen = useReopenJob();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [broadcastJobId, setBroadcastJobId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "filled" | "completed">("active");

  const handleReopen = (jobId: string, jobNo: string) => {
    if (!window.confirm(`Are you sure you want to reopen job ${jobNo}? This will withdraw the assigned crew and clear the schedule.`)) return;
    reopen.mutate(
      { id: jobId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          toast({ title: "Job Reopened", description: `Job ${jobNo} is back on the board.` });
        },
        onError: (err: any) => {
          toast({ title: "Failed to reopen", description: err?.data?.error ?? "Something went wrong", variant: "destructive" });
        }
      }
    );
  };

  const filteredData = useMemo(() => {
    if (!boardData) return [];
    return boardData.filter(d => {
      const s = d.job.boardStatus || "active";
      if (filter === "active") return s === "active" || s === "reopened";
      if (filter === "filled") return s === "filled";
      if (filter === "completed") return s === "completed";
      return true;
    });
  }, [boardData, filter]);

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300 pb-[80px]">
      <div className="font-display font-bold text-[26px] tracking-[-0.015em] leading-[1.1] mb-[2px]">Job Board</div>
      <div className="text-[13px] text-muted-foreground mb-[14px]">Dispatch and fill open jobs.</div>

      <div className="flex gap-[4px] bg-card rounded-[13px] p-[4px] shadow-[var(--shadow)] mb-[16px]">
        {[
          { key: "active", label: "Open" },
          { key: "filled", label: "Filled" },
          { key: "completed", label: "Done" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key as any)}
            className={`flex-1 rounded-[10px] py-[8px] text-[13px] font-display font-bold transition-colors ${
              filter === t.key ? "bg-[var(--ink)] text-white" : "text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
         <div className="animate-pulse space-y-4">
           <div className="h-[200px] bg-card rounded-[20px]" />
           <div className="h-[200px] bg-card rounded-[20px]" />
         </div>
      ) : filteredData.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[60px] bg-card rounded-[20px] border border-border shadow-[var(--shadow)]">
          <div className="w-[48px] h-[48px] mx-auto bg-[var(--paper)] rounded-full flex items-center justify-center mb-[12px]">
            <ClipboardList className="w-[20px] h-[20px] text-muted-foreground opacity-50" />
          </div>
          No jobs found for this view.
        </div>
      ) : (
        <div>
          {filteredData.map(d => (
            <JobCard
              key={d.job.id}
              data={d}
              onBroadcast={() => setBroadcastJobId(d.job.id)}
              onReopen={() => handleReopen(d.job.id, d.job.jobNo)}
            />
          ))}
        </div>
      )}

      <BroadcastSheet
        open={!!broadcastJobId}
        onOpenChange={(o) => !o && setBroadcastJobId(null)}
        jobId={broadcastJobId}
      />
    </div>
  );
}
