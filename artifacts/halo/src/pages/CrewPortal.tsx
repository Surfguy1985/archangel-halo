import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPortal,
  useListPortalMessages,
  useSendPortalMessage,
  useCreatePortalCheckin,
  createPortalTrackPoint,
  useListPortalDocuments,
  useUploadPortalDocument,
  useListPortalPhotos,
  useUploadPortalPhoto,
  useListPortalJobs,
  getListPortalJobsQueryKey,
  useCompletePortalLineItem,
  getListPortalPhotosQueryKey,
  useGetPortalW9,
  useSubmitPortalW9,
  useSetPortalPaymentMethod,
  getGetPortalQueryKey,
  getListPortalMessagesQueryKey,
  getListPortalDocumentsQueryKey,
  getGetPortalW9QueryKey,
  useRespondPortalOffer,
  useListPortalInvoices,
  useSubmitPortalInvoice,
  useResubmitPortalInvoice,
  useMarkPortalSeen,
  useAcceptPortalAgreement,
  useSetPortalSelfie,
  useGetPortalWings,
  useGetPortalBank,
  useSubmitPortalBank,
  useCommitPortalEmergency,
  useGetPortalDispatch,
  getGetPortalDispatchQueryKey,
  useGetPortalOfficeView,
  getGetPortalOfficeViewQueryKey,
  type PortalOfficeView,
  useCheckPortalDispatchItem,
  useRespondPortalDispatchMove,
  type PortalDispatchAssignment,
  useGetPortalEarnings,
  getGetPortalEarningsQueryKey,
  getListPortalInvoicesQueryKey,
  getGetPortalBankQueryKey,
  type W9Data,
  type PortalBundle,
  type PortalOffer,
  type PortalEmergencyOffer,
  type PortalEarningsHold,
  type CrewInvoice,
  type PortalSeenInputSection,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import {
  Calendar,
  MessageSquare,
  MapPin,
  Phone,
  CheckSquare,
  FileText,
  Wallet,
  ClipboardCheck,
  Send,
  FileUp,
  Check,
  Loader2,
  ShieldCheck,
  Download,
  PackageCheck,
  Camera,
  Briefcase,
  AlertCircle,
  X,
  Receipt,
  Plus,
  Trash2,
  LogIn,
  LogOut,
  Link2,
  Copy,
  BookOpen,
  Home,
  Feather,
  Award,
  ShieldCheck as ShieldCheckIcon,
  CheckCircle2,
  Shield,
  Play,
  Volume2,
  VolumeX,
  ChevronRight,
} from "lucide-react";
import { downloadW9Pdf } from "@/lib/w9pdf";
import {
  downloadInvoicePdf,
  invoicePdfFile,
  invoicePdfFileName,
  type InvoicePdfData,
} from "@/lib/invoicePdf";
import WelcomeKitTab from "./WelcomeKitTab";
import { FalkonBadge } from "@/components/FalkonBadge";
import CrewPortalFlow from "./CrewPortalFlow";
import { useGpsTrail, getPosition } from "@/hooks/useGpsTrail";
import { OfficePropertyMap } from "@/components/OfficePropertyMap";
import { portalGuide, type GuideLang } from "@/lib/portalGuideContent";
import { WingsGuide, TierBadge, type WingsGuideLang } from "@/components/WingsGuide";
import { WingsProgramPanel } from "@/components/WingsProgram";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Tab =
  | "jobs"
  | "offers"
  | "office"
  | "schedule"
  | "invoice"
  | "messages"
  | "photos"
  | "documents"
  | "checkin"
  | "pay"
  | "w9"
  | "packets"
  | "wings"
  | "guide";

const SEEN_SECTIONS: Partial<Record<Tab, PortalSeenInputSection>> = {
  offers: "offers",
  schedule: "schedule",
  messages: "messages",
  packets: "packets",
  documents: "documents",
};

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatWhen(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDay(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "13:30" → "1:30 PM" for staggered start times. */
function formatClock(hhmm?: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  if (h == null || Number.isNaN(h)) return hhmm;
  const am = h < 12;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m ?? 0).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

function initialGuideLang(): GuideLang | null {
  const g = new URLSearchParams(window.location.search).get("guide");
  return g === "en" || g === "es" ? g : null;
}

export default function CrewPortal() {
  const { token } = useParams<{ token: string }>();
  const [guideLang, setGuideLang] = useState<GuideLang>(() => initialGuideLang() ?? "en");
  const [tab, setTab] = useState<Tab>(() => {
    if (initialGuideLang()) return "guide";
    const t = new URLSearchParams(window.location.search).get("tab");
    const valid: Tab[] = [
      "jobs",
      "offers",
      "office",
      "schedule",
      "invoice",
      "messages",
      "photos",
      "documents",
      "checkin",
      "pay",
      "w9",
      "packets",
      "wings",
      "guide",
    ];
    return valid.includes(t as Tab) ? (t as Tab) : "jobs";
  });
  // Tapping "Send invoice" on a My Jobs card lands on the Invoice tab with
  // that job already selected.
  const [invoiceJobId, setInvoiceJobId] = useState<string | null>(null);
  // Controls the "More" bottom sheet that exposes all non-card tabs.
  const [moreOpen, setMoreOpen] = useState(false);
  // Training intro: show before the agreement, once per session
  const [trainingDone, setTrainingDone] = useState<boolean>(
    () => sessionStorage.getItem(`trainingDone:${token}`) === "1",
  );
  // Welcome Kit popup: show after agreement, before selfie, once per session
  const [kitDone, setKitDone] = useState<boolean>(
    () => sessionStorage.getItem(`kitDone:${token}`) === "1",
  );
  const queryClient = useQueryClient();

  const { data: portal, isLoading, isError } = useGetPortal(token, {
    query: { queryKey: getGetPortalQueryKey(token), refetchInterval: 60_000 },
  });
  const { data: officeViewData } = useGetPortalOfficeView(token, {
    query: {
      queryKey: getGetPortalOfficeViewQueryKey(token),
      refetchInterval: 60000,
    },
  });
  const markSeen = useMarkPortalSeen();

  const pendingOffersCount = portal?.offers?.filter(o => o.status === "pending" && !o.filledByOther).length || 0;
  // Emergency pings are urgent — pull the crew straight to the Offers tab too.
  const pendingEmergencyCount =
    portal?.emergencyOffers?.filter(o => o.status === "pending" && o.pingStatus === "open").length || 0;

  useEffect(() => {
    // Deep links (?tab=...) win over the offers auto-pull.
    if (new URLSearchParams(window.location.search).get("tab")) return;
    if ((pendingOffersCount > 0 || pendingEmergencyCount > 0) && tab !== "offers" && tab !== "guide") {
      setTab("offers");
    }
  }, [pendingOffersCount, pendingEmergencyCount]);

  const unseen = portal?.unseen;

  useEffect(() => {
    if (!unseen) return;
    const unseenMap = unseen as unknown as Record<string, number>;
    const sections: PortalSeenInputSection[] = [];
    const primary = SEEN_SECTIONS[tab];
    if (primary) sections.push(primary);
    // When the Offers tab is opened, also mark emergency pings as seen.
    if (tab === "offers") sections.push("emergency");
    // Pending move approvals live in the Schedule tab's dispatch section.
    if (tab === "schedule") sections.push("approvals");
    const toMark = sections.filter((section) => (unseenMap[section] ?? 0) > 0);
    if (toMark.length === 0) return;
    // Only refetch after the seen-marks actually succeed — otherwise a failing
    // mark would loop refetch -> still-unseen -> mark again forever.
    void Promise.allSettled(
      toMark.map((section) => markSeen.mutateAsync({ token, data: { section } })),
    ).then((results) => {
      if (results.some((r) => r.status === "fulfilled")) {
        queryClient.invalidateQueries({
          queryKey: getGetPortalQueryKey(token),
        });
      }
    });
  }, [tab, unseen, token]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--gold-dark)]" />
      </div>
    );
  }

  if (isError || !portal) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 text-[var(--gold-dark)] mx-auto mb-3" />
          <div className="font-display font-bold text-[18px] text-foreground">Invalid link</div>
          <p className="text-[13px] text-muted-foreground mt-1">
            This portal link isn't valid. Ask ArchAngel for a new one.
          </p>
        </div>
      </div>
    );
  }

  const u = portal.unseen;
  const officeView = officeViewData;
  const tabs: { key: Tab; label: string; icon: any; badge?: number; alert?: number }[] = [
    { key: "jobs", label: "My Jobs", icon: ClipboardCheck },
    { key: "offers", label: "Offers", icon: Briefcase, badge: pendingOffersCount, alert: (u?.offers ?? 0) + (u?.emergency ?? 0) },
    { key: "schedule", label: "Schedule", icon: Calendar, alert: (u?.schedule ?? 0) + (u?.approvals ?? 0) },
    ...(officeView?.enabled
      ? [{ key: "office" as Tab, label: "Office", icon: Home }]
      : []),
    { key: "invoice", label: "Invoice", icon: Receipt },
    { key: "packets", label: "Welcome Kit", icon: PackageCheck, alert: u?.packets },
    { key: "messages", label: "Messages", icon: MessageSquare, alert: u?.messages },
    { key: "checkin", label: "Job Tracker", icon: MapPin },
    { key: "photos", label: "Photos", icon: Camera },
    { key: "documents", label: "Docs", icon: FileText, alert: u?.documents },
    { key: "pay", label: "Pay", icon: Wallet },
    { key: "w9", label: "W-9", icon: ClipboardCheck },
    { key: "wings", label: "Wings", icon: Feather },
    { key: "guide", label: guideLang === "es" ? "Guía" : "Guide", icon: BookOpen },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Card-flow portal (full screen) ────────────────────────── */}
      <CrewPortalFlow
        token={token}
        portal={portal}
        onOpenMore={(openTab, jobId) => {
          if (jobId) setInvoiceJobId(jobId);
          if (openTab) setTab(openTab as Tab);
          setMoreOpen(true);
        }}
        onInvoice={(jobId) => {
          setInvoiceJobId(jobId);
          setTab("invoice");
          setMoreOpen(true);
        }}
      />

      {/* ── More sheet — all non-card tabs ────────────────────────── */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="h-[90vh] flex flex-col rounded-t-[20px] bg-card border-t border-border p-0"
        >
          {/* Tab selector bar */}
          <div className="px-[14px] pt-[14px] pb-0 border-b border-border shrink-0">
            <div className="flex gap-[4px] overflow-x-auto no-scrollbar pb-[10px]">
              {tabs
                .filter((t) => t.key !== "jobs")
                .map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`flex items-center gap-[5px] whitespace-nowrap rounded-[10px] px-[12px] py-[8px] text-[12.5px] font-display font-bold transition-all ${
                        tab === t.key
                          ? "bg-[var(--gold-light)] text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      <Icon className="w-[14px] h-[14px]" /> {t.label}
                      {t.alert ? (
                        <span className="ml-[2px] bg-red-500 text-white px-[5px] py-[1px] rounded-full text-[10px] font-bold min-w-[16px] text-center">
                          {t.alert}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-[14px] py-[16px] pb-[40px]">
            {tab === "schedule" && <SaveLinkCard />}
            {tab === "offers" && <OffersTab portal={portal} token={token} />}
            {tab === "office" && officeView?.enabled && <OfficeViewTab view={officeView} />}
            {tab === "schedule" && <PortalDispatchSection token={token} />}
            {tab === "schedule" && <WorkChecklistSection token={token} />}
            {tab === "schedule" && <ScheduleTab portal={portal} />}
            {tab === "invoice" && (
              <InvoiceTab portal={portal} token={token} initialJobId={invoiceJobId} />
            )}
            {tab === "packets" && <WelcomeKitTab token={token} />}
            {tab === "messages" &&
              (portal.crew.leaderId ? (
                <ForemanRoutedNotice leaderName={portal.crew.leaderName ?? null} />
              ) : (
                <MessagesTab token={token} />
              ))}
            {tab === "checkin" && <CheckinTab token={token} />}
            {tab === "photos" && <PhotosTab token={token} />}
            {tab === "documents" && <DocumentsTab token={token} />}
            {tab === "pay" && <PaymentTab token={token} />}
            {tab === "w9" && <W9Tab token={token} />}
            {tab === "wings" && <WingsTab token={token} />}
            {tab === "guide" && <GuideTab lang={guideLang} onLangChange={setGuideLang} />}
          </div>
        </SheetContent>
      </Sheet>

      {!portal.crew.agreementAcceptedAt && !trainingDone && (
        <TrainingModal
          token={token}
          crewName={portal.crew.name}
          onDone={() => {
            sessionStorage.setItem(`trainingDone:${token}`, "1");
            setTrainingDone(true);
          }}
        />
      )}
      {!portal.crew.agreementAcceptedAt && trainingDone && (
        <AgreementModal token={token} crewName={portal.crew.name} />
      )}
      {portal.crew.agreementAcceptedAt && !portal.crew.selfiePath && !kitDone && (
        <WelcomeKitModal
          token={token}
          crewName={portal.crew.name}
          onDone={() => {
            sessionStorage.setItem(`kitDone:${token}`, "1");
            setKitDone(true);
          }}
        />
      )}
      {portal.crew.agreementAcceptedAt && !portal.crew.selfiePath && kitDone && (
        <SelfieModal token={token} crewName={portal.crew.name} />
      )}
    </div>
  );
}

// ─── Training Module ──────────────────────────────────────────────────────────

const TRAINING_SLIDES = [
  {
    icon: Play,
    color: "#B4FF44",
    title: "Welcome to ArchAngel HALO",
    body: "Here's a quick 30-second walkthrough before you get started. Tap anywhere or wait to advance.",
    speech: "Welcome to ArchAngel HALO. Here's a quick walkthrough before you get started.",
  },
  {
    icon: MapPin,
    color: "#60a5fa",
    title: "Check in when you arrive",
    body: "Tap Check In the moment you're on site. Your GPS location is recorded as tamper-proof proof you were there.",
    speech: "Always tap Check In when you arrive on site. Your GPS location is recorded as proof you were there.",
  },
  {
    icon: Camera,
    color: "#34d399",
    title: "Take before & after photos",
    body: "Photograph the work area before you start and after you finish. Photos are sealed the instant they upload — they protect you.",
    speech: "Photograph the work area before you start and after you finish. Photos are sealed the moment they upload and protect you from disputes.",
  },
  {
    icon: CheckSquare,
    color: "#f472b6",
    title: "Complete your checklist",
    body: "Check off each task as you work. When the last item is done, the job advances automatically.",
    speech: "Check off each task on your list as you work. The last checkmark moves the job forward automatically.",
  },
  {
    icon: LogOut,
    color: "#fbbf24",
    title: "Clock out & send your invoice",
    body: "Clock out when the job is done, then send your invoice. Completed, documented jobs get paid faster.",
    speech: "When the job is done, clock out and send your invoice. Documented jobs get paid faster.",
  },
] as const;

function TrainingModal({
  crewName,
  onDone,
}: {
  token: string;
  crewName: string;
  onDone: () => void;
}) {
  const [slide, setSlide] = useState(0);
  const [progress, setProgress] = useState(0); // 0–100 within current slide
  const [muted, setMuted] = useState(false);
  const genRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const total = TRAINING_SLIDES.length;
  const SLIDE_MS = 5000;

  const advance = () => {
    setSlide((s) => {
      if (s + 1 >= total) { onDone(); return s; }
      return s + 1;
    });
    setProgress(0);
  };

  // SpeechSynthesis narration — guarded by genRef to avoid stale callbacks
  useEffect(() => {
    if (muted || typeof window === "undefined" || !window.speechSynthesis) return;
    const gen = ++genRef.current;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(TRAINING_SLIDES[slide].speech);
    utt.rate = 1.05;
    utt.pitch = 1;
    utt.onend = () => { if (genRef.current === gen) advance(); };
    // Small delay so the UI renders first
    const tid = setTimeout(() => {
      if (genRef.current === gen) window.speechSynthesis.speak(utt);
    }, 400);
    return () => {
      clearTimeout(tid);
      window.speechSynthesis.cancel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, muted]);

  // Fallback timer progress bar (also drives auto-advance when muted)
  useEffect(() => {
    setProgress(0);
    const tick = 50; // ms per tick
    let elapsed = 0;
    intervalRef.current = setInterval(() => {
      elapsed += tick;
      setProgress(Math.min((elapsed / SLIDE_MS) * 100, 100));
      if (elapsed >= SLIDE_MS) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (muted) advance();
      }
    }, tick);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, muted]);

  const s = TRAINING_SLIDES[slide];
  const SlideIcon = s.icon;
  const isLast = slide === total - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#080D1A" }}
      onClick={advance}
    >
      {/* Progress segments */}
      <div
        className="flex gap-[4px] px-[20px] pb-[8px]"
        style={{ paddingTop: "max(20px, calc(env(safe-area-inset-top) + 12px))" }}
      >
        {TRAINING_SLIDES.map((_, i) => (
          <div
            key={i}
            className="flex-1 h-[3px] rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            <div
              className="h-full rounded-full transition-none"
              style={{
                background: s.color,
                width: i < slide ? "100%" : i === slide ? `${progress}%` : "0%",
              }}
            />
          </div>
        ))}
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between px-[20px] py-[8px]">
        <div className="text-[10px] font-bold tracking-[0.22em] uppercase" style={{ color: "#B4FF44" }}>
          ARCHANGEL · HALO
        </div>
        <div className="flex items-center gap-[10px]">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
            className="p-[6px] rounded-full text-white/40 hover:text-white/70 transition-colors"
          >
            {muted
              ? <VolumeX className="w-[16px] h-[16px]" />
              : <Volume2 className="w-[16px] h-[16px]" />}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDone(); }}
            className="text-[12px] font-bold text-white/35 hover:text-white/70 px-[10px] py-[5px] rounded-full border border-white/10 transition-colors"
          >
            Skip
          </button>
        </div>
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-[32px] text-center gap-[20px]">
        <div
          className="w-[88px] h-[88px] rounded-[28px] grid place-items-center shadow-2xl"
          style={{
            background: `${s.color}18`,
            border: `1.5px solid ${s.color}40`,
          }}
        >
          <SlideIcon
            className="w-[40px] h-[40px]"
            style={{ color: s.color }}
          />
        </div>

        <div>
          <div className="font-display font-bold text-[24px] text-white leading-tight mb-[10px]">
            {slide === 0 ? (
              <>Welcome, <span style={{ color: "#B4FF44" }}>{crewName}</span>!</>
            ) : s.title}
          </div>
          <div className="text-[15px] text-white/55 leading-relaxed max-w-[320px] mx-auto">
            {s.body}
          </div>
        </div>

        {/* Step counter */}
        <div className="flex gap-[6px] mt-[4px]">
          {TRAINING_SLIDES.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all"
              style={{
                width: i === slide ? 20 : 6,
                height: 6,
                background: i === slide ? s.color : "rgba(255,255,255,0.15)",
              }}
            />
          ))}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="px-[24px] pb-[40px] pt-[16px]" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={advance}
          className="w-full flex items-center justify-center gap-[8px] rounded-[16px] py-[15px] text-[16px] font-display font-bold text-black transition-transform active:scale-[0.97]"
          style={{ background: s.color }}
        >
          {isLast ? (
            <><Check className="w-[18px] h-[18px]" /> Got it — open my portal</>
          ) : (
            <>Next <ChevronRight className="w-[18px] h-[18px]" /></>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Welcome Kit Modal ────────────────────────────────────────────────────────

function WelcomeKitModal({
  token,
  crewName,
  onDone,
}: {
  token: string;
  crewName: string;
  onDone: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#080D1A" }}
    >
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-[20px] pb-[14px] border-b"
        style={{
          paddingTop: "max(28px, calc(env(safe-area-inset-top) + 16px))",
          borderColor: "rgba(255,255,255,0.07)",
        }}
      >
        <div>
          <div className="text-[10px] font-bold tracking-[0.22em] uppercase" style={{ color: "#B4FF44" }}>
            ARCHANGEL · HALO
          </div>
          <div className="font-display font-bold text-[20px] text-white mt-[2px] flex items-center gap-[8px]">
            <PackageCheck className="w-[18px] h-[18px]" style={{ color: "#B4FF44" }} />
            Welcome Onboarding Kit
          </div>
          <div className="text-[12px] text-white/40 mt-[2px]">
            Hi {crewName} — complete these before your first job
          </div>
        </div>
      </div>

      {/* Scrollable kit content */}
      <div className="flex-1 overflow-y-auto px-[16px] py-[20px]">
        {/* Render the full WelcomeKitTab — packet list + PacketRunner */}
        <WelcomeKitTab token={token} />
      </div>

      {/* Sticky bottom CTA */}
      <div
        className="shrink-0 px-[20px] pt-[14px] pb-[32px] border-t"
        style={{ borderColor: "rgba(255,255,255,0.07)", background: "#080D1A" }}
      >
        <button
          type="button"
          onClick={onDone}
          className="w-full flex items-center justify-center gap-[8px] rounded-[16px] py-[15px] text-[16px] font-display font-bold text-black transition-transform active:scale-[0.97]"
          style={{ background: "#B4FF44" }}
        >
          <ChevronRight className="w-[18px] h-[18px]" />
          Continue to my portal
        </button>
        <p className="text-center text-[11px] text-white/30 mt-[10px]">
          You can always come back to this kit under More → Onboarding Kit
        </p>
      </div>
    </div>
  );
}

function AgreementModal({ token, crewName }: { token: string; crewName: string }) {
  const queryClient = useQueryClient();
  const accept = useAcceptPortalAgreement();
  const [checked, setChecked] = useState(false);

  const onAccept = () => {
    accept.mutate(
      { token },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPortalQueryKey(token) });
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--ink)]/40 flex items-end sm:items-center justify-center p-[14px]">
      <div className="bg-card border border-border rounded-[20px] w-full max-w-[480px] max-h-[86vh] overflow-y-auto p-[20px] shadow-xl">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-dark)]">
          Welcome, {crewName}
        </div>
        <div className="font-display font-bold text-[20px] mt-[4px] mb-[10px] text-foreground">
          How your crew portal works
        </div>
        <div className="text-[13.5px] leading-relaxed text-muted-foreground flex flex-col gap-[10px]">
          <div className="flex gap-[10px]">
            <Link2 className="w-[16px] h-[16px] text-primary shrink-0 mt-[2px]" />
            <span><b className="text-foreground">Save this link.</b> This page is your personal portal — the same link works for every job. Bookmark it or add it to your home screen (Share → "Add to Home Screen").</span>
          </div>
          <div className="flex gap-[10px]">
            <MapPin className="w-[16px] h-[16px] text-primary shrink-0 mt-[2px]" />
            <span><b className="text-foreground">Check in and out of every job.</b> Use the Job Tracker tab when you arrive and when you finish. Your GPS location and time are recorded as proof you were on site.</span>
          </div>
          <div className="flex gap-[10px]">
            <Camera className="w-[16px] h-[16px] text-primary shrink-0 mt-[2px]" />
            <span><b className="text-foreground">Take before &amp; after photos.</b> Photograph the work area before you start and after you finish. Photos are fingerprinted the moment they're uploaded, so they stand as tamper-proof evidence of your work.</span>
          </div>
          <div className="flex gap-[10px]">
            <ShieldCheck className="w-[16px] h-[16px] text-primary shrink-0 mt-[2px]" />
            <span><b className="text-foreground">This protects you.</b> GPS check-ins and sealed photos prove the job was done right — they resolve disputes in your favor and get you paid faster.</span>
          </div>
        </div>
        <label className="flex items-start gap-[10px] mt-[20px] mb-[18px] cursor-pointer group">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-[3px] w-[16px] h-[16px] accent-primary shrink-0"
          />
          <span className="text-[12.5px] text-muted-foreground group-hover:text-foreground transition-colors">
            I understand and agree to check in/out with GPS and document my work
            with before &amp; after photos on every job.
          </span>
        </label>
        <button
          onClick={onAccept}
          disabled={!checked || accept.isPending}
          className="w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-primary-foreground bg-[var(--gold-light)] disabled:opacity-50 hover:brightness-105 transition-all active:scale-[0.98]"
        >
          {accept.isPending ? (
            <Loader2 className="w-[18px] h-[18px] animate-spin" />
          ) : (
            <Check className="w-[18px] h-[18px]" />
          )}
          I agree — open my portal
        </button>
      </div>
    </div>
  );
}

function SelfieModal({ token, crewName }: { token: string; crewName: string }) {
  const queryClient = useQueryClient();
  const setSelfie = useSetPortalSelfie();
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(
    () => sessionStorage.getItem(`selfieSkip:${token}`) === "1",
  );
  const { uploadFile } = useUpload({
    onError: () => {
      setSaving(false);
      setError("Upload failed. Check your connection and try again.");
    },
  });

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  if (skipped) return null;

  const onPick = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setFile(f);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  };

  const onSave = async () => {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      const res = await uploadFile(file);
      if (!res) return;
      await setSelfie.mutateAsync({ token, data: { storagePath: res.objectPath } });
      queryClient.invalidateQueries({ queryKey: getGetPortalQueryKey(token) });
    } catch {
      setError("Couldn't save your photo. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const onSkip = () => {
    sessionStorage.setItem(`selfieSkip:${token}`, "1");
    setSkipped(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--ink)]/40 flex items-end sm:items-center justify-center p-[14px]">
      <div className="bg-card border border-border rounded-[20px] w-full max-w-[480px] max-h-[86vh] overflow-y-auto p-[20px] shadow-xl text-center">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-dark)]">
          One last step, {crewName}
        </div>
        <div className="font-display font-bold text-[20px] mt-[4px] mb-[8px] text-foreground">
          Add your profile photo
        </div>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground mb-[18px]">
          Take a quick selfie so the office knows who's on site. It shows up
          next to your name across HALO.
        </p>

        <label className="mx-auto w-[128px] h-[128px] rounded-full border-2 border-dashed border-border bg-background overflow-hidden grid place-items-center cursor-pointer hover:border-primary transition-colors">
          {preview ? (
            <img src={preview} alt="Your selfie" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-[6px] text-muted-foreground">
              <Camera className="w-[28px] h-[28px]" />
              <span className="text-[11px] font-bold uppercase tracking-wide">Tap to snap</span>
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
        </label>

        {error && (
          <div className="mt-[12px] text-[12.5px] text-destructive flex items-center justify-center gap-[6px]">
            <AlertCircle className="w-[14px] h-[14px]" /> {error}
          </div>
        )}

        <button
          onClick={onSave}
          disabled={!file || saving}
          className="mt-[18px] w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-primary-foreground bg-[var(--gold-light)] disabled:opacity-50 hover:brightness-105 transition-all active:scale-[0.98]"
        >
          {saving ? (
            <Loader2 className="w-[18px] h-[18px] animate-spin" />
          ) : (
            <Check className="w-[18px] h-[18px]" />
          )}
          {preview ? "Save my photo" : "Take a selfie first"}
        </button>
        <button
          onClick={onSkip}
          disabled={saving}
          className="mt-[10px] w-full text-[13px] text-muted-foreground hover:text-foreground transition-colors py-[6px]"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

const GUIDE_ICONS: Record<string, any> = {
  Briefcase,
  Calendar,
  MapPin,
  Camera,
  Receipt,
  MessageSquare,
  ClipboardCheck,
};

function GuideTab({
  lang,
  onLangChange,
}: {
  lang: GuideLang;
  onLangChange: (l: GuideLang) => void;
}) {
  const g = portalGuide[lang];
  return (
    <div className="space-y-[12px]" data-testid="guide-tab">
      <div className="flex items-center justify-between gap-[10px]">
        <h2 className="font-display font-bold text-[19px] tracking-[-0.01em]">
          {g.heading}
        </h2>
        <div className="flex rounded-[10px] overflow-hidden border border-border shrink-0">
          {(["en", "es"] as GuideLang[]).map((l) => (
            <button
              key={l}
              onClick={() => onLangChange(l)}
              data-testid={`guide-lang-${l}`}
              className={`px-[12px] py-[6px] text-[12px] font-display font-bold ${
                lang === l
                  ? "bg-[var(--ink)] text-white"
                  : "bg-card text-muted-foreground"
              }`}
            >
              {l === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[13.5px] text-muted-foreground leading-relaxed">{g.intro}</p>
      {g.sections.map((s) => {
        const Icon = GUIDE_ICONS[s.icon] ?? BookOpen;
        return (
          <div
            key={s.title}
            className="bg-card rounded-[14px] border border-border p-[14px] flex gap-[12px]"
          >
            <div className="w-[36px] h-[36px] rounded-[10px] bg-[var(--ink)] text-[var(--gold-light)] grid place-items-center shrink-0">
              <Icon className="w-[17px] h-[17px]" />
            </div>
            <div>
              <div className="font-display font-bold text-[14px]">{s.title}</div>
              <p className="text-[13px] text-muted-foreground leading-relaxed mt-[3px]">
                {s.body}
              </p>
            </div>
          </div>
        );
      })}
      <p className="text-[12.5px] text-muted-foreground leading-relaxed pt-[4px]">
        {g.footer}
      </p>
    </div>
  );
}

function WingsTab({ token }: { token: string }) {
  const { data: wings, isLoading, isError } = useGetPortalWings(token);
  const [lang, setLang] = useState<WingsGuideLang>("en");

  if (isLoading) {
    return (
      <div className="py-[40px] grid place-items-center">
        <Loader2 className="w-[22px] h-[22px] animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !wings) {
    return (
      <div className="py-[36px] text-center text-[13.5px] text-muted-foreground">
        Your Wings status isn't available yet.
      </div>
    );
  }

  const money = (n?: number | null) => `$${Math.round(n ?? 0).toLocaleString()}`;

  return (
    <div className="space-y-[14px]" data-testid="wings-tab">
      <div className={`${card} text-center`}>
        <div className="text-[11px] font-display font-bold tracking-[0.16em] uppercase text-[var(--gold-dark)]">
          Your Halo Score
        </div>
        <div className="font-display font-bold text-[52px] leading-none text-foreground mt-[6px]">
          {Math.round(wings.haloScore)}
        </div>
        <div className="flex items-center justify-center gap-[8px] mt-[8px]">
          <TierBadge tier={wings.tier} />
          <span className="text-[12px] text-muted-foreground">
            {Math.round((wings.scoreConfidence ?? 0) * 100)}% confidence
          </span>
        </div>
        {wings.scoreReasons && wings.scoreReasons.length > 0 && (
          <ul className="text-[12px] text-muted-foreground mt-[10px] space-y-[3px] text-left">
            {wings.scoreReasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        )}
      </div>

      <WingsProgramPanel wings={wings} lang={lang} card={card} />

      {wings.founderStatus && wings.founderStatus !== "NONE" && (
        <div className="bg-[var(--ink)] text-[var(--gold-light)] rounded-[16px] p-[14px] flex items-center gap-[10px]">
          <Award className="w-[22px] h-[22px] shrink-0" />
          <div>
            <div className="font-display font-bold text-[15px]">
              {wings.founderStatus.replace("_", " ")}
              {wings.founderNumber ? ` #${wings.founderNumber}` : ""}
            </div>
            <div className="text-[12px] opacity-80">
              Permanent founder recognition — thank you for building this with us.
            </div>
          </div>
        </div>
      )}

      <div className="pt-[6px]">
        <WingsGuide lang={lang} onLangChange={setLang} />
      </div>
    </div>
  );
}

