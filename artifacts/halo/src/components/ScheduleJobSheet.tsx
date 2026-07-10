import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import {
  useListCrews,
  useScheduleJob,
  getGetJobQueryKey,
  getListJobsQueryKey,
  getGetTodayQueryKey,
  getGetCalendarQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatYmd(ymd: string) {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d).toLocaleDateString();
}

const HOURS = Array.from({ length: 24 }, (_, h) => `${pad(h)}:00`);

export function ScheduleJobSheet({
  open,
  onOpenChange,
  jobId,
  jobLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobLabel: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: crews } = useListCrews();
  const schedule = useScheduleJob();

  const [scheduledOn, setScheduledOn] = useState("");
  const [windowStart, setWindowStart] = useState("08:00");
  const [crewLeaderId, setCrewLeaderId] = useState("");

  useEffect(() => {
    if (open) {
      setScheduledOn(localToday());
      setWindowStart("08:00");
      setCrewLeaderId("");
    }
  }, [open]);

  const leaders = (crews ?? []).filter((c) => c.isLeader !== false);

  const submit = () => {
    if (!scheduledOn) return;
    schedule.mutate(
      {
        id: jobId,
        data: {
          scheduledOn,
          windowStart: windowStart || undefined,
          crewLeaderId: crewLeaderId || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
          toast({
            title: "Job scheduled",
            description: `${jobLabel} set for ${formatYmd(scheduledOn)}.`,
          });
          onOpenChange(false);
        },
        onError: (e) =>
          toast({
            title: "Couldn't schedule job",
            description: e.message,
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[22px] px-[18px] pb-[26px]">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-[20px] tracking-[-0.01em]">
            Schedule job
          </SheetTitle>
        </SheetHeader>

        <div className="mt-[16px] space-y-[14px]">
          <div>
            <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground mb-[4px] ml-[2px]">
              Date
            </div>
            <input
              type="date"
              className={fieldCls}
              value={scheduledOn}
              onChange={(e) => setScheduledOn(e.target.value)}
            />
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground mb-[4px] ml-[2px]">
              Start time
            </div>
            <select
              className={fieldCls}
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground mb-[4px] ml-[2px]">
              Crew leader
            </div>
            <select
              className={fieldCls}
              value={crewLeaderId}
              onChange={(e) => setCrewLeaderId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {leaders.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.trade ? ` · ${c.trade}` : ""}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={submit}
            disabled={schedule.isPending || !scheduledOn}
            className="w-full mt-[4px] flex items-center justify-center gap-[8px] rounded-[13px] py-[12px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] disabled:opacity-50 transition-transform active:scale-[0.98]"
          >
            <CalendarDays className="w-[17px] h-[17px]" />
            {schedule.isPending ? "Scheduling…" : "Schedule job"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
