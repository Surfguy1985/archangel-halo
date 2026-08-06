import { useState, useEffect, useRef } from "react";
import { 
  useListJobBoard, 
  getListJobBoardQueryKey, 
  useBroadcastJob, 
  useReopenJob, 
  useUnlistJob,
  useUpdateJob,
  useCompleteJob,
  useUpdateBoardSettings,
  useQualityCheckJob,
  useSetJobBoardStatus,
  usePayJobCrewMember,
  useCreateExpense,
  useClearJobCrewPay,
  useRecordPayment,
  useRequestUploadUrl,
  useListCrews,
  getListCrewsQueryKey,
  useReopenJobChangeOrder,
  useAddJobLineItem,
  useUpdateJobLineItem,
  useGetPhotoLibrary,
  getGetPhotoLibraryQueryKey,
  useAssignPhotosToJob,
  type PhotoLibraryEntry,
  type JobBoardCard,
  type Crew,
  type CrewToday,
  useSendCheckFollowup,
} from "@workspace/api-client-react";
import { StageArtPanel, type RailKey } from "@workspace/board-ui";
import { Skeleton} from "@/components/ui/skeleton";
import { Card, CardContent} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem} from "@/components/ui/radio-group";
import { Label} from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from "@/components/ui/alert-dialog";
import { Button} from "@/components/ui/button";
import { useToast} from "@/hooks/use-toast";
import { useQueryClient} from "@tanstack/react-query";
import { format} from "date-fns";
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
  Trash2,
  ShieldCheck,
  Loader2,
  MessageSquare,
  Users,
  XCircle,
  FileText,
  Banknote,
  Receipt,
  Plus,
  Upload,
  Camera,
  BellRing,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ArrowRight,
  HelpCircle,
  X,
  FolderOpen,
} from "lucide-react";
import { PushCardDialog } from "@/components/PushCardDialog";
import { ScanCheckDialog } from "@/components/ScanCheckDialog";
import { useLocation } from "wouter";
import { Badge} from "@/components/ui/badge";
import { Input} from "@/components/ui/input";
import { Textarea} from "@/components/ui/textarea";

/**
 * Rails layout mirroring the client board structure: fixed vertical rails,
 * compact tiles, detail + actions in a sheet. Cards move themselves as
 * status changes — no drag between rails.
 */
const JOB_RAILS: { key: JobRailKey; label: string; tone: JobTone; hint: string; empty: string }[] = [
  { key: "requested", label: "Requested", tone: "lime", hint: "New work waiting for a crew", empty: "No open requests — new jobs land here from a client ask or Quick Job." },
  { key: "in_progress", label: "In progress", tone: "blue", hint: "A crew is on it", empty: "Nothing in motion — assign or broadcast a Requested job to start." },
  { key: "done", label: "Done", tone: "emerald", hint: "Work finished — needs PO, then billing", empty: "Nothing finished yet — jobs move here when the crew checks off the work." },
  { key: "billing", label: "Billing", tone: "stone", hint: "Invoice out, waiting on payment", empty: "No billing yet — Done jobs with a PO move here to get paid." },
  { key: "alert", label: "Alerts", tone: "red", hint: "Needs your attention now", empty: "No alerts — all covered." },
];

/** Card's ONE next step — teaches new users what to do by following the buttons. */
function nextAction(card: JobBoardCard, rail: JobRailKey): string | null {
  switch (rail) {
    case "requested":
      return "Assign or broadcast a crew";
    case "in_progress":
      return "Check work when the crew finishes";
    case "done":
      return card.job.poNumber ? "Move to Billing" : "Get the client PO";
    case "billing":
      return card.invoice ? "Collect payment" : "Send the invoice";
    case "alert":
      return "Open to fix";
    default:
      return null;
  }
}

type JobRailKey = "requested" | "in_progress" | "done" | "billing" | "alert";
type JobTone = "lime" | "blue" | "emerald" | "stone" | "red";

/** Same five rails as the client board: Requested → In progress → Done → Billing → Alerts (red, last). */
function jobRail(card: JobBoardCard): JobRailKey {
  // A pending client change order pulls the card back to Requested until the
  // office reviews upcharges and reopens it — mirrored on the client board.
  if (card.job.changeOrderStatus === "requested") return "requested";
  const board = card.job.boardStatus || "active";
  if (board === "manual_check") return "alert"; // failed AI check — needs a manual look
  if (board === "pay_alert") return "alert"; // crew paid — clear each row to history
  if (board === "reopened") return "alert"; // lost its crew — needs the office
  // Client reported the check as sent but we haven't verified/received it yet:
  // the card sits in Alerts until the physical check is scanned in.
  if (
    card.invoice?.clientPaidReportedAt &&
    !card.invoice.paidAt &&
    card.invoice.status !== "paid"
  )
    return "alert";
  if (board === "billing") return "billing"; // client picked a payment route
  if (card.job.status === "complete" || card.job.status === "paid") return "billing";
  if (board === "completed") return "done";
  if (board === "filled") return "in_progress";
  return "requested";
}