function SaveLinkCard() {
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("halo-portal-savelink-dismissed") === "1",
  );
  if (dismissed) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className={`${card} mb-[12px] border border-[rgba(143,106,31,0.35)]`}>
      <div className="flex items-start gap-[10px]">
        <div className="w-[36px] h-[36px] rounded-full bg-[rgba(143,106,31,0.12)] grid place-items-center shrink-0">
          <Link2 className="w-[17px] h-[17px] text-[var(--gold)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[14px]">Save this link — it's yours</div>
          <p className="text-[12px] text-muted-foreground mt-[2px]">
            This same link works for every job. On iPhone: Share → "Add to Home
            Screen". On Android: menu (⋮) → "Add to Home screen".
          </p>
          <div className="flex gap-[8px] mt-[8px]">
            <button
              onClick={copy}
              className="flex items-center gap-[6px] rounded-[10px] px-[12px] py-[7px] text-[12px] font-display font-bold bg-[var(--ink)] text-white active:scale-[0.97] transition-transform"
            >
              {copied ? <Check className="w-[13px] h-[13px]" /> : <Copy className="w-[13px] h-[13px]" />}
              {copied ? "Copied!" : "Copy my link"}
            </button>
            <button
              onClick={() => {
                localStorage.setItem("halo-portal-savelink-dismissed", "1");
                setDismissed(true);
              }}
              className="rounded-[10px] px-[12px] py-[7px] text-[12px] font-semibold text-muted-foreground bg-[var(--paper)] border border-border"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const card = "bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px]";

function moneyShort(n: number): string {
  return `$${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function EmergencyOfferCard({
  offer,
  token,
}: {
  offer: PortalEmergencyOffer;
  token: string;
}) {
  const queryClient = useQueryClient();
  const commit = useCommitPortalEmergency();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [committedHold, setCommittedHold] = useState<number | null>(null);

  const isCommitted = offer.status === "committed" || offer.filledByYou;
  const isExpired =
    !isCommitted && (offer.status === "expired" || offer.pingStatus === "expired");
  const isOpenPending =
    offer.status === "pending" && offer.pingStatus === "open" && !offer.filledByYou;
  const isFilledByOther =
    !isCommitted &&
    !isExpired &&
    (offer.status === "missed" || offer.pingStatus === "filled");
  const expiresLabel = (() => {
    if (!isOpenPending || !offer.expiresAt) return null;
    const ms = new Date(offer.expiresAt).getTime() - Date.now();
    if (ms <= 0) return "Offer expiring…";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `Offer expires in ${mins} min`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return `Offer expires in ${hrs}h${rem > 0 ? ` ${rem}m` : ""}`;
  })();

  const handleCommit = () => {
    setErrorMsg(null);
    commit.mutate(
      { token, targetId: offer.id },
      {
        onSuccess: (res) => {
          setSuccessMsg(res.message ?? "You're committed — pay is on hold.");
          setCommittedHold(res.holdAmount ?? offer.payAmount + offer.bonusAmount);
          queryClient.invalidateQueries({ queryKey: getGetPortalQueryKey(token) });
          queryClient.invalidateQueries({
            queryKey: getGetPortalEarningsQueryKey(token),
          });
        },
        onError: (err: any) => {
          const status = err?.status ?? err?.response?.status;
          const msg = err?.data?.error;
          if (status === 409) {
            setErrorMsg(msg ?? "This ping was just filled by another crew.");
            queryClient.invalidateQueries({ queryKey: getGetPortalQueryKey(token) });
          } else {
            setErrorMsg(msg ?? "Something went wrong. Try again.");
          }
        },
      },
    );
  };

  const holdOnCard = committedHold ?? offer.payAmount + offer.bonusAmount;
  const showCommittedState = isCommitted || successMsg;

  return (
    <div
      className="bg-card rounded-[16px] shadow-[var(--shadow)] overflow-hidden border-2 border-red-500"
      data-testid={`emergency-offer-${offer.id}`}
    >
      <div className="px-[16px] py-[12px] bg-red-50 border-b-2 border-red-200 flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-[6px]">
            <span className="text-[10px] font-display font-bold uppercase tracking-[0.12em] text-white bg-red-600 px-[8px] py-[3px] rounded-full animate-pulse">
              Emergency
            </span>
            {offer.jobNo && (
              <span className="text-[11px] font-bold text-red-700/80 uppercase tracking-wider truncate">
                {offer.jobNo}
                {offer.category ? ` · ${offer.category}` : ""}
              </span>
            )}
          </div>
          <div className="font-display font-bold text-[18px] mt-[6px] leading-tight text-foreground">
            {offer.propertyName || "Emergency job"}
            {offer.unitNo ? ` · Unit ${offer.unitNo}` : ""}
          </div>
        </div>
      </div>

      <div className="p-[16px] flex flex-col gap-[12px]">
        {/* Pay + bonus callout */}
        <div className="rounded-[12px] bg-red-50 border border-red-200 px-[12px] py-[10px]">
          <div className="text-[15px] font-display font-bold text-red-700">
            {moneyShort(offer.payAmount)} pay
            {offer.bonusAmount > 0 && (
              <> + {moneyShort(offer.bonusAmount)} bonus</>
            )}
            <span className="text-red-600"> — same-day pay</span>
          </div>
          {expiresLabel && (
            <div
              className="text-[12px] font-semibold text-red-600 mt-[4px]"
              data-testid={`emergency-expires-${offer.id}`}
            >
              {expiresLabel} — first to commit wins
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-[12px]">
          <div className="flex items-start gap-[8px]">
            <Calendar className="w-[16px] h-[16px] text-muted-foreground shrink-0 mt-[2px]" />
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Needed by
              </div>
              <div className="text-[13px] font-semibold">
                {offer.neededBy || "ASAP"}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-[8px]">
            <MapPin className="w-[16px] h-[16px] text-muted-foreground shrink-0 mt-[2px]" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Location
              </div>
              <div className="text-[13px] font-semibold leading-tight">
                {[offer.propertyAddress, offer.propertyCity]
                  .filter(Boolean)
                  .join(", ") || "No address provided"}
              </div>
              {(offer.propertyAddress || offer.propertyCity) && (
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(
                    [offer.propertyAddress, offer.propertyCity]
                      .filter(Boolean)
                      .join(", "),
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-semibold text-[var(--blue)]"
                >
                  Open in Maps
                </a>
              )}
            </div>
          </div>
        </div>

        {offer.note && (
          <div className="rounded-[10px] bg-[var(--paper)] border border-border px-[10px] py-[8px] text-[13px]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-[2px]">
              Note
            </span>
            {offer.note}
          </div>
        )}

        {offer.description && (
          <div className="text-[13.5px] leading-relaxed">{offer.description}</div>
        )}

        {(offer.contactName || offer.contactPhone) && (
          <div className="pt-[8px] border-t border-border">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-[2px]">
              Site Contact
            </div>
            <div className="text-[13px] font-semibold">
              {offer.contactName || "Contact"}
            </div>
            {offer.contactPhone && (
              <a
                href={`tel:${offer.contactPhone.replace(/[^\d+]/g, "")}`}
                className="text-[13px] text-[var(--blue)] font-semibold"
              >
                {offer.contactPhone}
              </a>
            )}
          </div>
        )}

        {/* Status / action */}
        {errorMsg && (
          <div
            className="bg-red-50 text-red-700 px-[12px] py-[8px] rounded-[8px] text-[13px] flex items-start gap-[8px]"
            data-testid={`emergency-error-${offer.id}`}
          >
            <AlertCircle className="w-[16px] h-[16px] shrink-0 mt-[2px]" />
            <span>{errorMsg}</span>
          </div>
        )}

        {showCommittedState ? (
          <div
            className="bg-green-50 border border-green-200 text-green-800 px-[14px] py-[12px] rounded-[12px] text-[13.5px] font-semibold flex items-start gap-[10px]"
            data-testid={`emergency-committed-${offer.id}`}
          >
            <CheckCircle2 className="w-[20px] h-[20px] shrink-0 mt-[1px] text-green-600" />
            <span>
              {successMsg ??
                `You're committed — ${moneyShort(holdOnCard)} on hold, releases on approval`}
            </span>
          </div>
        ) : isExpired ? (
          <div
            className="bg-black/5 text-muted-foreground px-[14px] py-[12px] rounded-[12px] text-[13.5px] font-semibold text-center"
            data-testid={`emergency-expired-${offer.id}`}
          >
            This offer expired — no longer available
          </div>
        ) : isFilledByOther ? (
          <div
            className="bg-black/5 text-muted-foreground px-[14px] py-[12px] rounded-[12px] text-[13.5px] font-semibold text-center"
            data-testid={`emergency-filled-${offer.id}`}
          >
            Filled by another crew
          </div>
        ) : isOpenPending ? (
          <button
            onClick={handleCommit}
            disabled={commit.isPending}
            className="w-full py-[14px] rounded-[12px] font-display font-bold text-[15px] bg-red-600 text-white active:scale-[0.98] transition-transform disabled:opacity-70 flex items-center justify-center gap-[8px]"
            data-testid={`button-emergency-commit-${offer.id}`}
          >
            {commit.isPending ? (
              <Loader2 className="w-[18px] h-[18px] animate-spin" />
            ) : (
              <Check className="w-[18px] h-[18px]" />
            )}
            Accept &amp; Commit
          </button>
        ) : null}
      </div>
    </div>
  );
}

