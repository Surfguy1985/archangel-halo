import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useParseVoice,
  useConfirmVoice,
  type VoiceAction,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Mic,
  Check,
  ChevronLeft,
  Loader2,
  Sparkles,
  Building2,
  UserPlus,
  Wrench,
  CalendarClock,
  Receipt,
  TrendingUp,
  StickyNote,
  CheckCheck,
  FileText,
  Truck,
  PackagePlus,
  Boxes,
  type LucideIcon,
} from "lucide-react";

const TOOL_LABELS: Record<string, string> = {
  create_property: "New property",
  create_crew: "New crew member",
  create_job: "New job",
  schedule_job: "Schedule job",
  log_expense: "Log expense",
  create_lead: "New lead",
  create_bid: "New bid",
  add_note: "Note",
  complete_job: "Complete job",
  create_invoice: "Draft invoice",
  create_vendor: "New vendor",
  add_inventory_item: "Track material",
  adjust_inventory: "Stock update",
};

type Script = {
  tool: string;
  label: string;
  Icon: LucideIcon;
  template: string;
  example: string;
};

// Blanks are wrapped in {curly braces} so they render as gold "say your detail here" chips.
const SCRIPTS: Script[] = [
  {
    tool: "create_property",
    label: "New property",
    Icon: Building2,
    template:
      "Add a new property called {the name}, managed by {management company}, {number} units in {city}. Access notes: {gate code or entry details}.",
    example:
      "Add a new property called Cedar Point Apartments, managed by Sterling PMC, 48 units in Austin. Access notes: gate code 4417.",
  },
  {
    tool: "create_crew",
    label: "New crew",
    Icon: UserPlus,
    template:
      "Add a new crew member {full name}, {their trade}, phone {number}. Make them a crew leader.",
    example:
      "Add a new crew member Marcus Reed, plumbing, phone 512-555-0134. Make them a crew leader.",
  },
  {
    tool: "create_job",
    label: "New job",
    Icon: Wrench,
    template:
      "Create a job at {property name}, unit {unit number}. It's a {category} job. {what needs doing}.",
    example:
      "Create a job at Riverside Commons, unit 112. It's a plumbing job. Kitchen sink is leaking under the cabinet.",
  },
  {
    tool: "schedule_job",
    label: "Schedule",
    Icon: CalendarClock,
    template:
      "Schedule job {job number} for {date, like tomorrow} at {time} with {crew name}.",
    example: "Schedule job J-2001 for tomorrow at 8am with Ray Coleman.",
  },
  {
    tool: "log_expense",
    label: "Expense",
    Icon: Receipt,
    template:
      "Log an expense. I paid {vendor} {amount} dollars for {what it was} at {property name}.",
    example:
      "Log an expense. I paid Home Depot 240 dollars for paint and supplies at Maple Grove Apartments.",
  },
  {
    tool: "create_lead",
    label: "New lead",
    Icon: TrendingUp,
    template:
      "New lead from {who it came from}. They need {what they want} at {property name}.",
    example:
      "New lead from Sterling PMC. They need a full unit turn on unit 210 at Maple Grove Apartments.",
  },
  {
    tool: "create_bid",
    label: "New bid",
    Icon: Sparkles,
    template:
      "Draft a bid for {amount} dollars at {property name}, unit {unit number}, for {scope of work}.",
    example:
      "Draft a bid for 3200 dollars at Maple Grove Apartments, unit 210, for a full unit turn with paint and carpet.",
  },
  {
    tool: "create_invoice",
    label: "Invoice",
    Icon: FileText,
    template:
      "Invoice {property name} for {amount} dollars for {what the work was}. PO number {number}.",
    example:
      "Invoice Maple Grove Apartments for 950 dollars for painting unit 5. PO number 4471.",
  },
  {
    tool: "create_vendor",
    label: "New vendor",
    Icon: Truck,
    template:
      "Add a new vendor called {company name}. They do {trade}, phone {number}.",
    example:
      "Add a new vendor called Rocky Top Supply. They do lumber, phone 615-555-0199.",
  },
  {
    tool: "add_inventory_item",
    label: "Track material",
    Icon: PackagePlus,
    template:
      "Start tracking {material name}. We have {quantity}, reorder at {quantity}, about {cost} dollars each.",
    example:
      "Start tracking door hinges. We have 40, reorder at 10, about 3 dollars each.",
  },
  {
    tool: "adjust_inventory",
    label: "Stock update",
    Icon: Boxes,
    template:
      "We used {quantity} {material name} today. Also picked up {quantity} {material name}.",
    example:
      "We used 6 tubes of caulk today. Also picked up 20 boxes of tile.",
  },
  {
    tool: "add_note",
    label: "Note",
    Icon: StickyNote,
    template: "Add a note to {property name or job number}. {the note}.",
    example:
      "Add a note to Maple Grove Apartments. Property manager wants a call before any entry before 8am.",
  },
  {
    tool: "complete_job",
    label: "Complete",
    Icon: CheckCheck,
    template: "Mark job {job number} complete.",
    example: "Mark job J-2002 complete.",
  },
];

