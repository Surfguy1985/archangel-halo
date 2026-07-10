import { useGetJob, getGetJobQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { ChevronLeft, Pencil } from "lucide-react";
import { useState } from "react";
import { EditJobSheet } from "@/components/EditJobSheet";

export default function JobDetail() {
  const params = useParams();
  const id = params.id as string;
  const [editOpen, setEditOpen] = useState(false);
  const { data, isLoading } = useGetJob(id, { query: { enabled: !!id, queryKey: getGetJobQueryKey(id) } });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 pt-4">
        <div className="h-8 bg-muted rounded w-1/3"></div>
        <div className="h-32 bg-card rounded-[16px]"></div>
      </div>
    );
  }

  if (!data) return <div className="p-4 text-center text-muted-foreground">Job not found</div>;

  const { job, activities, expenses, schedules } = data;

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <Link href={job.propertyId ? `/properties/${job.propertyId}` : "/properties"} className="flex items-center gap-[6px] text-muted-foreground text-[13.5px] font-semibold mb-[10px] w-fit">
        <ChevronLeft className="w-[16px] h-[16px]" /> Back
      </Link>
      
      <div className="flex items-start gap-[10px]">
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[26px] tracking-[-0.015em] leading-[1.1]">{job.category || 'General'}</div>
          <div className="text-[13px] text-muted-foreground mt-[3px] mb-[14px]">
            {job.propertyName} {job.unitNo ? `· Unit ${job.unitNo}` : ''}
          </div>
        </div>
        <button
          onClick={() => setEditOpen(true)}
          aria-label="Edit job"
          className="w-[36px] h-[36px] shrink-0 rounded-full grid place-items-center bg-card border border-border shadow-[var(--shadow)] text-muted-foreground transition-transform active:scale-[0.9]"
        >
          <Pencil className="w-[16px] h-[16px]" />
        </button>
      </div>

      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px_15px] mb-[18px]">
        <div className="flex justify-between items-start mb-[12px]">
          <div>
            <div className="text-[12px] text-muted-foreground uppercase tracking-[0.1em] font-semibold mb-[2px]">Status</div>
            <div className="font-semibold text-[15px] capitalize">{job.status.replace('_', ' ')}</div>
          </div>
          <div className="text-right">
            <div className="text-[12px] font-mono text-muted-foreground">{job.jobNo}</div>
            {job.woNo && <div className="text-[12px] font-mono text-muted-foreground">WO: {job.woNo}</div>}
          </div>
        </div>
        <div className="text-[14px] text-[var(--ink2)] leading-relaxed">
          {job.description}
        </div>
      </div>

      {schedules.length > 0 && (
        <div className="mb-[18px]">
          <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground mb-[8px] mx-[2px]">Schedule</div>
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
            {schedules.map((schedule, idx) => (
              <div key={schedule.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <div className="flex-1">
                  <div className="font-semibold">{new Date(schedule.scheduledOn).toLocaleDateString()}</div>
                  {schedule.windowStart && <div className="text-[12px] text-muted-foreground">{schedule.windowStart}</div>}
                </div>
                <div className="text-[12px] font-medium capitalize text-muted-foreground">
                  {schedule.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {expenses.length > 0 && (
        <div className="mb-[18px]">
          <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground mb-[8px] mx-[2px]">Expenses</div>
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
            {expenses.map((expense, idx) => (
              <div key={expense.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{expense.vendor || expense.category}</div>
                  <div className="text-[12px] text-muted-foreground truncate">{expense.source || 'Manual entry'}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-display font-semibold tabular-nums">${expense.amount.toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <EditJobSheet open={editOpen} onOpenChange={setEditOpen} job={job} />
    </div>
  );
}