function OffersTab({ portal, token }: { portal: PortalBundle; token: string }) {
  const queryClient = useQueryClient();
  const respond = useRespondPortalOffer();
  const [declineConfirmId, setDeclineConfirmId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const offers = portal.offers || [];
  const emergencyOffers = portal.emergencyOffers || [];
  const pending = offers.filter((o) => o.status === "pending" && !o.filledByOther);
  const resolved = offers.filter((o) => o.status !== "pending" || o.filledByOther);

  const handleRespond = (offerId: string, decision: "approved" | "declined") => {
    setErrors((prev) => ({ ...prev, [offerId]: "" }));
    respond.mutate(
      { token, offerId, data: { decision } },
      {
        onSuccess: () => { queryClient.invalidateQueries(); },
        onError: (err: any) => {
          setErrors((prev) => ({ ...prev, [offerId]: err?.data?.error ?? "Something went wrong" }));
        },
      }
    );
  };

  return (
    <div className="animate-in fade-in duration-200 flex flex-col gap-[10px]">

      {/* Emergency — stays prominent */}
      {emergencyOffers.length > 0 && (
        <div className="flex flex-col gap-[10px]" data-testid="section-emergency-offers">
          <div className="text-[11px] font-bold tracking-wider uppercase text-red-600 flex items-center gap-[5px]">
            <AlertCircle className="w-[13px] h-[13px]" /> Emergency
          </div>
          {emergencyOffers.map((eo) => (
            <EmergencyOfferCard key={eo.id} offer={eo} token={token} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {pending.length === 0 && resolved.length === 0 && emergencyOffers.length === 0 && (
        <div className={`${card} text-center py-[40px]`}>
          <Briefcase className="w-[28px] h-[28px] text-muted-foreground mx-auto mb-[10px]" />
          <div className="font-display font-bold text-[16px]">No offers yet</div>
          <p className="text-[13px] text-muted-foreground mt-[3px]">Job offers will appear here.</p>
        </div>
      )}

      {/* ── Pending offers — expanded card with action buttons ── */}
      {pending.map((o) => {
        const mapsQ = [o.propertyAddress, o.propertyCity].filter(Boolean).join(", ");
        const dateLabel = o.scheduleType === "flex" && o.flexDueBy
          ? `By ${formatDay(o.flexDueBy)}`
          : o.scheduledOn ? formatDay(o.scheduledOn) : "TBD";

        return (
          <div
            key={o.id}
            className="rounded-[16px] border-2 border-[var(--gold)] bg-card shadow-sm overflow-hidden"
          >
            {/* Header */}
            <div className="px-[14px] pt-[13px] pb-[11px] border-b border-[var(--gold)]/15 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-display font-bold text-[16px] leading-tight">
                  {o.unitNo ? `Unit ${o.unitNo}` : o.propertyName || "Job"}
                  {o.category ? ` · ${o.category}` : ""}
                </div>
                {o.propertyName && o.unitNo && (
                  <div className="text-[12px] text-muted-foreground mt-[1px] truncate">{o.propertyName}</div>
                )}
              </div>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-[var(--gold-light)] text-black px-[8px] py-[3px] rounded-full mt-[2px]">
                Action Needed
              </span>
            </div>

            {/* Details */}
            <div className="px-[14px] py-[11px] flex flex-col gap-[7px]">
              {/* Date + spots */}
              <div className="flex items-center gap-[12px] text-[13px]">
                <span className="flex items-center gap-[5px] font-semibold">
                  <Calendar className="w-[13px] h-[13px] text-muted-foreground" />
                  {dateLabel}
                  {o.startTime ? ` · ${formatClock(o.startTime)}` : ""}
                </span>
                {(o.crewsNeeded ?? 1) > 1 && (
                  <span className="text-[12px] text-muted-foreground">
                    {o.crewsFilled ?? 0}/{o.crewsNeeded} spots filled
                  </span>
                )}
              </div>

              {/* Location */}
              {mapsQ ? (
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(mapsQ)}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-[5px] text-[12.5px] text-[var(--blue)] font-semibold"
                >
                  <MapPin className="w-[13px] h-[13px] shrink-0" />
                  {mapsQ}
                </a>
              ) : null}

              {/* Specialty scope */}
              {o.forServices && o.forServices.length > 0 && (
                <div
                  className="text-[12px] bg-sky-50 border border-sky-200 text-sky-900 rounded-[8px] px-[10px] py-[6px]"
                  data-testid={`offer-services-${o.id}`}
                >
                  <b>Your scope:</b> {o.forServices.join(", ")}
                  {o.startTime && ` — start at ${formatClock(o.startTime)}`}
                </div>
              )}

              {/* Description / tasks */}
              {(o.description || (o.tasks && o.tasks.length > 0)) && (
                <div className="text-[12px] bg-[var(--paper)] rounded-[8px] px-[10px] py-[8px] flex flex-col gap-[3px]">
                  {o.description && <p className="mb-[3px] text-foreground">{o.description}</p>}
                  {o.tasks && o.tasks.map((t, i) => (
                    <div key={i} className="flex items-start gap-[5px] text-muted-foreground">
                      <span className="text-[var(--gold)] leading-none mt-[2px]">•</span> {t}
                    </div>
                  ))}
                </div>
              )}

              {/* Contact */}
              {(o.contactPhone || o.contactEmail) && (
                <div className="flex flex-wrap gap-x-[12px] gap-y-[3px]">
                  {o.contactPhone && (
                    <a href={`tel:${o.contactPhone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-[5px] text-[12.5px] text-[var(--blue)] font-semibold">
                      <Phone className="w-[13px] h-[13px] shrink-0" />
                      {o.contactPhone}{o.contactName ? ` · ${o.contactName}` : ""}
                    </a>
                  )}
                  {o.contactEmail && !o.contactPhone && (
                    <a href={`mailto:${o.contactEmail}`} className="text-[12.5px] text-[var(--blue)] font-semibold">{o.contactEmail}</a>
                  )}
                </div>
              )}

              {/* Reference photos */}
              {o.photos && o.photos.length > 0 && (
                <div className="flex gap-[6px] overflow-x-auto">
                  {o.photos.map((p) => (
                    <a key={p.storagePath} href={`/api/storage${p.storagePath}`} target="_blank" rel="noreferrer"
                      className="shrink-0 w-[72px] h-[72px] rounded-[8px] overflow-hidden bg-black/5 border border-border">
                      <img src={`/api/storage${p.storagePath}`} alt="" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              {/* Error */}
              {errors[o.id] && (
                <div className="text-[12px] text-red-700 bg-red-50 rounded-[8px] px-[10px] py-[6px] flex items-center gap-[6px]">
                  <AlertCircle className="w-[13px] h-[13px] shrink-0" /> {errors[o.id]}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="px-[14px] pb-[14px]">
              {declineConfirmId === o.id ? (
                <div className="flex gap-[8px]">
                  <button
                    onClick={() => setDeclineConfirmId(null)}
                    className="flex-1 py-[10px] rounded-[12px] text-[13px] font-bold border border-border text-muted-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { handleRespond(o.id, "declined"); setDeclineConfirmId(null); }}
                    disabled={respond.isPending}
                    className="flex-1 py-[10px] rounded-[12px] text-[13px] font-bold bg-red-600 text-white disabled:opacity-50"
                  >
                    Yes, Decline
                  </button>
                </div>
              ) : (
                <div className="flex gap-[10px]">
                  <button
                    onClick={() => setDeclineConfirmId(o.id)}
                    className="w-[80px] py-[11px] rounded-[12px] text-[13px] font-bold border-2 border-border text-muted-foreground active:scale-[0.97] transition-transform"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => handleRespond(o.id, "approved")}
                    disabled={respond.isPending}
                    className="flex-1 py-[11px] rounded-[12px] font-display font-bold text-[14px] btn-gold flex items-center justify-center gap-[7px] active:scale-[0.98] transition-transform disabled:opacity-70"
                  >
                    {respond.isPending
                      ? <Loader2 className="w-[16px] h-[16px] animate-spin" />
                      : <Check className="w-[16px] h-[16px]" />}
                    Accept Job
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* ── Resolved — collapsed single row per offer ── */}
      {resolved.length > 0 && (
        <div className="flex flex-col gap-[5px] mt-[2px]">
          {pending.length > 0 && (
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-[2px] mt-[4px]">
              Past offers
            </div>
          )}
          {resolved.map((o) => {
            const isFilled = o.status === "pending" && o.filledByOther;
            const statusLabel = isFilled
              ? "Filled"
              : o.status === "approved" ? "Accepted"
              : o.status === "declined" ? "Declined"
              : "Withdrawn";
            const statusCls = o.status === "approved"
              ? "text-green-700 bg-green-50"
              : "text-muted-foreground bg-black/5";
            return (
              <div key={o.id} className="flex items-center gap-[10px] bg-card border border-border rounded-[11px] px-[12px] py-[9px] opacity-65">
                <div className="min-w-0 flex-1 text-[13px] font-semibold truncate">
                  {o.unitNo ? `Unit ${o.unitNo} · ` : ""}
                  {o.propertyName || o.jobNo}
                  {o.category ? ` · ${o.category}` : ""}
                </div>
                <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-[7px] py-[2px] rounded-full ${statusCls}`}>
                  {statusLabel}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OfficeViewTab({ view }: { view: PortalOfficeView }) {
  // "View jobs" on a map pin filters the Jobs list to that property and
  // scrolls the section into view.
  const [jobsPropertyFilter, setJobsPropertyFilter] = useState<string | null>(null);
  const jobsSectionRef = useRef<HTMLDivElement | null>(null);
  const hasJobs = view.features.includes("jobs");
  const hasProperties = view.features.includes("properties");
  // Reverse direction: tapping a job scrolls to the map and opens the pin.
  const [mapFocus, setMapFocus] = useState<{ id: string; nonce: number } | null>(null);
  const mapSectionRef = useRef<HTMLDivElement | null>(null);
  const mappablePropertyIds = useMemo(
    () =>
      new Set(
        view.properties
          .filter((p) => p.latitude != null && p.longitude != null)
          .map((p) => p.id),
      ),
    [view.properties],
  );
  const viewPropertyOnMap = (propertyId: string) => {
    setMapFocus({ id: propertyId, nonce: Date.now() });
    requestAnimationFrame(() => {
      mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const viewJobsForProperty = (propertyId: string) => {
    setJobsPropertyFilter(propertyId);
    // Wait a tick so the (possibly re-rendered) section exists before scrolling.
    requestAnimationFrame(() => {
      jobsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const filteredJobs = jobsPropertyFilter
    ? view.jobs.filter((j) => j.propertyId === jobsPropertyFilter)
    : view.jobs;
  const filterPropertyName =
    jobsPropertyFilter
      ? view.properties.find((p) => p.id === jobsPropertyFilter)?.name ??
        view.jobs.find((j) => j.propertyId === jobsPropertyFilter)?.propertyName ??
        "property"
      : null;
  const statusColor = (s: string) =>
    s === "complete" || s === "paid"
      ? "bg-[var(--green)]/12 text-[var(--green)]"
      : s === "in_progress"
        ? "bg-[var(--gold-light)]/20 text-[var(--gold-dark,#8f6a1f)]"
        : "bg-[var(--ink)]/8 text-[var(--ink)]";
  return (
    <div className="animate-in fade-in duration-200">
      <div className={`${card} mb-[12px] flex items-start gap-[10px]`}>
        <ShieldCheck className="w-[18px] h-[18px] text-[var(--gold)] shrink-0 mt-[1px]" />
        <div>
          <div className="text-[13.5px] font-semibold">Your office access</div>
          <div className="text-[12.5px] text-muted-foreground">
            {view.accessSummary} · read-only
          </div>
        </div>
      </div>

      {view.features.includes("schedule") && (
        <>
          <div className="text-[13px] font-semibold mb-[8px]">
            Schedule — next 14 days
          </div>
          {view.schedule.length === 0 ? (
            <div className={`${card} mb-[12px] text-[12.5px] text-muted-foreground`}>
              Nothing scheduled in your scope.
            </div>
          ) : (
            <div className="flex flex-col gap-[8px] mb-[14px]">
              {view.schedule.map((s, i) => (
                <div key={i} className={card}>
                  <div className="flex items-center gap-[8px]">
                    <Calendar className="w-[13px] h-[13px] text-[var(--gold)]" />
                    <span className="text-[12.5px] font-semibold">
                      {formatDay(s.date)}
                    </span>
                    {s.time && (
                      <span className="text-[12px] text-muted-foreground">· {s.time}</span>
                    )}
                  </div>
                  <div className="text-[13.5px] font-semibold mt-[2px]">{s.title}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {s.propertyName ?? ""}
                    {s.unitNo ? ` · Unit ${s.unitNo}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view.features.includes("dispatch") && (
        <>
          <div className="text-[13px] font-semibold mb-[8px]">Today's dispatch</div>
          {view.dispatch.length === 0 ? (
            <div className={`${card} mb-[12px] text-[12.5px] text-muted-foreground`}>
              No dispatch assignments today in your scope.
            </div>
          ) : (
            <div className="flex flex-col gap-[8px] mb-[14px]">
              {view.dispatch.map((d, i) => (
                <div key={i} className={`${card} flex items-center gap-[10px]`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold truncate">
                      {d.memberName}
                    </div>
                    <div className="text-[12px] text-muted-foreground truncate">
                      {d.jobNo ?? "Job"}
                      {d.propertyName ? ` · ${d.propertyName}` : ""}
                      {d.unitNo ? ` · Unit ${d.unitNo}` : ""}
                    </div>
                  </div>
                  <span className="text-[12px] text-muted-foreground shrink-0">
                    {d.checklistTotal > 0
                      ? `${d.checklistDone}/${d.checklistTotal}`
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {hasJobs && (
        <div ref={jobsSectionRef} className="scroll-mt-[70px]">
          <div className="flex items-center gap-[8px] mb-[8px]">
            <div className="text-[13px] font-semibold">Jobs</div>
            {filterPropertyName && (
              <button
                type="button"
                onClick={() => setJobsPropertyFilter(null)}
                className="flex items-center gap-[4px] text-[11px] font-semibold bg-[var(--gold-light)]/25 text-foreground rounded-full px-[8px] py-[2px] hover:bg-[var(--gold-light)]/40 transition-colors"
                data-testid="button-clear-jobs-filter"
              >
                {filterPropertyName}
                <X className="w-[11px] h-[11px]" />
              </button>
            )}
          </div>
          {filteredJobs.length === 0 ? (
            <div className={`${card} mb-[12px] text-[12.5px] text-muted-foreground`}>
              {jobsPropertyFilter ? "No jobs at this property in your scope." : "No jobs in your scope."}
            </div>
          ) : (
            <div className="flex flex-col gap-[8px] mb-[14px]">
              {filteredJobs.slice(0, 50).map((j) => (
                <div key={j.id} className={card}>
                  <div className="flex items-center gap-[8px]">
                    <span className="text-[13.5px] font-semibold">{j.jobNo}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-[7px] py-[2px] rounded-full ${statusColor(j.status)}`}
                    >
                      {j.status.replace(/_/g, " ")}
                    </span>
                    {hasProperties && j.propertyId && mappablePropertyIds.has(j.propertyId) && (
                      <button
                        type="button"
                        onClick={() => viewPropertyOnMap(j.propertyId!)}
                        className="ml-auto flex items-center gap-[4px] text-[11px] font-semibold bg-[var(--gold-light)]/25 text-foreground rounded-full px-[8px] py-[3px] hover:bg-[var(--gold-light)]/40 transition-colors shrink-0"
                        data-testid={`button-view-on-map-${j.id}`}
                      >
                        <MapPin className="w-[11px] h-[11px]" /> Map
                      </button>
                    )}
                  </div>
                  <div className="text-[12.5px] text-muted-foreground mt-[2px]">
                    {j.propertyName ?? ""}
                    {j.unitNo ? ` · Unit ${j.unitNo}` : ""}
                    {j.scheduledOn ? ` · ${formatDay(j.scheduledOn)}` : ""}
                  </div>
                  {j.description && (
                    <div className="text-[12.5px] mt-[2px]">{j.description}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {hasProperties && (
        <div ref={mapSectionRef} className="scroll-mt-[70px]">
          <div className="text-[13px] font-semibold mb-[8px]">Properties</div>
          <OfficePropertyMap
            focus={mapFocus}
            pins={view.properties.flatMap((p) =>
              p.latitude != null && p.longitude != null
                ? [
                    {
                      id: p.id,
                      lat: p.latitude,
                      lng: p.longitude,
                      name: p.name,
                      address:
                        [p.address, p.city].filter(Boolean).join(", ") || null,
                      activeJobs: p.activeJobs,
                    },
                  ]
                : [],
            )}
            onViewJobs={hasJobs ? viewJobsForProperty : undefined}
          />
          <div className="flex flex-col gap-[8px] mb-[14px]">
            {view.properties.map((p) => (
              <div key={p.id} className={card}>
                <div className="text-[13.5px] font-semibold">{p.name}</div>
                <div className="text-[12px] text-muted-foreground">
                  {[p.address, p.city].filter(Boolean).join(", ") || "No address on file"}
                  {p.units != null ? ` · ${p.units} units` : ""}
                  {` · ${p.activeJobs} active job${p.activeJobs === 1 ? "" : "s"}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ForemanRoutedNotice({ leaderName }: { leaderName: string | null }) {
  return (
    <div className="animate-in fade-in duration-200">
      <div className={`${card} text-center py-[28px]`}>
        <MessageSquare className="w-[22px] h-[22px] text-[var(--gold)] mx-auto mb-[8px]" />
        <div className="font-semibold text-[14.5px] mb-[4px]">
          Messages go through your foreman
        </div>
        <div className="text-[13px] text-muted-foreground">
          {leaderName
            ? `Talk to ${leaderName} — they'll get word to the office for you.`
            : "Talk to your foreman — they'll get word to the office for you."}
        </div>
      </div>
    </div>
  );
}

function PortalDispatchSection({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const { data } = useGetPortalDispatch(token, {
    query: {
      queryKey: getGetPortalDispatchQueryKey(token),
      refetchInterval: 20000,
    },
  });
  const check = useCheckPortalDispatchItem();
  const respond = useRespondPortalDispatchMove();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetPortalDispatchQueryKey(token) });

  if (!data || (data.assignments.length === 0 && !data.team)) return null;

  const toggle = (assignmentId: string, itemId: string, done: boolean) => {
    check.mutate(
      { token, assignmentId, data: { itemId, done } },
      { onSuccess: refresh },
    );
  };

  const renderAssignment = (a: PortalDispatchAssignment, editable: boolean) => {
    const doneCount = a.checklist.filter((i) => i.done).length;
    return (
      <div key={a.id} className={`${card} mb-[10px]`}>
        <div className="flex items-center gap-[8px] mb-[4px]">
          <ClipboardCheck className="w-[14px] h-[14px] text-[var(--gold)]" />
          <span className="text-[12.5px] font-semibold">
            {a.jobNo ?? "Job"}
            {a.unitNo ? ` · Unit ${a.unitNo}` : ""}
          </span>
          {a.status === "pending_move" && (
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wide px-[8px] py-[2px] rounded-full bg-[var(--orange)]/12 text-[var(--orange)]">
              Move pending
            </span>
          )}
          {a.checklist.length > 0 && a.status !== "pending_move" && (
            <span className="ml-auto text-[11px] text-muted-foreground">
              {doneCount}/{a.checklist.length}
            </span>
          )}
        </div>
        <div className="font-semibold text-[14.5px]">
          {a.propertyName ?? a.description ?? "Assignment"}
        </div>
        {a.propertyName && a.description && (
          <div className="text-[12.5px] text-muted-foreground mt-[2px]">
            {a.description}
          </div>
        )}
        {a.checklist.length > 0 && (
          <div className="mt-[10px] flex flex-col gap-[6px]">
            {a.checklist.map((i) => (
              <button
                key={i.id}
                disabled={!editable}
                onClick={() => toggle(a.id, i.id, !i.done)}
                className="flex items-center gap-[9px] text-left"
              >
                <span
                  className={`w-[18px] h-[18px] rounded-[6px] border grid place-items-center shrink-0 ${
                    i.done
                      ? "bg-[var(--gold-light)] border-[var(--gold-light)]"
                      : "border-border bg-white"
                  }`}
                >
                  {i.done && <Check className="w-[12px] h-[12px] text-black" />}
                </span>
                <span
                  className={`text-[13px] ${i.done ? "line-through text-muted-foreground" : ""}`}
                >
                  {i.text}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="animate-in fade-in duration-200 mb-[14px]">
      {data.assignments.length > 0 && (
        <>
          <div className="text-[13px] text-muted-foreground mb-[8px]">
            Today's dispatch — check off work as you go
          </div>
          {data.assignments.map((a) => renderAssignment(a, true))}
        </>
      )}

      {data.team && data.team.pendingMoves.length > 0 && (
        <>
          <div className="text-[13px] font-semibold mb-[8px] mt-[6px]">
            Moves waiting on you
          </div>
          {data.team.pendingMoves.map((m) => (
            <div key={m.assignmentId} className={`${card} mb-[10px]`}>
              <div className="text-[13.5px] font-semibold mb-[2px]">
                Move {m.memberName}?
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                From {m.fromJobLabel ?? "current job"} to {m.toJobLabel ?? "another job"}
              </div>
              <div className="flex gap-[8px] mt-[10px]">
                <button
                  disabled={respond.isPending}
                  onClick={() =>
                    respond.mutate(
                      { token, assignmentId: m.assignmentId, data: { approve: true } },
                      { onSuccess: refresh },
                    )
                  }
                  className="flex-1 rounded-[11px] bg-[var(--gold-light)] text-black text-[13px] font-bold py-[9px]"
                >
                  Approve
                </button>
                <button
                  disabled={respond.isPending}
                  onClick={() =>
                    respond.mutate(
                      { token, assignmentId: m.assignmentId, data: { approve: false } },
                      { onSuccess: refresh },
                    )
                  }
                  className="flex-1 rounded-[11px] border border-border text-[13px] font-bold py-[9px]"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {data.team && data.team.members.some((m) => m.assignments.length > 0) && (
        <>
          <div className="text-[13px] font-semibold mb-[8px] mt-[6px]">
            Your team today
          </div>
          {data.team.members
            .filter((m) => m.assignments.length > 0)
            .map((m) => (
              <div key={m.id} className="mb-[6px]">
                <div className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide mb-[6px]">
                  {m.name}
                </div>
                {m.assignments.map((a) => renderAssignment(a, true))}
              </div>
            ))}
        </>
      )}
    </div>
  );
}

/** Per-job work checklist: the crew sees every line item on their jobs but can
 *  only check off the items assigned to them. Checking the last open item on a
 *  job moves the whole card to Done on the office board. */
function WorkChecklistSection({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const { data: jobs } = useListPortalJobs(token, {
    query: { queryKey: getListPortalJobsQueryKey(token) },
  });
  const completeItem = useCompletePortalLineItem();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = (jobs ?? []).filter(
    (j) =>
      (j.lineItems?.length ?? 0) > 0 &&
      j.status !== "complete" &&
      j.status !== "cancelled",
  );
  if (active.length === 0) return null;
  const toggle = async (jobId: string, itemId: string, done: boolean) => {
    setBusyId(itemId);
    setNotice(null);
    try {
      const res = await completeItem.mutateAsync({
        token,
        jobId,
        lineItemId: itemId,
        data: { done },
      });
      if (res.jobCompleted) setNotice("All work checked off — job marked Done. Nice work!");
      queryClient.invalidateQueries({ queryKey: getListPortalJobsQueryKey(token) });
    } catch {
      setNotice("Couldn't update that item — try again.");
    } finally {
      setBusyId(null);
    }
  };
  return (
    <div className="mb-[14px]">
      <div className="text-[13px] font-semibold mb-[8px]">Work checklist</div>
      {notice && (
        <div className="text-[12px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-[10px] py-[6px] mb-[8px]" data-testid="checklist-notice">
          {notice}
        </div>
      )}
      <div className="flex flex-col gap-[8px]">
        {active.map((j) => (
          <div key={j.id} className="bg-white border border-border rounded-2xl p-[12px]" data-testid={`checklist-job-${j.id}`}>
            <div className="text-[13px] font-semibold">{j.label}</div>
            <div className="mt-[8px] flex flex-col gap-[6px]">
              {(j.lineItems ?? []).map((li) => {
                const canTap = li.mine && busyId !== li.id;
                return (
                  <button
                    key={li.id}
                    type="button"
                    disabled={!canTap}
                    onClick={() => toggle(j.id, li.id, !li.completed)}
                    className={`flex items-center gap-[8px] rounded-xl border px-[10px] py-[8px] text-left ${
                      li.completed
                        ? "border-emerald-200 bg-emerald-50"
                        : li.mine
                          ? "border-border bg-[var(--background,#f8f8f6)]"
                          : "border-border bg-white opacity-60"
                    }`}
                    data-testid={`checklist-item-${li.id}`}
                  >
                    <span
                      className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2 ${
                        li.completed
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-muted-foreground/40 text-transparent"
                      }`}
                    >
                      <Check className="w-[12px] h-[12px]" />
                    </span>
                    <span className={`min-w-0 flex-1 text-[13px] font-medium ${li.completed ? "line-through text-muted-foreground" : ""}`}>
                      {li.service}
                      {li.startTime && !li.completed && (
                        <span className="ml-[6px] text-[10.5px] font-bold text-[var(--gold-dark)]">
                          {formatClock(li.startTime)}
                        </span>
                      )}
                    </span>
                    {!li.mine && (
                      <span className="shrink-0 text-[10.5px] text-muted-foreground">
                        {li.assignedCrewName ?? "Unassigned"}
                      </span>
                    )}
                    {li.mine && !li.completed && (
                      <span className="shrink-0 text-[10.5px] font-bold text-foreground bg-[var(--gold-light)]/40 rounded-full px-[7px] py-[2px]">
                        Tap when done
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduleTab({ portal }: { portal: PortalBundle }) {
  // Flat chronological view — no day/week/month switcher, crews just need
  // to see what's coming up. Upcoming first; past items hidden behind a toggle.
  const today = localToday();
  const sorted = (portal.schedule ?? [])
    .slice()
    .sort((a, b) => (a.scheduledOn ?? "").localeCompare(b.scheduledOn ?? ""));
  const upcoming = sorted.filter((s) => (s.scheduledOn ?? "") >= today);
  const past = sorted.filter((s) => (s.scheduledOn ?? "") < today);
  const [showPast, setShowPast] = useState(false);
  const items = showPast ? sorted : upcoming;

  // One-tap directions for today's multi-stop route.
  const todayStops = upcoming.filter((s) => s.scheduledOn === today);
  const todayAddresses = todayStops
    .map((s) =>
      s.propertyAddress
        ? s.propertyAddress
        : s.propertyName
          ? `${s.propertyName}${s.propertyCity ? `, ${s.propertyCity}` : ""}`
          : null,
    )
    .filter((a): a is string => Boolean(a));
  const dayDirectionsUrl =
    todayStops.length >= 2 && todayAddresses.length >= 1
      ? `https://www.google.com/maps/dir/${todayAddresses.map((a) => encodeURIComponent(a)).join("/")}`
      : null;

  // Group by date for headers.
  const grouped: { date: string; stops: typeof items }[] = [];
  for (const s of items) {
    const d = s.scheduledOn ?? "TBD";
    const last = grouped[grouped.length - 1];
    if (last?.date === d) last.stops.push(s);
    else grouped.push({ date: d, stops: [s] });
  }

  return (
    <div className="animate-in fade-in duration-200 flex flex-col gap-[10px]">

      {/* Today's directions button */}
      {dayDirectionsUrl && (
        <a
          href={dayDirectionsUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="link-directions-today"
          className="flex items-center justify-center gap-[8px] rounded-[13px] py-[12px] text-[14px] font-display font-bold text-black bg-[var(--gold-light)] active:scale-[0.98] transition-transform"
        >
          <MapPin className="w-[15px] h-[15px]" />
          Today's directions · {todayAddresses.length} stop{todayAddresses.length === 1 ? "" : "s"}
        </a>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className={`${card} text-center py-[36px]`}>
          <Calendar className="w-[28px] h-[28px] text-muted-foreground mx-auto mb-[10px]" />
          <div className="font-display font-bold text-[15px]">Nothing coming up</div>
          <p className="text-[12.5px] text-muted-foreground mt-[3px]">
            Your schedule appears here once the office assigns you to a job.
          </p>
        </div>
      )}

      {/* Stops grouped by date */}
      {grouped.map(({ date, stops }) => {
        const isToday = date === today;
        const dtLabel = formatDay(date) || "TBD";
        const multiStop = stops.length > 1;

        return (
          <div key={date}>
            {/* Date header */}
            <div className="flex items-center gap-[7px] mb-[6px] mt-[4px]">
              <span className={`text-[12px] font-bold uppercase tracking-wider ${isToday ? "text-[var(--gold-dark)]" : "text-muted-foreground"}`}>
                {dtLabel}
              </span>
              {isToday && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-[7px] py-[2px] rounded-full bg-[var(--gold-light)]/20 text-[var(--gold-dark)]">
                  Today
                </span>
              )}
            </div>

            <div className="flex flex-col gap-[6px]">
              {stops.map((s, idx) => {
                const mapsQ = s.propertyAddress
                  ? s.propertyAddress
                  : s.propertyName
                    ? `${s.propertyName}${s.propertyCity ? `, ${s.propertyCity}` : ""}`
                    : null;

                return (
                  <div
                    key={s.id}
                    className={`${card} ${isToday ? "ring-1 ring-[var(--gold)]/40" : ""}`}
                  >
                    <div className="flex items-start gap-[10px]">
                      {/* Stop number bubble for multi-stop days */}
                      {multiStop && (
                        <span className="shrink-0 w-[22px] h-[22px] rounded-full bg-[var(--ink)]/8 grid place-items-center text-[11px] font-bold text-[var(--ink)] mt-[1px]">
                          {idx + 1}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        {/* Property + unit */}
                        <div className="font-semibold text-[14px] leading-snug">
                          {s.propertyName || s.description || "Assignment"}
                          {s.unitNo ? ` · Unit ${s.unitNo}` : ""}
                        </div>
                        {s.propertyName && s.description && (
                          <div className="text-[12px] text-muted-foreground mt-[1px]">{s.description}</div>
                        )}

                        {/* Start time */}
                        {s.windowStart && (
                          <div className="text-[12px] font-semibold text-[var(--gold-dark)] mt-[4px]">
                            {s.windowStart}
                          </div>
                        )}

                        {/* Address + phone inline */}
                        <div className="flex flex-wrap gap-x-[10px] gap-y-[3px] mt-[6px]">
                          {mapsQ && (
                            <a
                              href={`https://maps.google.com/?q=${encodeURIComponent(mapsQ)}`}
                              target="_blank" rel="noreferrer"
                              className="flex items-center gap-[4px] text-[12px] text-[var(--blue)] font-semibold"
                            >
                              <MapPin className="w-[12px] h-[12px] shrink-0" />
                              {s.propertyAddress || s.propertyCity || "Directions"}
                            </a>
                          )}
                          {s.contactPhone && (
                            <a
                              href={`tel:${s.contactPhone.replace(/[^+0-9]/g, "")}`}
                              className="flex items-center gap-[4px] text-[12px] text-[var(--blue)] font-semibold"
                            >
                              <Phone className="w-[12px] h-[12px] shrink-0" />
                              {s.contactPhone}
                              {s.contactName ? (
                                <span className="text-muted-foreground font-normal"> · {s.contactName}</span>
                              ) : null}
                            </a>
                          )}
                        </div>

                        {/* Task list */}
                        {s.tasks && s.tasks.length > 0 && (
                          <ul className="mt-[8px] bg-[var(--paper)] rounded-[8px] px-[10px] py-[7px] flex flex-col gap-[3px]">
                            {s.tasks.map((t, i) => (
                              <li key={i} className="flex items-start gap-[5px] text-[12px]">
                                <CheckSquare className="w-[12px] h-[12px] mt-[2px] shrink-0 text-[var(--gold)]" />
                                {t}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Past stops toggle */}
      {past.length > 0 && (
        <button
          onClick={() => setShowPast((v) => !v)}
          data-testid="button-sched-show-past"
          className="text-[12px] text-muted-foreground font-semibold text-center py-[8px] border border-dashed border-border rounded-[10px] active:scale-[0.98] transition-transform"
        >
          {showPast
            ? "Hide past stops"
            : `Show ${past.length} past stop${past.length === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}

function MessagesTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const { data: messages } = useListPortalMessages(token, {
    query: {
      queryKey: getListPortalMessagesQueryKey(token),
      refetchInterval: 8000,
    },
  });
  const send = useSendPortalMessage();
  const [draft, setDraft] = useState("");

  const handleSend = () => {
    const body = draft.trim();
    if (!body) return;
    send.mutate(
      { token, data: { body } },
      {
        onSuccess: () => {
          setDraft("");
          queryClient.invalidateQueries({
            queryKey: getListPortalMessagesQueryKey(token),
          });
        },
      },
    );
  };

  return (
    <div className="animate-in fade-in duration-200">
      <div className={`${card} mb-[10px]`}>
        <div className="flex flex-col gap-[8px] min-h-[220px] max-h-[52vh] overflow-y-auto">
          {!messages || messages.length === 0 ? (
            <div className="text-[12.5px] text-muted-foreground py-[20px] text-center">
              Say hello to the office.
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[82%] rounded-[13px] px-[12px] py-[8px] text-[13px] leading-[1.4] ${
                  m.sender === "crew"
                    ? "self-end bg-[var(--ink)] text-white rounded-br-[4px]"
                    : "self-start bg-[rgba(23,24,28,0.06)] text-foreground rounded-bl-[4px]"
                }`}
              >
                <div>{m.body}</div>
                {m.attachmentPath && (
                  <a
                    href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/storage${m.attachmentPath}`}
                    target="_blank"
                    rel="noreferrer"
                    download={m.attachmentName ?? undefined}
                    className={`mt-[6px] flex items-center gap-[7px] rounded-[10px] px-[9px] py-[7px] text-[12px] font-semibold ${
                      m.sender === "crew"
                        ? "bg-white/15 text-white"
                        : "bg-white border border-border text-foreground"
                    }`}
                  >
                    <FileText className="w-[14px] h-[14px] shrink-0" />
                    <span className="truncate flex-1 min-w-0">
                      {m.attachmentName || "Attachment"}
                    </span>
                    <Download className="w-[13px] h-[13px] shrink-0" />
                  </a>
                )}
                <div
                  className={`text-[10px] mt-[3px] ${m.sender === "crew" ? "text-white/60" : "text-muted-foreground"}`}
                >
                  {m.sender === "admin" ? "ArchAngel" : "You"} · {formatWhen(m.createdAt)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="flex items-end gap-[8px]">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the office…"
          rows={1}
          className="flex-1 resize-none rounded-[12px] border border-border bg-card px-[13px] py-[11px] text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
        />
        <button
          onClick={handleSend}
          disabled={send.isPending || !draft.trim()}
          aria-label="Send"
          className="w-[44px] h-[44px] shrink-0 rounded-full grid place-items-center bg-[var(--ink)] text-white disabled:opacity-40 transition-transform active:scale-[0.9]"
        >
          <Send className="w-[17px] h-[17px]" />
        </button>
      </div>
    </div>
  );
}

// GPS trail logic lives in @/hooks/useGpsTrail — imported below.
// This placeholder keeps the file's section structure intact for search.
// All GPS functions (getPosition, localDay, TrackState, readTrackState,
// useGpsTrail) are re-exported from that shared hook so both MyJobsTab
// and CheckinTab use a single implementation with the same localStorage key.

/**
 * My Jobs — the guided, one-button-at-a-time home. Every job gets a card that
 * walks the crew through the exact same actions the other tabs offer
 * (check-in, before photos, checklist, after photos, check-out, invoice), via
 * the exact same endpoints — so the office Job Board, property timeline and
 * client board stay perfectly in sync no matter which tab the crew uses.
 */
function MyJobsTab({
  token,
  onInvoice,
}: {
  token: string;
  onInvoice: (jobId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: jobs } = useListPortalJobs(token, {
    query: { queryKey: getListPortalJobsQueryKey(token) },
  });
  const { data: photos } = useListPortalPhotos(token, {
    query: { queryKey: getListPortalPhotosQueryKey(token) },
  });
  const { tracking, startTrail, stopTrail } = useGpsTrail(token);
  const checkin = useCreatePortalCheckin();
  const completeItem = useCompletePortalLineItem();
  const sendPhoto = useUploadPortalPhoto();
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Jobs checked out this session (checkout doesn't change job.status).
  const [checkedOut, setCheckedOut] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingUpload = useRef<{ jobId: string; phase: "before" | "after" } | null>(null);
  const { uploadFile } = useUpload({
    onError: () => setErr("Photo upload failed. Check your connection and try again."),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListPortalJobsQueryKey(token) });
    queryClient.invalidateQueries({ queryKey: getListPortalPhotosQueryKey(token) });
    queryClient.invalidateQueries({ queryKey: getGetPortalQueryKey(token) });
  };

  const doCheck = async (jobId: string, kind: "checkin" | "checkout") => {
    setErr(null);
    setNotice(null);
    setBusy(`${jobId}:${kind}`);
    const pos = await getPosition();
    if (!pos) {
      setBusy(null);
      setErr("We couldn't get your location. Turn on location access and try again.");
      return;
    }
    checkin.mutate(
      {
        token,
        data: {
          jobId,
          kind,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          note: kind === "checkout" ? (notes[jobId] ?? "").trim() || null : null,
        },
      },
      {
        onSuccess: () => {
          setBusy(null);
          if (kind === "checkin") {
            startTrail(jobId);
            setNotice("Checked in! Keep this page open — your live trail is on until you check out.");
          } else {
            stopTrail();
            setCheckedOut((m) => ({ ...m, [jobId]: true }));
            setNotice("Checked out! Time and work note recorded. Last step: send your invoice.");
          }
          refresh();
        },
        onError: (e) => {
          setBusy(null);
          const data = (e as { data?: { code?: string; error?: string } | null })?.data;
          setErr(
            data?.code === "after_photos_required"
              ? "Add at least one AFTER photo (step 4) before checking out."
              : data?.error ?? "Couldn't save. Check your connection and try again.",
          );
        },
      },
    );
  };

  const pickPhotos = (jobId: string, phase: "before" | "after") => {
    setErr(null);
    pendingUpload.current = { jobId, phase };
    fileRef.current?.click();
  };

  const onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const target = pendingUpload.current;
    if (files.length === 0 || !target) return;
    setBusy(`${target.jobId}:${target.phase}`);
    const pos = await getPosition();
    try {
      for (const file of files) {
        const res = await uploadFile(file);
        if (!res) return;
        await sendPhoto.mutateAsync({
          token,
          data: {
            storagePath: res.objectPath,
            takenOn: localToday(),
            jobId: target.jobId,
            phase: target.phase,
            lat: pos?.coords.latitude ?? null,
            lng: pos?.coords.longitude ?? null,
            accuracy: pos?.coords.accuracy ?? null,
            capturedAt: new Date().toISOString(),
          },
        });
      }
      setNotice(target.phase === "before" ? "Before photos saved!" : "After photos saved!");
      refresh();
    } catch {
      setErr("Your photo uploaded but we couldn't save it. Please try again.");
    } finally {
      setBusy(null);
      pendingUpload.current = null;
    }
  };

  const toggleItem = async (jobId: string, itemId: string, done: boolean) => {
    setErr(null);
    setBusy(`item:${itemId}`);
    try {
      const res = await completeItem.mutateAsync({
        token,
        jobId,
        lineItemId: itemId,
        data: { done },
      });
      if (res.jobCompleted) setNotice("All work checked off — job marked Done. Nice work!");
      refresh();
    } catch {
      setErr("Couldn't update that item — try again.");
    } finally {
      setBusy(null);
    }
  };

  const activeJobs = (jobs ?? []).filter((j) => j.status !== "cancelled");

  const stepCircle = (state: "done" | "current" | "todo", n: number) => (
    <span
      className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 text-[12.5px] font-display font-bold ${
        state === "done"
          ? "border-emerald-600 bg-emerald-600 text-white"
          : state === "current"
            ? "border-[var(--gold)] bg-[var(--gold-light)] text-[var(--ink)]"
            : "border-border bg-card text-muted-foreground"
      }`}
    >
      {state === "done" ? <Check className="w-[14px] h-[14px]" /> : n}
    </span>
  );

  return (
    <div className="animate-in fade-in duration-200 flex flex-col gap-[12px]">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={onFilesPicked}
      />
      <div className={card}>
        <div className="font-display font-bold text-[17px]">My jobs</div>
        <p className="text-[12.5px] text-muted-foreground mt-[2px]">
          One card per job. Follow the steps top to bottom — the big button is
          always your next move. Everything you do here goes straight to the
          office and the client's board.
        </p>
      </div>
      {notice && (
        <div className="text-[12.5px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-[12px] py-[8px]" data-testid="myjobs-notice">
          {notice}
        </div>
      )}
      {err && (
        <div className="text-[12.5px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-[12px] py-[8px]" data-testid="myjobs-error">
          {err}
        </div>
      )}
      {activeJobs.length === 0 && (
        <div className={`${card} text-center text-[13px] text-muted-foreground`}>
          No jobs assigned right now. New offers show up in the Offers tab —
          you'll get an alert here the moment a job is yours.
        </div>
      )}
      {activeJobs.map((job) => {
        const beforeCount = (photos ?? []).filter((p) => p.jobId === job.id && p.phase === "before").length;
        const afterCount = (photos ?? []).filter((p) => p.jobId === job.id && p.phase === "after").length;
        const myItems = (job.lineItems ?? []).filter((li) => li.mine);
        const othersItems = (job.lineItems ?? []).filter((li) => !li.mine);
        const myAllDone = myItems.length > 0 && myItems.every((li) => li.completed);
        // On-site / checked-out state comes from the SERVER (persisted
        // check-ins), so the flow survives reloads and tab switches. The
        // local trail + session map only add instant feedback.
        const checkedIn = job.checkedIn || tracking?.jobId === job.id;
        const wasCheckedOut = !!job.checkedOut || !!checkedOut[job.id];
        const jobComplete = job.status === "complete";
        // Later evidence marks earlier steps done even after reloads.
        const laterEvidence = beforeCount > 0 || myItems.some((li) => li.completed) || afterCount > 0 || wasCheckedOut || jobComplete;
        const s1 = checkedIn || laterEvidence; // arrived
        const s2 = beforeCount > 0;
        const s3 = myItems.length === 0 ? s2 : myAllDone;
        const s4 = afterCount > 0;
        const s5 = wasCheckedOut || jobComplete;
        const doneFlags = [s1, s2, s3, s4, s5];
        const currentIdx = doneFlags.findIndex((d) => !d);
        const stateOf = (i: number): "done" | "current" | "todo" =>
          doneFlags[i] ? "done" : i === currentIdx ? "current" : "todo";
        const allDone = currentIdx === -1;
        const btnCls =
          "w-full mt-[8px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] disabled:opacity-60 transition-transform active:scale-[0.98]";
        return (
          <div key={job.id} className={card} data-testid={`myjob-${job.id}`}>
            <div className="flex items-start justify-between gap-[8px]">
              <div className="min-w-0">
                <div className="font-display font-bold text-[16px] leading-tight">
                  {job.propertyName ?? "Job"}
                  {job.unitNo ? ` · Unit ${job.unitNo}` : ""}
                </div>
                <div className="text-[12.5px] text-muted-foreground mt-[2px]">
                  <span className="font-mono">{job.jobNo}</span> · {job.label}
                </div>
              </div>
              {checkedIn && (
                <span className="shrink-0 flex items-center gap-[5px] text-[11px] font-bold text-[#3f7d20]">
                  <span className="w-[7px] h-[7px] rounded-full bg-[#4ade80] animate-pulse" /> On site
                </span>
              )}
            </div>

            <div className="mt-[12px] flex flex-col gap-[10px]">
              {/* Step 1 — arrive & check in */}
              <div className="flex gap-[10px]">
                {stepCircle(stateOf(0), 1)}
                <div className="min-w-0 flex-1">
                  <div className={`text-[13.5px] font-semibold ${stateOf(0) === "todo" ? "text-muted-foreground" : ""}`}>
                    Arrive &amp; check in
                  </div>
                  {stateOf(0) === "current" && (
                    <button onClick={() => doCheck(job.id, "checkin")} disabled={busy !== null} className={btnCls} data-testid={`myjob-checkin-${job.id}`}>
                      {busy === `${job.id}:checkin` ? (
                        <><Loader2 className="w-[18px] h-[18px] animate-spin" /> Getting location…</>
                      ) : (
                        <><LogIn className="w-[18px] h-[18px]" /> Check in — I've arrived</>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Step 2 — before photos */}
              <div className="flex gap-[10px]">
                {stepCircle(stateOf(1), 2)}
                <div className="min-w-0 flex-1">
                  <div className={`text-[13.5px] font-semibold ${stateOf(1) === "todo" ? "text-muted-foreground" : ""}`}>
                    Before photos{beforeCount > 0 ? ` · ${beforeCount} saved` : ""}
                  </div>
                  {(stateOf(1) === "current" || (stateOf(1) === "done" && currentIdx === 1)) && (
                    <button onClick={() => pickPhotos(job.id, "before")} disabled={busy !== null} className={btnCls} data-testid={`myjob-before-${job.id}`}>
                      {busy === `${job.id}:before` ? (
                        <><Loader2 className="w-[18px] h-[18px] animate-spin" /> Uploading…</>
                      ) : (
                        <><Camera className="w-[18px] h-[18px]" /> Take before photos</>
                      )}
                    </button>
                  )}
                  {stateOf(1) === "done" && (
                    <button onClick={() => pickPhotos(job.id, "before")} disabled={busy !== null} className="text-[12px] font-semibold text-[var(--gold-dark)] mt-[2px]">
                      + Add more before photos
                    </button>
                  )}
                </div>
              </div>

              {/* Step 3 — do the work (checklist) */}
              <div className="flex gap-[10px]">
                {stepCircle(stateOf(2), 3)}
                <div className="min-w-0 flex-1">
                  <div className={`text-[13.5px] font-semibold ${stateOf(2) === "todo" ? "text-muted-foreground" : ""}`}>
                    Do the work
                  </div>
                  {myItems.length === 0 ? (
                    <div className="text-[12px] text-muted-foreground mt-[2px]">
                      No task list on this job — just do the work described above.
                    </div>
                  ) : (
                    <div className="mt-[6px] flex flex-col gap-[6px]">
                      {myItems.map((li) => (
                        <button
                          key={li.id}
                          type="button"
                          disabled={busy === `item:${li.id}` || stateOf(2) === "todo"}
                          onClick={() => toggleItem(job.id, li.id, !li.completed)}
                          className={`flex items-center gap-[8px] rounded-xl border px-[10px] py-[9px] text-left ${
                            li.completed ? "border-emerald-200 bg-emerald-50" : "border-border bg-background"
                          } ${stateOf(2) === "todo" ? "opacity-60" : ""}`}
                          data-testid={`myjob-item-${li.id}`}
                        >
                          <span className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2 ${li.completed ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/40 text-transparent"}`}>
                            <Check className="w-[12px] h-[12px]" />
                          </span>
                          <span className={`min-w-0 flex-1 text-[13px] font-medium ${li.completed ? "line-through text-muted-foreground" : ""}`}>
                            {li.service}
                            {li.startTime && !li.completed && (
                              <span className="ml-[6px] text-[10.5px] font-bold text-[var(--gold-dark)]">{formatClock(li.startTime)}</span>
                            )}
                          </span>
                          {!li.completed && (
                            <span className="shrink-0 text-[10.5px] font-bold bg-[var(--gold-light)]/40 rounded-full px-[7px] py-[2px]">Tap when done</span>
                          )}
                        </button>
                      ))}
                      {othersItems.length > 0 && (
                        <div className="text-[11px] text-muted-foreground">
                          {othersItems.length} more task{othersItems.length > 1 ? "s" : ""} on this job belong{othersItems.length > 1 ? "" : "s"} to other crews.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Step 4 — after photos */}
              <div className="flex gap-[10px]">
                {stepCircle(stateOf(3), 4)}
                <div className="min-w-0 flex-1">
                  <div className={`text-[13.5px] font-semibold ${stateOf(3) === "todo" ? "text-muted-foreground" : ""}`}>
                    After photos{afterCount > 0 ? ` · ${afterCount} saved` : ""}
                    <span className="ml-[6px] text-[10.5px] font-bold text-red-600">Required to check out</span>
                  </div>
                  {stateOf(3) === "current" && (
                    <button onClick={() => pickPhotos(job.id, "after")} disabled={busy !== null} className={btnCls} data-testid={`myjob-after-${job.id}`}>
                      {busy === `${job.id}:after` ? (
                        <><Loader2 className="w-[18px] h-[18px] animate-spin" /> Uploading…</>
                      ) : (
                        <><Camera className="w-[18px] h-[18px]" /> Take after photos</>
                      )}
                    </button>
                  )}
                  {stateOf(3) === "done" && (
                    <button onClick={() => pickPhotos(job.id, "after")} disabled={busy !== null} className="text-[12px] font-semibold text-[var(--gold-dark)] mt-[2px]">
                      + Add more after photos
                    </button>
                  )}
                </div>
              </div>

              {/* Step 5 — check out */}
              <div className="flex gap-[10px]">
                {stepCircle(stateOf(4), 5)}
                <div className="min-w-0 flex-1">
                  <div className={`text-[13.5px] font-semibold ${stateOf(4) === "todo" ? "text-muted-foreground" : ""}`}>
                    Check out
                  </div>
                  {stateOf(4) === "current" && (
                    <>
                      <textarea
                        value={notes[job.id] ?? ""}
                        onChange={(e) => setNotes((m) => ({ ...m, [job.id]: e.target.value }))}
                        rows={2}
                        placeholder="What did you get done? (shown to the office & property manager)"
                        className="w-full mt-[6px] rounded-[12px] border border-border bg-background px-[13px] py-[11px] text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 resize-none"
                      />
                      <button onClick={() => doCheck(job.id, "checkout")} disabled={busy !== null} className="w-full mt-[8px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-white bg-[var(--ink)] disabled:opacity-60 transition-transform active:scale-[0.98]" data-testid={`myjob-checkout-${job.id}`}>
                        {busy === `${job.id}:checkout` ? (
                          <><Loader2 className="w-[18px] h-[18px] animate-spin" /> Getting location…</>
                        ) : (
                          <><LogOut className="w-[18px] h-[18px]" /> Check out — job done</>
                        )}
                      </button>
                      <div className="text-[11px] text-muted-foreground mt-[4px]">
                        Already checked out earlier? Skip ahead and send your invoice below.
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Step 6 — invoice */}
              <div className="flex gap-[10px]">
                {stepCircle(allDone ? "current" : "todo", 6)}
                <div className="min-w-0 flex-1">
                  <div className={`text-[13.5px] font-semibold ${allDone ? "" : "text-muted-foreground"}`}>
                    Send your invoice
                  </div>
                  <button
                    onClick={() => onInvoice(job.id)}
                    disabled={busy !== null}
                    className={allDone ? btnCls : "text-[12px] font-semibold text-[var(--gold-dark)] mt-[2px]"}
                    data-testid={`myjob-invoice-${job.id}`}
                  >
                    {allDone ? (
                      <><Receipt className="w-[18px] h-[18px]" /> Send invoice for this job</>
                    ) : (
                      "Invoice this job now →"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CheckinTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const checkin = useCreatePortalCheckin();
  const { data: jobs } = useListPortalJobs(token);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checkin" | "checkout" | null>(null);
  const { tracking, startTrail, stopTrail } = useGpsTrail(token);

  const doPunch = async (kind: "checkin" | "checkout") => {
    setStatus(null);
    setBusy(kind);
    const pos = await getPosition();
    if (!pos) {
      setBusy(null);
      setStatus("We couldn't get your location. Turn on location access and try again.");
      return;
    }
    checkin.mutate(
      {
        token,
        data: {
          jobId: selectedJobId || null,
          kind,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          note: kind === "checkout" ? note.trim() || null : null,
        },
      },
      {
        onSuccess: () => {
          setBusy(null);
          if (kind === "checkout") {
            setNote("");
            stopTrail();
          } else {
            startTrail(selectedJobId || null);
          }
          setStatus(
            kind === "checkout"
              ? "Checked out! Your time and work note were recorded."
              : "Checked in! Your location will be shared every 30 seconds until you check out — keep this page open.",
          );
          queryClient.invalidateQueries({ queryKey: getGetPortalQueryKey(token) });
        },
        onError: (err) => {
          setBusy(null);
          const data = (err as { data?: { code?: string; error?: string } | null })?.data;
          if (data?.code === "after_photos_required") {
            setStatus("Before you can check out, add your AFTER photos in the Photos tab.");
          } else {
            setStatus(data?.error ?? "Couldn't save. Check your connection and try again.");
          }
        },
      },
    );
  };

  return (
    <div className="animate-in fade-in duration-200 flex flex-col gap-[12px]">
      <div className={card}>
        <div className="text-[12px] font-display font-semibold tracking-[0.14em] uppercase text-muted-foreground mb-[8px]">
          Which job are you working on?
        </div>
        <div className="flex flex-wrap gap-[7px]">
          {(jobs ?? []).length === 0 && (
            <div className="text-[12.5px] text-muted-foreground">
              No jobs assigned right now — you can still check in below.
            </div>
          )}
          {(jobs ?? []).map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => setSelectedJobId((v) => (v === j.id ? "" : j.id))}
              className={`px-[12px] py-[8px] rounded-full text-[12.5px] font-semibold border transition-colors ${
                selectedJobId === j.id
                  ? "bg-[var(--gold-light)] border-[var(--gold)] text-[var(--ink)]"
                  : "bg-card border-border text-muted-foreground"
              }`}
            >
              {j.label}
            </button>
          ))}
        </div>
      </div>

      <div className={card}>
        <div className="grid place-items-center py-[6px]">
          <div className="w-[60px] h-[60px] rounded-full bg-[rgba(143,106,31,0.12)] grid place-items-center mb-[10px]">
            <MapPin className="w-[26px] h-[26px] text-[var(--gold)]" />
          </div>
          <div className="font-display font-bold text-[17px]">GPS job tracker</div>
          {tracking && (
            <div
              data-testid="text-gps-trail-live"
              className="mt-[6px] flex items-center gap-[6px] text-[12px] font-semibold text-[#3f7d20]"
            >
              <span className="w-[8px] h-[8px] rounded-full bg-[#4ade80] animate-pulse" />
              Live trail on — location shared every 30s until you check out
            </div>
          )}
          <p className="text-[12.5px] text-muted-foreground text-center mt-[4px] mb-[14px] max-w-[320px]">
            Check in when you arrive and check out when you finish. Your time
            and location are recorded as proof you were on site.
          </p>
          <button
            onClick={() => doPunch("checkin")}
            disabled={busy !== null}
            className="w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] disabled:opacity-60 transition-transform active:scale-[0.98]"
          >
            {busy === "checkin" ? (
              <>
                <Loader2 className="w-[18px] h-[18px] animate-spin" /> Getting location…
              </>
            ) : (
              <>
                <LogIn className="w-[18px] h-[18px]" /> Check in — I've arrived
              </>
            )}
          </button>
          <div className="w-full mt-[14px] pt-[14px] border-t border-border">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="What did you get done? (shown to the office & property manager)"
              className="w-full rounded-[12px] border border-border bg-background px-[13px] py-[11px] text-[14px] mb-[10px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 resize-none"
            />
            <button
              onClick={() => doPunch("checkout")}
              disabled={busy !== null}
              className="w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-white bg-[var(--ink)] disabled:opacity-60 transition-transform active:scale-[0.98]"
            >
              {busy === "checkout" ? (
                <>
                  <Loader2 className="w-[18px] h-[18px] animate-spin" /> Getting location…
                </>
              ) : (
                <>
                  <LogOut className="w-[18px] h-[18px]" /> Check out — job done
                </>
              )}
            </button>
          </div>
          {status && (
            <div className="text-[12.5px] text-center mt-[12px] text-muted-foreground">
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PhotosTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const { data: photos } = useListPortalPhotos(token, {
    query: { queryKey: getListPortalPhotosQueryKey(token) },
  });
  const { data: jobs } = useListPortalJobs(token);
  const sendPhoto = useUploadPortalPhoto();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [phase, setPhase] = useState<"before" | "after" | "">("");
  const { uploadFile } = useUpload({
    onError: () =>
      setUploadError("Upload failed. Check your connection and try again."),
  });

  const onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setSending(true);
    setUploadError(null);
    const pos = await getPosition();
    try {
      for (const file of files) {
        const res = await uploadFile(file);
        if (!res) return;
        await sendPhoto.mutateAsync({
          token,
          data: {
            storagePath: res.objectPath,
            takenOn: localToday(),
            jobId: selectedJobId || null,
            phase: phase || null,
            lat: pos?.coords.latitude ?? null,
            lng: pos?.coords.longitude ?? null,
            accuracy: pos?.coords.accuracy ?? null,
            capturedAt: new Date().toISOString(),
          },
        });
      }
      queryClient.invalidateQueries({
        queryKey: getListPortalPhotosQueryKey(token),
      });
    } catch {
      setUploadError("Your photo uploaded but we couldn't save it. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; photos: NonNullable<typeof photos> }>();
    for (const p of photos ?? []) {
      const key = p.jobId ?? "none";
      const g = map.get(key) ?? {
        label: p.jobLabel ?? (p.jobId ? "Job" : "General photos"),
        photos: [],
      };
      g.photos.push(p);
      map.set(key, g);
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "none") return 1;
      if (b[0] === "none") return -1;
      return 0;
    });
  }, [photos]);

  return (
    <div className="animate-in fade-in duration-200">
      <div className={`${card} mb-[12px]`}>
        <div className="text-[12px] font-display font-semibold tracking-[0.14em] uppercase text-muted-foreground mb-[8px]">
          Which job are these photos for?
        </div>
        <div className="flex flex-wrap gap-[7px]">
          <button
            type="button"
            onClick={() => setSelectedJobId("")}
            className={`px-[12px] py-[8px] rounded-full text-[12.5px] font-semibold border transition-colors ${
              selectedJobId === ""
                ? "bg-[var(--gold-light)] border-[var(--gold)] text-[var(--ink)]"
                : "bg-card border-border text-muted-foreground"
            }`}
          >
            General
          </button>
          {(jobs ?? []).map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => setSelectedJobId((v) => (v === j.id ? "" : j.id))}
              className={`px-[12px] py-[8px] rounded-full text-[12.5px] font-semibold border transition-colors ${
                selectedJobId === j.id
                  ? "bg-[var(--gold-light)] border-[var(--gold)] text-[var(--ink)]"
                  : "bg-card border-border text-muted-foreground"
              }`}
            >
              {j.label}
            </button>
          ))}
        </div>
        <div className="text-[12px] font-display font-semibold tracking-[0.14em] uppercase text-muted-foreground mt-[12px] mb-[8px]">
          Is this before or after the work?
        </div>
        <div className="flex gap-[7px]">
          {([
            ["before", "Before"],
            ["after", "After"],
            ["", "Other"],
          ] as const).map(([val, lbl]) => (
            <button
              key={lbl}
              type="button"
              onClick={() => setPhase(val)}
              className={`flex-1 px-[12px] py-[9px] rounded-[11px] text-[13px] font-display font-bold border transition-colors ${
                phase === val
                  ? "bg-[var(--ink)] border-[var(--ink)] text-white"
                  : "bg-card border-border text-muted-foreground"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
      <label className="w-full mb-[14px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] cursor-pointer transition-transform active:scale-[0.98]">
        {sending ? (
          <Loader2 className="w-[18px] h-[18px] animate-spin" />
        ) : (
          <Camera className="w-[18px] h-[18px]" />
        )}
        {sending ? "Sending…" : "Take / send photos"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={onFilesPicked}
          disabled={sending}
        />
      </label>
      {uploadError && (
        <div className="text-[12.5px] text-[var(--red,#be3c3c)] bg-[rgba(190,60,60,0.08)] rounded-[11px] px-[12px] py-[9px] mb-[14px]">
          {uploadError}
        </div>
      )}
      {!photos || photos.length === 0 ? (
        <div className={`${card} text-center text-[13px] text-muted-foreground py-[26px]`}>
          No photos yet. Snap your work as you go — the office sees them instantly.
        </div>
      ) : (
        <div className="flex flex-col gap-[16px]">
          {groups.map(([key, g]) => (
            <div key={key}>
              <div className="text-[13px] font-semibold mb-[7px]">
                {g.label}
                <span className="text-muted-foreground font-normal">
                  {" "}
                  · {g.photos.length} photo{g.photos.length === 1 ? "" : "s"}
                </span>
              </div>
              {(() => {
                const befores = g.photos.filter((p) => p.phase === "before");
                const afters = g.photos.filter((p) => p.phase === "after");
                const rest = g.photos.filter(
                  (p) => p.phase !== "before" && p.phase !== "after",
                );
                const pairs = Math.max(befores.length, afters.length);
                const cell = (
                  p: (typeof g.photos)[number] | undefined,
                  label: string,
                ) =>
                  p ? (
                    <a
                      href={`${base}/api/storage${p.storagePath}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block relative aspect-square rounded-[10px] overflow-hidden bg-[var(--paper)] border border-border"
                    >
                      <img
                        src={`${base}/api/storage${p.storagePath}`}
                        alt={label}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute bottom-[5px] left-[5px] bg-black/65 text-white text-[9.5px] font-bold tracking-[0.08em] uppercase px-[6px] py-[2px] rounded-full">
                        {label}
                      </span>
                    </a>
                  ) : (
                    <div className="aspect-square rounded-[10px] border border-dashed border-border grid place-items-center text-[10.5px] text-muted-foreground">
                      No {label.toLowerCase()} yet
                    </div>
                  );
                return (
                  <>
                    {pairs > 0 && (
                      <div className="flex flex-col gap-[6px] mb-[6px]">
                        {Array.from({ length: pairs }).map((_, i) => (
                          <div key={i} className="grid grid-cols-2 gap-[6px]">
                            {cell(befores[i], "Before")}
                            {cell(afters[i], "After")}
                          </div>
                        ))}
                      </div>
                    )}
                    {rest.length > 0 && (
                      <div className="grid grid-cols-3 gap-[6px]">
                        {rest.map((p) => (
                          <a
                            key={p.id}
                            href={`${base}/api/storage${p.storagePath}`}
                            target="_blank"
                            rel="noreferrer"
                            className="block aspect-square rounded-[10px] overflow-hidden bg-[var(--paper)] border border-border"
                          >
                            <img
                              src={`${base}/api/storage${p.storagePath}`}
                              alt={p.note || "Crew photo"}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentsTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const { data: documents } = useListPortalDocuments(token);
  const upload = useUploadPortalDocument();
  const { uploadFile, isUploading } = useUpload({
    onSuccess: async (res) => {
      await upload.mutateAsync({
        token,
        data: {
          name: res.metadata.name,
          storagePath: res.objectPath,
          contentType: res.metadata.contentType,
          size: res.metadata.size,
        },
      });
      queryClient.invalidateQueries({
        queryKey: getListPortalDocumentsQueryKey(token),
      });
    },
  });

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="animate-in fade-in duration-200">
      <label className="w-full mb-[14px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] cursor-pointer transition-transform active:scale-[0.98]">
        <FileUp className="w-[18px] h-[18px]" />
        {isUploading ? "Uploading…" : "Upload a document"}
        <input
          type="file"
          className="hidden"
          onChange={onFilePicked}
          disabled={isUploading}
        />
      </label>
      {!documents || documents.length === 0 ? (
        <div className={`${card} text-center text-[13px] text-muted-foreground py-[26px]`}>
          No documents yet.
        </div>
      ) : (
        <div className={card}>
          {documents.map((d, idx) => {
            const url = `${base}/api/storage${d.storagePath}`;
            return (
              <div
                key={d.id}
                className={`flex items-center gap-[10px] py-[11px] ${idx !== 0 ? "border-t border-border" : ""}`}
              >
                <FileText className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 min-w-0"
                >
                  <div className="text-[13.5px] font-semibold truncate">{d.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {d.direction === "to_crew" ? "From ArchAngel" : "You uploaded"} ·{" "}
                    {formatWhen(d.createdAt)}
                  </div>
                </a>
                <a
                  href={url}
                  download={d.name}
                  className="shrink-0 w-[34px] h-[34px] grid place-items-center rounded-full bg-[var(--paper)] border border-border text-muted-foreground transition-transform active:scale-[0.94]"
                  aria-label={`Download ${d.name}`}
                >
                  <Download className="w-[16px] h-[16px]" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function earningsStatePill(state: string): { label: string; cls: string } {
  switch (state) {
    case "held":
      return { label: "ON HOLD", cls: "bg-amber-100 text-amber-800 border-amber-300" };
    case "payable":
      return { label: "PAY TODAY", cls: "bg-green-100 text-green-800 border-green-300" };
    case "paid":
      return { label: "PAID", cls: "bg-black/5 text-muted-foreground border-border" };
    case "cancelled":
      return { label: "RETURNED", cls: "bg-black/5 text-muted-foreground border-border" };
    default:
      return { label: state.toUpperCase(), cls: "bg-black/5 text-muted-foreground border-border" };
  }
}

function EarningsSection({ token }: { token: string }) {
  const { data: earnings } = useGetPortalEarnings(token, {
    query: {
      enabled: !!token,
      queryKey: getGetPortalEarningsQueryKey(token),
    },
  });

  const holds = earnings?.holds ?? [];
  // Keep the UI clean when the crew has never had any holds.
  if (holds.length === 0) return null;

  return (
    <div className={`${card} mb-[12px]`} data-testid="section-earnings">
      <div className="font-display font-bold text-[16px] mb-[12px]">Your earnings</div>
      <div className="grid grid-cols-3 gap-[8px] mb-[14px]">
        <div className="rounded-[12px] bg-amber-50 border border-amber-200 px-[10px] py-[10px] text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
            On hold
          </div>
          <div className="font-display font-bold text-[19px] text-amber-800 mt-[2px]" data-testid="text-earnings-held">
            {moneyShort(earnings?.heldTotal ?? 0)}
          </div>
        </div>
        <div className="rounded-[12px] bg-green-50 border border-green-200 px-[10px] py-[10px] text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-green-700">
            Payable now
          </div>
          <div className="font-display font-bold text-[19px] text-green-800 mt-[2px]" data-testid="text-earnings-payable">
            {moneyShort(earnings?.payableTotal ?? 0)}
          </div>
        </div>
        <div className="rounded-[12px] bg-background border border-border px-[10px] py-[10px] text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Paid
          </div>
          <div className="font-display font-bold text-[19px] text-foreground mt-[2px]" data-testid="text-earnings-paid">
            {moneyShort(earnings?.paidTotal ?? 0)}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-[8px]">
        {holds.map((h: PortalEarningsHold) => {
          const pill = earningsStatePill(h.state);
          return (
            <div
              key={h.id}
              className="rounded-[12px] border border-border bg-background px-[12px] py-[10px]"
              data-testid={`earnings-hold-${h.id}`}
            >
              <div className="flex items-start justify-between gap-[8px]">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold leading-tight">
                    {h.jobLabel || "Emergency job"}
                  </div>
                  <div className="text-[13px] font-display font-bold text-foreground mt-[2px]">
                    {moneyShort(h.amount)}
                    {h.bonusAmount > 0 && (
                      <span className="text-[12px] font-semibold text-green-700">
                        {" "}
                        (incl. {moneyShort(h.bonusAmount)} bonus)
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-[8px] py-[3px] rounded-full border shrink-0 ${pill.cls}`}
                >
                  {pill.label}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-[4px]">
                {h.state === "held" ? (
                  <>Held {formatWhen(h.heldAt)}</>
                ) : h.releasedAt ? (
                  <>
                    Held {formatWhen(h.heldAt)} · {h.state === "cancelled" ? "Returned" : "Released"}{" "}
                    {formatWhen(h.releasedAt)}
                  </>
                ) : (
                  <>Held {formatWhen(h.heldAt)}</>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PaymentTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const { data: bank, isLoading } = useGetPortalBank(token, {
    query: {
      enabled: !!token,
      queryKey: getGetPortalBankQueryKey(token),
    },
  });
  const [connectOpen, setConnectOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="py-[40px] grid place-items-center">
        <Loader2 className="w-[22px] h-[22px] animate-spin text-primary" />
      </div>
    );
  }

  if (!bank || !bank.connected) {
    return (
      <div className="animate-in fade-in duration-200">
        <EarningsSection token={token} />
        <div className={`${card} text-center`}>
          <div className="w-[56px] h-[56px] rounded-full bg-[rgba(143,106,31,0.1)] grid place-items-center mx-auto mb-[12px]">
            <Wallet className="w-[28px] h-[28px] text-[var(--gold)]" />
          </div>
          <div className="font-display font-bold text-[18px] mb-[6px]">
            Connect your bank account
          </div>
          <p className="text-[13px] text-muted-foreground mb-[16px] leading-relaxed">
            Get paid instantly when jobs are completed. Connect your bank to receive payouts
            directly.
          </p>
          <button
            onClick={() => setConnectOpen(true)}
            className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] transition-transform active:scale-[0.98]"
            data-testid="button-open-bank-connect"
          >
            <Wallet className="w-[18px] h-[18px]" /> Connect bank account
          </button>
        </div>
        <BankConnectSheet
          token={token}
          open={connectOpen}
          onOpenChange={setConnectOpen}
        />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-200">
      <EarningsSection token={token} />
      <div className={card}>
        <div className="flex items-start gap-[12px] mb-[12px]">
          <div className="w-[48px] h-[48px] rounded-full bg-[rgba(60,122,78,0.12)] grid place-items-center shrink-0">
            <Shield className="w-[24px] h-[24px] text-[var(--green)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-[6px] mb-[4px]">
              <div className="font-display font-bold text-[16px]">Bank connected</div>
              <CheckCircle2 className="w-[16px] h-[16px] text-[var(--green)]" />
            </div>
            <div className="text-[12px] text-muted-foreground">
              You'll be paid instantly when jobs are completed.
            </div>
          </div>
        </div>
        <div className="bg-background rounded-[12px] p-[14px] space-y-[8px] text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Account type</span>
            <span className="font-semibold capitalize">
              {bank.accountKind === "personal" ? "Personal" : "Business"}
              {bank.accountType && ` · ${bank.accountType}`}
            </span>
          </div>
          {bank.holderName && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Account holder</span>
              <span className="font-semibold">{bank.holderName}</span>
            </div>
          )}
          {bank.businessName && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Business name</span>
              <span className="font-semibold">{bank.businessName}</span>
            </div>
          )}
          {bank.bankName && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Bank</span>
              <span className="font-semibold">{bank.bankName}</span>
            </div>
          )}
          {bank.accountLast4 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Account</span>
              <span className="font-mono font-semibold">•••• {bank.accountLast4}</span>
            </div>
          )}
          {bank.status === "verified" && bank.verifiedAt && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="flex items-center gap-[4px] font-semibold text-[var(--green)]">
                <Shield className="w-[13px] h-[13px]" /> Verified
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BankConnectSheet({
  token,
  open,
  onOpenChange,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [accountKind, setAccountKind] = useState<"personal" | "business">("personal");
  const [holderName, setHolderName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitBank = useSubmitPortalBank();

  const onSubmit = () => {
    setError(null);
    if (routingNumber.replace(/\D/g, "").length !== 9) {
      setError("Routing number must be 9 digits.");
      return;
    }
    if (!accountNumber) {
      setError("Account number is required.");
      return;
    }

    submitBank.mutate(
      {
        token,
        data: {
          accountKind,
          holderName,
          businessName: accountKind === "business" ? businessName : undefined,
          bankName: bankName || undefined,
          accountType,
          routingNumber: routingNumber.replace(/\D/g, ""),
          accountNumber,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetPortalBankQueryKey(token),
          });
          queryClient.invalidateQueries({
            queryKey: getGetPortalQueryKey(token),
          });
          setStep(4);
        },
        onError: (e) => {
          setError(e.message || "Couldn't connect your bank. Try again.");
        },
      }
    );
  };

  const onClose = () => {
    if (step === 4) {
      onOpenChange(false);
      setStep(1);
      setAccountKind("personal");
      setHolderName("");
      setBusinessName("");
      setBankName("");
      setRoutingNumber("");
      setAccountNumber("");
      setError(null);
    } else {
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-xl"
      >
        <div className="w-[40px] h-[5px] rounded-full bg-[rgba(23,24,28,0.16)] mx-auto mt-[12px] mb-[4px] shrink-0" />
        <div className="p-[12px_24px_32px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[22px] tracking-[-0.01em] m-[6px_0_2px]">
              Connect your bank
            </SheetTitle>
            <div className="text-[14px] text-muted-foreground">
              Step {step} of 4
            </div>
          </SheetHeader>

          {step === 1 && (
            <div>
              <div className="text-[14px] font-semibold mb-[12px]">
                What type of account?
              </div>
              <div className="grid grid-cols-2 gap-[10px] mb-[20px]">
                {[
                  { key: "personal" as const, label: "Personal", icon: Home },
                  { key: "business" as const, label: "Business", icon: Briefcase },
                ].map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setAccountKind(opt.key)}
                      className={`flex flex-col items-center gap-[10px] rounded-[14px] p-[20px] border-2 transition-all ${
                        accountKind === opt.key
                          ? "border-[var(--gold)] bg-[rgba(143,106,31,0.06)]"
                          : "border-border bg-card"
                      }`}
                      data-testid={`button-account-${opt.key}`}
                    >
                      <div
                        className={`w-[44px] h-[44px] rounded-full grid place-items-center ${
                          accountKind === opt.key
                            ? "bg-[var(--gold-light)] text-[var(--ink)]"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="w-[22px] h-[22px]" />
                      </div>
                      <span className="font-display font-bold text-[15px]">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setStep(2)}
                className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] transition-transform active:scale-[0.98]"
                data-testid="button-next-step-2"
              >
                Continue
              </button>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="space-y-[14px] mb-[20px]">
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                    Account holder name
                  </label>
                  <input
                    type="text"
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px]"
                    data-testid="input-holder-name"
                  />
                </div>
                {accountKind === "business" && (
                  <div>
                    <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                      Business name
                    </label>
                    <input
                      type="text"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Your business name"
                      className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px]"
                      data-testid="input-business-name"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                    Bank name (optional)
                  </label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. Chase, Wells Fargo"
                    className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px]"
                    data-testid="input-bank-name"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                    Account type
                  </label>
                  <div className="flex gap-[8px]">
                    {(["checking", "savings"] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setAccountType(type)}
                        className={`flex-1 rounded-[10px] py-[10px] text-[14px] font-display font-bold border transition-all ${
                          accountType === type
                            ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                            : "bg-card text-muted-foreground border-border"
                        }`}
                        data-testid={`button-account-type-${type}`}
                      >
                        {type === "checking" ? "Checking" : "Savings"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-[8px]">
                <button
                  onClick={() => setStep(1)}
                  className="rounded-[13px] px-[16px] py-[13px] text-[15px] font-display font-bold bg-card border border-border"
                  data-testid="button-back-step-1"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!holderName || (accountKind === "business" && !businessName)}
                  className="flex-1 flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                  data-testid="button-next-step-3"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="space-y-[14px] mb-[20px]">
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                    Routing number
                  </label>
                  <input
                    type="text"
                    value={routingNumber}
                    onChange={(e) => setRoutingNumber(e.target.value)}
                    placeholder="9 digits"
                    className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px] font-mono"
                    data-testid="input-routing-number"
                  />
                  <div className="text-[11px] text-muted-foreground mt-[4px]">
                    Found on the bottom of your check.
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                    Account number
                  </label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="Account number"
                    className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px] font-mono"
                    data-testid="input-account-number"
                  />
                </div>
              </div>

              {error && (
                <div className="mb-[14px] flex items-start gap-[8px] bg-destructive/10 rounded-[10px] p-[12px] text-[13px] text-destructive">
                  <AlertCircle className="w-[16px] h-[16px] shrink-0 mt-[1px]" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex gap-[8px]">
                <button
                  onClick={() => setStep(2)}
                  className="rounded-[13px] px-[16px] py-[13px] text-[15px] font-display font-bold bg-card border border-border"
                  data-testid="button-back-step-2"
                >
                  Back
                </button>
                <button
                  onClick={onSubmit}
                  disabled={submitBank.isPending}
                  className="flex-1 flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                  data-testid="button-submit-bank"
                >
                  {submitBank.isPending ? (
                    <Loader2 className="w-[18px] h-[18px] animate-spin" />
                  ) : (
                    <Shield className="w-[18px] h-[18px]" />
                  )}
                  Connect account
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="text-center py-[20px]">
              <div className="w-[64px] h-[64px] rounded-full bg-[rgba(60,122,78,0.12)] grid place-items-center mx-auto mb-[16px]">
                <CheckCircle2 className="w-[36px] h-[36px] text-[var(--green)]" />
              </div>
              <div className="font-display font-bold text-[20px] mb-[8px]">
                Connected & verified
              </div>
              <p className="text-[14px] text-muted-foreground mb-[20px]">
                Your bank account is connected. You can now be paid instantly when jobs are
                completed.
              </p>
              <button
                onClick={onClose}
                className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] transition-transform active:scale-[0.98]"
                data-testid="button-close-bank-connect"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const TAX_CLASSES = [
  { key: "individual", label: "Individual / sole proprietor" },
  { key: "c_corp", label: "C Corporation" },
  { key: "s_corp", label: "S Corporation" },
  { key: "partnership", label: "Partnership" },
  { key: "trust_estate", label: "Trust / estate" },
  { key: "llc", label: "LLC" },
  { key: "other", label: "Other" },
];

function W9Tab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const { data: w9, isLoading } = useGetPortalW9(token);
  const submit = useSubmitPortalW9();
  const [form, setForm] = useState<W9Data>({});
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (w9?.data) setForm(w9.data);
  }, [w9?.data]);

  const set = (k: keyof W9Data, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const tinType = form.tinType === "ein" ? "ein" : "ssn";

  const handleSubmit = () => {
    setErr(null);
    if (!form.name || String(form.name).trim() === "") {
      setErr("Name is required (as shown on your income tax return).");
      return;
    }
    if (!form.taxClassification) {
      setErr("Select a federal tax classification.");
      return;
    }
    if (tinType === "ssn" ? !form.ssn : !form.ein) {
      setErr(`Enter your ${tinType === "ssn" ? "SSN" : "EIN"}.`);
      return;
    }
    if (!form.signature || !form.certified) {
      setErr("Type your signature and check the certification box.");
      return;
    }
    submit.mutate(
      {
        token,
        data: {
          ...form,
          signedDate: form.signedDate || new Date().toISOString().slice(0, 10),
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          queryClient.invalidateQueries({
            queryKey: getGetPortalW9QueryKey(token),
          });
          queryClient.invalidateQueries({
            queryKey: getGetPortalQueryKey(token),
          });
          setTimeout(() => setSaved(false), 2200);
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="grid place-items-center py-[40px]">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--gold)]" />
      </div>
    );
  }

  const field =
    "w-full rounded-[11px] border border-border bg-background px-[12px] py-[10px] text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40";
  const lbl = "block text-[12px] font-semibold text-muted-foreground mb-[5px]";

  return (
    <div className="animate-in fade-in duration-200 flex flex-col gap-[12px]">
      <div className={card}>
        <div className="font-display font-bold text-[17px]">
          Form W-9
        </div>
        <p className="text-[12px] text-muted-foreground mt-[2px]">
          Request for Taxpayer Identification Number and Certification. Your info
          is stored securely and only visible to ArchAngel.
        </p>
        {w9?.submitted && (
          <>
          <div className="flex items-center gap-[6px] text-[12.5px] text-[var(--green,#3c7a4e)] mt-[10px]">
            <Check className="w-[15px] h-[15px]" /> Last submitted{" "}
            {formatWhen(w9.submittedAt)}
          </div>
          <button
            onClick={() => downloadW9Pdf({ ...w9.data, ...form })}
            className="w-full mt-[10px] flex items-center justify-center gap-[7px] rounded-[11px] py-[10px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
          >
            <Download className="w-[15px] h-[15px]" /> Download W-9 (PDF)
          </button>
          </>
        )}
      </div>

      <div className={`${card} flex flex-col gap-[12px]`}>
        <div>
          <label className={lbl}>1. Name (as shown on your income tax return)</label>
          <input
            className={field}
            value={(form.name as string) ?? ""}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div>
          <label className={lbl}>2. Business name / disregarded entity (if different)</label>
          <input
            className={field}
            value={(form.businessName as string) ?? ""}
            onChange={(e) => set("businessName", e.target.value)}
          />
        </div>
        <div>
          <label className={lbl}>3. Federal tax classification</label>
          <div className="grid grid-cols-1 gap-[6px]">
            {TAX_CLASSES.map((c) => (
              <button
                key={c.key}
                onClick={() => set("taxClassification", c.key)}
                className={`text-left rounded-[10px] px-[12px] py-[9px] text-[13px] border transition-colors ${
                  form.taxClassification === c.key
                    ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                    : "bg-background border-border"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {form.taxClassification === "llc" && (
            <input
              className={`${field} mt-[8px]`}
              placeholder="LLC tax classification (C, S, or P)"
              value={(form.llcClassification as string) ?? ""}
              onChange={(e) => set("llcClassification", e.target.value)}
            />
          )}
          {form.taxClassification === "other" && (
            <input
              className={`${field} mt-[8px]`}
              placeholder="Describe classification"
              value={(form.otherClassification as string) ?? ""}
              onChange={(e) => set("otherClassification", e.target.value)}
            />
          )}
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          <div>
            <label className={lbl}>4a. Exempt payee code</label>
            <input
              className={field}
              value={(form.exemptPayeeCode as string) ?? ""}
              onChange={(e) => set("exemptPayeeCode", e.target.value)}
            />
          </div>
          <div>
            <label className={lbl}>4b. FATCA code</label>
            <input
              className={field}
              value={(form.fatcaCode as string) ?? ""}
              onChange={(e) => set("fatcaCode", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className={`${card} flex flex-col gap-[12px]`}>
        <div>
          <label className={lbl}>5. Address (number, street, apt/suite)</label>
          <input
            className={field}
            value={(form.address as string) ?? ""}
            onChange={(e) => set("address", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-3 gap-[10px]">
          <div className="col-span-1">
            <label className={lbl}>City</label>
            <input
              className={field}
              value={(form.city as string) ?? ""}
              onChange={(e) => set("city", e.target.value)}
            />
          </div>
          <div>
            <label className={lbl}>State</label>
            <input
              className={field}
              value={(form.state as string) ?? ""}
              onChange={(e) => set("state", e.target.value)}
            />
          </div>
          <div>
            <label className={lbl}>ZIP</label>
            <input
              className={field}
              value={(form.zip as string) ?? ""}
              onChange={(e) => set("zip", e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={lbl}>7. Account numbers (optional)</label>
          <input
            className={field}
            value={(form.accountNumbers as string) ?? ""}
            onChange={(e) => set("accountNumbers", e.target.value)}
          />
        </div>
      </div>

      <div className={`${card} flex flex-col gap-[12px]`}>
        <div className="font-display font-bold text-[14px]">
          Part I · Taxpayer Identification Number
        </div>
        <div className="flex gap-[8px]">
          <button
            onClick={() => set("tinType", "ssn")}
            className={`flex-1 rounded-[10px] py-[9px] text-[13px] font-semibold border transition-colors ${
              tinType === "ssn"
                ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                : "bg-background border-border"
            }`}
          >
            SSN
          </button>
          <button
            onClick={() => set("tinType", "ein")}
            className={`flex-1 rounded-[10px] py-[9px] text-[13px] font-semibold border transition-colors ${
              tinType === "ein"
                ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                : "bg-background border-border"
            }`}
          >
            EIN
          </button>
        </div>
        {tinType === "ssn" ? (
          <div>
            <label className={lbl}>Social Security Number</label>
            <input
              className={field}
              inputMode="numeric"
              placeholder="XXX-XX-XXXX"
              value={(form.ssn as string) ?? ""}
              onChange={(e) => set("ssn", e.target.value)}
            />
          </div>
        ) : (
          <div>
            <label className={lbl}>Employer Identification Number</label>
            <input
              className={field}
              inputMode="numeric"
              placeholder="XX-XXXXXXX"
              value={(form.ein as string) ?? ""}
              onChange={(e) => set("ein", e.target.value)}
            />
          </div>
        )}
      </div>

      <div className={`${card} flex flex-col gap-[12px]`}>
        <div className="font-display font-bold text-[14px]">Part II · Certification</div>
        <p className="text-[11.5px] text-muted-foreground leading-[1.5]">
          Under penalties of perjury, I certify that the number shown is my
          correct taxpayer identification number, that I am not subject to backup
          withholding, that I am a U.S. person, and that any FATCA code entered is
          correct.
        </p>
        <label className="flex items-start gap-[9px] text-[13px]">
          <input
            type="checkbox"
            checked={!!form.certified}
            onChange={(e) => set("certified", e.target.checked)}
            className="mt-[2px] w-[18px] h-[18px] accent-[var(--gold)]"
          />
          <span>I certify the statements above are true and correct.</span>
        </label>
        <div className="grid grid-cols-2 gap-[10px]">
          <div>
            <label className={lbl}>Signature (type name)</label>
            <input
              className={field}
              value={(form.signature as string) ?? ""}
              onChange={(e) => set("signature", e.target.value)}
            />
          </div>
          <div>
            <label className={lbl}>Date</label>
            <input
              type="date"
              className={field}
              value={(form.signedDate as string) ?? ""}
              onChange={(e) => set("signedDate", e.target.value)}
            />
          </div>
        </div>
      </div>

      {err && (
        <div className="text-[12.5px] text-destructive px-[4px]">{err}</div>
      )}
      <button
        onClick={handleSubmit}
        disabled={submit.isPending}
        className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] disabled:opacity-60 transition-transform active:scale-[0.98]"
      >
        {saved ? (
          <>
            <Check className="w-[17px] h-[17px]" /> Submitted
          </>
        ) : submit.isPending ? (
          <>
            <Loader2 className="w-[17px] h-[17px] animate-spin" /> Submitting…
          </>
        ) : (
          "Submit W-9"
        )}
      </button>
    </div>
  );
}

const invField =
  "w-full rounded-[11px] border border-border bg-background px-[12px] py-[10px] text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40";
const invLbl = "block text-[12px] font-semibold text-muted-foreground mb-[5px]";

const TERMS_OPTIONS = ["Due Upon Receipt", "Net 7", "Net 15", "Net 30"];

function addDaysLocal(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function termsToDueDate(invoiceDate: string, terms: string): string {
  if (!invoiceDate) return "";
  const m = terms.match(/Net (\d+)/);
  if (m) return addDaysLocal(invoiceDate, Number(m[1]));
  return invoiceDate;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type InvLine = {
  dateOfWork: string;
  unitNo: string;
  typeOfWork: string;
  qty: string;
  unitPrice: string;
};

function emptyLine(): InvLine {
  return { dateOfWork: localToday(), unitNo: "", typeOfWork: "", qty: "1", unitPrice: "" };
}

function InvoiceTab({
  portal,
  token,
  initialJobId,
}: {
  portal: PortalBundle;
  token: string;
  /** Preselect this job (set when arriving from a My Jobs card). */
  initialJobId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { uploadFile } = useUpload();
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const { data: invoices } = useListPortalInvoices(token, {
    query: {
      queryKey: getListPortalInvoicesQueryKey(token),
      refetchInterval: 8000,
    },
  });
  const { data: portalJobs } = useListPortalJobs(token);
  const submit = useSubmitPortalInvoice();
  const resubmit = useResubmitPortalInvoice();
  const [editingId, setEditingId] = useState<string | null>(null);

  const [fromCompany, setFromCompany] = useState(portal.crew.name);
  const [fromTrade, setFromTrade] = useState(portal.crew.trade ?? "");
  const [fromAddress, setFromAddress] = useState("");
  const [fromCityStateZip, setFromCityStateZip] = useState("");
  const [fromContact, setFromContact] = useState("");
  const [fromPhone, setFromPhone] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(localToday());
  const [terms, setTerms] = useState("Net 30");
  const [jobId, setJobId] = useState(initialJobId ?? "");
  const [propertyAddress, setPropertyAddress] = useState("");

  // If the crew taps "Send invoice" on a different My Jobs card while this
  // tab is already mounted, follow the new selection.
  useEffect(() => {
    if (initialJobId) setJobId(initialJobId);
  }, [initialJobId]);
  const [lines, setLines] = useState<InvLine[]>([emptyLine()]);
  const [signatureName, setSignatureName] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (prefilled || !invoices || invoices.length === 0) return;
    const last = invoices[0]!;
    setFromCompany(last.fromCompany || portal.crew.name);
    if (last.fromTrade) setFromTrade(last.fromTrade);
    if (last.fromAddress) setFromAddress(last.fromAddress);
    if (last.fromCityStateZip) setFromCityStateZip(last.fromCityStateZip);
    if (last.fromContact) setFromContact(last.fromContact);
    if (last.fromPhone) setFromPhone(last.fromPhone);
    if (last.fromEmail) setFromEmail(last.fromEmail);
    setPrefilled(true);
  }, [invoices, prefilled, portal.crew.name]);

  const dueDate = termsToDueDate(invoiceDate, terms);

  const lineAmount = (l: InvLine) => {
    const q = parseFloat(l.qty);
    const p = parseFloat(l.unitPrice);
    if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
    return Math.round(q * p * 100) / 100;
  };
  const total = Math.round(lines.reduce((s, l) => s + lineAmount(l), 0) * 100) / 100;

  const setLine = (idx: number, patch: Partial<InvLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const buildPdfData = (filled: InvLine[]): InvoicePdfData => ({
    fromCompany: fromCompany.trim(),
    fromTrade: fromTrade.trim() || undefined,
    fromAddress: fromAddress.trim() || undefined,
    fromCityStateZip: fromCityStateZip.trim() || undefined,
    fromContact: fromContact.trim() || undefined,
    fromPhone: fromPhone.trim() || undefined,
    fromEmail: fromEmail.trim() || undefined,
    invoiceNo: invoiceNo.trim() || undefined,
    poNumber: poNumber.trim() || undefined,
    invoiceDate,
    terms,
    dueDate: dueDate || undefined,
    propertyAddress: propertyAddress.trim(),
    lines: filled.map((l) => ({
      dateOfWork: l.dateOfWork,
      unitNo: l.unitNo.trim(),
      typeOfWork: l.typeOfWork.trim(),
      qty: parseFloat(l.qty),
      unitPrice: parseFloat(l.unitPrice),
      amount: lineAmount(l),
    })),
    subtotal: total,
    total,
    signatureName: signatureName.trim() || undefined,
  });

  // Shared validation for both "Download PDF" and "Sign & Send".
  const validate = (requireSignature: boolean): InvLine[] | null => {
    setErr("");
    if (!fromCompany.trim()) {
      setErr("Enter your company or crew name.");
      return null;
    }
    if (!propertyAddress.trim()) {
      setErr("Enter the property address you worked at.");
      return null;
    }
    const filled = lines.filter((l) => l.typeOfWork.trim());
    if (filled.length === 0) {
      setErr("Add at least one line of work.");
      return null;
    }
    for (const l of filled) {
      if (!l.dateOfWork) {
        setErr("Every line needs a date of work.");
        return null;
      }
      const q = parseFloat(l.qty);
      const p = parseFloat(l.unitPrice);
      if (!Number.isFinite(q) || q <= 0) {
        setErr("Every line needs a quantity above zero.");
        return null;
      }
      if (!Number.isFinite(p) || p < 0) {
        setErr("Every line needs a unit price.");
        return null;
      }
    }
    if (requireSignature && !signatureName.trim()) {
      setErr("Type your full name to sign the invoice.");
      return null;
    }
    return filled;
  };

  const handleDownloadPdf = () => {
    const filled = validate(false);
    if (!filled) return;
    downloadInvoicePdf(buildPdfData(filled));
  };

  const handleSend = async () => {
    const filled = validate(true);
    if (!filled) return;

    // Generate the completed PDF and upload it so it lands in Messages.
    const pdfData = buildPdfData(filled);
    let pdfStoragePath: string | undefined;
    let pdfName: string | undefined;
    setUploadingPdf(true);
    try {
      const res = await uploadFile(invoicePdfFile(pdfData));
      if (!res) {
        setErr("Couldn't upload the invoice PDF. Check your connection and try again.");
        return;
      }
      pdfStoragePath = res.objectPath;
      pdfName = invoicePdfFileName(pdfData);
    } finally {
      setUploadingPdf(false);
    }

    const payload = {
          invoiceNo: invoiceNo.trim() || undefined,
          poNumber: poNumber.trim() || undefined,
          invoiceDate,
          terms,
          dueDate: dueDate || undefined,
          fromCompany: fromCompany.trim(),
          fromTrade: fromTrade.trim() || undefined,
          fromAddress: fromAddress.trim() || undefined,
          fromCityStateZip: fromCityStateZip.trim() || undefined,
          fromContact: fromContact.trim() || undefined,
          fromPhone: fromPhone.trim() || undefined,
          fromEmail: fromEmail.trim() || undefined,
          propertyAddress: propertyAddress.trim(),
          jobId: jobId || undefined,
          items: filled.map((l) => ({
            dateOfWork: l.dateOfWork,
            unitNo: l.unitNo.trim() || undefined,
            typeOfWork: l.typeOfWork.trim(),
            qty: parseFloat(l.qty),
            unitPrice: parseFloat(l.unitPrice),
          })),
          signatureName: signatureName.trim(),
          pdfStoragePath,
          pdfName,
    };

    const opts = {
      onSuccess: () => {
        setSent(true);
        setEditingId(null);
        setInvoiceNo("");
        setPoNumber("");
        setInvoiceDate(localToday());
        setJobId("");
        setPropertyAddress("");
        setLines([emptyLine()]);
        setSignatureName("");
        queryClient.invalidateQueries({
          queryKey: getListPortalInvoicesQueryKey(token),
        });
        queryClient.invalidateQueries({
          queryKey: getListPortalMessagesQueryKey(token),
        });
        queryClient.invalidateQueries({
          queryKey: getListPortalDocumentsQueryKey(token),
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => setSent(false), 6000);
      },
      onError: (e: any) => {
        setErr(e?.data?.error ?? "Something went wrong. Try again.");
      },
    };

    if (editingId) {
      resubmit.mutate({ token, invoiceId: editingId, data: payload }, opts);
    } else {
      submit.mutate({ token, data: payload }, opts);
    }
  };

  const startFix = (inv: CrewInvoice) => {
    setEditingId(inv.id);
    setFromCompany(inv.fromCompany);
    setFromTrade(inv.fromTrade ?? "");
    setFromAddress(inv.fromAddress ?? "");
    setFromCityStateZip(inv.fromCityStateZip ?? "");
    setFromContact(inv.fromContact ?? "");
    setFromPhone(inv.fromPhone ?? "");
    setFromEmail(inv.fromEmail ?? "");
    setInvoiceNo(inv.invoiceNo ?? "");
    setPoNumber(inv.poNumber ?? "");
    setInvoiceDate(inv.invoiceDate);
    setTerms(inv.terms ?? "Net 30");
    setJobId(inv.jobId ?? "");
    setPropertyAddress(inv.propertyAddress);
    setLines(
      inv.items.map((it) => ({
        dateOfWork: it.dateOfWork,
        unitNo: it.unitNo ?? "",
        typeOfWork: it.typeOfWork,
        qty: String(it.qty),
        unitPrice: String(it.unitPrice),
      })),
    );
    setSignatureName("");
    setErr("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const statusChip = (s: string) => {
    const map: Record<string, string> = {
      submitted: "bg-[var(--gold-light)]/15 text-[var(--gold-dark,#8f6a1f)]",
      approved: "bg-emerald-100 text-emerald-700",
      paid: "bg-emerald-100 text-emerald-700",
      needs_corrections: "bg-amber-100 text-amber-800",
      rejected: "bg-red-100 text-red-700",
    };
    return map[s] ?? "bg-muted text-muted-foreground";
  };

  return (
    <div className="animate-in fade-in duration-200 flex flex-col gap-[12px]">
      {sent && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-[14px] p-[13px] flex items-center gap-[9px] text-[13.5px] font-semibold">
          <Check className="w-[18px] h-[18px]" /> Invoice sent to ArchAngel. They've been notified.
        </div>
      )}

      {editingId && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-[14px] p-[13px] text-[13px] font-semibold flex items-center justify-between gap-[9px]">
          <span>You're fixing an invoice that was sent back. Update it below, sign, and resend.</span>
          <button
            onClick={() => {
              setEditingId(null);
              setInvoiceNo("");
              setPoNumber("");
              setInvoiceDate(localToday());
              setJobId("");
              setPropertyAddress("");
              setLines([emptyLine()]);
              setSignatureName("");
              setErr("");
            }}
            className="shrink-0 text-[12px] font-bold underline"
          >
            Cancel
          </button>
        </div>
      )}

      <div className={card}>
        <div className="font-display font-bold text-[17px]">Subcontractor Invoice</div>
        <p className="text-[12.5px] text-muted-foreground mt-[3px]">
          Fill this out and sign to send your invoice straight to the ArchAngel office.
        </p>
      </div>

      <div className={card}>
        <div className="text-[11px] font-display font-bold tracking-[0.14em] uppercase text-muted-foreground mb-[10px]">
          From (your company)
        </div>
        <div className="flex flex-col gap-[10px]">
          <div>
            <label className={invLbl}>Company / Crew name *</label>
            <input className={invField} value={fromCompany} onChange={(e) => setFromCompany(e.target.value)} />
          </div>
          <div>
            <label className={invLbl}>Trade</label>
            <input className={invField} value={fromTrade} onChange={(e) => setFromTrade(e.target.value)} placeholder="e.g. Painting" />
          </div>
          <div>
            <label className={invLbl}>Street address</label>
            <input className={invField} value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} />
          </div>
          <div>
            <label className={invLbl}>City, State ZIP</label>
            <input className={invField} value={fromCityStateZip} onChange={(e) => setFromCityStateZip(e.target.value)} />
          </div>
          <div>
            <label className={invLbl}>Contact name</label>
            <input className={invField} value={fromContact} onChange={(e) => setFromContact(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <div>
              <label className={invLbl}>Phone</label>
              <input className={invField} inputMode="tel" value={fromPhone} onChange={(e) => setFromPhone(e.target.value)} />
            </div>
            <div>
              <label className={invLbl}>Email</label>
              <input className={invField} inputMode="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="text-[11px] font-display font-bold tracking-[0.14em] uppercase text-muted-foreground mb-[8px]">
          Bill to
        </div>
        <div className="text-[13.5px] leading-[1.55]">
          <div className="font-bold">Archangel Ventures LLC</div>
          <div>ATTN: May Mahboob</div>
          <div>130 N Preston Rd, Suite 334</div>
          <div>Prosper, TX 75078</div>
          <div className="text-muted-foreground">Admin@archangelcontractors.com</div>
        </div>
      </div>

      <div className={card}>
        <div className="text-[11px] font-display font-bold tracking-[0.14em] uppercase text-muted-foreground mb-[10px]">
          Invoice details
        </div>
        <div className="flex flex-col gap-[10px]">
          <div className="grid grid-cols-2 gap-[10px]">
            <div>
              <label className={invLbl}>Invoice #</label>
              <input className={invField} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className={invLbl}>PO # </label>
              <input className={invField} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <div>
              <label className={invLbl}>Invoice date</label>
              <input type="date" className={invField} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <label className={invLbl}>Terms</label>
              <select className={invField} value={terms} onChange={(e) => setTerms(e.target.value)}>
                {TERMS_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={invLbl}>Due date (from terms)</label>
            <input type="date" className={invField} value={dueDate} readOnly />
          </div>
          {portalJobs && portalJobs.length > 0 && (
            <div>
              <label className={invLbl}>Which job is this invoice for?</label>
              <select
                className={invField}
                value={jobId}
                onChange={(e) => {
                  const id = e.target.value;
                  setJobId(id);
                  if (id) {
                    const j = portalJobs.find((pj) => pj.id === id);
                    if (j) {
                      setPropertyAddress(
                        [j.propertyName, j.unitNo ? `Unit ${j.unitNo}` : null]
                          .filter(Boolean)
                          .join(" · ") || propertyAddress,
                      );
                    }
                  }
                }}
              >
                <option value="">Not one of my listed jobs</option>
                {portalJobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.label}</option>
                ))}
              </select>
              <div className="text-[11px] text-muted-foreground mt-[4px]">
                Picking a job links this invoice to that property in the office system.
              </div>
            </div>
          )}
          <div>
            <label className={invLbl}>Property address (where the work was done) *</label>
            <input className={invField} value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} placeholder="e.g. Maple Grove Apartments" />
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="text-[11px] font-display font-bold tracking-[0.14em] uppercase text-muted-foreground mb-[10px]">
          Work performed
        </div>
        <div className="flex flex-col gap-[12px]">
          {lines.map((l, idx) => (
            <div key={idx} className="rounded-[13px] border border-border p-[11px] flex flex-col gap-[9px]">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-bold text-muted-foreground">Line {idx + 1}</div>
                {lines.length > 1 && (
                  <button
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-muted-foreground hover:text-destructive p-[3px]"
                    aria-label="Remove line"
                  >
                    <Trash2 className="w-[15px] h-[15px]" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-[9px]">
                <div>
                  <label className={invLbl}>Date of work</label>
                  <input type="date" className={invField} value={l.dateOfWork} onChange={(e) => setLine(idx, { dateOfWork: e.target.value })} />
                </div>
                <div>
                  <label className={invLbl}>Unit #</label>
                  <input className={invField} value={l.unitNo} onChange={(e) => setLine(idx, { unitNo: e.target.value })} placeholder="Optional" />
                </div>
              </div>
              <div>
                <label className={invLbl}>Type of work *</label>
                <input className={invField} value={l.typeOfWork} onChange={(e) => setLine(idx, { typeOfWork: e.target.value })} placeholder="e.g. Full paint — 2 bed unit" />
              </div>
              <div className="grid grid-cols-3 gap-[9px]">
                <div>
                  <label className={invLbl}>Qty</label>
                  <input className={invField} inputMode="decimal" value={l.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} />
                </div>
                <div>
                  <label className={invLbl}>Unit price</label>
                  <input className={invField} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(idx, { unitPrice: e.target.value })} placeholder="0.00" />
                </div>
                <div>
                  <label className={invLbl}>Amount</label>
                  <div className="rounded-[11px] bg-muted px-[12px] py-[10px] text-[14px] font-semibold tabular-nums">
                    {money(lineAmount(l))}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            className="flex items-center justify-center gap-[6px] rounded-[12px] border border-dashed border-border py-[10px] text-[13px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-[15px] h-[15px]" /> Add another line
          </button>
          <div className="flex items-center justify-between border-t border-border pt-[11px]">
            <div className="font-display font-bold text-[15px]">Total due</div>
            <div className="font-display font-bold text-[19px] tabular-nums">{money(total)}</div>
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="text-[11px] font-display font-bold tracking-[0.14em] uppercase text-muted-foreground mb-[8px]">
          Sign &amp; send
        </div>
        <p className="text-[12.5px] text-muted-foreground mb-[10px]">
          By typing your name you confirm the work above was completed and the amounts are correct.
        </p>
        <label className={invLbl}>Type your full name to sign *</label>
        <input
          className={`${invField} font-display italic`}
          value={signatureName}
          onChange={(e) => setSignatureName(e.target.value)}
          placeholder="Your full name"
        />
        {err && <div className="text-[12.5px] text-destructive mt-[9px]">{err}</div>}
        <button
          onClick={handleDownloadPdf}
          className="mt-[12px] w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] text-[14px] font-display font-bold text-foreground bg-card border border-border transition-transform active:scale-[0.98]"
        >
          <Download className="w-[16px] h-[16px]" /> Download PDF
        </button>
        <button
          onClick={handleSend}
          disabled={submit.isPending || resubmit.isPending || uploadingPdf}
          className="mt-[10px] w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--gold-light)] disabled:opacity-60 transition-transform active:scale-[0.98]"
        >
          {submit.isPending || resubmit.isPending || uploadingPdf ? (
            <>
              <Loader2 className="w-[17px] h-[17px] animate-spin" />{" "}
              {uploadingPdf ? "Preparing PDF…" : "Sending…"}
            </>
          ) : (
            <>
              <Send className="w-[17px] h-[17px]" />{" "}
              {editingId ? "Sign & Resend Corrected Invoice" : "Sign & Send Invoice"}
            </>
          )}
        </button>
        <p className="text-[11.5px] text-muted-foreground mt-[8px] text-center">
          Sending delivers the finished PDF to the office in your Messages thread.
        </p>
      </div>

      {invoices && invoices.length > 0 && (
        <div className={card}>
          <div className="text-[11px] font-display font-bold tracking-[0.14em] uppercase text-muted-foreground mb-[10px]">
            Invoices you've sent
          </div>
          <div className="flex flex-col gap-[9px]">
            {invoices.map((inv: CrewInvoice) => (
              <div key={inv.id} className="rounded-[12px] border border-border px-[12px] py-[10px]">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">
                      {inv.invoiceNo ? `#${inv.invoiceNo} · ` : ""}{inv.propertyAddress}
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      {formatDay(inv.invoiceDate)} · {inv.items.length} line{inv.items.length === 1 ? "" : "s"}
                      {inv.jobLabel ? ` · ${inv.jobLabel}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-[8px] shrink-0 ml-[10px]">
                    <span className="font-bold text-[14px] tabular-nums">{money(inv.total)}</span>
                    <span className={`px-[8px] py-[3px] rounded-full text-[11px] font-bold capitalize ${statusChip(inv.status)}`}>
                      {inv.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
                {inv.status === "needs_corrections" && (
                  <div className="mt-[8px] rounded-[10px] bg-amber-50 border border-amber-200 px-[10px] py-[8px]">
                    {inv.adminNote && (
                      <div className="text-[12px] text-amber-800 mb-[7px]">
                        <span className="font-bold">Office says:</span> {inv.adminNote}
                      </div>
                    )}
                    <button
                      onClick={() => startFix(inv)}
                      className="w-full rounded-[10px] py-[8px] text-[12.5px] font-bold bg-amber-600 text-white transition-transform active:scale-[0.98]"
                    >
                      Fix &amp; Resubmit
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
