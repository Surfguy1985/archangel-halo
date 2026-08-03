import { useEffect, useMemo, useState } from "react";
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
import { portalGuide, type GuideLang } from "@/lib/portalGuideContent";
import { WingsGuide, TierBadge, type WingsGuideLang } from "@/components/WingsGuide";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Tab =
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

function initialGuideLang(): GuideLang | null {
  const g = new URLSearchParams(window.location.search).get("guide");
  return g === "en" || g === "es" ? g : null;
}

export default function CrewPortal() {
  const { token } = useParams<{ token: string }>();
  const [guideLang, setGuideLang] = useState<GuideLang>(() => initialGuideLang() ?? "en");
  const [tab, setTab] = useState<Tab>(() => (initialGuideLang() ? "guide" : "schedule"));
  const queryClient = useQueryClient();

  const { data: portal, isLoading, isError } = useGetPortal(token);
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
    { key: "offers", label: "Offers", icon: Briefcase, badge: pendingOffersCount, alert: (u?.offers ?? 0) + (u?.emergency ?? 0) },
    { key: "schedule", label: "Schedule", icon: Calendar, alert: u?.schedule },
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
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-card border-b border-border px-[18px] pt-[20px] pb-[16px] lg:px-0 lg:pt-[26px] lg:pb-[20px]">
        <div className="lg:max-w-[1160px] lg:mx-auto lg:px-[24px]">
          <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-dark)] lg:text-[12px]">
            ArchAngel · HALO
          </div>
          <div className="font-display font-bold text-[22px] tracking-[-0.01em] mt-[3px] text-foreground lg:text-[28px]">
            {portal.crew.name}
          </div>
          <div className="text-[12.5px] text-muted-foreground lg:text-[14px]">
            {portal.crew.trade || "Crew portal"}
          </div>
        </div>
      </header>

      <div className="sticky top-0 z-10 bg-card px-[12px] pt-[10px] pb-[8px] border-b border-border shadow-sm lg:hidden">
        <div className="flex gap-[4px] overflow-x-auto no-scrollbar pb-[2px]">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-[5px] whitespace-nowrap rounded-[10px] px-[12px] py-[8px] text-[12.5px] font-display font-bold transition-all ${
                  tab === t.key
                    ? "bg-[var(--gold-light)] text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                <Icon className="w-[14px] h-[14px]" /> {t.label}
                {t.alert ? (
                  <span className="ml-[2px] bg-red-500 text-white px-[5px] py-[1px] rounded-full text-[10px] font-bold min-w-[16px] text-center">
                    {t.alert}
                  </span>
                ) : t.badge ? (
                  <span className="ml-[2px] bg-background text-foreground px-[5px] py-[1px] rounded-full text-[10px] font-bold border border-border">
                    {t.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <main className="px-[14px] py-[16px] pb-[40px] max-w-[560px] mx-auto w-full flex-1 lg:max-w-[1160px] lg:px-[24px] lg:py-[28px] lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-[32px] lg:items-start">
        <aside className="hidden lg:block lg:sticky lg:top-[24px]">
          <nav className="flex flex-col gap-[4px]">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-[10px] rounded-[12px] px-[14px] py-[11px] text-[14px] font-display font-bold text-left transition-all ${
                    tab === t.key
                      ? "bg-[var(--gold-light)] text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  data-testid={`sidebar-tab-${t.key}`}
                >
                  <Icon className="w-[16px] h-[16px] shrink-0" />
                  <span className="flex-1">{t.label}</span>
                  {t.alert ? (
                    <span className="bg-red-500 text-white px-[6px] py-[1px] rounded-full text-[10px] font-bold min-w-[18px] text-center">
                      {t.alert}
                    </span>
                  ) : t.badge ? (
                    <span className="bg-background text-foreground px-[6px] py-[1px] rounded-full text-[10px] font-bold border border-border">
                      {t.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 lg:max-w-[720px]">
        {tab === "schedule" && <SaveLinkCard />}
        {tab === "offers" && <OffersTab portal={portal} token={token} />}
        {tab === "office" && officeView?.enabled && (
          <OfficeViewTab view={officeView} />
        )}
        {tab === "schedule" && <PortalDispatchSection token={token} />}
        {tab === "schedule" && <ScheduleTab portal={portal} />}
        {tab === "invoice" && <InvoiceTab portal={portal} token={token} />}
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
      </main>

      {!portal.crew.agreementAcceptedAt && (
        <AgreementModal token={token} crewName={portal.crew.name} />
      )}
      {portal.crew.agreementAcceptedAt && !portal.crew.selfiePath && (
        <SelfieModal token={token} crewName={portal.crew.name} />
      )}
      
      <div className="pb-8 pt-4">
        <FalkonBadge />
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

      {wings.sponsorName && (
        <div className={card}>
          <div className="text-[12px] text-muted-foreground">Your sponsor</div>
          <div className="font-display font-bold text-[15px] text-foreground mt-[2px]">
            {wings.sponsorName}
          </div>
        </div>
      )}

      <div className={card}>
        <div className="font-display font-bold text-[15px] mb-[8px]">Your recruits</div>
        {wings.recruits.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No recruits yet. Sponsor a crew to start earning overrides.
          </p>
        ) : (
          <div className="space-y-[8px]">
            {wings.recruits.map((r, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="text-[13.5px] font-semibold text-foreground">{r.crewName}</div>
                <div className="flex items-center gap-[8px]">
                  <TierBadge tier={r.tier} />
                  <span className="font-display font-bold text-[15px] text-foreground">
                    {Math.round(r.haloScore)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-[10px]">
        <div className={`${card} text-center`}>
          <div className="flex items-center justify-center gap-[5px] text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">
            <ShieldCheckIcon className="w-[13px] h-[13px]" /> Held
          </div>
          <div className="font-display font-bold text-[20px] text-foreground mt-[4px]">
            {money(wings.reserve.held)}
          </div>
        </div>
        <div className={`${card} text-center`}>
          <div className="flex items-center justify-center gap-[5px] text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">
            <Check className="w-[13px] h-[13px]" /> Released
          </div>
          <div className="font-display font-bold text-[20px] text-foreground mt-[4px]">
            {money(wings.reserve.released)}
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="font-display font-bold text-[15px] mb-[8px]">Your override earnings</div>
        {wings.overrides.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No override earnings yet. When a crew you sponsor completes a job that passes review, you earn here.
          </p>
        ) : (
          <div className="space-y-[10px]">
            {wings.overrides.map((o) => (
              <div key={o.id} className="border-b border-border last:border-0 pb-[10px] last:pb-0">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-[13.5px] text-foreground">{o.jobNo ?? "Job"}</div>
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                    {o.status?.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12.5px] mt-[4px]">
                  <span className="text-muted-foreground">Immediate 80%</span>
                  <span className="font-bold text-foreground">{money(o.immediateAmount)}</span>
                </div>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-muted-foreground">Reserve 20%</span>
                  <span>{money(o.reserveAmount)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
  const [successMsg, setSuccessMsg] = useState<{ [id: string]: string }>({});
  const [errorMsg, setErrorMsg] = useState<{ [id: string]: string }>({});

  const offers = portal.offers || [];
  const emergencyOffers = portal.emergencyOffers || [];

  const handleRespond = (offerId: string, decision: "approved" | "declined") => {
    setErrorMsg((prev) => ({ ...prev, [offerId]: "" }));
    respond.mutate(
      { token, offerId, data: { decision } },
      {
        onSuccess: (res) => {
          if (decision === "approved") {
            setSuccessMsg((prev) => ({ ...prev, [offerId]: res.message ?? "You're on the schedule." }));
          }
          queryClient.invalidateQueries();
        },
        onError: (err: any) => {
          setErrorMsg((prev) => ({
            ...prev,
            [offerId]: err?.data?.error ?? "Something went wrong",
          }));
        },
      }
    );
  };

  const emergencySection = emergencyOffers.length > 0 && (
    <div className="flex flex-col gap-[12px]" data-testid="section-emergency-offers">
      <div className="flex items-center gap-[6px] text-[13px] font-display font-bold text-red-600 uppercase tracking-wider">
        <AlertCircle className="w-[16px] h-[16px]" /> Emergency
      </div>
      {emergencyOffers.map((eo) => (
        <EmergencyOfferCard key={eo.id} offer={eo} token={token} />
      ))}
    </div>
  );

  if (offers.length === 0) {
    return (
      <div className="animate-in fade-in duration-200 flex flex-col gap-[12px]">
        {emergencySection}
        <div className={`${card} text-center py-[40px]`}>
          <Briefcase className="w-[32px] h-[32px] text-muted-foreground mx-auto mb-[12px]" />
          <div className="font-display font-bold text-[17px]">No offers yet</div>
          <p className="text-[13px] text-muted-foreground mt-[4px]">
            When the office sends job offers, they'll appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-200 flex flex-col gap-[12px]">
      {emergencySection}
      <div className="text-[13px] text-muted-foreground mb-[4px]">
        Job offers from the office
      </div>
      {offers.map((o) => {
        const isPending = o.status === "pending" && !o.filledByOther;
        const isFilled = o.status === "pending" && o.filledByOther;
        const isResolved = o.status !== "pending";

        return (
          <div
            key={o.id}
            className={`bg-card rounded-[16px] shadow-[var(--shadow)] overflow-hidden border ${
              isPending
                ? "border-[var(--gold)]"
                : "border-border opacity-80"
            }`}
          >
            <div className={`px-[16px] py-[12px] flex items-start justify-between border-b ${
              isPending ? "bg-[var(--gold-tint)] border-[var(--gold)]/20" : "bg-[var(--paper)] border-border"
            }`}>
              <div>
                <div className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground flex items-center gap-[6px]">
                  {isPending && <span className="w-[8px] h-[8px] rounded-full bg-[var(--gold-light)] animate-pulse" />}
                  {o.jobNo} {o.category ? `· ${o.category}` : ""}
                </div>
                <div className="font-display font-bold text-[18px] mt-[2px] leading-tight">
                  {o.propertyName || "Assignment"}
                  {o.unitNo ? ` · Unit ${o.unitNo}` : ""}
                </div>
              </div>
              <div className="text-right">
                {isPending && (
                  <div className="text-[11px] font-bold uppercase text-[var(--gold-dark)] bg-white px-[8px] py-[2px] rounded-full shadow-sm">
                    Action Needed
                  </div>
                )}
                {isFilled && (
                  <div className="text-[11px] font-bold uppercase text-muted-foreground bg-black/5 px-[8px] py-[2px] rounded-full">
                    Filled by another crew
                  </div>
                )}
                {o.status === "approved" && (
                  <div className="text-[11px] font-bold uppercase text-green-700 bg-green-50 px-[8px] py-[2px] rounded-full flex items-center gap-1">
                    <Check className="w-3 h-3" /> Accepted
                  </div>
                )}
                {o.status === "declined" && (
                  <div className="text-[11px] font-bold uppercase text-red-700 bg-red-50 px-[8px] py-[2px] rounded-full">
                    Declined
                  </div>
                )}
                {o.status === "withdrawn" && (
                  <div className="text-[11px] font-bold uppercase text-muted-foreground bg-black/5 px-[8px] py-[2px] rounded-full">
                    Withdrawn
                  </div>
                )}
              </div>
            </div>

            <div className="p-[16px]">
              <div className="flex flex-col gap-[12px]">
                {/* Date & Location */}
                <div className={`rounded-[10px] px-[10px] py-[8px] border text-[12px] ${
                  o.scheduleType === "flex"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-[var(--gold-tint)] border-[rgba(185,138,47,0.28)] text-[var(--gold-dark)]"
                }`}>
                  {o.scheduleType === "flex" ? (
                    <><b>Flex job</b> — work on your own time{o.flexDueBy ? <>, finish by <b>{formatDay(o.flexDueBy)}</b></> : " within the set timeframe"}.</>
                  ) : (
                    <><b>Set schedule</b> — you commit to the days and hours set by the property.</>
                  )}
                  {(o.crewsNeeded ?? 1) > 1 && (
                    <> {o.crewsFilled ?? 0} of {o.crewsNeeded} crew spots filled.</>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-[12px]">
                  <div className="flex items-start gap-[8px]">
                    <Calendar className="w-[16px] h-[16px] text-muted-foreground shrink-0 mt-[2px]" />
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">When needed</div>
                      <div className="text-[13px] font-semibold">{o.scheduleType === "flex" && o.flexDueBy ? `By ${formatDay(o.flexDueBy)}` : o.scheduledOn ? formatDay(o.scheduledOn) : "TBD"}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-[8px]">
                    <MapPin className="w-[16px] h-[16px] text-muted-foreground shrink-0 mt-[2px]" />
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Location</div>
                      <div className="text-[13px] font-semibold leading-tight">
                        {[o.propertyAddress, o.propertyCity].filter(Boolean).join(", ") || "No address provided"}
                      </div>
                      {(o.propertyAddress || o.propertyCity) && (
                        <a
                          href={`https://maps.google.com/?q=${encodeURIComponent([o.propertyAddress, o.propertyCity].filter(Boolean).join(", "))}`}
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

                {/* Units */}
                <div className="flex items-start gap-[8px]">
                  <Home className="w-[16px] h-[16px] text-muted-foreground shrink-0 mt-[2px]" />
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Unit(s) to work</div>
                    <div className="text-[13px] font-semibold">{o.unitNo ? `Unit ${o.unitNo}` : "See scope of work — ask the site contact if unsure"}</div>
                  </div>
                </div>

                {/* Scope */}
                {(o.description || (o.tasks && o.tasks.length > 0)) && (
                  <div className="mt-[4px] pt-[12px] border-t border-border">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-[6px]">Scope of work</div>
                    {o.description && <div className="text-[13.5px] leading-relaxed mb-[8px]">{o.description}</div>}
                    {o.tasks && o.tasks.length > 0 && (
                      <ul className="flex flex-col gap-[4px]">
                        {o.tasks.map((t, i) => (
                          <li key={i} className="flex items-start gap-[6px] text-[13px]">
                            <span className="text-[var(--gold)] mt-[2px]">•</span>
                            <span>{t}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Photos */}
                {o.photos && o.photos.length > 0 && (
                  <div className="mt-[4px] pt-[12px] border-t border-border">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-[6px]">Reference Photos</div>
                    <div className="flex gap-[8px] overflow-x-auto pb-[4px]">
                      {o.photos.map((p) => (
                        <a
                          key={p.storagePath}
                          href={`/api/storage${p.storagePath}`}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 w-[80px] h-[80px] rounded-[8px] overflow-hidden bg-black/5 border border-border"
                        >
                          <img src={`/api/storage${p.storagePath}`} alt="" className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Contact */}
                {(o.contactName || o.contactPhone || o.contactEmail) && (
                  <div className="mt-[4px] pt-[12px] border-t border-border">
                     <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-[2px]">Site Contact</div>
                     <div className="text-[13px] font-semibold">
                       {o.contactName || "Contact"}
                       {o.contactRole ? <span className="text-muted-foreground font-normal"> ({o.contactRole})</span> : null}
                     </div>
                     {o.contactPhone && (
                       <div className="text-[13px]">
                         <a href={`tel:${o.contactPhone.replace(/[^\d+]/g, '')}`} className="text-[var(--blue)] font-semibold">{o.contactPhone}</a>
                       </div>
                     )}
                     {o.contactEmail && (
                       <div className="text-[13px]">
                         <a href={`mailto:${o.contactEmail}`} className="text-[var(--blue)] font-semibold">{o.contactEmail}</a>
                       </div>
                     )}
                  </div>
                )}

              </div>
            </div>

            {/* Actions / Status footer */}
            <div className={`p-[16px] pt-0 ${!isPending && !successMsg[o.id] && !errorMsg[o.id] ? "hidden" : ""}`}>
              {errorMsg[o.id] && (
                <div className="mb-[12px] bg-red-50 text-red-700 px-[12px] py-[8px] rounded-[8px] text-[13px] flex items-start gap-[8px]">
                  <AlertCircle className="w-[16px] h-[16px] shrink-0 mt-[2px]" />
                  <span>{errorMsg[o.id]}</span>
                </div>
              )}
              
              {successMsg[o.id] ? (
                 <div className="bg-green-50 border border-green-200 text-green-800 px-[14px] py-[12px] rounded-[12px] text-[13.5px] font-semibold flex items-start gap-[10px]">
                   <CheckSquare className="w-[20px] h-[20px] shrink-0 mt-[1px] text-green-600" />
                   <span>{successMsg[o.id]}</span>
                 </div>
              ) : isPending ? (
                declineConfirmId === o.id ? (
                  <div className="bg-[var(--paper)] rounded-[12px] p-[12px] flex flex-col gap-[10px]">
                    <div className="text-[13px] font-semibold text-center">Are you sure you want to decline?</div>
                    <div className="flex gap-[8px]">
                      <button
                        onClick={() => setDeclineConfirmId(null)}
                        className="flex-1 py-[10px] rounded-[8px] text-[13px] font-bold border border-border bg-white text-muted-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleRespond(o.id, "declined")}
                        disabled={respond.isPending}
                        className="flex-1 py-[10px] rounded-[8px] text-[13px] font-bold bg-red-600 text-white disabled:opacity-50"
                      >
                        Yes, Decline
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-[12px]">
                    <button
                      onClick={() => setDeclineConfirmId(o.id)}
                      className="w-1/3 py-[12px] rounded-[12px] font-display font-bold text-[14px] border-2 border-border text-muted-foreground active:scale-[0.98] transition-transform"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => handleRespond(o.id, "approved")}
                      disabled={respond.isPending}
                      className="flex-1 py-[12px] rounded-[12px] font-display font-bold text-[15px] btn-gold active:scale-[0.98] transition-transform disabled:opacity-70 flex items-center justify-center gap-[8px]"
                    >
                      {respond.isPending ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Check className="w-[18px] h-[18px]" />}
                      Accept Job
                    </button>
                  </div>
                )
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OfficeViewTab({ view }: { view: PortalOfficeView }) {
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

      {view.features.includes("jobs") && (
        <>
          <div className="text-[13px] font-semibold mb-[8px]">Jobs</div>
          {view.jobs.length === 0 ? (
            <div className={`${card} mb-[12px] text-[12.5px] text-muted-foreground`}>
              No jobs in your scope.
            </div>
          ) : (
            <div className="flex flex-col gap-[8px] mb-[14px]">
              {view.jobs.slice(0, 50).map((j) => (
                <div key={j.id} className={card}>
                  <div className="flex items-center gap-[8px]">
                    <span className="text-[13.5px] font-semibold">{j.jobNo}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-[7px] py-[2px] rounded-full ${statusColor(j.status)}`}
                    >
                      {j.status.replace(/_/g, " ")}
                    </span>
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
        </>
      )}

      {view.features.includes("properties") && (
        <>
          <div className="text-[13px] font-semibold mb-[8px]">Properties</div>
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
        </>
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

function ScheduleTab({ portal }: { portal: PortalBundle }) {
  const items = portal.schedule;
  // Server returns items already in route order within each day; number the
  // stops so crews can follow the plan (only shown for multi-stop days).
  const dayCounts = new Map<string, number>();
  for (const s of items) {
    const d = s.scheduledOn ?? "";
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  }
  const daySeen = new Map<string, number>();
  const stopNo = (day: string | null) => {
    const d = day ?? "";
    const n = (daySeen.get(d) ?? 0) + 1;
    daySeen.set(d, n);
    return { n, of: dayCounts.get(d) ?? 1 };
  };
  return (
    <div className="animate-in fade-in duration-200">
      <div className="text-[13px] text-muted-foreground mb-[12px]">
        Your upcoming assignments
      </div>
      {items.length === 0 ? (
        <div className={`${card} text-center text-[13px] text-muted-foreground py-[30px]`}>
          Nothing scheduled right now.
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {items.map((s) => {
            const isToday = s.scheduledOn === localToday();
            const { n: stopN, of: stopOf } = stopNo(s.scheduledOn ?? null);
            const mapsQuery = s.propertyAddress
              ? s.propertyAddress
              : s.propertyName
                ? `${s.propertyName}${s.propertyCity ? `, ${s.propertyCity}` : ""}`
                : null;
            return (
              <div
                key={s.id}
                className={`${card} ${isToday ? "ring-1 ring-[var(--gold)]" : ""}`}
              >
                <div className="flex items-center gap-[8px] mb-[4px]">
                  <Calendar className="w-[14px] h-[14px] text-[var(--gold)]" />
                  <span className="text-[12.5px] font-semibold">
                    {formatDay(s.scheduledOn)}
                  </span>
                  {s.windowStart && (
                    <span className="text-[12px] text-muted-foreground">
                      · {s.windowStart}
                    </span>
                  )}
                  {stopOf > 1 && (
                    <span className="text-[10.5px] font-bold uppercase tracking-wide px-[7px] py-[2px] rounded-full bg-[var(--ink)]/8 text-[var(--ink)]">
                      Stop {stopN} of {stopOf}
                    </span>
                  )}
                  {isToday && (
                    <span className="ml-auto text-[10px] font-bold uppercase tracking-wide px-[8px] py-[2px] rounded-full bg-[var(--gold-light)]/15 text-[var(--gold-dark,#8f6a1f)]">
                      Today
                    </span>
                  )}
                </div>
                <div className="font-semibold text-[14.5px]">
                  {s.propertyName || s.description || "Assignment"}
                  {s.unitNo ? ` · Unit ${s.unitNo}` : ""}
                </div>
                {s.propertyName && s.description && (
                  <div className="text-[12.5px] text-muted-foreground mt-[2px]">
                    {s.description}
                  </div>
                )}
                {mapsQuery && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(mapsQuery)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-[6px] mt-[8px] text-[12.5px] text-[var(--blue,#2b6cb0)] font-semibold"
                  >
                    <MapPin className="w-[13px] h-[13px] mt-[2px] shrink-0" />
                    <span>
                      {s.propertyAddress ||
                        `${s.propertyName}${s.propertyCity ? `, ${s.propertyCity}` : ""}`}
                    </span>
                  </a>
                )}
                {s.contactPhone && (
                  <a
                    href={`tel:${s.contactPhone.replace(/[^+0-9]/g, "")}`}
                    className="flex items-center gap-[6px] mt-[6px] text-[12.5px] text-[var(--blue,#2b6cb0)] font-semibold"
                  >
                    <Phone className="w-[13px] h-[13px] shrink-0" />
                    <span>
                      {s.contactPhone}
                      {s.contactName ? (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {s.contactName}
                        </span>
                      ) : null}
                    </span>
                  </a>
                )}
                {s.tasks && s.tasks.length > 0 && (
                  <div className="mt-[10px] bg-[var(--paper)] rounded-[11px] px-[12px] py-[10px]">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-[6px]">
                      {isToday ? "Today's tasks" : "Task list"}
                    </div>
                    <ul className="flex flex-col gap-[4px]">
                      {s.tasks.map((t, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-[7px] text-[12.5px]"
                        >
                          <CheckSquare className="w-[13px] h-[13px] mt-[2px] shrink-0 text-[var(--gold)]" />
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.jobNo && (
                  <div className="text-[11.5px] text-muted-foreground mt-[6px] font-mono">
                    {s.jobNo}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

// Local YYYY-MM-DD (never UTC) so the trail resets at the crew's midnight.
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type TrackState = { day: string; jobId: string | null };

function readTrackState(token: string): TrackState | null {
  try {
    const raw = localStorage.getItem(`halo_gps_trail_${token}`);
    if (!raw) return null;
    const s = JSON.parse(raw) as TrackState;
    return s.day === localDay() ? s : null;
  } catch {
    return null;
  }
}

function CheckinTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const checkin = useCreatePortalCheckin();
  const { data: jobs } = useListPortalJobs(token);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checkin" | "checkout" | null>(null);
  const [tracking, setTracking] = useState<TrackState | null>(() => readTrackState(token));

  // While checked in, breadcrumb the crew's GPS every 30 seconds so the office
  // and client maps can draw the live trail. Stops on checkout, at midnight,
  // or when the server says we're no longer checked in (409).
  useEffect(() => {
    if (!tracking) return;
    let cancelled = false;
    const stop = () => {
      try { localStorage.removeItem(`halo_gps_trail_${token}`); } catch {}
      setTracking(null);
    };
    const ping = async () => {
      if (cancelled) return;
      if (tracking.day !== localDay()) { stop(); return; }
      const pos = await getPosition();
      if (cancelled || !pos) return;
      try {
        await createPortalTrackPoint(token, {
          jobId: tracking.jobId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        if (status === 409 || status === 404) stop();
        // other errors (offline, flaky signal): keep trying
      }
    };
    void ping();
    const iv = window.setInterval(() => void ping(), 30_000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [token, tracking]);

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
            try { localStorage.removeItem(`halo_gps_trail_${token}`); } catch {}
            setTracking(null);
          } else {
            const next: TrackState = { day: localDay(), jobId: selectedJobId || null };
            try { localStorage.setItem(`halo_gps_trail_${token}`, JSON.stringify(next)); } catch {}
            setTracking(next);
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

function InvoiceTab({ portal, token }: { portal: PortalBundle; token: string }) {
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
  const [jobId, setJobId] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
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
          <div className="font-bold">ArchAngel Contractors</div>
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