function ScriptTemplate({ template }: { template: string }) {
  const parts = template.split(/(\{[^}]+\})/g).filter(Boolean);
  return (
    <p className="text-[16px] leading-[1.7] font-display text-foreground">
      {parts.map((part, i) =>
        part.startsWith("{") && part.endsWith("}") ? (
          <span
            key={i}
            className="inline-block bg-[rgba(143,106,31,0.12)] text-[var(--gold-dark)] font-semibold rounded-[7px] px-[7px] py-[1px] mx-[1px]"
          >
            {part.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

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

export function VoiceCaptureDialog({
  open,
  onOpenChange,
  initialText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText?: string;
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
  const [activeScript, setActiveScript] = useState<string | null>(null);
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
    setActiveScript(null);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  };

  useEffect(() => {
    if (!open) resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Command-bar entry: when opened with typed text, parse it immediately.
  useEffect(() => {
    if (!open || !initialText || !initialText.trim()) return;
    let cancelled = false;
    const text = initialText.trim();
    setTranscript(text);
    parse.mutate(
      { data: { transcript: text } },
      {
        onSuccess: (res) => {
          if (cancelled) return;
          setActions(res.actions);
          setSelected(new Set(res.actions.map((_, i) => i)));
          setVoiceLogId(res.voiceLogId ?? null);
          setPhase("review");
        },
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialText]);

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
          queryClient.invalidateQueries();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {phase === "capture" && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display font-bold text-xl">
                Talk to HALO
              </DialogTitle>
              <DialogDescription>
                Add a property, a crew member, a job, schedule work, log an
                expense — just say it, or type it below.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center justify-center my-2">
              <button
                className={`w-[64px] h-[64px] rounded-full relative grid place-items-center shadow-[0_6px_20px_rgba(143,106,31,0.38)] before:content-[''] before:absolute before:inset-0 before:rounded-full before:bg-[conic-gradient(from_210deg,var(--gold-dark),var(--gold-light),var(--gold),var(--gold-dark))] after:content-[''] after:absolute after:inset-[3.5px] after:rounded-full after:bg-[var(--ink)] ${listening ? "animate-pulse" : ""}`}
                onClick={toggleListen}
                type="button"
              >
                <Mic className="relative z-10 w-6 h-6 text-[var(--gold-light)]" />
              </button>
              <span className="block text-center text-[11px] tracking-[0.16em] uppercase text-[var(--gold-dark)] font-bold mt-3">
                {listening ? "Listening — click to stop" : "Click to speak"}
              </span>
            </div>

            <div>
              <div className="text-[11px] tracking-[0.14em] uppercase text-muted-foreground font-bold mb-2">
                Need a script? Pick a task
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SCRIPTS.map((s) => {
                  const on = activeScript === s.tool;
                  return (
                    <button
                      key={s.tool}
                      type="button"
                      aria-pressed={on}
                      aria-label={`Script for ${s.label}`}
                      onClick={() => setActiveScript(on ? null : s.tool)}
                      className={`flex items-center gap-1.5 rounded-full py-1.5 px-3 text-[12.5px] font-semibold border transition-colors ${
                        on
                          ? "bg-[var(--ink)] text-[var(--paper)] border-[var(--ink)]"
                          : "bg-card text-foreground border-border shadow-sm hover:border-[var(--gold)]"
                      }`}
                    >
                      <s.Icon
                        aria-hidden="true"
                        className={`w-[14px] h-[14px] ${on ? "text-[var(--gold-light)]" : "text-[var(--gold-dark)]"}`}
                      />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeScript && (
              <div className="bg-[var(--paper)] rounded-xl border-2 border-[var(--gold)] shadow-[0_6px_20px_rgba(143,106,31,0.18)] p-4 pb-3.5">
                <div className="flex items-center gap-1.5 text-[11px] tracking-[0.14em] uppercase text-[var(--gold-dark)] font-bold mb-2.5">
                  <Mic className="w-[13px] h-[13px]" /> Read this aloud
                </div>
                {(() => {
                  const s = SCRIPTS.find((x) => x.tool === activeScript)!;
                  return (
                    <>
                      <ScriptTemplate template={s.template} />
                      <div className="mt-3 pt-2.5 border-t border-[rgba(23,24,28,0.10)] text-[13px] text-muted-foreground italic leading-[1.55]">
                        e.g. “{s.example}”
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            <textarea
              className="w-full bg-card rounded-lg border border-border shadow-sm p-3 text-sm min-h-[96px] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
              placeholder={
                speechSupported
                  ? "Your words appear here — or type them. e.g. “Log an expense. I paid Home Depot 240 dollars for paint at Maple Grove Apartments.”"
                  : "Type what you want to do. e.g. “Add a new crew member Marcus Reed, plumbing, crew leader, 512-555-0134.”"
              }
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
            />

            {!speechSupported && (
              <div className="text-xs text-muted-foreground">
                Voice input isn't available in this browser — you can type your
                request instead.
              </div>
            )}

            <Button
              onClick={runParse}
              disabled={!transcript.trim() || parse.isPending}
              className="w-full"
            >
              {parse.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Reading…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-1.5" /> Review
                </>
              )}
            </Button>

            {parse.isError && (
              <div className="text-xs text-destructive">
                Couldn't read that. Please try again.
              </div>
            )}
          </>
        )}

        {phase === "review" && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display font-bold text-xl">
                Confirm before saving
              </DialogTitle>
              <DialogDescription>
                Click any card to include or skip it. Nothing is saved until you
                confirm.
              </DialogDescription>
            </DialogHeader>

            {actions.length === 0 ? (
              <div className="bg-card rounded-lg border border-border shadow-sm p-4 text-sm text-muted-foreground">
                Nothing actionable found. Go back and add more detail.
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
                {actions.map((a, i) => {
                  const on = selected.has(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleSelected(i)}
                      className={`text-left rounded-lg border p-3 transition-colors ${
                        on
                          ? "bg-card border-[var(--gold)] shadow-sm"
                          : "bg-transparent border-border opacity-55"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11px] tracking-[0.14em] uppercase font-bold text-[var(--gold-dark)]">
                          {TOOL_LABELS[a.tool] ?? a.tool}
                        </span>
                        <span
                          className={`w-5 h-5 rounded-full grid place-items-center shrink-0 ${
                            on
                              ? "bg-[var(--gold-light)] text-black"
                              : "bg-black/10 text-transparent"
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      </div>
                      <div className="text-sm font-semibold">{a.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {a.summary}
                      </div>
                      {a.needsReview && (
                        <div className="text-[11px] text-[var(--gold-dark)] font-semibold mt-1.5">
                          ⚠ Double-check the details
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPhase("capture")}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                onClick={runConfirm}
                disabled={selected.size === 0 || confirm.isPending}
                className="flex-1"
              >
                {confirm.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    Save {selected.size > 0 ? selected.size : ""}{" "}
                    {selected.size === 1 ? "item" : "items"}
                  </>
                )}
              </Button>
            </div>

            {confirm.isError && (
              <div className="text-xs text-destructive">
                Couldn't save. Please try again.
              </div>
            )}
          </>
        )}

        {phase === "done" && (
          <>
            <div className="flex flex-col items-center text-center my-2">
              <span className="w-12 h-12 rounded-full bg-[var(--gold-light)] grid place-items-center shadow-[0_6px_20px_rgba(143,106,31,0.38)]">
                <Check className="w-6 h-6 text-black" />
              </span>
              <DialogTitle className="font-display font-bold text-xl mt-3">
                {appliedCount > 0
                  ? `Saved ${appliedCount} ${appliedCount === 1 ? "item" : "items"}`
                  : "Nothing saved"}
              </DialogTitle>
            </div>

            {resultMessages.length > 0 && (
              <div className="flex flex-col gap-2">
                {resultMessages.map((m, i) => (
                  <div
                    key={i}
                    className="bg-card rounded-lg border border-border shadow-sm p-2.5 text-sm"
                  >
                    {m}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <Button variant="outline" className="flex-1" onClick={resetAll}>
                Say something else
              </Button>
              <Button className="flex-1" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
