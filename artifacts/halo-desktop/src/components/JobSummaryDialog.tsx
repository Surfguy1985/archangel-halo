import { useEffect, useState } from "react";
import { X, Send, Copy, Flag, Check, ImageIcon } from "lucide-react";
import {
  useGetJobSummary,
  useSaveJobSummary,
  useSendJobSummary,
  type JobSummaryDoc,
  type SummaryPhotoRef,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--primary)]";

type Draft = Pick<
  JobSummaryDoc,
  | "title"
  | "unitNumber"
  | "serviceDate"
  | "crewLead"
  | "timeIn"
  | "timeOut"
  | "checklist"
  | "flags"
  | "observations"
  | "touchUpNotes"
  | "overallResult"
> & { photos: { phase: string; path: string }[] };

export function JobSummaryDialog({
  jobId,
  onClose,
  onCloseOut,
  closeOutPending,
}: {
  jobId: string;
  onClose: () => void;
  /** Runs the existing close-out mutation; dialog stays until it succeeds/fails upstream. */
  onCloseOut: () => void;
  closeOutPending: boolean;
}) {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useGetJobSummary(jobId);
  const save = useSaveJobSummary();
  const send = useSendJobSummary();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmUnsentClose, setConfirmUnsentClose] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendToTouched, setSendToTouched] = useState(false);

  useEffect(() => {
    if (data && !draft) {
      const d = data.doc;
      setDraft({
        title: d.title,
        unitNumber: d.unitNumber,
        serviceDate: d.serviceDate,
        crewLead: d.crewLead,
        timeIn: d.timeIn,
        timeOut: d.timeOut,
        checklist: d.checklist,
        flags: d.flags,
        observations: d.observations,
        touchUpNotes: d.touchUpNotes,
        overallResult: d.overallResult,
        photos: d.photos.map((p) => ({ phase: p.phase, path: p.path })),
      });
    }
    if (data && !sendToTouched && !sendTo && data.suggestedRecipient) {
      setSendTo(data.suggestedRecipient);
    }
  }, [data, draft, sendTo, sendToTouched]);

  const doc = data?.doc;
  const onError = (err: Error) =>
    toast({ title: "That didn't work", description: err.message, variant: "destructive" });

  const doSave = (then?: () => void) => {
    if (!draft) return;
    save.mutate(
      { id: jobId, data: draft },
      {
        onSuccess: () => {
          refetch();
          if (then) then();
          else toast({ title: "Summary saved" });
        },
        onError,
      },
    );
  };

  const doSend = () =>
    doSave(() =>
      send.mutate(
        { id: jobId, data: { to: sendTo } },
        {
          onSuccess: () => {
            refetch();
            toast({ title: "Summary sent", description: `Emailed to ${sendTo}.` });
          },
          onError,
        },
      ),
    );

  const togglePhoto = (p: SummaryPhotoRef) => {
    if (!draft) return;
    const has = draft.photos.some((x) => x.path === p.path);
    setDraft({
      ...draft,
      photos: has
        ? draft.photos.filter((x) => x.path !== p.path)
        : [...draft.photos, { phase: p.phase, path: p.path }],
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
        data-testid="dialog-job-summary"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-display font-bold">Job summary</h2>
            <p className="text-sm text-muted-foreground font-medium">
              Prefilled recap for the property manager — review, flag anything you noticed, attach photos, send.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading || !draft || !doc ? (
          <div className="py-16 text-center text-muted-foreground font-medium">Loading…</div>
        ) : (
          <>
            {/* Header fields */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="col-span-2 md:col-span-3">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Title</label>
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputCls} data-testid="input-summary-title" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Unit #</label>
                <input value={draft.unitNumber ?? ""} onChange={(e) => setDraft({ ...draft, unitNumber: e.target.value || null })} className={inputCls} data-testid="input-summary-unit" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Service date</label>
                <input type="date" value={draft.serviceDate ?? ""} onChange={(e) => setDraft({ ...draft, serviceDate: e.target.value || null })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Crew lead</label>
                <input value={draft.crewLead ?? ""} onChange={(e) => setDraft({ ...draft, crewLead: e.target.value || null })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Time in</label>
                <input value={draft.timeIn ?? ""} onChange={(e) => setDraft({ ...draft, timeIn: e.target.value || null })} className={inputCls} placeholder="9:00 AM" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Time out</label>
                <input value={draft.timeOut ?? ""} onChange={(e) => setDraft({ ...draft, timeOut: e.target.value || null })} className={inputCls} placeholder="1:30 PM" />
              </div>
            </div>

            <div className="bg-muted rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground">
              {doc.propertyName}{doc.propertyAddress ? ` · ${doc.propertyAddress}` : ""} — sent under{" "}
              <b className="text-foreground">{doc.business?.companyName}</b>
              {doc.business?.phone ? ` · ${doc.business.phone}` : ""}{doc.business?.email ? ` · ${doc.business.email}` : ""}
            </div>

            {/* Checklist */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {draft.checklist.map((sec, si) => (
                <div key={si}>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{sec.section}</p>
                  <div className="space-y-1">
                    {sec.items.map((it, ii) => (
                      <label key={ii} className="flex items-start gap-2 text-sm font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={it.checked}
                          onChange={(e) => {
                            const checklist = draft.checklist.map((s, a) =>
                              a === si
                                ? { ...s, items: s.items.map((x, b) => (b === ii ? { ...x, checked: e.target.checked } : x)) }
                                : s,
                            );
                            setDraft({ ...draft, checklist });
                          }}
                          className="mt-0.5 accent-[var(--gold-light,#B4FF44)]"
                        />
                        {it.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Flags */}
            <div className="border border-border rounded-xl p-4 space-y-2">
              <p className="text-sm font-bold flex items-center gap-2"><Flag className="w-4 h-4 text-rose-600" /> While we were there, we noticed…</p>
              <p className="text-xs text-muted-foreground font-medium">Checked items turn the unit red on the property manager's community box view.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                {draft.flags.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={f.checked}
                      onChange={(e) => {
                        const flags = draft.flags.map((x, a) => (a === i ? { ...x, checked: e.target.checked } : x));
                        setDraft({ ...draft, flags });
                      }}
                      className="accent-rose-600"
                      data-testid={`checkbox-flag-${i}`}
                    />
                    <span className="shrink-0">{f.label}</span>
                    {f.checked && (
                      <input
                        value={f.note}
                        onChange={(e) => {
                          const flags = draft.flags.map((x, a) => (a === i ? { ...x, note: e.target.value } : x));
                          setDraft({ ...draft, flags });
                        }}
                        className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-border bg-background text-xs"
                        placeholder="where / details"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Additional observations</label>
                <textarea rows={3} value={draft.observations ?? ""} onChange={(e) => setDraft({ ...draft, observations: e.target.value || null })} className={inputCls} data-testid="input-summary-observations" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Anything need a touch-up?</label>
                <textarea rows={3} value={draft.touchUpNotes ?? ""} onChange={(e) => setDraft({ ...draft, touchUpNotes: e.target.value || null })} className={inputCls} placeholder="We'll make it right — no charge, no questions." />
              </div>
            </div>

            {/* Overall result */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-2">Overall result</span>
              {[
                { v: "exceeded", l: "Exceeded" },
                { v: "met", l: "Met scope" },
                { v: "followup", l: "Follow-up needed" },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setDraft({ ...draft, overallResult: o.v })}
                  className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${draft.overallResult === o.v ? "bg-[var(--ink)] text-white border-transparent" : "border-border hover:bg-muted"}`}
                >
                  {o.l}
                </button>
              ))}
            </div>

            {/* Photos */}
            <div>
              <p className="text-sm font-bold flex items-center gap-2 mb-2">
                <ImageIcon className="w-4 h-4" /> Before &amp; after photos from the crew
              </p>
              {data!.availablePhotos.length === 0 ? (
                <p className="text-sm text-muted-foreground font-medium">No crew photos for this job yet.</p>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {data!.availablePhotos.map((p) => {
                    const selected = draft.photos.some((x) => x.path === p.path);
                    return (
                      <button
                        key={p.path}
                        onClick={() => togglePhoto(p)}
                        className={`relative rounded-xl overflow-hidden border-2 ${selected ? "border-[var(--gold-light,#B4FF44)]" : "border-transparent opacity-70 hover:opacity-100"}`}
                        data-testid={`button-photo-${p.path.split("/").pop()}`}
                      >
                        <img src={p.url} alt="" className="w-24 h-24 object-cover" />
                        <span className="absolute bottom-1 left-1 text-[9px] font-bold uppercase bg-black/70 text-white rounded px-1.5 py-0.5">{p.phase}</span>
                        {selected && (
                          <span className="absolute top-1 right-1 bg-[var(--gold-light,#B4FF44)] text-black rounded-full p-0.5"><Check className="w-3 h-3" /></span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Share + actions */}
            {doc.shareUrl && (
              <div className="flex items-center gap-2 bg-muted rounded-xl px-4 py-3">
                <code className="flex-1 text-xs truncate">{doc.shareUrl}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(doc.shareUrl!); toast({ title: "Link copied" }); }}
                  className="p-2 rounded-lg hover:bg-background" aria-label="Copy link"
                >
                  <Copy className="w-4 h-4" />
                </button>
                {doc.status === "sent" && (
                  <span className="text-xs font-bold text-[var(--gold,#4a7000)]">Sent to {doc.sentTo}</span>
                )}
              </div>
            )}

            {confirmUnsentClose && (
              <div
                className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-center gap-3"
                data-testid="banner-unsent-summary-confirm"
              >
                <div className="flex-1 min-w-[220px]">
                  <p className="text-sm font-bold text-amber-900">Send the summary first?</p>
                  <p className="text-xs font-medium text-amber-800">
                    This recap hasn't been sent to the property manager yet. You can still close out without sending it.
                  </p>
                </div>
                <button
                  onClick={() => setConfirmUnsentClose(false)}
                  className="px-4 py-2 text-sm font-bold rounded-xl border border-amber-300 text-amber-900 hover:bg-amber-100"
                  data-testid="button-confirm-go-back"
                >
                  Go back
                </button>
                <button
                  onClick={() => { setConfirmUnsentClose(false); onCloseOut(); }}
                  disabled={closeOutPending}
                  className="px-4 py-2 bg-[var(--ink)] text-white text-sm font-bold rounded-xl hover:opacity-90 disabled:opacity-50"
                  data-testid="button-confirm-close-anyway"
                >
                  Close out anyway
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
              <input
                value={sendTo}
                onChange={(e) => { setSendTo(e.target.value); setSendToTouched(true); }}
                className={`${inputCls} flex-1 min-w-[200px]`}
                placeholder="manager@property.com"
                data-testid="input-summary-send-to"
              />
              <button
                onClick={doSend}
                disabled={save.isPending || send.isPending || !sendTo.trim()}
                className="px-5 py-2.5 bg-[var(--gold-light,#B4FF44)] text-black text-sm font-bold rounded-xl hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                data-testid="button-summary-send"
              >
                <Send className="w-4 h-4" /> {send.isPending ? "Sending…" : "Save & send to PM"}
              </button>
              <button
                onClick={() => doSave()}
                disabled={save.isPending}
                className="px-4 py-2.5 text-sm font-bold rounded-xl border border-border hover:bg-muted disabled:opacity-50"
                data-testid="button-summary-save"
              >
                {save.isPending ? "Saving…" : "Save draft"}
              </button>
              <button
                onClick={() => {
                  if (doc.status !== "sent") setConfirmUnsentClose(true);
                  else onCloseOut();
                }}
                disabled={closeOutPending}
                className="ml-auto px-5 py-2.5 bg-[var(--ink)] text-white text-sm font-bold rounded-xl hover:opacity-90 disabled:opacity-50"
                data-testid="button-summary-close-out"
              >
                {closeOutPending ? "Closing…" : "Close out job"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