const JOB_TONES: Record<JobTone, { chip: string; dot: string }> = {
  lime: { chip: "bg-[var(--gold-light)] text-black", dot: "bg-[var(--gold-light)]" },
  blue: { chip: "bg-sky-100 text-sky-800", dot: "bg-sky-400" },
  emerald: { chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-400" },
  stone: { chip: "bg-stone-100 text-stone-600", dot: "bg-stone-300" },
  red: { chip: "bg-red-100 text-red-800", dot: "bg-[#DC2626]" },
};

export default function JobBoard() {
  const { data: jobBoard, isLoading} = useListJobBoard({
    query: { queryKey: getListJobBoardQueryKey(), refetchInterval: 5000},
 });
  // Crew roster so in-progress tiles can show the assigned team.
  const { data: allCrews } = useListCrews({ query: { queryKey: getListCrewsQueryKey() } });
  const [openId, setOpenId] = useState<string | null>(null);
  // First-time teaching aids: a dismissible intro banner + an always-available legend.
  const [showIntro, setShowIntro] = useState(() => {
    try { return localStorage.getItem("jobboard-intro-dismissed") !== "1"; } catch { return false; }
  });
  const dismissIntro = () => {
    setShowIntro(false);
    try { localStorage.setItem("jobboard-intro-dismissed", "1"); } catch { /* private mode */ }
  };
  const [legendOpen, setLegendOpen] = useState(false);
  // Property decks: cards stack by property inside each rail; a deck stays
  // collapsed until the property is selected. Keyed by rail|propertyId.
  const [expandedDecks, setExpandedDecks] = useState<Set<string>>(new Set());
  const toggleDeck = (key: string, open: boolean) =>
    setExpandedDecks((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  // One card per unit on the board: the server lists jobs newest-first, so
  // keep the first (newest) card per property+unit and drop older duplicates.
  const cards = (() => {
    const seen = new Set<string>();
    const out: JobBoardCard[] = [];
    for (const c of jobBoard ?? []) {
      const key = c.job.unitNo ? `${c.job.propertyId}|${c.job.unitNo}` : c.job.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  })();
  const openCard = cards.find((c) => c.job.id === openId) ?? null;

  // Flash cards that just switched rails for 15s so the move is easy to spot.
  // Rails are compared against the previous render's snapshot; first sight of
  // a card (initial load) never flashes.
  const prevRails = useRef<Map<string, JobRailKey> | null>(null);
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const prev = prevRails.current;
    const next = new Map<string, JobRailKey>();
    const moved: string[] = [];
    for (const c of cards) {
      const r = jobRail(c);
      next.set(c.job.id, r);
      const p = prev?.get(c.job.id);
      if (p && p !== r) moved.push(c.job.id);
    }
    prevRails.current = next;
    if (moved.length === 0) return;
    setFlashing((s) => new Set([...s, ...moved]));
    for (const id of moved) {
      const old = flashTimers.current.get(id);
      if (old) clearTimeout(old);
      flashTimers.current.set(
        id,
        setTimeout(() => {
          flashTimers.current.delete(id);
          setFlashing((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        }, 15000),
      );
    }
  }, [cards]);
  useEffect(() => {
    const timers = flashTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="p-8 max-w-[1400px] mx-auto space-y-8 min-h-[100dvh] flex flex-col bg-[var(--background)]">
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)]">Job Board</h1>
          <p className="text-muted-foreground mt-1 text-sm">Open work, offers out to crews, and what's been claimed</p>
        </div>
        <button
          type="button"
          onClick={() => setLegendOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-white px-3 py-1.5 text-xs font-bold text-[var(--secondary)] hover:bg-[var(--muted)] transition-colors"
          data-testid="button-board-legend"
        >
          <HelpCircle className="w-3.5 h-3.5" /> How the board works
        </button>
      </header>

      {showIntro && (
        <div
          className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--gold-light)] bg-[var(--gold-light)]/20 px-4 py-3 shrink-0"
          data-testid="board-intro-banner"
        >
          <p className="text-sm text-[var(--ink)]">
            <span className="font-bold">Jobs move left to right</span> — Requested → In progress → Done → Billing.
            The red column means it needs your attention right now. Open any card and follow the highlighted button.
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismissIntro}
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-black/[0.06] hover:text-foreground"
            data-testid="dismiss-board-intro"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <Dialog open={legendOpen} onOpenChange={setLegendOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-display">How the board works</DialogTitle>
            <DialogDescription>Jobs travel left to right as work gets done.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5 py-1">
            {JOB_RAILS.map((r) => (
              <div key={r.key} className="flex items-start gap-2.5">
                <span className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${JOB_TONES[r.tone].dot}`} />
                <div>
                  <span className="text-sm font-bold text-[var(--ink)]">{r.label}</span>
                  <span className="text-sm text-muted-foreground"> — {r.hint}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-border pt-3 text-sm text-muted-foreground">
            <p><span className="font-bold text-[var(--ink)]">Piles</span> — cards stack by property; tap a pile to fan it out.</p>
            <p><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">PO 123</span> / <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">PO needed</span> — a client PO is required before a Done job can move to Billing.</p>
            <p><span className="font-bold text-[var(--ink)]">Glowing card</span> — it just moved rails (lasts 15 seconds).</p>
            <p><span className="font-bold text-[var(--ink)]">"Next" line on a card</span> — the one thing to do next; open the card and follow it.</p>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex-1 pb-12">
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-6">
            {JOB_RAILS.map((r) => (
              <Skeleton key={r.key} className="h-[320px] rounded-2xl bg-muted" />
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border border-dashed border-[var(--hairline)] text-muted-foreground bg-card rounded-2xl">
            <ClipboardList className="w-12 h-12 mb-4 text-border" />
            <p className="font-medium text-lg text-[var(--secondary)]">Nothing on the board yet</p>
            <p className="text-sm">Post a job from a property, or use + New → Job.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5 items-start" data-testid="jobboard-rails">
            {JOB_RAILS.map((rail) => {
              const railCards = cards.filter((c) => jobRail(c) === rail.key);
              return (
                <section key={rail.key} className="min-w-0" data-testid={`jobrail-${rail.key}`}>
                  <div className="mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${JOB_TONES[rail.tone].dot}`} />
                      <h2 className="font-display font-bold text-sm tracking-tight text-[var(--ink)]">{rail.label}</h2>
                      <span className="text-xs font-mono text-muted-foreground">{railCards.length}</span>
                      {/* Pipeline arrows: the board reads left → right */}
                      {rail.key !== "alert" && rail.key !== "billing" && (
                        <ChevronRight className="ml-auto w-3.5 h-3.5 text-muted-foreground/50" aria-hidden />
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{rail.hint}</p>
                  </div>
                  <div className="space-y-4">
                    {railCards.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-[var(--hairline)] px-4 py-6 text-center text-xs text-muted-foreground bg-card/50">
                        {rail.empty}
                      </div>
                    ) : (
                      groupByProperty(railCards).map(([propId, deck]) => {
                        const deckKey = `${rail.key}|${propId}`;
                        const expanded = expandedDecks.has(deckKey);
                        const propName = deck[0].job.propertyName || "Unknown Property";
                        if (!expanded) {
                          // Collapsed deck: a stacked pile — select the
                          // property to fan its cards out. If a card inside
                          // just moved rails, the whole pile flashes.
                          const deckFlash = deck.some((c) => flashing.has(c.job.id));
                          return (
                            <button
                              key={deckKey}
                              type="button"
                              onClick={() => toggleDeck(deckKey, true)}
                              className={`relative block w-full text-left group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9DB40F] rounded-2xl ${deckFlash ? "card-move-flash" : ""}`}
                              data-testid={`deck-${rail.key}-${propId}`}
                            >
                              {deck.length > 2 && (
                                <span className="absolute inset-x-3 -bottom-2 h-full rounded-2xl border border-[var(--hairline)] bg-white shadow-sm" aria-hidden />
                              )}
                              {deck.length > 1 && (
                                <span className="absolute inset-x-1.5 -bottom-1 h-full rounded-2xl border border-[var(--hairline)] bg-white shadow-sm" aria-hidden />
                              )}
                              <span className="relative block rounded-2xl border border-[var(--hairline)] bg-white px-3.5 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
                                <span className="flex items-center justify-between gap-2">
                                  <span className="min-w-0">
                                    <span className="block truncate font-display font-bold text-sm text-[var(--ink)]">{propName}</span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                      {deck.length} job{deck.length === 1 ? "" : "s"}
                                      {deck.some((c) => c.job.unitNo) && (
                                        <> · {deck.filter((c) => c.job.unitNo).slice(0, 4).map((c) => `#${c.job.unitNo}`).join(" ")}{deck.filter((c) => c.job.unitNo).length > 4 ? "…" : ""}</>
                                      )}
                                    </span>
                                  </span>
                                  <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${JOB_TONES[rail.tone].chip}`}>
                                    {deck.length}
                                    <ChevronDown className="w-3 h-3" />
                                  </span>
                                </span>
                              </span>
                            </button>
                          );
                        }
                        return (
                          <div key={deckKey} className="space-y-2.5" data-testid={`deck-open-${rail.key}-${propId}`}>
                            <div className="flex items-center justify-between gap-2 px-1">
                              <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{propName}</span>
                              <button
                                type="button"
                                onClick={() => toggleDeck(deckKey, false)}
                                className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--hairline)] bg-white px-2 py-0.5 text-[10px] font-bold text-[var(--ink)] hover:bg-[var(--muted)]"
                                data-testid={`deck-minimize-${rail.key}-${propId}`}
                              >
                                <ChevronUp className="w-3 h-3" /> Minimize
                              </button>
                            </div>
                            {deck.map((card) => (
                              <JobTile
                                key={card.job.id}
                                card={card}
                                tone={rail.tone}
                                crews={allCrews}
                                flash={flashing.has(card.job.id)}
                                onOpen={() => setOpenId(card.job.id)}
                              />
                            ))}
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!openCard} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <DialogContent className="sm:max-w-[760px] p-0 gap-0 overflow-hidden rounded-2xl max-h-[88dvh] overflow-y-auto border-none bg-transparent shadow-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Job details</DialogTitle>
            <DialogDescription>Full job posting with actions</DialogDescription>
          </DialogHeader>
          {openCard && <JobBoardItem card={openCard} crews={allCrews ?? []} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Tiny circular crew avatar — prefers the crew selfie over initials (project convention). */
function CrewFace({ name, selfiePath, size = 5 }: { name: string; selfiePath?: string | null; size?: 5 | 6 }) {
  const dim = size === 6 ? "h-6 w-6" : "h-5 w-5";
  return selfiePath ? (
    <img
      src={`/api/storage${selfiePath}`}
      alt={name}
      className={`${dim} block shrink-0 rounded-full object-cover`}
    />
  ) : (
    <span className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-[var(--secondary)] text-[9px] font-bold text-white`}>
      {name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
    </span>
  );
}

/** Deck grouping: one pile per property inside a rail, preserving the
 *  rail's card order (newest-first from the server). */
function groupByProperty(railCards: JobBoardCard[]): [string, JobBoardCard[]][] {
  const byProp = new Map<string, JobBoardCard[]>();
  for (const c of railCards) {
    const key = c.job.propertyId ?? "unknown";
    const list = byProp.get(key) ?? [];
    list.push(c);
    byProp.set(key, list);
  }
  return [...byProp.entries()];
}

/** "Cabinet Paint — 2 BR" → "Cabinet Paint": strip the size suffix so the
 *  pill reads as the service, while the size stays in the line items. */
function serviceBase(s: string) {
  return s.replace(/\s*[—–-]\s*\d\s*BR\s*$/i, "").trim();
}

// Solid stage panels (shared with the client board's rail tiles): the
// thumbnail background matches the rail's color coding and one animated
// icon sits on the right. Tones map 1:1 onto rails.
const TONE_RAIL: Record<JobTone, RailKey> = {
  lime: "requested",
  blue: "in_progress",
  emerald: "done",
  stone: "paid",
  red: "needs_you",
};

const TONE_OVERLAY_TEXT: Record<JobTone, string> = {
  lime: "text-black/80 [text-shadow:none]",
  blue: "text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.45)]",
  emerald: "text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.45)]",
  stone: "text-[#40361F] [text-shadow:none]",
  red: "text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.45)]",
};
const OVERLAY_TEXT = "text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.45)]";

// Client board lane labels — shown when the property moved this job's card
// on their own board, so office sees the client's placement at a glance.
const CLIENT_LANE_LABELS: Record<string, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  billing: "Billing",
  done: "Done",
};

function JobTile({ card, tone, crews, flash, onOpen }: { card: JobBoardCard; tone: JobTone; crews?: Crew[]; flash?: boolean; onOpen: () => void }) {
  const { job, photos, broadcasts } = card;
  const clientLaneLabel = card.clientLane ? CLIENT_LANE_LABELS[card.clientLane] ?? null : null;
  const services = job.services ?? [];
  const t = JOB_TONES[tone];
  // Assigned crew (in-progress rail only): leader first with a badge, then teammates.
  const leader = crews && job.crewLeaderId ? crews.find((c) => c.id === job.crewLeaderId) : undefined;
  const team = leader ? (crews ?? []).filter((c) => c.leaderId === leader.id && c.active !== false) : [];
  // A manually assigned leader counts as a filled slot even when no broadcast
  // was claimed — otherwise assigned jobs read "0/1 crews".
  const filledCount = Math.max(job.crewsFilled ?? 0, job.crewLeaderId ? 1 : 0);
  const filled = filledCount >= (job.crewsNeeded ?? 1);
  const artwork = photos[0]?.storagePath;
  const pendingOffers = broadcasts.filter((b) => b.status === "sent" || b.status === "pending").length;

  return (
    <div>
    <button
      type="button"
      onClick={onOpen}
      data-testid={`job-tile-${job.id}`}
      className={`block w-full min-w-0 text-left rounded-2xl overflow-hidden bg-white border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9DB40F] ${flash ? "card-move-flash" : ""}`}
    >
      <div className="relative aspect-[5/2] overflow-hidden bg-[var(--muted)]">
        {/* Always the solid stage panel — navy background on every card, the
            rail's colored icon carries the color coding. */}
        <StageArtPanel rail={TONE_RAIL[tone]} bg="var(--secondary)" testId={`job-stage-art-${job.id}`} />
        {/* Big uniform unit number, white, top-left corner. Property-level
            jobs (no unit) show the service big instead. */}
        {job.unitNo ? (
          <span
            className={`absolute top-2 left-3 font-display font-bold text-4xl pointer-events-none ${OVERLAY_TEXT}`}
            data-testid={`job-unit-${job.id}`}
          >
            {job.unitNo}
          </span>
        ) : services.length > 0 ? (
          <span
            className={`absolute top-2 left-3 max-w-[calc(100%-72px)] truncate font-display font-bold text-2xl pointer-events-none ${OVERLAY_TEXT}`}
            data-testid={`job-service-big-${job.id}`}
          >
            {serviceBase(services[0])}
          </span>
        ) : (
          !artwork && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <ClipboardList className="w-5 h-5 text-white/25" />
            </div>
          )
        )}
        <span className={`absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate rounded-full px-2.5 py-1 text-[11px] font-medium ${t.chip}`} data-testid={`job-services-${job.id}`}>
          {services.length > 0
            ? services.map(serviceBase).filter((s, i, a) => a.indexOf(s) === i).join(" · ")
            : job.category || job.boardStatus || "Job"}
        </span>
        {pendingOffers > 0 && (
          <span className="absolute top-2 right-2 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-bold text-[var(--ink)]">
            {pendingOffers} offer{pendingOffers > 1 ? "s" : ""} out
          </span>
        )}
        {clientLaneLabel && (
          <span
            className={`absolute right-2 rounded-full bg-[var(--gold-light)] px-2 py-0.5 text-[10px] font-bold text-black ${pendingOffers > 0 ? "top-8" : "top-2"}`}
            title="Where the client placed this card on their board"
            data-testid={`job-client-lane-${job.id}`}
          >
            Client: {clientLaneLabel}
          </span>
        )}
        {TONE_RAIL[tone] === "done" && (
          <span
            className={`absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${job.poNumber ? "bg-emerald-100 text-emerald-800" : "bg-red-500 text-white"}`}
            title={job.poNumber ? `PO ${job.poNumber}` : "A client PO is required before this job can move to Billing"}
            data-testid={`job-po-${job.id}`}
          >
            {job.poNumber ? `PO ${job.poNumber}` : "PO needed"}
          </span>
        )}
        {job.changeOrderStatus === "requested" && (
          <span
            className="absolute bottom-0 left-0 right-0 bg-amber-400 px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-widest text-black"
            data-testid={`job-change-order-${job.id}`}
          >
            Change order
          </span>
        )}
      </div>
      <div className="min-w-0 px-3.5 py-3">
        <p className="truncate font-display font-bold text-sm text-[var(--ink)]">
          {job.propertyName || "Unknown Property"}{job.unitNo ? ` · #${job.unitNo}` : ""}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {job.scheduledOn
            ? `Needed ${format(new Date(job.scheduledOn + "T00:00:00"), "MMM d")}`
            : job.scheduleType === "flex"
              ? `Flex${job.flexDueBy ? ` · due ${format(new Date(job.flexDueBy + "T00:00:00"), "MMM d")}` : ""}`
              : job.jobNo}
          {" · "}
          <span className={filled ? "text-emerald-600 font-medium" : ""}>
            {filledCount}/{job.crewsNeeded ?? 1} crews
          </span>
        </p>
        {(() => {
          const action = nextAction(card, jobRail(card));
          return action ? (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--gold-dark)]" data-testid={`job-next-${job.id}`}>
              Next: {action} <ArrowRight className="w-3 h-3" />
            </p>
          ) : null;
        })()}
        {(leader || (crews && job.crewLeaderName)) && (
          <div className="mt-2 flex items-center gap-2 min-w-0" data-testid={`job-crew-${job.id}`}>
            {/* Overlapping circle photos: leader first (lime ring), then teammates */}
            <span className="flex shrink-0 items-center">
              <span className="rounded-full ring-2 ring-[var(--gold-light)]">
                <CrewFace name={leader?.name ?? job.crewLeaderName ?? "Crew"} selfiePath={leader?.selfiePath} size={6} />
              </span>
              {team.map((m) => (
                <span key={m.id} className="-ml-1.5 rounded-full ring-2 ring-white" title={m.name}>
                  <CrewFace name={m.name} selfiePath={m.selfiePath} size={6} />
                </span>
              ))}
            </span>
            <span className="truncate text-[11px] font-semibold text-[var(--ink)]">
              {leader?.name ?? job.crewLeaderName}
              {team.length > 0 && <span className="font-normal text-muted-foreground"> +{team.length}</span>}
            </span>
            <span className="shrink-0 rounded-full bg-[var(--gold-light)] px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-black">
              Leader
            </span>
          </div>
        )}
      </div>
    </button>
    {job.boardStatus === "manual_check" && <MarkCompleteButton jobId={job.id} small />}
    </div>
  );
}

/** Assigned crew with a live link per member — jump straight to their page
 *  to message them or see their live position on the map. */
function AssignedCrewPanel({ job, crews }: { job: JobBoardCard["job"]; crews: CrewToday[] }) {
  const [, navigate] = useLocation();
  const leader = job.crewLeaderId ? crews.find((c) => c.id === job.crewLeaderId) : undefined;
  if (!leader) return null;
  const team = crews.filter((c) => c.leaderId === leader.id && c.active !== false);
  const members = [leader, ...team];
  const statusLabel: Record<string, string> = { route: "On route", site: "On site", done: "Done for today", idle: "Idle" };
  return (
    <div>
      <h4 className="text-xs font-bold text-[var(--secondary)] mb-2 flex items-center gap-1">
        <Users className="w-3.5 h-3.5" /> Crew
      </h4>
      <div className="space-y-2">
        {members.map((m, i) => (
          <div key={m.id} className="flex items-center gap-2.5 text-sm p-2 bg-[var(--background)] border border-border rounded-none" data-testid={`crew-member-${m.id}`}>
            <CrewFace name={m.name} selfiePath={m.selfiePath} size={6} />
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-medium text-[var(--secondary)] truncate">
                {m.name}
                {i === 0 && <span className="rounded-full bg-[var(--gold-light,#B4FF44)] px-1.5 py-px text-[9px] font-bold text-black">LEADER</span>}
              </span>
              {m.todayStatus && (
                <span className="block text-[11px] text-muted-foreground truncate">
                  {statusLabel[m.todayStatus] ?? m.todayStatus}{m.todayProperty ? ` · ${m.todayProperty}` : ""}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate(`/crews/${m.id}`)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-[11px] font-bold text-[var(--secondary)] hover:bg-[var(--secondary)] hover:text-white transition-colors"
              data-testid={`crew-live-link-${m.id}`}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live link
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function JobBoardItem({ card, crews }: { card: JobBoardCard; crews: CrewToday[] }) {
  const { job, priceItems, lineItems, photos, broadcasts} = card;
  const updateLineItem = useUpdateJobLineItem();
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [postingOpen, setPostingOpen] = useState(false);
  const [checkWorkOpen, setCheckWorkOpen] = useState(false);
  const [payFlowOpen, setPayFlowOpen] = useState(false);
  const [expensesOpen, setExpensesOpen] = useState(false);
  const [pushInvoiceOpen, setPushInvoiceOpen] = useState(false);
  const [scanCheckOpen, setScanCheckOpen] = useState(false);
  const checkFollowup = useSendCheckFollowup();
  const rail = jobRail(card);
  const [, navigate] = useLocation();
  const [upchargeId, setUpchargeId] = useState<string>("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const reopenChangeOrder = useReopenJobChangeOrder();
  const addLineItem = useAddJobLineItem();
  const updateJob = useUpdateJob();
  const [poDraft, setPoDraft] = useState(job.poNumber ?? "");
  useEffect(() => setPoDraft(job.poNumber ?? ""), [job.poNumber]);
  const savePo = () => {
    const poNumber = poDraft.trim();
    if (!poNumber || poNumber === (job.poNumber ?? "")) return;
    updateJob.mutate(
      { id: job.id, data: { poNumber } },
      {
        onSuccess: () => {
          toast({ title: "PO saved", description: `PO ${poNumber} attached to ${job.jobNo}. The card can move to Billing.` });
          queryClient.invalidateQueries({ queryKey: getListJobBoardQueryKey() });
        },
        onError: (err) =>
          toast({ title: "Couldn't save PO", description: (err as any)?.data?.error ?? (err as Error).message, variant: "destructive" }),
      },
    );
  };
  const pendingCO = job.changeOrderStatus === "requested";
  const completeJob = useCompleteJob();
  // Done→Billing shortcut: only offered once the PO gate AND the work
  // checklist are both satisfied — the server re-checks the same rules.
  const checklistDone =
    (lineItems?.length ?? 0) > 0 && (lineItems ?? []).every((li) => !!li.completedAt);
  const readyForBilling = !!job.poNumber && checklistDone;
  const moveToBilling = () => {
    completeJob.mutate(
      { id: job.id, data: {} },
      {
        onSuccess: () => {
          toast({ title: "Moved to Billing", description: `${job.jobNo} is ready to invoice.` });
          queryClient.invalidateQueries({ queryKey: getListJobBoardQueryKey() });
        },
        onError: (err) =>
          toast({
            title: "Couldn't move to Billing",
            description: (err as any)?.data?.error ?? (err as Error).message,
            variant: "destructive",
          }),
      },
    );
  };
  
  const statusColors: Record<string, string> = {
    active: "bg-blue-100 text-blue-800",
    filled: "bg-emerald-100 text-emerald-800",
    reopened: "bg-orange-100 text-orange-800",
    completed: "bg-gray-100 text-gray-600",
 };

  const boardStatus = job.boardStatus || "active";
  const badgeColor = statusColors[boardStatus] || statusColors.active;

  return (
    <Card className="flex flex-col shadow-sm rounded-3xl overflow-hidden bg-white border-none">
      <div className="p-6 bg-[var(--secondary)]">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-white/60">{job.jobNo}</span>
              <span className={`text-[10px] font-bold   px-2.5 py-0.5 rounded-full ${badgeColor}`}>
                {boardStatus}
              </span>
            </div>
            <h3 className="font-display font-bold text-2xl text-white flex items-center gap-2">
              {job.propertyName || "Unknown Property"}
              {job.unitNo && <span className="text-white/60 font-normal">#{job.unitNo}</span>}
            </h3>
          </div>
          {job.marginPct !== null && job.marginPct !== undefined && (
            <div className="text-right">
              <div className="text-xs text-[var(--primary)] font-bold">Margin</div>
              <div className="font-mono font-bold text-white text-xl">{job.marginPct}%</div>
            </div>
          )}
        </div>
        
        <div className="flex flex-wrap gap-4 mt-3 text-sm text-white/80">
          {job.category && (
            <div className="flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4" />
              <span>{job.category}</span>
            </div>
          )}
          {job.scheduledOn && (
            <div className="flex items-center gap-1.5">
              <CalendarIcon className="w-4 h-4" />
              <span>Needed: <span className="font-medium text-[var(--primary)]">{format(new Date(job.scheduledOn + "T00:00:00"), "MMM d, yyyy")}</span></span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          {job.scheduleType === "flex" ? (
            <span className="text-[10px] font-bold px-3 py-1 rounded-full bg-emerald-400 text-black">
              Flex{job.flexDueBy ?` · due ${format(new Date(job.flexDueBy + "T00:00:00"), "MMM d")}` : ""}
            </span>
          ) : (
            <span className="text-[10px] font-bold px-3 py-1 rounded-full bg-[var(--primary)] text-black">
              Set Schedule
            </span>
          )}
          <span className={`text-[10px] font-bold   px-3 py-1 rounded-full ${
            Math.max(job.crewsFilled ?? 0, job.crewLeaderId ? 1 : 0) >= (job.crewsNeeded ?? 1)
              ? "bg-emerald-400 text-black"
              : "bg-white text-black"
         }`}>
            {Math.max(job.crewsFilled ?? 0, job.crewLeaderId ? 1 : 0)} of {job.crewsNeeded ?? 1} crew{(job.crewsNeeded ?? 1) > 1 ? "s" : ""} filled
          </span>
          {boardStatus !== "completed" && (
            <button
              onClick={() => setPostingOpen(true)}
              className="text-[10px] font-bold px-3 py-1 rounded-full border border-white/20 text-white hover:bg-white hover:text-black transition-colors inline-flex items-center gap-1"
            >
              <Pencil className="w-3 h-3" /> Edit Posting
            </button>
          )}
        </div>
      </div>

      <CardContent className="p-0 flex-1 flex flex-col">
        <div className="p-5 flex-1 flex flex-col gap-6">
          {pendingCO && (
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4" data-testid={`change-order-panel-${job.id}`}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold uppercase tracking-widest text-amber-900">Change order — needs review</h4>
                {job.changeOrderAt && (
                  <span className="text-[10px] text-amber-800">{format(new Date(job.changeOrderAt), "MMM d, h:mm a")}</span>
                )}
              </div>
              <p className="text-sm font-semibold text-amber-950">{job.changeOrderReason}</p>
              {job.changeOrderNote && (
                <p className="mt-1 text-sm whitespace-pre-wrap text-amber-900">{job.changeOrderNote}</p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <Select value={upchargeId} onValueChange={setUpchargeId}>
                  <SelectTrigger className="h-9 flex-1 bg-white text-sm" data-testid={`select-upcharge-${job.id}`}>
                    <SelectValue placeholder="Add upcharge from price list…" />
                  </SelectTrigger>
                  <SelectContent>
                    {priceItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.service} — ${item.rate}{item.unit ? `/${item.unit}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!upchargeId || addLineItem.isPending}
                  data-testid={`button-add-upcharge-${job.id}`}
                  onClick={() =>
                    addLineItem.mutate(
                      { id: job.id, data: { priceItemId: upchargeId } },
                      {
                        onSuccess: () => {
                          setUpchargeId("");
                          queryClient.invalidateQueries();
                          toast({ title: "Upcharge added to the job" });
                        },
                        onError: () => toast({ title: "Could not add upcharge", variant: "destructive" }),
                      },
                    )
                  }
                >
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              </div>
              <Button
                className="mt-3 w-full rounded-full bg-amber-400 font-bold text-black hover:bg-amber-300"
                disabled={reopenChangeOrder.isPending}
                data-testid={`button-reopen-change-order-${job.id}`}
                onClick={() =>
                  reopenChangeOrder.mutate(
                    { id: job.id },
                    {
                      onSuccess: () => {
                        queryClient.invalidateQueries();
                        toast({
                          title: "Back in the flow",
                          description: job.crewLeaderName
                            ? `${job.crewLeaderName} was alerted through their live link.`
                            : "Card returned to its rail.",
                        });
                      },
                      onError: () => toast({ title: "Could not reopen", variant: "destructive" }),
                    },
                  )
                }
              >
                <RotateCcw className="w-4 h-4 mr-2" /> Reopen into flow{job.crewLeaderName ? ` — same crew (${job.crewLeaderName})` : ""}
              </Button>
            </div>
          )}

          {job.description && (
            <div>
              <h4 className="text-xs font-bold text-[var(--secondary)] mb-2">Scope of Work</h4>
              <p className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">{job.description}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(lineItems?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-xs font-bold text-[var(--secondary)] mb-2 flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5" /> Work Checklist
                  {/* Live pulse — board refreshes every 5 s from crew portal */}
                  <span className="ml-1 flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    Live
                  </span>
                </h4>
                {/* Work checklist — items assigned to crew; crew checks off from
                    their portal link; auto-refreshes every 5 s so office sees
                    completions in near-real-time. */}
                <div className="space-y-2">
                  {(lineItems ?? []).map(item => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 text-sm p-2 border rounded-lg transition-colors ${
                        item.completedAt
                          ? "bg-emerald-50 border-emerald-200"
                          : "bg-[var(--background)] border-border"
                      }`}
                      data-testid={`line-item-${item.id}`}
                    >
                      <button
                        type="button"
                        title={item.completedAt ? "Mark not done (office override)" : "Mark done (office override)"}
                        disabled={updateLineItem.isPending}
                        onClick={() =>
                          updateLineItem.mutate(
                            { id: item.id, data: { completed: !item.completedAt } },
                            { onSuccess: () => queryClient.invalidateQueries() },
                          )
                        }
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          item.completedAt
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-muted-foreground/40 text-transparent hover:border-emerald-500"
                        }`}
                        data-testid={`line-item-check-${item.id}`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className={`font-medium block truncate ${item.completedAt ? "text-muted-foreground line-through" : "text-[var(--secondary)]"}`}>
                          {item.service}
                        </span>
                        {item.completedAt && item.assignedCrewName && (
                          <span className="text-[10px] text-emerald-700 font-semibold">
                            ✓ Done by {item.assignedCrewName} · {new Date(item.completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </span>
                        )}
                        {item.completedAt && !item.assignedCrewName && (
                          <span className="text-[10px] text-emerald-700 font-semibold">
                            ✓ Completed · {new Date(item.completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                      {item.completedAt ? (
                        <span className="shrink-0 text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">Done</span>
                      ) : (
                        <Select
                          value={item.assignedCrewId ?? "none"}
                          onValueChange={(v) =>
                            updateLineItem.mutate(
                              { id: item.id, data: { assignedCrewId: v === "none" ? null : v } },
                              { onSuccess: () => queryClient.invalidateQueries() },
                            )
                          }
                        >
                          <SelectTrigger className="h-7 w-[130px] shrink-0 bg-white text-[11px]" data-testid={`line-item-crew-${item.id}`}>
                            <SelectValue placeholder="Assign crew" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Unassigned</SelectItem>
                            {crews.filter((c) => c.active !== false).map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <AssignedCrewPanel job={job} crews={crews} />

            {broadcasts.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-[var(--secondary)] mb-2 flex items-center gap-1">
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
              <h4 className="text-xs font-bold text-[var(--secondary)] mb-2 flex items-center gap-1">
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

        {(rail === 'done' || boardStatus === 'manual_check') && (
          /* Done→Billing gate: the card can't move to Billing without a client PO. */
          <div className="px-4 pt-3 bg-[var(--background)] border-t border-border flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full shrink-0 ${job.poNumber ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>
              {job.poNumber ? 'PO on file' : 'PO required'}
            </span>
            <Input
              value={poDraft}
              onChange={(e) => setPoDraft(e.target.value)}
              placeholder="Client PO number — required to bill"
              className="h-9 rounded-full bg-white"
              data-testid={`po-input-${job.id}`}
              onKeyDown={(e) => { if (e.key === 'Enter') savePo(); }}
            />
            <Button
              onClick={savePo}
              disabled={updateJob.isPending || !poDraft.trim() || poDraft.trim() === (job.poNumber ?? "")}
              data-testid={`po-save-${job.id}`}
              className="bg-[var(--gold-light)] hover:opacity-90 text-black rounded-full font-bold shrink-0"
            >
              {updateJob.isPending ? 'Saving…' : 'Save PO'}
            </Button>
          </div>
        )}
        <div className="p-4 bg-[var(--background)] border-t border-border flex justify-end gap-3 shrink-0">
          <Button
            variant="outline"
            onClick={() => setEditOpen(true)}
            className="text-[var(--secondary)] rounded-full border-border"
          >
            <Pencil className="w-4 h-4 mr-2" /> Edit
          </Button>
          <Button
            variant="outline"
            onClick={() => setDeleteConfirmOpen(true)}
            className="text-destructive border-destructive hover:bg-destructive hover:text-white rounded-full"
          >
            <Trash2 className="w-4 h-4 mr-2" /> Delete
          </Button>
          {(boardStatus === 'active' || boardStatus === 'reopened') && (
            <>
              {/* Manual assignment — skip the broadcast-and-wait loop. The
                  server PATCH atomically marks the job filled (In progress)
                  and withdraws any pending offers. */}
              <select
                value=""
                disabled={updateJob.isPending}
                data-testid={`assign-crew-${job.id}`}
                onChange={(e) => {
                  const crewLeaderId = e.target.value;
                  if (!crewLeaderId) return;
                  updateJob.mutate(
                    { id: job.id, data: { crewLeaderId } },
                    {
                      onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: getListJobBoardQueryKey() });
                        toast({ title: "Crew assigned", description: "Job moved to In progress." });
                      },
                      onError: (err) =>
                        toast({ title: "Couldn't assign crew", description: err.message, variant: "destructive" }),
                    },
                  );
                }}
                className="h-10 rounded-full border border-border bg-white px-4 text-sm font-bold text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 disabled:opacity-50"
              >
                <option value="">{updateJob.isPending ? "Assigning…" : "Assign crew…"}</option>
                {crews
                  .filter((c) => !c.leaderId && c.active !== false)
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
              <Button onClick={() => setBroadcastOpen(true)} className="bg-[var(--primary)] hover:opacity-90 text-black rounded-full font-bold">
                <Send className="w-4 h-4 mr-2" /> Broadcast Job
              </Button>
            </>
          )}
          {boardStatus === 'filled' && (
            <>
              <Button variant="outline" onClick={() => setReopenConfirmOpen(true)} className="text-orange-600 border-orange-600 hover:bg-orange-600 hover:text-white rounded-full">
                <RotateCcw className="w-4 h-4 mr-2" /> Reopen Job
              </Button>
              <Button
                onClick={() => setCheckWorkOpen(true)}
                data-testid={`check-work-${job.id}`}
                className="bg-[var(--gold-light)] hover:opacity-90 text-black rounded-full font-bold"
              >
                <ShieldCheck className="w-4 h-4 mr-2" /> Check Work
              </Button>
            </>
          )}
          {boardStatus === 'manual_check' && (
            <MarkCompleteButton jobId={job.id} />
          )}
          {/* Invoice actions live only on billing-rail cards; Done-rail cards
              wrap up the work itself (expenses) — no invoicing from Done. */}
          {rail === 'done' && (
            <>
              <Button
                variant="outline"
                onClick={() => setExpensesOpen(true)}
                data-testid={`log-expenses-${job.id}`}
                className="rounded-full font-bold"
              >
                <Receipt className="w-4 h-4 mr-2" /> Log Expenses
              </Button>
              {readyForBilling && (
                <Button
                  onClick={moveToBilling}
                  disabled={completeJob.isPending}
                  data-testid={`move-to-billing-${job.id}`}
                  className="bg-[var(--gold-light)] hover:opacity-90 text-black rounded-full font-bold"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  {completeJob.isPending ? "Moving…" : "Move to Billing"}
                </Button>
              )}
            </>
          )}
          {rail === 'alert' && card.invoice?.clientPaidReportedAt && !card.invoice.paidAt && (
            <>
              <div className="flex items-center gap-2 text-amber-700 text-sm font-medium px-2">
                <Clock className="w-4 h-4" /> Client says check sent{" "}
                {format(new Date(card.invoice.clientPaidReportedAt), "MMM d")} · not received yet
              </div>
              {Date.now() - new Date(card.invoice.clientPaidReportedAt).getTime() > 7 * 24 * 60 * 60 * 1000 && (
                <Button
                  variant="outline"
                  disabled={checkFollowup.isPending}
                  onClick={() =>
                    checkFollowup.mutate(
                      { jobId: job.id },
                      {
                        onSuccess: () =>
                          toast({ title: "Follow-up sent", description: "The property was asked to verify the check was mailed." }),
                        onError: (err) =>
                          toast({ title: "Couldn't send follow-up", description: (err as any)?.data?.error ?? err.message, variant: "destructive" }),
                      },
                    )
                  }
                  data-testid={`check-followup-${job.id}`}
                  className="rounded-full font-bold text-amber-700 border-amber-400 hover:bg-amber-50"
                >
                  <BellRing className="w-4 h-4 mr-2" /> {checkFollowup.isPending ? "Sending…" : "Follow up with property"}
                </Button>
              )}
              <Button
                onClick={() => setScanCheckOpen(true)}
                data-testid={`scan-check-${job.id}`}
                className="bg-[var(--gold-light)] hover:opacity-90 text-black rounded-full font-bold"
              >
                <Camera className="w-4 h-4 mr-2" /> Scan received check
              </Button>
            </>
          )}
          {rail === 'billing' && !card.invoice && (
            <Button
              onClick={() => navigate(`/invoices/new?jobId=${job.id}&propertyId=${job.propertyId}`)}
              data-testid={`create-invoice-${job.id}`}
              className="bg-[var(--gold-light)] hover:opacity-90 text-black rounded-full font-bold"
            >
              <FileText className="w-4 h-4 mr-2" /> Create Invoice
            </Button>
          )}
          {rail === 'billing' && card.invoice && (
            <>
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium px-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Invoice {card.invoice.invoiceNo}
              </div>
              <Button
                variant="outline"
                onClick={() => setPushInvoiceOpen(true)}
                data-testid={`push-invoice-${job.id}`}
                className="rounded-full font-bold"
              >
                <Send className="w-4 h-4 mr-2" /> Push to Client Board
              </Button>
            </>
          )}
          {(boardStatus === 'billing' || boardStatus === 'pay_alert') && (
            <Button
              onClick={() => setPayFlowOpen(true)}
              data-testid={`payment-pending-${job.id}`}
              className={
                boardStatus === 'billing' && !card.invoice?.paidAt
                  ? "bg-yellow-400 hover:bg-yellow-500 text-black rounded-full font-bold"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-bold"
              }
            >
              {boardStatus === 'billing' && !card.invoice?.paidAt ? (
                <><Clock className="w-4 h-4 mr-2" /> Job Payment Pending</>
              ) : (
                <><Banknote className="w-4 h-4 mr-2" /> Crew Pay</>
              )}
            </Button>
          )}
        </div>
      </CardContent>

      <CheckWorkDialog open={checkWorkOpen} onOpenChange={setCheckWorkOpen} job={job} photos={photos} />
      <PaymentFlowDialog open={payFlowOpen} onOpenChange={setPayFlowOpen} card={card} crews={crews} />
      <LogExpensesDialog open={expensesOpen} onOpenChange={setExpensesOpen} card={card} />
      {card.invoice && job.propertyId && (
        <ScanCheckDialog
          open={scanCheckOpen}
          onOpenChange={setScanCheckOpen}
          presetPropertyId={job.propertyId}
          presetInvoiceId={card.invoice.id}
        />
      )}
      {card.invoice && job.propertyId && (
        <PushCardDialog
          propertyId={job.propertyId}
          open={pushInvoiceOpen}
          onOpenChange={setPushInvoiceOpen}
          prefill={{
            templateId: "invoice",
            title: `Invoice ${card.invoice.invoiceNo}`,
            amount: card.invoice.total ?? null,
            source: { type: "invoice", id: card.invoice.id, jobId: job.id },
          }}
        />
      )}
      <BroadcastDialog open={broadcastOpen} onOpenChange={setBroadcastOpen} job={job} />
      <ReopenConfirmDialog open={reopenConfirmOpen} onOpenChange={setReopenConfirmOpen} job={job} />
      <DeleteConfirmDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen} job={job} />
      <EditJobDialog open={editOpen} onOpenChange={setEditOpen} job={job} />
      <EditPostingDialog open={postingOpen} onOpenChange={setPostingOpen} job={job} />
    </Card>
  );
}

/**
 * Log job expenses by line item, with an optional receipt photo (camera scan
 * on mobile). Each line posts as its own expense tied to the job + property,
 * so the property's expense section and the books pick it up per unit.
 */
function LogExpensesDialog({
  open,
  onOpenChange,
  card,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: JobBoardCard;
}) {
  const { job } = card;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createExpense = useCreateExpense();
  const requestUpload = useRequestUploadUrl();

  type ExpenseLine = { label: string; category: string; amount: string };
  const [lines, setLines] = useState<ExpenseLine[]>([{ label: "", category: "materials", amount: "" }]);
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLines([{ label: "", category: "materials", amount: "" }]);
      setReceiptPath(null);
    }
  }, [open]);

  const setLine = (i: number, patch: Partial<ExpenseLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await requestUpload.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type || "image/jpeg" },
      });
      await fetch(r.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/jpeg" } });
      setReceiptPath(r.objectPath);
      toast({ title: "Receipt attached" });
    } catch {
      toast({ title: "Upload failed", description: "Try the photo again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const valid = lines.filter((l) => l.label.trim() && Number.isFinite(Number(l.amount)) && Number(l.amount) > 0);
  const total = valid.reduce((s, l) => s + Number(l.amount), 0);

  const handleSave = async () => {
    if (!valid.length) {
      toast({ title: "Add at least one line item", description: "Each line needs a description and amount.", variant: "destructive" });
      return;
    }
    setSaving(true);
    let saved = 0;
    try {
      for (const l of valid) {
        await createExpense.mutateAsync({
          data: {
            jobId: job.id,
            propertyId: job.propertyId,
            vendor: l.label.trim(),
            category: l.category,
            amount: Math.round(Number(l.amount) * 100) / 100,
            paymentStatus: "paid",
            ...(receiptPath ? { receiptPath } : {}),
          },
        });
        saved++;
      }
      toast({
        title: `${saved} expense${saved === 1 ? "" : "s"} logged`,
        description: `${total.toLocaleString("en-US", { style: "currency", currency: "USD" })} added to the books for ${job.jobNo}.`,
      });
      queryClient.invalidateQueries();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: saved ? `Saved ${saved}, then hit an error` : "Couldn't log expenses",
        description: (err as any)?.data?.error ?? "Something went wrong",
        variant: "destructive",
      });
      queryClient.invalidateQueries();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Log Expenses</DialogTitle>
          <DialogDescription>
            {job.propertyName ?? "Property"}{job.unitNo ? ` · Unit ${job.unitNo}` : ""} · {job.jobNo}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2" data-testid="expense-lines">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2" data-testid={`expense-line-${i}`}>
              <Input
                value={l.label}
                onChange={(e) => setLine(i, { label: e.target.value })}
                placeholder="What was it? (e.g. Paint — Sherwin)"
                className="flex-1 h-9"
                data-testid={`expense-label-${i}`}
              />
              <select
                value={l.category}
                onChange={(e) => setLine(i, { category: e.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                data-testid={`expense-category-${i}`}
              >
                <option value="materials">Materials</option>
                <option value="equipment">Equipment</option>
                <option value="subcontractor">Subcontractor</option>
                <option value="disposal">Disposal</option>
                <option value="other">Other</option>
              </select>
              <Input
                value={l.amount}
                onChange={(e) => setLine(i, { amount: e.target.value })}
                placeholder="$"
                inputMode="decimal"
                className="w-24 h-9"
                data-testid={`expense-amount-${i}`}
              />
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label="Remove line"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLines((ls) => [...ls, { label: "", category: "materials", amount: "" }])}
            data-testid="add-expense-line"
            className="text-[var(--gold-dark)] font-bold"
          >
            <Plus className="w-4 h-4 mr-1" /> Add line
          </Button>
        </div>

        <div>
          <Label className="text-xs">Receipt (optional — applies to all lines)</Label>
          <label className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground cursor-pointer hover:bg-muted/50">
            <Upload className="w-4 h-4" />
            {uploading ? "Uploading…" : receiptPath ? "Receipt attached ✓" : "Upload or scan the receipt"}
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              data-testid="expense-receipt-input"
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
          </label>
        </div>

        <Button
          onClick={handleSave}
          disabled={saving || uploading}
          data-testid="save-expenses-btn"
          className="w-full bg-[var(--gold-light)] hover:opacity-90 text-black rounded-full font-bold"
        >
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Receipt className="w-4 h-4 mr-2" />}
          Log {valid.length || ""} Expense{valid.length === 1 ? "" : "s"}{total > 0 ? ` — ${total.toLocaleString("en-US", { style: "currency", currency: "USD" })}` : ""}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Billing-rail pay flow: mark the client's payment received (amount + check
 * photo), then pay each crew member; paid rows show "Pay pending" until the
 * office clears each one — last clear sends the card to history.
 */
function PaymentFlowDialog({
  open,
  onOpenChange,
  card,
  crews,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: JobBoardCard;
  crews: CrewToday[];
}) {
  const { job } = card;
  const invoice = card.invoice ?? null;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const recordPayment = useRecordPayment();
  const requestUpload = useRequestUploadUrl();
  const payCrew = usePayJobCrewMember();
  const clearPay = useClearJobCrewPay();

  const [amount, setAmount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [checkPath, setCheckPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setAmount(invoice ? String(invoice.total) : "");
  }, [open, invoice?.total]);

  const paymentReceived = !!invoice?.paidAt || invoice?.status === "paid";
  const leader = crews.find((c) => c.id === job.crewLeaderId) ?? null;
  const roster = leader
    ? [leader, ...crews.filter((c) => c.leaderId === leader.id && c.active !== false)]
    : [];
  const payEntries: { crewId: string; name: string; amount: number; paidAt: string | null; clearedAt: string | null }[] =
    Array.isArray((job as any).crewPay) ? ((job as any).crewPay as any[]) : [];
  const entryFor = (crewId: string) => payEntries.find((e) => e.crewId === crewId);

  const refresh = () => queryClient.invalidateQueries();

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await requestUpload.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type || "image/jpeg" },
      });
      await fetch(r.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/jpeg" } });
      setCheckPath(r.objectPath);
      toast({ title: "Check photo attached" });
    } catch {
      toast({ title: "Upload failed", description: "Try the photo again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleMarkReceived = () => {
    if (!invoice) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Enter the check amount", variant: "destructive" });
      return;
    }
    recordPayment.mutate(
      {
        data: {
          invoiceId: invoice.id,
          amount: amt,
          method: invoice.paymentChoice === "platform" ? "platform" : "check",
          ...(checkNumber.trim() ? { checkNumber: checkNumber.trim() } : {}),
          ...(checkPath ? { checkImagePath: checkPath } : {}),
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Payment recorded",
            description: checkPath
              ? `Invoice ${invoice.invoiceNo} marked paid.`
              : `Saved — ${invoice.invoiceNo} marks paid once the scanned check on file covers the amount.`,
          });
          refresh();
        },
        onError: (err) =>
          toast({ title: "Couldn't record payment", description: (err as any)?.data?.error ?? "Something went wrong", variant: "destructive" }),
      },
    );
  };

  const handlePayCrew = (crewId: string) => {
    const amt = Number(payAmounts[crewId]);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Enter a pay amount first", variant: "destructive" });
      return;
    }
    payCrew.mutate(
      { id: job.id, data: { crewId, amount: amt } },
      {
        onSuccess: () => {
          toast({ title: "Crew paid", description: "Logged to the books as crew labor." });
          refresh();
        },
        onError: (err) =>
          toast({ title: "Couldn't pay crew", description: (err as any)?.data?.error ?? "Something went wrong", variant: "destructive" }),
      },
    );
  };

  const handleClear = (crewId: string) => {
    clearPay.mutate(
      { id: job.id, data: { crewId } },
      {
        onSuccess: (updated) => {
          refresh();
          if ((updated as any)?.boardStatus === "removed") {
            toast({ title: "All settled", description: "Card cleared to history — money section updated." });
            onOpenChange(false);
          } else {
            toast({ title: "Cleared" });
          }
        },
        onError: (err) =>
          toast({ title: "Couldn't clear", description: (err as any)?.data?.error ?? "Something went wrong", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[880px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Job Payments</DialogTitle>
          <DialogDescription>
            {job.propertyName ?? "Property"}{job.unitNo ? ` · Unit ${job.unitNo}` : ""} · {job.jobNo}
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6">
        {/* LEFT — client invoice side */}
        <div className="space-y-3 md:border-r md:border-border md:pr-6">
        <p className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
          <FileText className="w-4 h-4" /> Invoice
        </p>
        {!invoice ? (
          <p className="text-sm text-muted-foreground">No invoice on this job yet.</p>
        ) : !paymentReceived ? (
          <div className="space-y-4" data-testid="payment-pending-panel">
            <div className="rounded-xl bg-yellow-50 border border-yellow-300 p-3 text-sm text-yellow-800 font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 shrink-0" />
              Payment pending — client is {invoice.paymentChoice === "platform" ? "sending it through their payment platform" : "mailing a check"} for Invoice {invoice.invoiceNo}.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Amount received</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" data-testid="received-amount" />
              </div>
              <div>
                <Label className="text-xs">Check # (optional)</Label>
                <Input value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} data-testid="received-check-no" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Check photo (optional)</Label>
              <label className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground cursor-pointer hover:bg-muted/50">
                <Upload className="w-4 h-4" />
                {uploading ? "Uploading…" : checkPath ? "Check photo attached ✓" : "Upload or scan the check"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handleUpload(e.target.files?.[0])}
                />
              </label>
            </div>
            <Button
              onClick={handleMarkReceived}
              disabled={recordPayment.isPending || uploading}
              data-testid="mark-received-btn"
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-bold"
            >
              {recordPayment.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Banknote className="w-4 h-4 mr-2" />}
              Mark Received
            </Button>
          </div>
        ) : (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> Payment received for Invoice {invoice.invoiceNo}.
          </div>
        )}
        </div>

        {/* RIGHT — crew payments side */}
        <div className="space-y-2">
          <p className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
            <Users className="w-4 h-4" /> Crew payments
          </p>
          {roster.length === 0 && (
            <p className="text-sm text-muted-foreground">No crew assigned to this job yet.</p>
          )}
          {roster.map((c) => {
            const entry = entryFor(c.id);
            const method = c.preferredPaymentMethod?.trim() || null;
            return (
              <div key={c.id} className="rounded-xl border border-border px-3 py-2 space-y-1.5" data-testid={`crew-pay-row-${c.id}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold flex-1 truncate">{c.name}</span>
                  {!entry?.paidAt ? (
                    <>
                      <Input
                        value={payAmounts[c.id] ?? ""}
                        onChange={(e) => setPayAmounts((p) => ({ ...p, [c.id]: e.target.value }))}
                        placeholder="$"
                        inputMode="decimal"
                        className="w-24 h-8"
                        data-testid={`crew-pay-amount-${c.id}`}
                      />
                      <Button
                        size="sm"
                        onClick={() => handlePayCrew(c.id)}
                        disabled={payCrew.isPending || !paymentReceived}
                        data-testid={`crew-pay-btn-${c.id}`}
                        className="bg-[var(--gold-light)] hover:opacity-90 text-black rounded-full h-8 font-bold"
                      >
                        Paid
                      </Button>
                    </>
                  ) : !entry.clearedAt ? (
                    <>
                      <Badge className="bg-yellow-100 text-yellow-800 border-none">Pay pending · ${entry.amount}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleClear(c.id)}
                        disabled={clearPay.isPending}
                        data-testid={`crew-clear-btn-${c.id}`}
                        className="rounded-full h-8"
                      >
                        Clear
                      </Button>
                    </>
                  ) : (
                    <Badge className="bg-emerald-100 text-emerald-800 border-none">Paid ${entry.amount} ✓</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {method ? (
                    <>
                      <Badge variant="outline" className="rounded-full capitalize">{method}</Badge>
                      {c.paymentDetails?.trim() && <span className="truncate">{c.paymentDetails}</span>}
                    </>
                  ) : (
                    <span className="italic">No pay method on file — set it on the crew's profile</span>
                  )}
                </div>
              </div>
            );
          })}
          {roster.length > 0 && !paymentReceived && (
            <p className="text-xs text-muted-foreground">Crew pay unlocks once the client's payment is received.</p>
          )}
          {roster.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Clicking Paid logs it to the books and messages the crew's live link that their payment is on the way.
            </p>
          )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Moves a manual-check card from Alerts to Done. */
function MarkCompleteButton({ jobId, small }: { jobId: string; small?: boolean }) {
  const setBoardStatus = useSetJobBoardStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setBoardStatus.mutate(
      { id: jobId, data: { boardStatus: "completed" } },
      {
        onSuccess: () => {
          toast({ title: "Marked complete", description: "The card moved to Done." });
          queryClient.invalidateQueries();
        },
        onError: (err) => {
          toast({ title: "Couldn't mark complete", description: (err as any)?.data?.error ?? "Something went wrong", variant: "destructive" });
        },
      },
    );
  };
  return (
    <Button
      onClick={handleClick}
      disabled={setBoardStatus.isPending}
      data-testid={`mark-complete-${jobId}`}
      className={`bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-bold ${small ? "h-7 px-3 text-[11px] mt-2 w-full" : ""}`}
    >
      <CheckCircle2 className={small ? "w-3.5 h-3.5 mr-1.5" : "w-4 h-4 mr-2"} /> Mark Complete
    </Button>
  );
}

function CheckWorkDialog({ open, onOpenChange, job, photos }: { open: boolean; onOpenChange: (open: boolean) => void; job: JobBoardCard['job']; photos: JobBoardCard['photos'] }) {
  const qualityCheck = useQualityCheckJob();
  const [result, setResult] = useState<{ verdict: string; summary: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Run token — a late response from a previous open must not overwrite the
  // current run's state.
  const [runId, setRunId] = useState(0);

  const befores = photos.filter((p) => p.kind === "photo_before");
  const afters = photos.filter((p) => p.kind === "photo_after");

  // Auto-run the AI check each time the dialog opens.
  useEffect(() => {
    if (!open) { setResult(null); setError(null); return; }
    const myRun = runId + 1;
    setRunId(myRun);
    setResult(null);
    setError(null);
    let stale = false;
    qualityCheck.mutate({ id: job.id }, {
      onSuccess: (r) => { if (!stale) setResult({ verdict: r.verdict, summary: r.summary }); },
      onError: (err) => { if (!stale) setError((err as any)?.data?.error ?? "Quality check failed — try again in a moment."); },
    });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job.id]);

  const setBoardStatus = useSetJobBoardStatus();
  const queryClient = useQueryClient();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const manualCheckHref = `sms:?&body=${encodeURIComponent(
    `Manual check required - Property: ${job.propertyName || "Unknown"} Unit: ${job.unitNo || "—"}`
  )}`;
  // Sending a manual check moves the card to the Alerts rail.
  const handleManualCheck = () => {
    setBoardStatus.mutate(
      { id: job.id, data: { boardStatus: "manual_check" } },
      { onSuccess: () => queryClient.invalidateQueries() },
    );
  };

  const PhotoStrip = ({ label, items }: { label: string; items: JobBoardCard['photos'] }) => (
    <div>
      <h4 className="text-xs font-bold text-[var(--secondary)] mb-2">{label} · {items.length}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None uploaded</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map((p) => (
            <img
              key={p.storagePath}
              src={`/api/storage${p.storagePath}`}
              alt={label}
              className="w-24 h-24 rounded-lg object-cover border border-border shrink-0 bg-muted"
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Check Work — {job.propertyName}{job.unitNo ? ` #${job.unitNo}` : ""}</DialogTitle>
          <DialogDescription>
            AI compares the crew's before and after photos and gives a simple pass or fail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <PhotoStrip label="Before" items={befores} />
          <PhotoStrip label="After" items={afters} />

          {befores.length === 0 && afters.length === 0 && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--gold-light)] bg-[var(--gold-light)]/15 p-4" data-testid="no-photos-box">
              <p className="text-sm text-[var(--ink)]">
                <span className="font-bold">No photos on this card yet.</span>{" "}
                Browse everything the crews have sent and attach the right shots.
              </p>
              <Button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="shrink-0 rounded-full bg-[var(--gold-light)] font-bold text-black hover:bg-[var(--gold-dark)]"
                data-testid="button-check-all-photos"
              >
                <FolderOpen className="w-4 h-4 mr-2" /> Check all photos
              </Button>
            </div>
          )}

          {qualityCheck.isPending && (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--background)] p-4 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--gold)]" />
              Running AI quality check…
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="check-work-error">
              {error}
            </div>
          )}
          {result && (
            <div
              data-testid="check-work-result"
              className={`rounded-xl border p-4 ${result.verdict === "pass" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}
            >
              <div className="flex items-center gap-2 font-display font-bold text-lg">
                {result.verdict === "pass" ? (
                  <><CheckCircle2 className="w-5 h-5 text-emerald-600" /> <span className="text-emerald-700">PASS</span></>
                ) : (
                  <><XCircle className="w-5 h-5 text-red-600" /> <span className="text-red-700">FAIL</span></>
                )}
              </div>
              <p className="mt-1 text-sm text-foreground">{result.summary}</p>
              {result.verdict !== "pass" && (
                <Button
                  asChild
                  className="mt-3 bg-[var(--secondary)] hover:opacity-90 text-white rounded-full font-bold"
                  data-testid="manual-check-btn"
                >
                  <a href={manualCheckHref} onClick={handleManualCheck}>
                    <MessageSquare className="w-4 h-4 mr-2" /> Manual Check
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>

      <PhotoLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        jobId={job.id}
        onAssigned={() => {
          setLibraryOpen(false);
          queryClient.invalidateQueries({ queryKey: getListJobBoardQueryKey() });
        }}
      />
    </Dialog>
  );
}

/** Organized photo folder — every photo received from crews, one labeled
 *  column per property. Select shots and assign them to the open card. */
function PhotoLibraryDialog({ open, onOpenChange, jobId, onAssigned }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  onAssigned: () => void;
}) {
  const { data: library, isLoading } = useGetPhotoLibrary({
    query: { queryKey: getGetPhotoLibraryQueryKey(), enabled: open },
  });
  const assign = useAssignPhotosToJob();
  const { toast } = useToast();
  // Each picked photo carries its own Before/After tag — the big mode buttons
  // above the grid decide which tag the next tap applies.
  const [selected, setSelected] = useState<Map<string, { entry: PhotoLibraryEntry; kind: "photo_before" | "photo_after" }>>(new Map());
  const [mode, setMode] = useState<"photo_before" | "photo_after">("photo_before");

  useEffect(() => {
    if (!open) {
      setSelected(new Map());
      setMode("photo_before");
    }
  }, [open]);

  // One labeled column per property; photos with no property go last.
  const columns = (() => {
    const byProp = new Map<string, { label: string; items: PhotoLibraryEntry[] }>();
    for (const p of library ?? []) {
      const key = p.propertyId ?? "__none__";
      const col = byProp.get(key) ?? { label: p.propertyName ?? "Not tied to a property", items: [] };
      col.items.push(p);
      byProp.set(key, col);
    }
    return [...byProp.entries()].sort(([a], [b]) => {
      if (a === "__none__") return 1;
      if (b === "__none__") return -1;
      return byProp.get(a)!.label.localeCompare(byProp.get(b)!.label);
    });
  })();

  const toggle = (p: PhotoLibraryEntry) => {
    setSelected((cur) => {
      const next = new Map(cur);
      const existing = next.get(p.storagePath);
      if (existing?.kind === mode) next.delete(p.storagePath); // tap again = unpick
      else next.set(p.storagePath, { entry: p, kind: mode }); // new pick or re-tag to current mode
      return next;
    });
  };

  const beforeCount = [...selected.values()].filter((s) => s.kind === "photo_before").length;
  const afterCount = selected.size - beforeCount;

  const doAssign = () => {
    assign.mutate(
      {
        id: jobId,
        data: { items: [...selected.values()].map((s) => ({ storagePath: s.entry.storagePath, kind: s.kind })) },
      },
      {
        onSuccess: (r) => {
          toast({ title: r.added > 0 ? `${r.added} photo${r.added === 1 ? "" : "s"} attached to the card` : "Those photos were already on the card" });
          onAssigned();
        },
        onError: () => toast({ title: "Couldn't attach the photos", description: "Try again.", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px] max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display">All crew photos</DialogTitle>
          <DialogDescription>
            Step 1 — with <span className="font-bold text-amber-600">Before</span> on, tap the photos taken before the work. Step 2 — switch to <span className="font-bold text-emerald-600">After</span> and tap the finished shots. Then attach.
          </DialogDescription>
        </DialogHeader>

        {/* The two big mode buttons — the choice you're making is impossible to miss. */}
        <div className="grid grid-cols-2 gap-2">
          {([
            ["photo_before", "Before", "Pick photos from before the work", beforeCount, "border-amber-400 bg-amber-50 text-amber-900", "bg-amber-500"],
            ["photo_after", "After", "Pick the finished shots", afterCount, "border-emerald-400 bg-emerald-50 text-emerald-900", "bg-emerald-500"],
          ] as const).map(([k, label, hint, count, activeCls, dotCls]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={`rounded-xl border-2 px-4 py-2.5 text-left transition-all ${mode === k ? `${activeCls} shadow-sm` : "border-border text-muted-foreground hover:border-foreground/30"}`}
              data-testid={`assign-as-${k}`}
            >
              <span className="flex items-center gap-2 font-display font-bold text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${dotCls}`} />
                {mode === k ? `Picking ${label} photos` : label}
                {count > 0 && (
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${dotCls}`}>{count}</span>
                )}
              </span>
              <span className="block text-[11px] mt-0.5 opacity-80">{hint}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading photos…
            </div>
          ) : columns.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No crew photos yet — shots crews send from their portal will show up here.
            </div>
          ) : (
            <div className="flex gap-4 pb-2 h-full">
              {columns.map(([key, col]) => (
                <div key={key} className="w-56 shrink-0 flex flex-col min-h-0" data-testid={`photo-col-${key}`}>
                  <div className="sticky top-0 rounded-t-xl bg-[var(--muted)] px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                    {col.label} · {col.items.length}
                  </div>
                  <div className="flex-1 min-h-0 space-y-2 overflow-y-auto rounded-b-xl border border-t-0 border-border p-2 max-h-[48dvh]">
                    {col.items.map((p) => {
                      const pick = selected.get(p.storagePath);
                      const isBefore = pick?.kind === "photo_before";
                      return (
                        <button
                          key={p.storagePath}
                          type="button"
                          onClick={() => toggle(p)}
                          className={`relative block w-full overflow-hidden rounded-lg border-2 transition-all ${pick ? (isBefore ? "border-amber-400 shadow-sm" : "border-emerald-400 shadow-sm") : "border-transparent hover:border-border"}`}
                          data-testid={`photo-pick-${p.storagePath}`}
                        >
                          <img
                            src={`/api/storage${p.storagePath}`}
                            alt={col.label}
                            loading="lazy"
                            className="aspect-[4/3] w-full object-cover bg-muted"
                          />
                          {pick && (
                            <span className={`absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${isBefore ? "bg-amber-500" : "bg-emerald-500"}`}>
                              <CheckCircle2 className="w-3 h-3" />
                              {isBefore ? "BEFORE" : "AFTER"}
                            </span>
                          )}
                          <span className="absolute bottom-0 inset-x-0 bg-black/55 px-1.5 py-0.5 text-left text-[10px] font-semibold text-white truncate">
                            {[p.kind === "photo_before" ? "Before" : p.kind === "photo_after" ? "After" : null, p.unitNo ? `#${p.unitNo}` : null, p.crewName, p.takenOn]
                              .filter(Boolean)
                              .join(" · ") || "Photo"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="items-center gap-3 border-t border-border pt-3 sm:justify-between">
          <span className="text-xs font-semibold text-muted-foreground" data-testid="pick-summary">
            {selected.size === 0 ? (
              "Nothing picked yet — tap photos above."
            ) : (
              <>
                <span className="text-amber-600 font-bold">{beforeCount} before</span>
                {" · "}
                <span className="text-emerald-600 font-bold">{afterCount} after</span>
              </>
            )}
          </span>
          <Button
            type="button"
            disabled={selected.size === 0 || assign.isPending}
            onClick={doAssign}
            className="rounded-full bg-[var(--gold-light)] font-bold text-black hover:bg-[var(--gold-dark)]"
            data-testid="button-assign-photos"
          >
            {assign.isPending ? "Attaching…" : `Attach ${selected.size || ""} to this card`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BroadcastDialog({ open, onOpenChange, job}: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job']}) {
  const [mode, setMode] = useState<"all" | "trade" | "crews">("all");
  const [selectedTrade, setSelectedTrade] = useState<string>("");
  const [selectedCrews, setSelectedCrews] = useState<string[]>([]);
  const [scheduleType, setScheduleType] = useState<"scheduled" | "flex">("scheduled");
  const [flexDays, setFlexDays] = useState("7");
  const [crewsNeeded, setCrewsNeeded] = useState("1");
  const { data: crews} = useListCrews({ query: { enabled: open, queryKey: getListCrewsQueryKey()}});
  const { toast} = useToast();
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
          description:`Sent to ${result.sent} crews. ${result.alreadySent > 0 ?`(${result.alreadySent} already sent)` : ''}`,
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

function EditPostingDialog({ open, onOpenChange, job}: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job']}) {
  const [scheduleType, setScheduleType] = useState<"scheduled" | "flex">(job.scheduleType === "flex" ? "flex" : "scheduled");
  const [flexDays, setFlexDays] = useState("7");
  const [crewsNeeded, setCrewsNeeded] = useState(String(job.crewsNeeded ?? 1));
  const { toast} = useToast();
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
        toast({ title: "Posting updated", description: "Crews will see the new terms in their portals."});
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

function EditJobDialog({ open, onOpenChange, job}: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job']}) {
  const updateJob = useUpdateJob();
  const { toast} = useToast();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState(job.category ?? "");
  const [description, setDescription] = useState(job.description ?? "");
  const [unitNo, setUnitNo] = useState(job.unitNo ?? "");
  const [woNo, setWoNo] = useState(job.woNo ?? "");
  const [poNumber, setPoNumber] = useState(job.poNumber ?? "");
  const [status, setStatus] = useState(job.status);

  useEffect(() => {
    if (open) {
      setCategory(job.category ?? "");
      setDescription(job.description ?? "");
      setUnitNo(job.unitNo ?? "");
      setWoNo(job.woNo ?? "");
      setPoNumber(job.poNumber ?? "");
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
        poNumber: poNumber.trim() || undefined,
        status,
     }
   }, {
      onSuccess: () => {
        toast({ title: "Job Updated", description:`${job.jobNo} was saved. Crews see the updated details.`});
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
              <Label htmlFor="ej-po">Client PO # (required to bill)</Label>
              <Input id="ej-po" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-4482" data-testid="edit-job-po" />
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

function DeleteConfirmDialog({ open, onOpenChange, job}: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job']}) {
  const unlistJob = useUnlistJob();
  const { toast} = useToast();
  const queryClient = useQueryClient();

  const handleDelete = () => {
    unlistJob.mutate({ id: job.id}, {
      onSuccess: () => {
        toast({
          title: "Posting Removed",
          description:`${job.jobNo} is off the board and crew portals. The job itself still exists on the Jobs page.`,
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
            onClick={(e) => { e.preventDefault(); handleDelete();}}
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

function ReopenConfirmDialog({ open, onOpenChange, job}: { open: boolean, onOpenChange: (open: boolean) => void, job: JobBoardCard['job']}) {
  const reopenJob = useReopenJob();
  const { toast} = useToast();
  const queryClient = useQueryClient();

  const handleReopen = () => {
    reopenJob.mutate({ id: job.id}, {
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
            onClick={(e) => { e.preventDefault(); handleReopen();}}
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
