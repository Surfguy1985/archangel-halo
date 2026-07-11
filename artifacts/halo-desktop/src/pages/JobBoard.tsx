import { useState } from "react";
import { 
  useListJobBoard, 
  getListJobBoardQueryKey, 
  useBroadcastJob, 
  useReopenJob, 
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
  Clock
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function JobBoard() {
  const { data: jobBoard, isLoading } = useListJobBoard();
  const [filter, setFilter] = useState<string>("active");

  const filteredJobs = jobBoard?.filter(card => {
    if (filter === "all") return true;
    return card.job.boardStatus === filter;
  }) || [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 h-screen flex flex-col">
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Job Board</h1>
          <p className="text-muted-foreground">Available jobs and broadcast status</p>
        </div>
        
        <div className="flex bg-card p-1 rounded-lg border border-border shadow-sm">
          {["active", "filled", "reopened", "completed", "all"].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize transition-colors ${
                filter === status 
                  ? "bg-[var(--gold-tint)] text-[var(--gold-dark)] shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-12">
        {isLoading ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Skeleton className="h-[400px] rounded-xl" />
            <Skeleton className="h-[400px] rounded-xl" />
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border border-dashed border-border rounded-xl text-muted-foreground bg-card/50">
            <ClipboardList className="w-12 h-12 mb-4 text-border" />
            <p className="font-medium text-lg text-[var(--ink)]">No jobs found</p>
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
  
  const statusColors: Record<string, string> = {
    active: "bg-[var(--blue)]/10 text-[var(--blue)] border-[var(--blue)]/20",
    filled: "bg-[var(--green)]/10 text-[var(--green)] border-[var(--green)]/20",
    reopened: "bg-[var(--orange)]/10 text-[var(--orange)] border-[var(--orange)]/20",
    completed: "bg-black/5 text-muted-foreground border-border",
  };

  const boardStatus = job.boardStatus || "active";
  const badgeColor = statusColors[boardStatus] || statusColors.active;

  return (
    <Card className="overflow-hidden flex flex-col shadow-sm border-border hover:shadow-md transition-shadow h-full">
      <div className="p-5 border-b border-border bg-black/[0.02]">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-muted-foreground">{job.jobNo}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeColor}`}>
                {boardStatus}
              </span>
            </div>
            <h3 className="font-display font-bold text-xl text-[var(--ink)] flex items-center gap-2">
              {job.propertyName || "Unknown Property"}
              {job.unitNo && <span className="text-muted-foreground font-normal">#{job.unitNo}</span>}
            </h3>
          </div>
          {job.marginPct !== null && job.marginPct !== undefined && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Margin</div>
              <div className="font-mono font-bold text-[var(--gold-dark)]">{job.marginPct}%</div>
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
              <span>Needed: <span className="font-medium text-[var(--ink)]">{format(new Date(job.scheduledOn), "MMM d, yyyy")}</span></span>
            </div>
          )}
        </div>
      </div>

      <CardContent className="p-0 flex-1 flex flex-col">
        <div className="p-5 flex-1 flex flex-col gap-6">
          {job.description && (
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Scope of Work</h4>
              <p className="text-sm whitespace-pre-wrap text-[var(--ink)] leading-relaxed">{job.description}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {priceItems.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" /> Price List
                </h4>
                <div className="space-y-2">
                  {priceItems.map(item => (
                    <div key={item.id} className="flex justify-between items-center text-sm p-2 rounded-md bg-black/[0.02] border border-border">
                      <span className="font-medium text-[var(--ink)] truncate pr-2">{item.service}</span>
                      <span className="font-mono font-medium">${item.rate} {item.unit ? `/${item.unit}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {broadcasts.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Send className="w-3.5 h-3.5" /> Broadcasts
                </h4>
                <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                  {broadcasts.map(b => (
                    <div key={b.id} className="flex justify-between items-center text-sm p-2 rounded-md bg-card border border-border">
                      <div className="truncate pr-2">
                        <span className="font-medium text-[var(--ink)] block truncate">{b.crewName}</span>
                        {b.respondedAt && <span className="text-[10px] text-muted-foreground block">{format(new Date(b.respondedAt), "MMM d, h:mm a")}</span>}
                      </div>
                      <Badge variant="outline" className={`
                        capitalize text-[10px] px-1.5 py-0 rounded
                        ${b.status === 'approved' ? 'bg-[var(--green)]/10 text-[var(--green)] border-[var(--green)]/20' : 
                          b.status === 'declined' || b.status === 'withdrawn' ? 'bg-destructive/10 text-destructive border-destructive/20' : 
                          'bg-[var(--gold-tint)] text-[var(--gold-dark)] border-[var(--gold)]/20'}
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
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5" /> Photos
              </h4>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {photos.map(photo => (
                  <div key={photo.storagePath} className="relative w-20 h-20 rounded-md overflow-hidden border border-border shrink-0 bg-black/5">
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

        <div className="p-4 bg-card border-t border-border flex justify-end gap-3 shrink-0">
          {(boardStatus === 'active' || boardStatus === 'reopened') && (
            <Button onClick={() => setBroadcastOpen(true)} className="bg-[var(--gold)] hover:bg-[var(--gold-dark)] text-white">
              <Send className="w-4 h-4 mr-2" /> Broadcast Job
            </Button>
          )}
          {boardStatus === 'filled' && (
            <Button variant="outline" onClick={() => setReopenConfirmOpen(true)} className="text-[var(--orange)] border-[var(--orange)]/30 hover:bg-[var(--orange)]/10">
              <RotateCcw className="w-4 h-4 mr-2" /> Reopen Job
            </Button>
          )}
          {boardStatus === 'completed' && (
             <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium px-2">
               <CheckCircle2 className="w-4 h-4 text-[var(--green)]" /> Completed
             </div>
          )}
        </div>
      </CardContent>

      <BroadcastDialog open={broadcastOpen} onOpenChange={setBroadcastOpen} job={job} />
      <ReopenConfirmDialog open={reopenConfirmOpen} onOpenChange={setReopenConfirmOpen} job={job} />
    </Card>
  );
}

function BroadcastDialog({ open, onOpenChange, job }: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job'] }) {
  const [mode, setMode] = useState<"all" | "trade" | "crews">("all");
  const [selectedTrade, setSelectedTrade] = useState<string>("");
  const [selectedCrews, setSelectedCrews] = useState<string[]>([]);
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
        crewIds: mode === 'crews' ? selectedCrews : undefined
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
            className="bg-[var(--gold)] hover:bg-[var(--gold-dark)] text-white"
          >
            {broadcastJob.isPending ? "Sending..." : "Send Broadcast"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
