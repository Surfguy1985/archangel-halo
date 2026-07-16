import {
  useGetJob,
  getGetJobQueryKey,
  useDraftJobRecap,
  useCreateRecapShare,
  useGetProperty,
  getGetPropertyQueryKey,
  useUpdateJob,
  useUpdateProperty,
  useRestartJob,
  useClearJob,
  getGetTodayQueryKey,
  getListJobsQueryKey,
  getGetCalendarQueryKey,
} from "@workspace/api-client-react";
import { MarginSection } from "@/components/MarginSection";
import { CrewPhotosSection } from "@/components/CrewPhotosSection";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ChevronLeft, Pencil, Sparkles, Send, Check, CalendarDays, RotateCcw, Archive } from "lucide-react";
import { useState } from "react";
import { EditJobSheet } from "@/components/EditJobSheet";
import { ScheduleJobSheet } from "@/components/ScheduleJobSheet";

export default function JobDetail() {
  const params = useParams();
  const id = params.id as string;
  const [editOpen, setEditOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetJob(id, { query: { enabled: !!id, queryKey: getGetJobQueryKey(id) } });
  const [recapOpen, setRecapOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [recapBody, setRecapBody] = useState("");
  const draft = useDraftJobRecap();
  const createShare = useCreateRecapShare();
  const updateJob = useUpdateJob();
  const updateProperty = useUpdateProperty();
  const restartJob = useRestartJob();
  const clearJob = useClearJob();
  const propertyId = data?.job.propertyId ?? "";

  const invalidateJobLists = () => {
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
    if (propertyId) queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
  };
  const { data: propData } = useGetProperty(propertyId, {
    query: { enabled: !!propertyId, queryKey: getGetPropertyQueryKey(propertyId) },
  });

  const generateRecap = () => {
    setRecapOpen(true);
    draft.mutate(
      { id },
      {
        onSuccess: (d) => {
          setSubject(d.subject);
          setRecapBody(d.body);
        },
      },
    );
  };

  const send = () => {
    createShare.mutate(
      { id, data: { subject, body: recapBody } },
      {
        onSuccess: async (share) => {
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
          setRecapOpen(false);
          const url = `${window.location.origin}/recap/${share.token}`;
          const message = `${subject}\n\n${recapBody}\n\nFull recap with photos: ${url}`;
          try {
            await navigator.clipboard.writeText(url);
          } catch {
            // clipboard unavailable — the link is still in the message
          }
          window.location.href = `sms:?&body=${encodeURIComponent(message)}`;
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 pt-4">
        <div className="h-8 bg-muted rounded w-1/3"></div>
        <div className="h-32 bg-card rounded-[16px]"></div>
      </div>
    );
  }

  if (!data) return <div className="p-4 text-center text-muted-foreground">Job not found</div>;

  const { job, expenses, schedules, crewPhotos } = data;

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
            {job.status === "complete" ? (
              <span className="inline-flex items-center gap-[5px] text-[12px] font-display font-bold uppercase tracking-[0.08em] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-[10px] py-[4px]">
                <Check className="w-[12px] h-[12px]" /> Completed
              </span>
            ) : (
              <div className="font-semibold text-[15px] capitalize">{job.status.replace('_', ' ')}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[12px] font-mono text-muted-foreground">{job.jobNo}</div>
            {job.woNo && <div className="text-[12px] font-mono text-muted-foreground">WO: {job.woNo}</div>}
          </div>
        </div>
        <div className="text-[14px] text-[var(--ink2)] leading-relaxed">
          {job.description}
        </div>
        {job.status === "complete" && (
          <div className="flex items-center gap-[8px] mt-[12px] pt-[12px] border-t border-border">
            {!job.clearedAt && (
              <button
                disabled={clearJob.isPending}
                onClick={() => clearJob.mutate({ id }, { onSuccess: invalidateJobLists })}
                className="flex items-center gap-[5px] text-[12.5px] font-display font-bold px-[12px] py-[8px] rounded-full bg-[rgba(23,24,28,0.05)] text-muted-foreground active:scale-[0.95] disabled:opacity-50"
              >
                <Archive className="w-[13px] h-[13px]" /> Clear to history
              </button>
            )}
            {job.clearedAt && (
              <span className="text-[12px] text-muted-foreground">In job history</span>
            )}
            <button
              disabled={restartJob.isPending}
              onClick={() => restartJob.mutate({ id }, { onSuccess: invalidateJobLists })}
              className="ml-auto flex items-center gap-[5px] text-[12.5px] font-display font-bold px-[12px] py-[8px] rounded-full bg-[rgba(143,106,31,0.1)] text-[var(--gold-dark)] active:scale-[0.95] disabled:opacity-50"
            >
              <RotateCcw className="w-[13px] h-[13px]" /> Restart job
            </button>
          </div>
        )}
      </div>

      <MarginSection
        title="Job margin"
        currentPct={job.marginPct != null ? Math.round(job.marginPct * 1000) / 10 : null}
        minFrac={propData?.property.marginMin}
        targetFrac={propData?.property.marginTarget}
        currentEditable
        saving={updateJob.isPending || updateProperty.isPending}
        helperText="Thresholds come from the property. Below-minimum jobs get flagged in Today."
        onSave={({ minFrac, targetFrac, currentFrac }) => {
          updateJob.mutate(
            { id, data: { marginPct: currentFrac ?? null } },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
                queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
                queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
                if (propertyId) queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
              },
            },
          );
          if (propertyId) {
            updateProperty.mutate(
              { id: propertyId, data: { marginMin: minFrac, marginTarget: targetFrac } },
              {
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
                  queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
                },
              },
            );
          }
        }}
      />

      <button
        onClick={() => setScheduleOpen(true)}
        className="w-full mb-[18px] flex items-center justify-center gap-[8px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <CalendarDays className="w-[17px] h-[17px]" />
        {schedules.length > 0 ? "Reschedule / add date" : "Schedule job"}
      </button>

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

      <CrewPhotosSection photos={crewPhotos ?? []} />

      {(job.status === "complete" || job.recapSentAt) && (
        <div className="mb-[18px]">
          <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground mb-[8px] mx-[2px]">Client recap</div>
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px_15px]">
            {job.recapSentAt && !recapOpen ? (
              <div className="flex items-center gap-[8px] text-[14px] text-muted-foreground">
                <Check className="w-[16px] h-[16px] text-emerald-600" />
                Recap sent {new Date(job.recapSentAt).toLocaleDateString()}
                <button
                  onClick={generateRecap}
                  className="ml-auto text-[13px] font-semibold text-[var(--gold,#8f6a1f)]"
                >
                  Draft again
                </button>
              </div>
            ) : !recapOpen ? (
              <button
                onClick={generateRecap}
                className="w-full flex items-center justify-center gap-[8px] py-[10px] rounded-[12px] bg-[var(--ink,#17181c)] text-white text-[14px] font-semibold transition-transform active:scale-[0.98]"
              >
                <Sparkles className="w-[16px] h-[16px]" /> Draft recap with AI
              </button>
            ) : (
              <div className="space-y-[10px]">
                {draft.isPending ? (
                  <div className="py-[20px] text-center text-[14px] text-muted-foreground animate-pulse">
                    Writing the recap…
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-[4px]">Subject</div>
                      <input
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="w-full text-[14px] bg-background border border-border rounded-[10px] px-[12px] py-[9px] outline-none focus:border-[var(--gold,#8f6a1f)]"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-[4px]">Message</div>
                      <textarea
                        value={recapBody}
                        onChange={(e) => setRecapBody(e.target.value)}
                        rows={8}
                        className="w-full text-[14px] leading-relaxed bg-background border border-border rounded-[10px] px-[12px] py-[9px] outline-none focus:border-[var(--gold,#8f6a1f)] resize-y"
                      />
                    </div>
                    {(crewPhotos?.length ?? 0) > 0 && (
                      <div className="text-[12px] text-muted-foreground">
                        {crewPhotos!.length} photo{crewPhotos!.length === 1 ? "" : "s"} from the crew will be included on the branded recap page automatically.
                      </div>
                    )}
                    <div className="flex items-center gap-[8px]">
                      <button
                        onClick={() => setRecapOpen(false)}
                        className="text-[13px] font-semibold text-muted-foreground px-[12px] py-[9px]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={send}
                        disabled={createShare.isPending || !subject || !recapBody}
                        className="ml-auto flex items-center gap-[7px] px-[16px] py-[9px] rounded-[12px] bg-[var(--gold,#8f6a1f)] text-white text-[14px] font-semibold disabled:opacity-50 transition-transform active:scale-[0.98]"
                      >
                        <Send className="w-[15px] h-[15px]" />
                        {createShare.isPending ? "Preparing…" : "Send recap"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <EditJobSheet open={editOpen} onOpenChange={setEditOpen} job={job} />
      <ScheduleJobSheet
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        jobId={job.id}
        jobLabel={job.jobNo || job.category || "Job"}
      />
    </div>
  );
}
