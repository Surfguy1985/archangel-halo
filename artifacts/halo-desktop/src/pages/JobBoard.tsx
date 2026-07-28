import { useState, useEffect } from "react";
import { 
  useListJobBoard, 
  getListJobBoardQueryKey, 
  useBroadcastJob, 
  useReopenJob, 
  useUnlistJob,
  useUpdateJob,
  useUpdateBoardSettings,
  useListCrews,
  getListCrewsQueryKey,
  type JobBoardCard,
  type Crew
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { 
  ClipboardList, 
  MapPin, 
  Calendar as CalendarIcon, 
  DollarSign, 
  Send, 
  RotateCcw, 
  CheckCircle2,
  Image as ImageIcon,
  Clock,
  Pencil,
  Trash2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function JobBoard() {
  const { data: jobBoard, isLoading } = useListJobBoard({
    query: { queryKey: getListJobBoardQueryKey(), refetchInterval: 5000 },
  });
  const [filter, setFilter] = useState<string>("active");

  const filteredJobs = jobBoard?.filter(card => {
    if (filter === "all") return true;
    return card.job.boardStatus === filter;
  }) || [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 min-h-[100dvh] flex flex-col bg-[var(--background)]">
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground tracking-tight uppercase">Job Board</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">Available jobs and broadcast status</p>
        </div>
        
        <div className="flex gap-2">
          {["active", "filled", "reopened", "completed", "all"].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-full transition-colors ${
                filter === status 
                  ? "bg-[var(--secondary)] text-white shadow-sm" 
                  : "bg-white border border-border text-muted-foreground hover:border-[var(--secondary)] hover:text-[var(--secondary)]"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 pb-12">
        {isLoading ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Skeleton className="h-[400px] rounded-none bg-muted" />
            <Skeleton className="h-[400px] rounded-none bg-muted" />
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border border-dashed border-border text-muted-foreground bg-card">
            <ClipboardList className="w-12 h-12 mb-4 text-border" />
            <p className="font-medium text-lg text-[var(--secondary)]">No jobs found</p>
            <p className="text-sm">There are no jobs matching the current filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {filteredJobs.map((card) => (
              <JobBoardItem key={card.job.id} card={card} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobBoardItem({ card }: { card: JobBoardCard }) {
  const { job, priceItems, photos, broadcasts } = card;
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [postingOpen, setPostingOpen] = useState(false);
  
  const statusColors: Record<string, string> = {
    active: "bg-blue-100 text-blue-800",
    filled: "bg-emerald-100 text-emerald-800",
    reopened: "bg-orange-100 text-orange-800",
    completed: "bg-gray-100 text-gray-600",
  };

  const boardStatus = job.boardStatus || "active";
  const badgeColor = statusColors[boardStatus] || statusColors.active;

  return (
    <Card className="flex flex-col border border-border shadow-sm rounded-none bg-white">
      <div className="p-5 border-b border-border bg-[var(--background)]">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-muted-foreground">{job.jobNo}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${badgeColor}`}>
                {boardStatus}
              </span>
            </div>
            <h3 className="font-display font-bold text-xl text-[var(--secondary)] flex items-center gap-2">
              {job.propertyName || "Unknown Property"}
              {job.unitNo && <span className="text-muted-foreground font-normal">#{job.unitNo}</span>}
            </h3>
          </div>
          {job.marginPct !== null && job.marginPct !== undefined && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Margin</div>
              <div className="font-mono font-bold text-[var(--secondary)]">{job.marginPct}%</div>
            </div>
          )}
        </div>
        
        <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
          {job.category && (
            <div className="flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4" />
              <span>{job.category}</span>
            </div>
          )}
          {job.scheduledOn && (
            <div className="flex items-center gap-1.5">
              <CalendarIcon className="w-4 h-4" />
              <span>Needed: <span className="font-medium text-[var(--secondary)]">{format(new Date(job.scheduledOn + "T00:00:00"), "MMM d, yyyy")}</span></span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {job.scheduleType === "flex" ? (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Flex{job.flexDueBy ? ` · due ${format(new Date(job.flexDueBy + "T00:00:00"), "MMM d")}` : ""}
            </span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--primary)] text-[var(--secondary)] border border-[var(--secondary)]/20">
              Set Schedule
            </span>
          )}
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
            (job.crewsFilled ?? 0) >= (job.crewsNeeded ?? 1)
              ? "bg-emerald-100 text-emerald-800 border-emerald-200"
              : "bg-gray-100 text-gray-600 border-gray-200"
          }`}>
            {job.crewsFilled ?? 0} of {job.crewsNeeded ?? 1} crew{(job.crewsNeeded ?? 1) > 1 ? "s" : ""} filled
          </span>
          {boardStatus !== "completed" && (
            <button
              onClick={() => setPostingOpen(true)}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:text-[var(--secondary)] hover:border-[var(--secondary)] transition-colors inline-flex items-center gap-1"
            >
              <Pencil className="w-3 h-3" /> Edit Posting
            </button>
          )}
        </div>
      </div>

      <CardContent className="p-0 flex-1 flex flex-col">
        <div className="p-5 flex-1 flex flex-col gap-6">
          {job.description && (
            <div>
              <h4 className="text-xs font-bold text-[var(--secondary)] uppercase tracking-wider mb-2">Scope of Work</h4>
              <p className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">{job.description}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {priceItems.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-[var(--secondary)] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" /> Price List
                </h4>
                <div className="space-y-2">
                  {priceItems.map(item => (
                    <div key={item.id} className="flex justify-between items-center text-sm p-2 bg-[var(--background)] border border-border rounded-none">
                      <span className="font-medium text-[var(--secondary)] truncate pr-2">{item.service}</span>
                      <span className="font-mono font-medium">${item.rate} {item.unit ? `/${item.unit}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {broadcasts.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-[var(--secondary)] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Send className="w-3.5 h-3.5" /> Broadcasts
                </h4>
                <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                  {broadcasts.map(b => (
                    <div key={b.id} className="flex justify-between items-center text-sm p-2 bg-white border border-border rounded-none">
                      <div className="truncate pr-2">
                        <span className="font-medium text-[var(--secondary)] block truncate">{b.crewName}</span>
                        {b.respondedAt && <span className="text-[10px] text-muted-foreground block">{format(new Date(b.respondedAt), "MMM d, h:mm a")}</span>}
                      </div>
                      <Badge variant="outline" className={`
                        capitalize text-[10px] px-1.5 py-0 rounded-none border-none
                        ${b.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 
                          b.status === 'declined' || b.status === 'withdrawn' ? 'bg-red-100 text-red-800' : 
                          'bg-[var(--primary)] text-[var(--secondary)]'}
                      `}>
                        {b.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {photos.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-[var(--secondary)] uppercase tracking-wider mb-2 flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5" /> Photos
              </h4>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {photos.map(photo => (
                  <div key={photo.storagePath} className="relative w-20 h-20 rounded-none overflow-hidden border border-border shrink-0 bg-muted">
                    <img 
                      src={`/api/storage${photo.storagePath}`} 
                      alt="Job Photo" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-[var(--background)] border-t border-border flex justify-end gap-3 shrink-0">
          <Button
            variant="outline"
            onClick={() => setEditOpen(true)}
            className="text-[var(--secondary)] rounded-none border-border"
          >
            <Pencil className="w-4 h-4 mr-2" /> Edit
          </Button>
          <Button
            variant="outline"
            onClick={() => setDeleteConfirmOpen(true)}
            className="text-destructive border-destructive hover:bg-destructive hover:text-white rounded-none"
          >
            <Trash2 className="w-4 h-4 mr-2" /> Delete
          </Button>
          {(boardStatus === 'active' || boardStatus === 'reopened') && (
            <Button onClick={() => setBroadcastOpen(true)} className="bg-[var(--primary)] hover:opacity-90 text-[var(--secondary)] rounded-none font-bold">
              <Send className="w-4 h-4 mr-2" /> Broadcast Job
            </Button>
          )}
          {boardStatus === 'filled' && (
            <Button variant="outline" onClick={() => setReopenConfirmOpen(true)} className="text-orange-600 border-orange-600 hover:bg-orange-600 hover:text-white rounded-none">
              <RotateCcw className="w-4 h-4 mr-2" /> Reopen Job
            </Button>
          )}
          {boardStatus === 'completed' && (
             <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium px-2">
               <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Completed
             </div>
          )}
        </div>
      </CardContent>

      <BroadcastDialog open={broadcastOpen} onOpenChange={setBroadcastOpen} job={job} />
      <ReopenConfirmDialog open={reopenConfirmOpen} onOpenChange={setReopenConfirmOpen} job={job} />
      <DeleteConfirmDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen} job={job} />
      <EditJobDialog open={editOpen} onOpenChange={setEditOpen} job={job} />
      <EditPostingDialog open={postingOpen} onOpenChange={setPostingOpen} job={job} />
    </Card>
  );
}

function BroadcastDialog({ open, onOpenChange, job }: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job'] }) {
  const [mode, setMode] = useState<"all" | "trade" | "crews">("all");
  const [selectedTrade, setSelectedTrade] = useState<string>("");
  const [selectedCrews, setSelectedCrews] = useState<string[]>([]);
  const [scheduleType, setScheduleType] = useState<"scheduled" | "flex">("scheduled");
  const [flexDays, setFlexDays] = useState("7");
  const [crewsNeeded, setCrewsNeeded] = useState("1");
  const { data: crews } = useListCrews({ query: { enabled: open, queryKey: getListCrewsQueryKey() } });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const broadcastJob = useBroadcastJob();

  const distinctTrades = Array.from(new Set(crews?.map(c => c.trade).filter(Boolean) as string[]));

  const handleBroadcast = () => {
    broadcastJob.mutate({
      id: job.id,
      data: {
        mode,
        trade: mode === 'trade' ? selectedTrade : undefined,
        crewIds: mode === 'crews' ? selectedCrews : undefined,
        scheduleType,
        flexDays: scheduleType === 'flex' ? Math.max(1, parseInt(flexDays) || 7) : undefined,
        crewsNeeded: Math.max(1, parseInt(crewsNeeded) || 1),
      }
    }, {
      onSuccess: (result) => {
        toast({
          title: "Job Broadcasted",
          description: `Sent to ${result.sent} crews. ${result.alreadySent > 0 ? `(${result.alreadySent} already sent)` : ''}`,
        });
        queryClient.invalidateQueries();
        onOpenChange(false);
      },
      onError: (err) => {
        toast({
          title: "Broadcast failed",
          description: (err as any)?.data?.error ?? "Something went wrong",
          variant: "destructive"
        });
      }
    });
  };

  const toggleCrew = (id: string) => {
    setSelectedCrews(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Broadcast Job</DialogTitle>
          <DialogDescription>
            Send {job.jobNo} at {job.propertyName} to crews.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="all" id="r-all" />
              <Label htmlFor="r-all">All Crews</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="trade" id="r-trade" />
              <Label htmlFor="r-trade">Specific Trade</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="crews" id="r-crews" />
              <Label htmlFor="r-crews">Select Crews</Label>
            </div>
          </RadioGroup>

          {mode === 'trade' && (
            <div className="pl-6 animate-in fade-in slide-in-from-top-2">
              <Select value={selectedTrade} onValueChange={setSelectedTrade}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a trade" />
                </SelectTrigger>
                <SelectContent>
                  {distinctTrades.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="border-t border-border pt-4 space-y-4">
            <div className="space-y-2">
              <Label>Schedule Type</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleType("scheduled")}
                  className={`flex-1 rounded-md border px-3 py-2 text-left transition-colors ${scheduleType === "scheduled" ? "border-[var(--gold)] bg-[var(--gold-tint)]" : "border-border hover:bg-black/5"}`}
                >
                  <div className="text-sm font-semibold">Set Schedule</div>
                  <div className="text-xs text-muted-foreground">Crew commits to set days & hours</div>
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleType("flex")}
                  className={`flex-1 rounded-md border px-3 py-2 text-left transition-colors ${scheduleType === "flex" ? "border-emerald-400 bg-emerald-50" : "border-border hover:bg-black/5"}`}
                >
                  <div className="text-sm font-semibold">Flex</div>
                  <div className="text-xs text-muted-foreground">Work anytime within a timeframe</div>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {scheduleType === "flex" && (
                <div className="space-y-1.5">
                  <Label htmlFor="bc-flexdays">Finish within (days)</Label>
                  <Input id="bc-flexdays" type="number" min={1} value={flexDays} onChange={(e) => setFlexDays(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="bc-crews">Crews needed</Label>
                <Input id="bc-crews" type="number" min={1} value={crewsNeeded} onChange={(e) => setCrewsNeeded(e.target.value)} />
              </div>
            </div>
          </div>

          {mode === 'crews' && (
            <div className="pl-6 max-h-[200px] overflow-y-auto space-y-2 animate-in fade-in slide-in-from-top-2">
              {crews?.map(crew => (
                <label key={crew.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-black/5 cursor-pointer border border-transparent hover:border-border transition-colors">
                  <input 
                    type="checkbox" 
                    checked={selectedCrews.includes(crew.id)}
                    onChange={() => toggleCrew(crew.id)}
                    className="rounded border-border text-[var(--gold)] focus:ring-[var(--gold)]"
                  />
                  <div>
                    <div className="font-medium text-sm">{crew.name}</div>
                    <div className="text-xs text-muted-foreground">{crew.trade || 'General'}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button 
            onClick={handleBroadcast} 
            disabled={broadcastJob.isPending || (mode === 'trade' && !selectedTrade) || (mode === 'crews' && selectedCrews.length === 0)}
            className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
          >
            {broadcastJob.isPending ? "Sending..." : "Send Broadcast"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPostingDialog({ open, onOpenChange, job }: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job'] }) {
  const [scheduleType, setScheduleType] = useState<"scheduled" | "flex">(job.scheduleType === "flex" ? "flex" : "scheduled");
  const [flexDays, setFlexDays] = useState("7");
  const [crewsNeeded, setCrewsNeeded] = useState(String(job.crewsNeeded ?? 1));
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateSettings = useUpdateBoardSettings();

  useEffect(() => {
    if (open) {
      setScheduleType(job.scheduleType === "flex" ? "flex" : "scheduled");
      setCrewsNeeded(String(job.crewsNeeded ?? 1));
      if (job.flexDueBy) {
        const due = new Date(job.flexDueBy + "T00:00:00");
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const days = Math.round((due.getTime() - today.getTime()) / 86400000);
        setFlexDays(String(Math.max(1, days)));
      } else {
        setFlexDays("7");
      }
    }
  }, [open, job.scheduleType, job.crewsNeeded, job.flexDueBy]);

  const handleSave = () => {
    updateSettings.mutate({
      id: job.id,
      data: {
        scheduleType,
        flexDays: scheduleType === "flex" ? Math.max(1, parseInt(flexDays) || 7) : undefined,
        crewsNeeded: Math.max(1, parseInt(crewsNeeded) || 1),
      },
    }, {
      onSuccess: () => {
        toast({ title: "Posting updated", description: "Crews will see the new terms in their portals." });
        queryClient.invalidateQueries();
        onOpenChange(false);
      },
      onError: (err) => {
        toast({
          title: "Couldn't update posting",
          description: (err as any)?.data?.error ?? "Something went wrong",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Posting</DialogTitle>
          <DialogDescription>
            Change the schedule type or crew slots for {job.jobNo} at {job.propertyName}.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label>Schedule Type</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScheduleType("scheduled")}
                className={`flex-1 rounded-md border px-3 py-2 text-left transition-colors ${scheduleType === "scheduled" ? "border-[var(--gold)] bg-[var(--gold-tint)]" : "border-border hover:bg-black/5"}`}
              >
                <div className="text-sm font-semibold">Set Schedule</div>
                <div className="text-xs text-muted-foreground">Crew commits to set days & hours</div>
              </button>
              <button
                type="button"
                onClick={() => setScheduleType("flex")}
                className={`flex-1 rounded-md border px-3 py-2 text-left transition-colors ${scheduleType === "flex" ? "border-emerald-400 bg-emerald-50" : "border-border hover:bg-black/5"}`}
              >
                <div className="text-sm font-semibold">Flex</div>
                <div className="text-xs text-muted-foreground">Work anytime within a timeframe</div>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {scheduleType === "flex" && (
              <div className="space-y-1.5">
                <Label htmlFor="ep-flexdays">Finish within (days)</Label>
                <Input id="ep-flexdays" type="number" min={1} value={flexDays} onChange={(e) => setFlexDays(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ep-crews">Crews needed</Label>
              <Input id="ep-crews" type="number" min={Math.max(1, job.crewsFilled ?? 0)} value={crewsNeeded} onChange={(e) => setCrewsNeeded(e.target.value)} />
            </div>
          </div>
          {(job.crewsFilled ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              {job.crewsFilled} crew{(job.crewsFilled ?? 0) > 1 ? "s have" : " has"} already accepted — slots can't go below that.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={updateSettings.isPending}
            className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
          >
            {updateSettings.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const JOB_STATUSES = ["open", "scheduled", "in_progress", "blocked", "complete", "invoiced", "paid", "cancelled"];

function EditJobDialog({ open, onOpenChange, job }: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job'] }) {
  const updateJob = useUpdateJob();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState(job.category ?? "");
  const [description, setDescription] = useState(job.description ?? "");
  const [unitNo, setUnitNo] = useState(job.unitNo ?? "");
  const [woNo, setWoNo] = useState(job.woNo ?? "");
  const [status, setStatus] = useState(job.status);

  useEffect(() => {
    if (open) {
      setCategory(job.category ?? "");
      setDescription(job.description ?? "");
      setUnitNo(job.unitNo ?? "");
      setWoNo(job.woNo ?? "");
      setStatus(job.status);
    }
  }, [open, job]);

  const handleSave = () => {
    updateJob.mutate({
      id: job.id,
      data: {
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        unitNo: unitNo.trim() || undefined,
        woNo: woNo.trim() || undefined,
        status,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Job Updated", description: `${job.jobNo} was saved. Crews see the updated details.` });
        queryClient.invalidateQueries();
        onOpenChange(false);
      },
      onError: (err) => {
        toast({
          title: "Could not save",
          description: (err as any)?.data?.error ?? "Something went wrong",
          variant: "destructive"
        });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit Job</DialogTitle>
          <DialogDescription>
            Update {job.jobNo} at {job.propertyName}. Changes appear on the board and crew portals.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ej-category">Category</Label>
              <Input id="ej-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Cleaning" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ej-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="ej-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_STATUSES.map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ej-unit">Unit #</Label>
              <Input id="ej-unit" value={unitNo} onChange={(e) => setUnitNo(e.target.value)} placeholder="Unit" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ej-wo">WO #</Label>
              <Input id="ej-wo" value={woNo} onChange={(e) => setWoNo(e.target.value)} placeholder="Work order" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ej-desc">Scope of Work</Label>
            <Textarea id="ej-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the work..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={updateJob.isPending}
            className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
          >
            {updateJob.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirmDialog({ open, onOpenChange, job }: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job'] }) {
  const unlistJob = useUnlistJob();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleDelete = () => {
    unlistJob.mutate({ id: job.id }, {
      onSuccess: () => {
        toast({
          title: "Posting Removed",
          description: `${job.jobNo} is off the board and crew portals. The job itself still exists on the Jobs page.`,
        });
        queryClient.invalidateQueries();
        onOpenChange(false);
      },
      onError: (err) => {
        toast({
          title: "Could not remove posting",
          description: (err as any)?.data?.error ?? "Something went wrong",
          variant: "destructive"
        });
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Posting?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes {job.jobNo} from the job board and withdraws it from all crew portals. The job itself is not deleted — you can rebroadcast it later from the Jobs page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={(e) => { e.preventDefault(); handleDelete(); }}
            className="bg-destructive hover:bg-destructive/90 text-white"
            disabled={unlistJob.isPending}
          >
            {unlistJob.isPending ? "Removing..." : "Delete Posting"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReopenConfirmDialog({ open, onOpenChange, job }: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job'] }) {
  const reopenJob = useReopenJob();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleReopen = () => {
    reopenJob.mutate({ id: job.id }, {
      onSuccess: () => {
        toast({
          title: "Job Reopened",
          description: "The job is back on the board and removed from the schedule.",
        });
        queryClient.invalidateQueries();
        onOpenChange(false);
      },
      onError: (err) => {
        toast({
          title: "Could not reopen",
          description: (err as any)?.data?.error ?? "Something went wrong",
          variant: "destructive"
        });
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reopen Job?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove the current crew from {job.jobNo} and take it off the calendar. This action is destructive and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={(e) => { e.preventDefault(); handleReopen(); }}
            className="bg-[var(--orange)] hover:bg-[var(--orange)]/90 text-white"
            disabled={reopenJob.isPending}
          >
            {reopenJob.isPending ? "Reopening..." : "Reopen Job"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
