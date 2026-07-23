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
  useCreateJobTrackerShare,
} from "@workspace/api-client-react";
import { MarginSection } from "@/components/MarginSection";
import { CrewPhotosSection } from "@/components/CrewPhotosSection";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ChevronLeft, Pencil, Sparkles, Send, Check, CalendarDays, RotateCcw, Archive, Radio, FileDown } from "lucide-react";
import { useState } from "react";
import { EditJobSheet } from "@/components/EditJobSheet";
import { ScheduleJobSheet } from "@/components/ScheduleJobSheet";
import { FalkonBadge } from "@/components/FalkonBadge";

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
  const trackerShare = useCreateJobTrackerShare();
  const [trackerCopied, setTrackerCopied] = useState(false);

  const copyTrackerLink = () => {
    trackerShare.mutate(
      { id },
      {
        onSuccess: async (r) => {
          const url = r.link || `${window.location.origin}/track/${r.token}`;
          try {
            await navigator.clipboard.writeText(url);
            setTrackerCopied(true);
            setTimeout(() => setTrackerCopied(false), 2500);
          } catch {
            window.prompt("Copy this live tracker link:", url);
          }
        },
      },
    );
  };
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
      <div className="animate-pulse space-y-4 pt-4 px-4 pb-24">
        <div className="h-8 bg-muted rounded w-1/3"></div>
        <div className="h-32 bg-card rounded-[16px]"></div>
      </div>
    );
  }

  if (!data) return <div className="p-4 text-center text-muted-foreground pb-24">Job not found</div>;

  const { job, expenses, schedules, crewPhotos } = data;

  return (
    <div className="pt-2 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <Link href={job.propertyId ? `/properties/${job.propertyId}` : "/properties"} className="flex items-center gap-[6px] text-primary text-[13.5px] font-semibold mb-[10px] w-fit hover:brightness-110 transition-all">
        <ChevronLeft className="w-[16px] h-[16px]" /> Back
      </Link>
      
      <div className="flex items-start gap-[10px] px-[6px]">
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[26px] tracking-[-0.015em] leading-[1.1] text-foreground drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]">{job.category || 'General'}</div>
          <div className="text-[13px] text-muted-foreground mt-[3px] mb-[14px]">
            <span className="text-foreground">{job.propertyName}</span> {job.unitNo ? `· Unit ${job.unitNo}` : ''}
          </div>
        </div>
        <button
          onClick={() => setEditOpen(true)}
          aria-label="Edit job"
          className="w-[36px] h-[36px] shrink-0 rounded-full grid place-items-center bg-card border border-border shadow-[0_0_10px_rgba(180,255,68,0.1)] text-primary hover:text-primary-foreground hover:bg-[var(--gold-light)] transition-all active:scale-[0.9]"
        >
          <Pencil className="w-[16px] h-[16px]" />
        </button>
      </div>

      <div className="bg-card rounded-[16px] border border-border shadow-[0_0_15px_rgba(0,0,0,0.4)] p-[14px_15px] mb-[18px] mx-[6px]">
        <div className="flex justify-between items-start mb-[12px]">
          <div>
            <div className="text-[12px] text-primary uppercase tracking-[0.1em] font-display font-bold mb-[4px]">Status</div>
            {job.status === "complete" ? (
              <span className="inline-flex items-center gap-[5px] text-[12px] font-display font-bold uppercase tracking-[0.08em] text-primary bg-primary/10 border border-primary/30 rounded-full px-[10px] py-[4px] shadow-[0_0_10px_rgba(180,255,68,0.2)]">
                <Check className="w-[12px] h-[12px]" /> Completed
              </span>
            ) : (
              <div className="font-semibold text-[15px] capitalize text-foreground">{job.status.replace('_', ' ')}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[12px] font-mono text-muted-foreground">{job.jobNo}</div>
            {job.woNo && <div className="text-[12px] font-mono text-muted-foreground">WO: {job.woNo}</div>}
          </div>
        </div>
        <div className="text-[14px] text-foreground/90 leading-relaxed">
          {job.description}
        </div>
        {job.status === "complete" && (
          <div className="flex items-center gap-[8px] mt-[12px] pt-[12px] border-t border-border">
            {!job.clearedAt && (
              <button
                disabled={clearJob.isPending}
                onClick={() => clearJob.mutate({ id }, { onSuccess: invalidateJobLists })}
                className="flex items-center gap-[5px] text-[12.5px] font-display font-bold px-[12px] py-[8px] rounded-full bg-muted text-muted-foreground active:scale-[0.95] disabled:opacity-50 hover:text-foreground transition-colors"
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
              className="ml-auto flex items-center gap-[5px] text-[12.5px] font-display font-bold px-[12px] py-[8px] rounded-full bg-primary/10 text-primary active:scale-[0.95] disabled:opacity-50 hover:bg-primary/20 transition-colors border border-primary/20"
            >
              <RotateCcw className="w-[13px] h-[13px]" /> Restart job
            </button>
          </div>
        )}
        {clearJob.isError && (
          <div className="mt-[8px] text-[12px] font-semibold text-red-600">
            {(clearJob.error as { data?: { error?: string } } | null)?.data?.error ?? clearJob.error?.message ?? "Couldn't clear this job."}
          </div>
        )}
      </div>

      <div className="px-[6px]">
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
      </div>

      <div className="px-[6px]">
        <button
          onClick={() => setScheduleOpen(true)}
          className="w-full mb-[18px] flex items-center justify-center gap-[8px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[0_0_15px_rgba(180,255,68,0.05)] text-primary hover:border-primary/50 transition-all active:scale-[0.98]"
        >
          <CalendarDays className="w-[17px] h-[17px]" />
          {schedules.length > 0 ? "Reschedule / add date" : "Schedule job"}
        </button>

        {schedules.length > 0 && (
          <div className="mb-[18px]">
            <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-primary mb-[8px] mx-[2px] drop-shadow-[0_0_5px_rgba(180,255,68,0.3)]">Schedule</div>
            <div className="bg-card border border-border rounded-[16px] shadow-[0_0_20px_rgba(0,0,0,0.4)] p-[6px_14px]">
              {schedules.map((schedule, idx) => (
                <div key={schedule.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                  <div className="flex-1">
                    <div className="font-semibold text-foreground">{new Date(schedule.scheduledOn).toLocaleDateString()}</div>
                    {schedule.windowStart && <div className="text-[12px] text-muted-foreground">{schedule.windowStart}</div>}
                  </div>
                  <div className="text-[12px] font-medium capitalize text-primary bg-primary/10 px-[8px] py-[2px] rounded-full border border-primary/20">
                    {schedule.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {expenses.length > 0 && (
          <div className="mb-[18px]">
            <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-primary mb-[8px] mx-[2px] drop-shadow-[0_0_5px_rgba(180,255,68,0.3)]">Expenses</div>
            <div className="bg-card border border-border rounded-[16px] shadow-[0_0_20px_rgba(0,0,0,0.4)] p-[6px_14px]">
              {expenses.map((expense, idx) => (
                <div key={expense.id} className={`flex items-center gap-[10px] py-[10px] text-[14px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate text-foreground">{expense.vendor || expense.category}</div>
                    <div className="text-[12px] text-muted-foreground truncate">{expense.source || 'Manual entry'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display font-semibold tabular-nums text-foreground">${expense.amount.toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <CrewPhotosSection photos={crewPhotos ?? []} />

        <div className="mb-[18px]">
          <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-primary mb-[8px] mx-[2px] drop-shadow-[0_0_5px_rgba(180,255,68,0.3)]">Live tracker & evidence</div>
          <div className="bg-card border border-border rounded-[16px] shadow-[0_0_20px_rgba(0,0,0,0.4)] p-[14px_15px] flex flex-col gap-[10px]">
            <p className="text-[12.5px] text-muted-foreground">
              Share a live link with the property manager — it shows GPS check-ins,
              before &amp; after photos, and work notes in real time. The PDF report
              packages everything with tamper-proof photo fingerprints.
            </p>
            <button
              onClick={copyTrackerLink}
              disabled={trackerShare.isPending}
              className="w-full flex items-center justify-center gap-[8px] py-[11px] rounded-[12px] bg-[var(--gold-light)] text-primary-foreground text-[14px] font-bold disabled:opacity-60 transition-all hover:brightness-110 active:scale-[0.98] shadow-[0_0_15px_rgba(180,255,68,0.3)]"
            >
              {trackerCopied ? (
                <>
                  <Check className="w-[16px] h-[16px]" /> Link copied!
                </>
              ) : (
                <>
                  <Radio className="w-[16px] h-[16px]" />
                  {trackerShare.isPending ? "Creating link…" : "Copy live tracker link"}
                </>
              )}
            </button>
            <a
              href={`/api/jobs/${id}/report`}
              className="w-full flex items-center justify-center gap-[8px] py-[11px] rounded-[12px] bg-background border border-border text-[14px] font-semibold text-foreground transition-all hover:bg-muted active:scale-[0.98]"
            >
              <FileDown className="w-[16px] h-[16px] text-primary" /> Download job report (PDF)
            </a>
          </div>
        </div>

        {(job.status === "complete" || job.recapSentAt) && (
          <div className="mb-[18px]">
            <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-primary mb-[8px] mx-[2px] drop-shadow-[0_0_5px_rgba(180,255,68,0.3)]">Client recap</div>
            <div className="bg-card border border-border rounded-[16px] shadow-[0_0_20px_rgba(0,0,0,0.4)] p-[14px_15px]">
              {job.recapSentAt && !recapOpen ? (
                <div className="flex items-center gap-[8px] text-[14px] text-muted-foreground">
                  <Check className="w-[16px] h-[16px] text-primary drop-shadow-[0_0_8px_rgba(180,255,68,0.5)]" />
                  <span className="text-foreground">Recap sent</span> {new Date(job.recapSentAt).toLocaleDateString()}
                  <button
                    onClick={generateRecap}
                    className="ml-auto text-[13px] font-semibold text-primary hover:text-primary/80 transition-colors"
                  >
                    Draft again
                  </button>
                </div>
              ) : !recapOpen ? (
                <button
                  onClick={generateRecap}
                  className="w-full flex items-center justify-center gap-[8px] py-[10px] rounded-[12px] bg-background border border-primary/50 text-primary text-[14px] font-bold transition-all hover:bg-primary/10 active:scale-[0.98]"
                >
                  <Sparkles className="w-[16px] h-[16px]" /> Draft recap with AI
                </button>
              ) : (
                <div className="space-y-[12px]">
                  {draft.isPending ? (
                    <div className="py-[20px] text-center text-[14px] text-primary animate-pulse font-display font-bold">
                      Writing the recap…
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="text-[11px] font-display font-bold uppercase tracking-[0.1em] text-muted-foreground mb-[6px]">Subject</div>
                        <input
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          className="w-full text-[14px] bg-background border border-border rounded-[10px] px-[12px] py-[9px] outline-none focus:border-primary text-foreground focus:ring-1 focus:ring-primary/50 transition-all"
                        />
                      </div>
                      <div>
                        <div className="text-[11px] font-display font-bold uppercase tracking-[0.1em] text-muted-foreground mb-[6px]">Message</div>
                        <textarea
                          value={recapBody}
                          onChange={(e) => setRecapBody(e.target.value)}
                          rows={8}
                          className="w-full text-[14px] leading-relaxed bg-background border border-border rounded-[10px] px-[12px] py-[9px] outline-none focus:border-primary text-foreground focus:ring-1 focus:ring-primary/50 transition-all resize-y"
                        />
                      </div>
                      {(crewPhotos?.length ?? 0) > 0 && (
                        <div className="text-[12px] text-muted-foreground bg-muted/50 p-3 rounded-[10px] border border-border">
                          <span className="text-foreground font-semibold">{crewPhotos!.length} photo{crewPhotos!.length === 1 ? "" : "s"}</span> from the crew will be included on the branded recap page automatically.
                        </div>
                      )}
                      <div className="flex items-center gap-[8px] pt-[4px]">
                        <button
                          onClick={() => setRecapOpen(false)}
                          className="text-[13px] font-semibold text-muted-foreground px-[12px] py-[9px] hover:text-foreground transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={send}
                          disabled={createShare.isPending || !subject || !recapBody}
                          className="ml-auto flex items-center gap-[7px] px-[16px] py-[9px] rounded-[12px] bg-[var(--gold-light)] text-primary-foreground text-[14px] font-bold disabled:opacity-50 transition-all hover:brightness-110 active:scale-[0.98] shadow-[0_0_15px_rgba(180,255,68,0.3)] disabled:shadow-none"
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
      </div>

      <EditJobSheet open={editOpen} onOpenChange={setEditOpen} job={job} />
      <ScheduleJobSheet
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        jobId={job.id}
        jobLabel={job.jobNo || job.category || "Job"}
      />
      
      <FalkonBadge />
    </div>
  );
}
