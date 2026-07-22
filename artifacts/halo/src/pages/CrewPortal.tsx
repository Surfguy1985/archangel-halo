import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPortal,
  useListPortalMessages,
  useSendPortalMessage,
  useCreatePortalCheckin,
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
  useMarkPortalSeen,
  useAcceptPortalAgreement,
  getListPortalInvoicesQueryKey,
  type W9Data,
  type PortalBundle,
  type PortalOffer,
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
} from "lucide-react";
import { downloadW9Pdf } from "@/lib/w9pdf";
import WelcomeKitTab from "./WelcomeKitTab";

type Tab =
  | "offers"
  | "schedule"
  | "invoice"
  | "messages"
  | "photos"
  | "documents"
  | "checkin"
  | "pay"
  | "w9"
  | "packets";

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

export default function CrewPortal() {
  const { token } = useParams<{ token: string }>();
  const [tab, setTab] = useState<Tab>("schedule");
  const queryClient = useQueryClient();

  const { data: portal, isLoading, isError } = useGetPortal(token);
  const markSeen = useMarkPortalSeen();

  const pendingOffersCount = portal?.offers?.filter(o => o.status === "pending" && !o.filledByOther).length || 0;

  useEffect(() => {
    if (pendingOffersCount > 0 && tab !== "offers") {
      setTab("offers");
    }
  }, [pendingOffersCount]);

  const unseen = portal?.unseen;

  useEffect(() => {
    const section = SEEN_SECTIONS[tab];
    if (!section || !unseen) return;
    const n = (unseen as unknown as Record<string, number>)[section] ?? 0;
    if (n > 0) {
      markSeen.mutate(
        { token, data: { section } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getGetPortalQueryKey(token),
            });
          },
        },
      );
    }
  }, [tab, unseen, token]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg,#f4f2ee)] grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--gold)]" />
      </div>
    );
  }

  if (isError || !portal) {
    return (
      <div className="min-h-screen bg-[var(--bg,#f4f2ee)] grid place-items-center px-6">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <div className="font-display font-bold text-[18px]">Invalid link</div>
          <p className="text-[13px] text-muted-foreground mt-1">
            This portal link isn't valid. Ask ArchAngel for a new one.
          </p>
        </div>
      </div>
    );
  }

  const u = portal.unseen;
  const tabs: { key: Tab; label: string; icon: any; badge?: number; alert?: number }[] = [
    { key: "offers", label: "Offers", icon: Briefcase, badge: pendingOffersCount, alert: u?.offers },
    { key: "schedule", label: "Schedule", icon: Calendar, alert: u?.schedule },
    { key: "invoice", label: "Invoice", icon: Receipt },
    { key: "packets", label: "Welcome Kit", icon: PackageCheck, alert: u?.packets },
    { key: "messages", label: "Messages", icon: MessageSquare, alert: u?.messages },
    { key: "checkin", label: "Job Tracker", icon: MapPin },
    { key: "photos", label: "Photos", icon: Camera },
    { key: "documents", label: "Docs", icon: FileText, alert: u?.documents },
    { key: "pay", label: "Pay", icon: Wallet },
    { key: "w9", label: "W-9", icon: ClipboardCheck },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg,#f4f2ee)]">
      <header className="bg-[var(--ink)] text-white px-[18px] pt-[20px] pb-[16px]">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-light)]">
          ArchAngel · HALO
        </div>
        <div className="font-display font-bold text-[22px] tracking-[-0.01em] mt-[3px]">
          {portal.crew.name}
        </div>
        <div className="text-[12.5px] text-white/60">
          {portal.crew.trade || "Crew portal"}
        </div>
      </header>

      <div className="sticky top-0 z-10 bg-[var(--bg,#f4f2ee)] px-[12px] pt-[10px] pb-[8px] border-b border-border">
        <div className="flex gap-[4px] overflow-x-auto no-scrollbar">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-[5px] whitespace-nowrap rounded-[10px] px-[12px] py-[8px] text-[12.5px] font-display font-bold transition-colors ${
                  tab === t.key
                    ? "bg-[var(--ink)] text-white"
                    : "bg-card text-muted-foreground"
                }`}
              >
                <Icon className="w-[14px] h-[14px]" /> {t.label}
                {t.alert ? (
                  <span className="ml-[2px] bg-red-600 text-white px-[5px] py-[1px] rounded-full text-[10px] font-bold min-w-[16px] text-center">
                    {t.alert}
                  </span>
                ) : t.badge ? (
                  <span className="ml-[2px] bg-[var(--gold)] text-[var(--ink)] px-[5px] py-[1px] rounded-full text-[10px] font-bold">
                    {t.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <main className="px-[14px] py-[16px] pb-[40px] max-w-[560px] mx-auto">
        {tab === "schedule" && <SaveLinkCard />}
        {tab === "offers" && <OffersTab portal={portal} token={token} />}
        {tab === "schedule" && <ScheduleTab portal={portal} />}
        {tab === "invoice" && <InvoiceTab portal={portal} token={token} />}
        {tab === "packets" && <WelcomeKitTab token={token} />}
        {tab === "messages" && <MessagesTab token={token} />}
        {tab === "checkin" && <CheckinTab token={token} />}
        {tab === "photos" && <PhotosTab token={token} />}
        {tab === "documents" && <DocumentsTab token={token} />}
        {tab === "pay" && (
          <PaymentTab
            token={token}
            initialMethod={portal.crew.preferredPaymentMethod ?? ""}
            initialDetails={portal.crew.paymentDetails ?? ""}
          />
        )}
        {tab === "w9" && <W9Tab token={token} />}
      </main>

      {!portal.crew.agreementAcceptedAt && (
        <AgreementModal token={token} crewName={portal.crew.name} />
      )}
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-[14px]">
      <div className="bg-card rounded-[20px] w-full max-w-[480px] max-h-[86vh] overflow-y-auto p-[20px] shadow-2xl">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold)]">
          Welcome, {crewName}
        </div>
        <div className="font-display font-bold text-[20px] mt-[4px] mb-[10px]">
          How your crew portal works
        </div>
        <div className="text-[13.5px] leading-relaxed text-foreground/90 flex flex-col gap-[10px]">
          <div className="flex gap-[10px]">
            <Link2 className="w-[16px] h-[16px] text-[var(--gold)] shrink-0 mt-[2px]" />
            <span><b>Save this link.</b> This page is your personal portal — the same link works for every job. Bookmark it or add it to your home screen (Share → "Add to Home Screen").</span>
          </div>
          <div className="flex gap-[10px]">
            <MapPin className="w-[16px] h-[16px] text-[var(--gold)] shrink-0 mt-[2px]" />
            <span><b>Check in and out of every job.</b> Use the Job Tracker tab when you arrive and when you finish. Your GPS location and time are recorded as proof you were on site.</span>
          </div>
          <div className="flex gap-[10px]">
            <Camera className="w-[16px] h-[16px] text-[var(--gold)] shrink-0 mt-[2px]" />
            <span><b>Take before &amp; after photos.</b> Photograph the work area before you start and after you finish. Photos are fingerprinted the moment they're uploaded, so they stand as tamper-proof evidence of your work.</span>
          </div>
          <div className="flex gap-[10px]">
            <ShieldCheck className="w-[16px] h-[16px] text-[var(--gold)] shrink-0 mt-[2px]" />
            <span><b>This protects you.</b> GPS check-ins and sealed photos prove the job was done right — they resolve disputes in your favor and get you paid faster.</span>
          </div>
        </div>
        <label className="flex items-start gap-[10px] mt-[16px] mb-[14px] cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-[3px] w-[16px] h-[16px] accent-[var(--gold)]"
          />
          <span className="text-[12.5px] text-muted-foreground">
            I understand and agree to check in/out with GPS and document my work
            with before &amp; after photos on every job.
          </span>
        </label>
        <button
          onClick={onAccept}
          disabled={!checked || accept.isPending}
          className="w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
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

function OffersTab({ portal, token }: { portal: PortalBundle; token: string }) {
  const queryClient = useQueryClient();
  const respond = useRespondPortalOffer();
  const [declineConfirmId, setDeclineConfirmId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<{ [id: string]: string }>({});
  const [errorMsg, setErrorMsg] = useState<{ [id: string]: string }>({});

  const offers = portal.offers || [];

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

  if (offers.length === 0) {
    return (
      <div className="animate-in fade-in duration-200">
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
                  {isPending && <span className="w-[8px] h-[8px] rounded-full bg-[var(--gold)] animate-pulse" />}
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
                <div className="grid grid-cols-2 gap-[12px]">
                  <div className="flex items-start gap-[8px]">
                    <Calendar className="w-[16px] h-[16px] text-muted-foreground shrink-0 mt-[2px]" />
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">When needed</div>
                      <div className="text-[13px] font-semibold">{o.scheduledOn ? formatDay(o.scheduledOn) : "TBD"}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-[8px]">
                    <MapPin className="w-[16px] h-[16px] text-muted-foreground shrink-0 mt-[2px]" />
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Location</div>
                      <div className="text-[13px] font-semibold leading-tight">
                        {o.propertyAddress || o.propertyCity || "No address provided"}
                      </div>
                    </div>
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
                {o.contactPhone && (
                  <div className="mt-[4px] pt-[12px] border-t border-border">
                     <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-[2px]">Site Contact</div>
                     <div className="text-[13px] font-semibold">{o.contactName || "Contact"} · <a href={`tel:${o.contactPhone.replace(/[^\d+]/g, '')}`} className="text-[var(--blue)]">{o.contactPhone}</a></div>
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

function ScheduleTab({ portal }: { portal: PortalBundle }) {
  const items = portal.schedule;
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
                  {isToday && (
                    <span className="ml-auto text-[10px] font-bold uppercase tracking-wide px-[8px] py-[2px] rounded-full bg-[var(--gold)]/15 text-[var(--gold-dark,#8f6a1f)]">
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

function CheckinTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const checkin = useCreatePortalCheckin();
  const { data: jobs } = useListPortalJobs(token);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checkin" | "checkout" | null>(null);

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
          if (kind === "checkout") setNote("");
          setStatus(
            kind === "checkout"
              ? "Checked out! Your time and work note were recorded."
              : "Checked in! Your arrival time and location were recorded.",
          );
          queryClient.invalidateQueries({ queryKey: getGetPortalQueryKey(token) });
        },
        onError: () => {
          setBusy(null);
          setStatus("Couldn't save. Check your connection and try again.");
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
                  ? "bg-[var(--gold)] border-[var(--gold)] text-[var(--ink)]"
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
          <p className="text-[12.5px] text-muted-foreground text-center mt-[4px] mb-[14px] max-w-[320px]">
            Check in when you arrive and check out when you finish. Your time
            and location are recorded as proof you were on site.
          </p>
          <button
            onClick={() => doPunch("checkin")}
            disabled={busy !== null}
            className="w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] disabled:opacity-60 transition-transform active:scale-[0.98]"
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
                ? "bg-[var(--gold)] border-[var(--gold)] text-[var(--ink)]"
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
                  ? "bg-[var(--gold)] border-[var(--gold)] text-[var(--ink)]"
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
      <label className="w-full mb-[14px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] cursor-pointer transition-transform active:scale-[0.98]">
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
      <label className="w-full mb-[14px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] cursor-pointer transition-transform active:scale-[0.98]">
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

const PAY_METHODS = ["Direct deposit (ACH)", "Check", "Zelle", "Venmo", "Cash App", "PayPal"];

function PaymentTab({
  token,
  initialMethod,
  initialDetails,
}: {
  token: string;
  initialMethod: string;
  initialDetails: string;
}) {
  const queryClient = useQueryClient();
  const save = useSetPortalPaymentMethod();
  const [method, setMethod] = useState(initialMethod);
  const [details, setDetails] = useState(initialDetails);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    save.mutate(
      {
        token,
        data: {
          preferredPaymentMethod: method || null,
          paymentDetails: details || null,
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          queryClient.invalidateQueries({
            queryKey: getGetPortalQueryKey(token),
          });
          setTimeout(() => setSaved(false), 1800);
        },
      },
    );
  };

  return (
    <div className="animate-in fade-in duration-200">
      <div className={card}>
        <div className="font-display font-bold text-[16px] mb-[3px]">
          How do you want to get paid?
        </div>
        <p className="text-[12.5px] text-muted-foreground mb-[14px]">
          Pick your preferred method and add the details we'll need.
        </p>
        <div className="grid grid-cols-2 gap-[8px] mb-[14px]">
          {PAY_METHODS.map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`rounded-[12px] py-[11px] px-[10px] text-[13px] font-semibold border transition-colors ${
                method === m
                  ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                  : "bg-background text-foreground border-border"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
          Payment details
        </label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
          placeholder="e.g. Routing & account #, Zelle email/phone, or mailing address"
          className="w-full resize-none rounded-[12px] border border-border bg-background px-[13px] py-[11px] text-[14px] mb-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
        />
        <button
          onClick={handleSave}
          disabled={save.isPending}
          className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] disabled:opacity-60 transition-transform active:scale-[0.98]"
        >
          {saved ? (
            <>
              <Check className="w-[17px] h-[17px]" /> Saved
            </>
          ) : (
            "Save payment method"
          )}
        </button>
      </div>
    </div>
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
        className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] disabled:opacity-60 transition-transform active:scale-[0.98]"
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
  const { data: invoices } = useListPortalInvoices(token);
  const submit = useSubmitPortalInvoice();

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

  const handleSend = () => {
    setErr("");
    if (!fromCompany.trim()) return setErr("Enter your company or crew name.");
    if (!propertyAddress.trim()) return setErr("Enter the property address you worked at.");
    const filled = lines.filter((l) => l.typeOfWork.trim());
    if (filled.length === 0) return setErr("Add at least one line of work.");
    for (const l of filled) {
      if (!l.dateOfWork) return setErr("Every line needs a date of work.");
      const q = parseFloat(l.qty);
      const p = parseFloat(l.unitPrice);
      if (!Number.isFinite(q) || q <= 0) return setErr("Every line needs a quantity above zero.");
      if (!Number.isFinite(p) || p < 0) return setErr("Every line needs a unit price.");
    }
    if (!signatureName.trim()) return setErr("Type your full name to sign the invoice.");

    submit.mutate(
      {
        token,
        data: {
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
          items: filled.map((l) => ({
            dateOfWork: l.dateOfWork,
            unitNo: l.unitNo.trim() || undefined,
            typeOfWork: l.typeOfWork.trim(),
            qty: parseFloat(l.qty),
            unitPrice: parseFloat(l.unitPrice),
          })),
          signatureName: signatureName.trim(),
        },
      },
      {
        onSuccess: () => {
          setSent(true);
          setInvoiceNo("");
          setPoNumber("");
          setInvoiceDate(localToday());
          setPropertyAddress("");
          setLines([emptyLine()]);
          setSignatureName("");
          queryClient.invalidateQueries({
            queryKey: getListPortalInvoicesQueryKey(token),
          });
          window.scrollTo({ top: 0, behavior: "smooth" });
          setTimeout(() => setSent(false), 6000);
        },
        onError: (e: any) => {
          setErr(e?.data?.error ?? "Something went wrong. Try again.");
        },
      },
    );
  };

  const statusChip = (s: string) => {
    const map: Record<string, string> = {
      submitted: "bg-[var(--gold)]/15 text-[var(--gold-dark,#8f6a1f)]",
      approved: "bg-emerald-100 text-emerald-700",
      paid: "bg-emerald-100 text-emerald-700",
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
          onClick={handleSend}
          disabled={submit.isPending}
          className="mt-[12px] w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] disabled:opacity-60 transition-transform active:scale-[0.98]"
        >
          {submit.isPending ? (
            <>
              <Loader2 className="w-[17px] h-[17px] animate-spin" /> Sending…
            </>
          ) : (
            <>
              <Send className="w-[17px] h-[17px]" /> Sign &amp; Send Invoice
            </>
          )}
        </button>
      </div>

      {invoices && invoices.length > 0 && (
        <div className={card}>
          <div className="text-[11px] font-display font-bold tracking-[0.14em] uppercase text-muted-foreground mb-[10px]">
            Invoices you've sent
          </div>
          <div className="flex flex-col gap-[9px]">
            {invoices.map((inv: CrewInvoice) => (
              <div key={inv.id} className="flex items-center justify-between rounded-[12px] border border-border px-[12px] py-[10px]">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold truncate">
                    {inv.invoiceNo ? `#${inv.invoiceNo} · ` : ""}{inv.propertyAddress}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {formatDay(inv.invoiceDate)} · {inv.items.length} line{inv.items.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-[8px] shrink-0 ml-[10px]">
                  <span className="font-bold text-[14px] tabular-nums">{money(inv.total)}</span>
                  <span className={`px-[8px] py-[3px] rounded-full text-[11px] font-bold capitalize ${statusChip(inv.status)}`}>
                    {inv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
