import { useState, useMemo, useEffect } from "react";
import {
  useListJobBoard,
  useBroadcastJob,
  useReopenJob,
  useUnlistJob,
  useUpdateBoardSettings,
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
  ClipboardList,
  Pencil,
  Trash2
} from "lucide-react";
import { Link } from "wouter";
import { EditJobSheet } from "@/components/EditJobSheet";
import { FalkonBadge } from "@/components/FalkonBadge";

const boardStatusColors: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: "hsl(var(--primary) / 0.15)", text: "hsl(var(--primary))", label: "Open" },
  filled: { bg: "rgba(60,122,78,0.2)", text: "#4ade80", label: "Filled" },
  reopened: { bg: "rgba(192,69,58,0.2)", text: "#f87171", label: "Reopened" },
  completed: { bg: "hsl(var(--muted))", text: "hsl(var(--muted-foreground))", label: "Completed" },
};

const broadcastStatusConfig: Record<string, { icon: any; color: string; label: string }> = {
  pending: { icon: Clock, color: "hsl(var(--muted-foreground))", label: "Pending" },
  approved: { icon: CheckCircle2, color: "#4ade80", label: "Accepted" },
  declined: { icon: XCircle, color: "#f87171", label: "Declined" },
  withdrawn: { icon: LogOut, color: "hsl(var(--muted-foreground))", label: "Withdrawn" },
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
  const [scheduleType, setScheduleType] = useState<"scheduled" | "flex">("scheduled");
  const [flexDays, setFlexDays] = useState("7");
  const [crewsNeeded, setCrewsNeeded] = useState("1");

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
      scheduleType,
      ...(scheduleType === "flex" ? { flexDays: Math.max(1, parseInt(flexDays) || 7) } : {}),
      crewsNeeded: Math.max(1, parseInt(crewsNeeded) || 1),
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
        className="rounded-t-[26px] bg-card p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-10px_40px_rgba(0,0,0,0.8)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-border mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px] text-foreground drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]">
              Broadcast Job
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              Notify crews about this open job.
            </div>
          </SheetHeader>

          <div className="space-y-4">
            <div className="flex gap-[6px] bg-background p-[6px] rounded-[14px] border border-border">
              {["all", "trade", "crews"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m as any)}
                  className={`flex-1 rounded-[10px] py-[8px] text-[13px] font-display font-bold capitalize transition-all ${
                    mode === m ? "bg-[var(--gold-light)] text-primary-foreground shadow-[0_0_10px_rgba(180,255,68,0.3)]" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {mode === "trade" && (
              <div className="bg-background border border-border rounded-[14px] p-[12px] shadow-sm">
                <div className="text-[13px] font-semibold mb-[8px] text-foreground">Select Trade</div>
                <div className="flex flex-wrap gap-[6px]">
                  {trades.length === 0 && <span className="text-[13px] text-muted-foreground">No trades found in crews.</span>}
                  {trades.map(t => (
                    <button
                      key={t}
                      onClick={() => setSelectedTrade(t)}
                      className={`px-[12px] py-[6px] rounded-[8px] text-[13px] font-medium border transition-colors ${selectedTrade === t ? "bg-[var(--gold-light)] text-primary-foreground border-primary shadow-[0_0_8px_rgba(180,255,68,0.2)]" : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === "crews" && (
              <div className="bg-background border border-border rounded-[14px] p-[12px] shadow-sm max-h-[200px] overflow-y-auto">
                <div className="text-[13px] font-semibold mb-[8px] text-foreground">Select Crews</div>
                <div className="flex flex-col gap-[6px]">
                  {crews?.map(c => (
                    <label key={c.id} className="flex items-center gap-[10px] p-[6px] hover:bg-muted/30 rounded-md cursor-pointer transition-colors group">
                      <input
                        type="checkbox"
                        checked={selectedCrews.includes(c.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedCrews([...selectedCrews, c.id]);
                          else setSelectedCrews(selectedCrews.filter(id => id !== c.id));
                        }}
                        className="rounded-[4px] border-border text-primary focus:ring-primary focus:ring-offset-background bg-background"
                      />
                      <span className="text-[14px] font-medium text-foreground group-hover:text-primary transition-colors">{c.name}</span>
                      {c.trade && <span className="text-[12px] text-muted-foreground ml-auto">{c.trade}</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-background border border-border rounded-[14px] p-[12px] shadow-sm space-y-[12px]">
              <div>
                <div className="text-[13px] font-semibold mb-[8px] text-foreground">Schedule Type</div>
                <div className="flex gap-[8px]">
                  <button
                    type="button"
                    onClick={() => setScheduleType("scheduled")}
                    className={`flex-1 rounded-[10px] border p-[10px] text-left transition-colors ${scheduleType === "scheduled" ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    <div className="text-[13px] font-display font-bold text-foreground">Set Schedule</div>
                    <div className="text-[11px] text-muted-foreground mt-[2px]">Crew commits to set days & hours</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleType("flex")}
                    className={`flex-1 rounded-[10px] border p-[10px] text-left transition-colors ${scheduleType === "flex" ? "border-emerald-400 bg-emerald-400/10" : "border-border"}`}
                  >
                    <div className="text-[13px] font-display font-bold text-foreground">Flex</div>
                    <div className="text-[11px] text-muted-foreground mt-[2px]">Work anytime within a timeframe</div>
                  </button>
                </div>
              </div>
              <div className="flex gap-[10px]">
                {scheduleType === "flex" && (
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold mb-[6px] text-foreground">Finish within (days)</div>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={flexDays}
                      onChange={(e) => setFlexDays(e.target.value)}
                      className="w-full rounded-[10px] border border-border bg-card px-[12px] py-[9px] text-[14px] text-foreground"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <div className="text-[13px] font-semibold mb-[6px] text-foreground">Crews needed</div>
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={crewsNeeded}
                    onChange={(e) => setCrewsNeeded(e.target.value)}
                    className="w-full rounded-[10px] border border-border bg-card px-[12px] py-[9px] text-[14px] text-foreground"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleSend}
              disabled={broadcast.isPending || (mode === "trade" && !selectedTrade) || (mode === "crews" && selectedCrews.length === 0)}
              className="w-full rounded-[13px] py-[12px] text-[15px] font-display font-bold text-primary-foreground bg-[var(--gold-light)] shadow-[0_0_15px_rgba(180,255,68,0.3)] disabled:opacity-50 disabled:shadow-none transition-all active:scale-[0.98] mt-[10px] hover:brightness-110"
            >
              {broadcast.isPending ? "Sending..." : "Send Broadcast"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}


function EditPostingSheet({
  open,
  onOpenChange,
  job,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobBoardCard["job"] | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateSettings = useUpdateBoardSettings();

  const [scheduleType, setScheduleType] = useState<"scheduled" | "flex">("scheduled");
  const [flexDays, setFlexDays] = useState("7");
  const [crewsNeeded, setCrewsNeeded] = useState("1");

  useEffect(() => {
    if (open && job) {
      setScheduleType(job.scheduleType === "flex" ? "flex" : "scheduled");
      setCrewsNeeded(String(job.crewsNeeded ?? 1));
      if (job.flexDueBy) {
        const due = new Date(job.flexDueBy + "T00:00:00");
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        setFlexDays(String(Math.max(1, Math.round((due.getTime() - today.getTime()) / 86400000))));
      } else {
        setFlexDays("7");
      }
    }
  }, [open, job]);

  const handleSave = () => {
    if (!job) return;
    updateSettings.mutate(
      {
        id: job.id,
        data: {
          scheduleType,
          ...(scheduleType === "flex" ? { flexDays: Math.max(1, parseInt(flexDays) || 7) } : {}),
          crewsNeeded: Math.max(1, parseInt(crewsNeeded) || 1),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          toast({ title: "Posting Updated", description: "Crews will see the new terms in their portals." });
          onOpenChange(false);
        },
        onError: (err: any) => {
          toast({
            title: "Couldn't update posting",
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
        className="rounded-t-[26px] bg-card p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-10px_40px_rgba(0,0,0,0.8)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-border mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px] text-foreground drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]">
              Edit Posting
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              Change the schedule type or crew slots{job ? ` for ${job.jobNo}` : ""}.
            </div>
          </SheetHeader>

          <div className="space-y-[16px]">
            <div>
              <div className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-primary mb-[8px]">Schedule Type</div>
              <div className="flex gap-[8px]">
                <button
                  type="button"
                  onClick={() => setScheduleType("scheduled")}
                  className={`flex-1 rounded-[10px] border p-[10px] text-left transition-colors ${scheduleType === "scheduled" ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <div className="text-[13px] font-display font-bold text-foreground">Set Schedule</div>
                  <div className="text-[11px] text-muted-foreground mt-[2px]">Set days & hours</div>
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleType("flex")}
                  className={`flex-1 rounded-[10px] border p-[10px] text-left transition-colors ${scheduleType === "flex" ? "border-emerald-400 bg-emerald-400/10" : "border-border"}`}
                >
                  <div className="text-[13px] font-display font-bold text-foreground">Flex</div>
                  <div className="text-[11px] text-muted-foreground mt-[2px]">Anytime within timeframe</div>
                </button>
              </div>
            </div>

            <div className="flex gap-[10px]">
              {scheduleType === "flex" && (
                <div className="flex-1">
                  <div className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-primary mb-[6px]">Finish within (days)</div>
                  <input
                    type="number"
                    min={1}
                    value={flexDays}
                    onChange={(e) => setFlexDays(e.target.value)}
                    className="w-full rounded-[10px] bg-background border border-border px-[12px] py-[10px] text-[14px] text-foreground"
                  />
                </div>
              )}
              <div className="flex-1">
                <div className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-primary mb-[6px]">Crews needed</div>
                <input
                  type="number"
                  min={Math.max(1, job?.crewsFilled ?? 0)}
                  value={crewsNeeded}
                  onChange={(e) => setCrewsNeeded(e.target.value)}
                  className="w-full rounded-[10px] bg-background border border-border px-[12px] py-[10px] text-[14px] text-foreground"
                />
              </div>
            </div>

            {(job?.crewsFilled ?? 0) > 0 && (
              <div className="text-[12px] text-muted-foreground">
                {job?.crewsFilled} crew{(job?.crewsFilled ?? 0) > 1 ? "s have" : " has"} already accepted — slots can't go below that.
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={updateSettings.isPending}
              className="w-full rounded-[13px] py-[13px] text-[14.5px] font-display font-bold text-primary-foreground bg-[var(--gold-light)] shadow-[0_0_15px_rgba(180,255,68,0.3)] transition-all active:scale-[0.98] hover:brightness-110 disabled:opacity-60"
            >
              {updateSettings.isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function JobCard({ data, onBroadcast, onReopen, onEdit, onEditPosting, onDelete }: { data: JobBoardCard; onBroadcast: () => void; onReopen: () => void; onEdit: () => void; onEditPosting: () => void; onDelete: () => void }) {
  const { job, priceItems, photos, broadcasts } = data;
  const status = job.boardStatus || "active";
  const stConfig = boardStatusColors[status] || boardStatusColors.active;

  return (
    <div className="bg-card rounded-[20px] shadow-[0_0_20px_rgba(0,0,0,0.5)] border border-border overflow-hidden mb-[16px] transition-all hover:border-primary/30 group">
      <div className="p-[16px] border-b border-border">
        <div className="flex items-start justify-between mb-[8px]">
          <div>
            <Link href={`/jobs/${job.id}`}>
              <div className="font-display font-bold text-[18px] leading-[1.2] text-foreground active:opacity-70 transition-opacity group-hover:text-primary">
                {job.propertyName || "Unknown Property"} {job.unitNo ? `· ${job.unitNo}` : ""}
              </div>
            </Link>
            <div className="flex items-center gap-[8px] mt-[4px]">
              <span className="font-mono text-[12px] text-muted-foreground">{job.jobNo}</span>
              {job.category && (
                <span className="text-[11.5px] font-medium text-foreground bg-muted px-[6px] py-[2px] rounded-[6px] border border-border">
                  {job.category}
                </span>
              )}
            </div>
          </div>
          <div
            className="text-[11px] font-bold uppercase tracking-[0.06em] px-[8px] py-[4px] rounded-full shrink-0"
            style={{ backgroundColor: stConfig.bg, color: stConfig.text, boxShadow: `0 0 10px ${stConfig.bg}` }}
          >
            {stConfig.label}
          </div>
        </div>

        {job.description && (
          <div className="text-[13.5px] text-foreground/80 mt-[10px] leading-snug line-clamp-3">
            {job.description}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-[6px] mt-[10px]">
          {job.scheduleType === "flex" ? (
            <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] px-[8px] py-[3px] rounded-full border border-emerald-400/40 bg-emerald-400/10 text-emerald-400">
              Flex{job.flexDueBy ? ` · due ${new Date(job.flexDueBy + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
            </span>
          ) : (
            <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] px-[8px] py-[3px] rounded-full border border-primary/40 bg-primary/10 text-primary">
              Set Schedule
            </span>
          )}
          <span className={`text-[10.5px] font-bold uppercase tracking-[0.05em] px-[8px] py-[3px] rounded-full border ${
            (job.crewsFilled ?? 0) >= (job.crewsNeeded ?? 1)
              ? "border-[rgba(60,122,78,0.4)] bg-[rgba(60,122,78,0.15)] text-[#4ade80]"
              : "border-border bg-muted text-muted-foreground"
          }`}>
            {job.crewsFilled ?? 0} of {job.crewsNeeded ?? 1} crew{(job.crewsNeeded ?? 1) > 1 ? "s" : ""} filled
          </span>
          {status !== "completed" && (
            <button
              onClick={onEditPosting}
              className="text-[10.5px] font-bold uppercase tracking-[0.05em] px-[8px] py-[3px] rounded-full border border-border text-muted-foreground active:scale-[0.97] transition-all inline-flex items-center gap-[4px]"
            >
              <Pencil className="w-[11px] h-[11px]" /> Edit Posting
            </button>
          )}
        </div>

        <div className="flex items-center gap-[14px] mt-[12px] text-[12.5px] text-muted-foreground">
          {job.scheduledOn && (
            <div className="flex items-center gap-[4px]">
              <Calendar className="w-[14px] h-[14px] text-primary" />
              <span className="text-foreground">{new Date(job.scheduledOn).toLocaleDateString()}</span>
            </div>
          )}
          {job.crewLeaderName && (
            <div className="flex items-center gap-[4px]">
              <MapPin className="w-[14px] h-[14px] text-primary" />
              <span className="text-foreground">{job.crewLeaderName}</span>
            </div>
          )}
        </div>
      </div>

      {priceItems.length > 0 && (
        <div className="bg-background p-[12px_16px] border-b border-border">
          <div className="text-[11px] font-display font-bold uppercase tracking-[0.08em] text-primary mb-[8px]">Price List</div>
          <div className="space-y-[6px]">
            {priceItems.map(p => (
              <div key={p.id} className="flex items-start justify-between text-[13px]">
                <div className="pr-[10px]">
                  <span className="font-medium text-foreground">{p.service}</span>
                  {p.detail && <span className="text-muted-foreground block text-[11.5px] mt-[1px]">{p.detail}</span>}
                </div>
                <div className="font-display font-semibold tabular-nums shrink-0 text-foreground">
                  ${p.rate} {p.unit && <span className="text-muted-foreground font-sans text-[11.5px] font-normal">/ {p.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {photos.length > 0 && (
        <div className="p-[12px_16px] border-b border-border flex gap-[8px] overflow-x-auto bg-background/50">
          {photos.map(p => (
            <div key={p.storagePath} className="w-[60px] h-[60px] rounded-[10px] bg-muted shrink-0 overflow-hidden relative border border-border group-hover:border-primary/50 transition-colors">
              <img src={`/api/storage${p.storagePath}`} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {broadcasts.length > 0 && (
        <div className="p-[12px_16px] border-b border-border bg-background/30">
          <div className="text-[11px] font-display font-bold uppercase tracking-[0.08em] text-primary mb-[8px]">Broadcasts</div>
          <div className="flex flex-col gap-[6px]">
            {broadcasts.map(b => {
              const bConf = broadcastStatusConfig[b.status] || broadcastStatusConfig.pending;
              const Icon = bConf.icon;
              return (
                <div key={b.id} className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-[6px]">
                    <Icon className="w-[14px] h-[14px]" style={{ color: bConf.color }} />
                    <span className="font-medium text-foreground">{b.crewName}</span>
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

      <div className="p-[12px_16px] flex gap-[8px] bg-card">
        {status === "active" || status === "reopened" ? (
          <button
            onClick={onBroadcast}
            className="flex-1 rounded-[11px] py-[10px] text-[13px] font-display font-bold text-primary-foreground bg-[var(--gold-light)] shadow-[0_0_15px_rgba(180,255,68,0.3)] transition-all active:scale-[0.98] hover:brightness-110 flex items-center justify-center gap-[6px]"
          >
            <Megaphone className="w-[15px] h-[15px]" /> Broadcast
          </button>
        ) : null}

        {status === "filled" ? (
          <button
            onClick={onReopen}
            className="flex-1 rounded-[11px] py-[10px] text-[13px] font-display font-bold text-primary bg-background border border-primary/40 shadow-[0_0_10px_rgba(180,255,68,0.1)] transition-all active:scale-[0.98] hover:bg-primary/10 flex items-center justify-center gap-[6px]"
          >
            <RefreshCw className="w-[15px] h-[15px]" /> Reopen Job
          </button>
        ) : null}

        <button
          onClick={onEdit}
          aria-label="Edit job"
          className="rounded-[11px] px-[14px] py-[10px] text-[13px] font-display font-bold text-foreground bg-background border border-border transition-colors active:scale-[0.98] flex items-center justify-center gap-[6px] hover:bg-muted hover:text-foreground"
        >
          <Pencil className="w-[15px] h-[15px]" /> Edit
        </button>

        <button
          onClick={onDelete}
          aria-label="Delete posting"
          className="rounded-[11px] px-[14px] py-[10px] text-[13px] font-display font-bold text-destructive bg-destructive/10 border border-destructive/20 transition-colors active:scale-[0.98] flex items-center justify-center gap-[6px] hover:bg-destructive/20"
        >
          <Trash2 className="w-[15px] h-[15px]" /> Delete
        </button>
      </div>
    </div>
  );
}

export default function JobBoard() {
  const { data: boardData, isLoading } = useListJobBoard({
    query: { queryKey: getListJobBoardQueryKey(), refetchInterval: 5000 },
  });
  const reopen = useReopenJob();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [broadcastJobId, setBroadcastJobId] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<JobBoardCard["job"] | null>(null);
  const [postingJob, setPostingJob] = useState<JobBoardCard["job"] | null>(null);
  const [filter, setFilter] = useState<"active" | "filled" | "completed">("active");
  const unlist = useUnlistJob();

  const handleDelete = (jobId: string, jobNo: string) => {
    if (!window.confirm(`Remove job ${jobNo} from the board? Crews will no longer see it in their portals. The job itself is not deleted.`)) return;
    unlist.mutate(
      { id: jobId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          toast({ title: "Posting Removed", description: `Job ${jobNo} is off the board and crew portals.` });
        },
        onError: (err: any) => {
          toast({ title: "Could not remove posting", description: err?.data?.error ?? "Something went wrong", variant: "destructive" });
        }
      }
    );
  };

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
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300 pb-[80px] px-2 flex flex-col min-h-screen">
      <div className="flex-1 w-full">
        <div className="font-display font-bold text-[26px] tracking-[-0.015em] leading-[1.1] mb-[2px] text-foreground drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]">Job Board</div>
        <div className="text-[13px] text-muted-foreground mb-[14px]">Dispatch and fill open jobs.</div>

        <div className="flex gap-[4px] bg-background border border-border rounded-[13px] p-[4px] shadow-sm mb-[16px]">
          {[
            { key: "active", label: "Open" },
            { key: "filled", label: "Filled" },
            { key: "completed", label: "Done" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key as any)}
              className={`flex-1 rounded-[10px] py-[8px] text-[13px] font-display font-bold transition-all ${
                filter === t.key ? "bg-[var(--gold-light)] text-primary-foreground shadow-[0_0_10px_rgba(180,255,68,0.3)]" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {isLoading ? (
           <div className="animate-pulse space-y-4">
             <div className="h-[200px] bg-card rounded-[20px] border border-border" />
             <div className="h-[200px] bg-card rounded-[20px] border border-border" />
           </div>
        ) : filteredData.length === 0 ? (
          <div className="text-center text-[13px] text-muted-foreground py-[60px] bg-card rounded-[20px] border border-border shadow-[0_0_15px_rgba(0,0,0,0.3)]">
            <div className="w-[48px] h-[48px] mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-[12px] border border-primary/20 shadow-[0_0_10px_rgba(180,255,68,0.1)]">
              <ClipboardList className="w-[20px] h-[20px] text-primary" />
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
                onEdit={() => setEditJob(d.job)}
                onEditPosting={() => setPostingJob(d.job)}
                onDelete={() => handleDelete(d.job.id, d.job.jobNo)}
              />
            ))}
          </div>
        )}

        <BroadcastSheet
          open={!!broadcastJobId}
          onOpenChange={(o) => !o && setBroadcastJobId(null)}
          jobId={broadcastJobId}
        />

        <EditPostingSheet
          open={!!postingJob}
          onOpenChange={(o) => !o && setPostingJob(null)}
          job={postingJob}
        />

        {editJob && (
          <EditJobSheet
            open={!!editJob}
            onOpenChange={(o) => !o && setEditJob(null)}
            job={editJob}
          />
        )}
      </div>

      <div className="pt-8 pb-4">
        <FalkonBadge />
      </div>
    </div>
  );
}
