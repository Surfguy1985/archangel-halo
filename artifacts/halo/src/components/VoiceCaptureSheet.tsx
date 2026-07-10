import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Mic, Check, ChevronLeft, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useParseVoice,
  useConfirmVoice,
  getListPropertiesQueryKey,
  getListCrewsQueryKey,
  getListJobsQueryKey,
  type VoiceAction,
} from "@workspace/api-client-react";

const TOOL_LABELS: Record<string, string> = {
  create_property: "New property",
  create_crew: "New crew member",
  create_job: "New job",
  schedule_job: "Schedule job",
  log_expense: "Log expense",
  create_lead: "New lead",
  add_note: "Note",
  complete_job: "Complete job",
};

type Phase = "capture" | "review" | "done";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
};

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function VoiceCaptureSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("capture");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [actions, setActions] = useState<VoiceAction[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [voiceLogId, setVoiceLogId] = useState<string | null>(null);
  const [resultMessages, setResultMessages] = useState<string[]>([]);
  const [appliedCount, setAppliedCount] = useState(0);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTranscriptRef = useRef("");

  const parse = useParseVoice();
  const confirm = useConfirmVoice();

  useEffect(() => {
    setSpeechSupported(getRecognition() !== null);
  }, []);

  const resetAll = () => {
    setPhase("capture");
    setListening(false);
    setTranscript("");
    setActions([]);
    setSelected(new Set());
    setVoiceLogId(null);
    setResultMessages([]);
    setAppliedCount(0);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  };

  useEffect(() => {
    if (!open) resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleListen = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = getRecognition();
    if (!rec) {
      setSpeechSupported(false);
      return;
    }
    baseTranscriptRef.current = transcript ? transcript.trim() + " " : "";
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: unknown) => {
      const ev = e as {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      };
      let text = "";
      for (let i = 0; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      setTranscript(baseTranscriptRef.current + text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const runParse = () => {
    const text = transcript.trim();
    if (!text) return;
    recognitionRef.current?.stop();
    setListening(false);
    parse.mutate(
      { data: { transcript: text } },
      {
        onSuccess: (res) => {
          setActions(res.actions);
          setSelected(new Set(res.actions.map((_, i) => i)));
          setVoiceLogId(res.voiceLogId ?? null);
          setPhase("review");
        },
      },
    );
  };

  const toggleSelected = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const runConfirm = () => {
    const chosen = actions.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    confirm.mutate(
      {
        data: {
          voiceLogId: voiceLogId ?? undefined,
          transcript: transcript.trim(),
          actions: chosen,
        },
      },
      {
        onSuccess: (res) => {
          setAppliedCount(res.applied);
          setResultMessages(res.messages ?? []);
          setPhase("done");
          queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListCrewsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          queryClient.invalidateQueries();
        },
      },
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
          {phase === "capture" && (
            <>
              <SheetHeader className="text-left mb-[14px]">
                <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
                  Talk to HALO
                </SheetTitle>
                <div className="text-[13px] text-muted-foreground">
                  Add a property, a crew member, a job, schedule work, log an
                  expense — just say it.
                </div>
              </SheetHeader>

              <div className="flex flex-col items-center justify-center my-[18px]">
                <button
                  className={`w-[66px] h-[66px] rounded-full relative grid place-items-center shadow-[0_6px_20px_rgba(143,106,31,0.38)] before:content-[''] before:absolute before:inset-0 before:rounded-full before:bg-[conic-gradient(from_210deg,var(--gold-dark),var(--gold-light),var(--gold),var(--gold-dark))] after:content-[''] after:absolute after:inset-[3.5px] after:rounded-full after:bg-[var(--ink)] ${listening ? "animate-pulse" : ""}`}
                  onClick={toggleListen}
                >
                  <Mic className="relative z-10 w-[24px] h-[24px] text-[var(--gold-light)]" />
                </button>
                <span className="block text-center text-[12px] tracking-[0.16em] uppercase text-[var(--gold-dark)] font-bold mt-[12px]">
                  {listening ? "LISTENING — TAP TO STOP" : "TAP TO SPEAK"}
                </span>
              </div>

              <textarea
                className="w-full bg-card rounded-[14px] border border-border shadow-[var(--shadow)] p-[14px_15px] text-[15px] text-[var(--ink2)] min-h-[92px] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
                placeholder={
                  speechSupported
                    ? "Your words appear here — or type them. e.g. “Add a new property called Cedar Point Apartments, managed by Sterling, 48 units in Austin.”"
                    : "Type what you want to do. e.g. “Add a new crew member Marcus Reed, plumbing, crew leader, 512-555-0134.”"
                }
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />

              {!speechSupported && (
                <div className="text-[12px] text-muted-foreground mt-[8px]">
                  Voice input isn’t available in this browser — you can type your
                  request instead.
                </div>
              )}

              <button
                onClick={runParse}
                disabled={!transcript.trim() || parse.isPending}
                className="w-full mt-[16px] py-[13px] rounded-[14px] bg-[var(--ink)] text-[var(--paper)] font-semibold text-[15px] flex items-center justify-center gap-[8px] disabled:opacity-40"
              >
                {parse.isPending ? (
                  <>
                    <Loader2 className="w-[17px] h-[17px] animate-spin" /> Reading…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-[17px] h-[17px] text-[var(--gold-light)]" />{" "}
                    Review
                  </>
                )}
              </button>

              {parse.isError && (
                <div className="text-[12.5px] text-red-600 mt-[10px]">
                  Couldn’t read that. Please try again.
                </div>
              )}
            </>
          )}

          {phase === "review" && (
            <>
              <SheetHeader className="text-left mb-[14px]">
                <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
                  Confirm before saving
                </SheetTitle>
                <div className="text-[13px] text-muted-foreground">
                  Tap any card to include or skip it. Nothing is saved until you
                  confirm.
                </div>
              </SheetHeader>

              {actions.length === 0 ? (
                <div className="bg-card rounded-[14px] border border-border shadow-[var(--shadow)] p-[16px] text-[14px] text-muted-foreground">
                  Nothing actionable found. Go back and add more detail.
                </div>
              ) : (
                <div className="flex flex-col gap-[10px]">
                  {actions.map((a, i) => {
                    const on = selected.has(i);
                    return (
                      <button
                        key={i}
                        onClick={() => toggleSelected(i)}
                        className={`text-left rounded-[14px] border p-[13px_14px] transition-colors ${
                          on
                            ? "bg-card border-[var(--gold)] shadow-[var(--shadow)]"
                            : "bg-transparent border-border opacity-55"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-[10px] mb-[4px]">
                          <span className="text-[11px] tracking-[0.14em] uppercase font-bold text-[var(--gold-dark)]">
                            {TOOL_LABELS[a.tool] ?? a.tool}
                          </span>
                          <span
                            className={`w-[22px] h-[22px] rounded-full grid place-items-center shrink-0 ${
                              on
                                ? "bg-[var(--gold)] text-white"
                                : "bg-[rgba(23,24,28,0.10)] text-transparent"
                            }`}
                          >
                            <Check className="w-[14px] h-[14px]" />
                          </span>
                        </div>
                        <div className="text-[15px] font-semibold text-foreground">
                          {a.title}
                        </div>
                        <div className="text-[13px] text-muted-foreground mt-[2px]">
                          {a.summary}
                        </div>
                        {a.needsReview && (
                          <div className="text-[11.5px] text-[var(--gold-dark)] font-semibold mt-[6px]">
                            ⚠ Double-check the details
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-[10px] mt-[16px]">
                <button
                  onClick={() => setPhase("capture")}
                  className="py-[13px] px-[16px] rounded-[14px] border border-border bg-card font-semibold text-[15px] flex items-center gap-[6px]"
                >
                  <ChevronLeft className="w-[16px] h-[16px]" /> Back
                </button>
                <button
                  onClick={runConfirm}
                  disabled={selected.size === 0 || confirm.isPending}
                  className="flex-1 py-[13px] rounded-[14px] bg-[var(--ink)] text-[var(--paper)] font-semibold text-[15px] flex items-center justify-center gap-[8px] disabled:opacity-40"
                >
                  {confirm.isPending ? (
                    <>
                      <Loader2 className="w-[17px] h-[17px] animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      Save {selected.size > 0 ? selected.size : ""}{" "}
                      {selected.size === 1 ? "item" : "items"}
                    </>
                  )}
                </button>
              </div>

              {confirm.isError && (
                <div className="text-[12.5px] text-red-600 mt-[10px]">
                  Couldn’t save. Please try again.
                </div>
              )}
            </>
          )}

          {phase === "done" && (
            <>
              <div className="flex flex-col items-center text-center my-[14px]">
                <span className="w-[54px] h-[54px] rounded-full bg-[var(--gold)] grid place-items-center shadow-[0_6px_20px_rgba(143,106,31,0.38)]">
                  <Check className="w-[26px] h-[26px] text-white" />
                </span>
                <SheetTitle className="font-display font-bold text-[19px] mt-[12px]">
                  {appliedCount > 0
                    ? `Saved ${appliedCount} ${appliedCount === 1 ? "item" : "items"}`
                    : "Nothing saved"}
                </SheetTitle>
              </div>

              {resultMessages.length > 0 && (
                <div className="flex flex-col gap-[8px] mb-[6px]">
                  {resultMessages.map((m, i) => (
                    <div
                      key={i}
                      className="bg-card rounded-[12px] border border-border shadow-[var(--shadow)] p-[11px_13px] text-[13.5px] text-[var(--ink2)]"
                    >
                      {m}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-[10px] mt-[16px]">
                <button
                  onClick={resetAll}
                  className="flex-1 py-[13px] rounded-[14px] border border-border bg-card font-semibold text-[15px]"
                >
                  Say something else
                </button>
                <button
                  onClick={() => onOpenChange(false)}
                  className="flex-1 py-[13px] rounded-[14px] bg-[var(--ink)] text-[var(--paper)] font-semibold text-[15px]"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
