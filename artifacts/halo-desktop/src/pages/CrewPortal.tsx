import { useEffect, useMemo, useState} from "react";
import { useParams} from "wouter";
import { useQueryClient} from "@tanstack/react-query";
import {
  useGetPortal,
  useListPortalMessages,
  useSendPortalMessage,
  useCreatePortalCheckin,
  useListPortalDocuments,
  useUploadPortalDocument,
  useListPortalPhotos,
  useUploadPortalPhoto,
  getListPortalPhotosQueryKey,
  useGetPortalW9,
  useSubmitPortalW9,
  useSetPortalPaymentMethod,
  getGetPortalQueryKey,
  getListPortalMessagesQueryKey,
  getListPortalDocumentsQueryKey,
  getGetPortalW9QueryKey,
  useRespondPortalOffer,
  useGetPortalWings,
  type W9Data,
  type PortalBundle,
  type PortalOffer,
} from "@workspace/api-client-react";
import { WingsGuideContent, LangToggle, type GuideLang} from "@/components/WingsGuideDialog";
import { useUpload} from "@workspace/object-storage-web";
import {
  Calendar,
  MessageSquare,
  MapPin,
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
  Phone,
  CheckSquare,
  Briefcase,
  AlertCircle,
  X,
  Home,
  Feather,
  ShieldCheck as ShieldIcon,
} from "lucide-react";
import { downloadW9Pdf} from "@/lib/w9pdf";
import WelcomeKitTab from "./WelcomeKitTab";

type Tab =
  | "offers"
  | "schedule"
  | "messages"
  | "photos"
  | "documents"
  | "checkin"
  | "pay"
  | "w9"
  | "wings"
  | "packets";

function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return`${d.getFullYear()}-${m}-${day}`;
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
  const d = new Date(iso.length <= 10 ?`${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
 });
}

export default function CrewPortal() {
  const { token} = useParams<{ token: string}>();
  const [tab, setTab] = useState<Tab>("schedule");

  const { data: portal, isLoading, isError} = useGetPortal(token);

  const pendingOffersCount = portal?.offers?.filter(o => o.status === "pending" && !o.filledByOther).length || 0;

  useEffect(() => {
    if (pendingOffersCount > 0 && tab !== "offers") {
      setTab("offers");
   }
 }, [pendingOffersCount]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--ink)]" />
      </div>
    );
 }

  if (isError || !portal) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
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

  const tabs: { key: Tab; label: string; icon: any; badge?: number}[] = [
    { key: "offers", label: "Offers", icon: Briefcase, badge: pendingOffersCount},
    { key: "schedule", label: "Schedule", icon: Calendar},
    { key: "packets", label: "Welcome Kit", icon: PackageCheck},
    { key: "messages", label: "Messages", icon: MessageSquare},
    { key: "checkin", label: "Check-in", icon: MapPin},
    { key: "photos", label: "Photos", icon: Camera},
    { key: "documents", label: "Docs", icon: FileText},
    { key: "pay", label: "Pay", icon: Wallet},
    { key: "w9", label: "W-9", icon: ClipboardCheck},
    { key: "wings", label: "Wings", icon: Feather},
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-[var(--ink)] text-white px-[18px] pt-[20px] pb-[16px]">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] text-[var(--gold-light)]">
          ArchAngel · HALO
        </div>
        <div className="font-display font-bold text-[22px] tracking-[-0.01em] mt-[3px]">
          {portal.crew.name}
        </div>
        <div className="text-[12.5px] text-white/60">
          {portal.crew.trade || "Crew portal"}
        </div>
      </header>

      <div className="sticky top-0 z-10 bg-background px-[12px] pt-[10px] pb-[8px] border-b border-border">
        <div className="flex gap-[4px] overflow-x-auto no-scrollbar">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-[5px] whitespace-nowrap rounded-full px-[12px] py-[8px] text-[12.5px] font-display font-bold transition-colors ${
                  tab === t.key
                    ? "bg-[var(--ink)] text-white"
                    : "bg-muted text-muted-foreground"
               }`}
              >
                <Icon className="w-[14px] h-[14px]" /> {t.label}
                {t.badge ? (
                  <span className="ml-[2px] bg-[var(--gold-light)] text-[var(--ink)] px-[5px] py-[1px] rounded-full text-[10px] font-bold">
                    {t.badge}
                  </span>
                ) : null}
              </button>
            );
         })}
        </div>
      </div>

      <main className="px-[14px] py-[16px] pb-[40px] max-w-[560px] mx-auto">
        {tab === "offers" && <OffersTab portal={portal} token={token} />}
        {tab === "schedule" && <ScheduleTab portal={portal} />}
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
        {tab === "wings" && <WingsTab token={token} />}
      </main>
    </div>
  );
}

const card = "bg-card rounded-[20px] border border-border shadow-sm p-[15px]";

const wingsMoney = (n: number) =>
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2});

const WINGS_TIER_STYLES: Record<string, string> = {
  TRAINING: "bg-slate-100 text-slate-700",
  BRONZE: "bg-orange-100 text-orange-800",
  SILVER: "bg-zinc-100 text-zinc-700",
  GOLD: "bg-amber-100 text-amber-800",
  PLATINUM: "bg-violet-100 text-violet-800",
};

function WingsTab({ token}: { token: string}) {
  const { data: wings, isLoading, isError} = useGetPortalWings(token);
  const [lang, setLang] = useState<GuideLang>("en");

  if (isLoading) {
    return (
      <div className="animate-in fade-in duration-200 grid place-items-center py-[40px]">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--gold)]" />
      </div>
    );
 }

  if (isError || !wings) {
    return (
      <div className="animate-in fade-in duration-200">
        <div className={`${card} text-center py-[40px]`}>
          <Feather className="w-[32px] h-[32px] text-muted-foreground mx-auto mb-[12px]" />
          <div className="font-display font-bold text-[17px]">Not in Founding Wings yet</div>
          <p className="text-[13px] text-muted-foreground mt-[4px]">
            When you're enrolled in the program, your Halo Score and earnings will show up here.
          </p>
        </div>
      </div>
    );
 }

  const tierCls = WINGS_TIER_STYLES[wings.tier] || "bg-muted text-muted-foreground";

  return (
    <div className="animate-in fade-in duration-200 flex flex-col gap-[12px]">
      {/* Score hero */}
      <div className="bg-[var(--ink)] text-white rounded-[20px] shadow-sm p-[15px] text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--gold-light)]">Your Halo Score</div>
        <div className="text-[56px] leading-none font-display font-bold text-white mt-[6px]">{Math.round(wings.haloScore)}</div>
        <div className="mt-[8px] flex items-center justify-center gap-[8px]">
          <span className={`px-[10px] py-[3px] rounded-full text-[11px] font-bold   ${tierCls}`}>{wings.tier}</span>
          <span className="text-[12px] text-white/60">Confidence {Math.round((wings.scoreConfidence ?? 0) * 100)}%</span>
        </div>
        {wings.scoreReasons && wings.scoreReasons.length > 0 && (
          <p className="text-[12px] text-white/60 mt-[10px]">{wings.scoreReasons.join(" · ")}</p>
        )}
      </div>

      {/* Founder banner */}
      {wings.founderStatus && wings.founderStatus !== "NONE" && (
        <div className="bg-[var(--gold-tint)] border border-[var(--gold-light)] text-[var(--gold-dark)] rounded-[16px] px-[16px] py-[12px] flex items-center gap-[10px]">
          <ShieldIcon className="w-[20px] h-[20px] shrink-0" />
          <div className="text-[13.5px] font-semibold">
            Founding member — {wings.founderStatus}{wings.founderNumber ?` #${wings.founderNumber}` : ""}
          </div>
        </div>
      )}

      {/* Sponsor */}
      {wings.sponsorName && (
        <div className={`${card}`}>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Your sponsor</div>
          <div className="text-[15px] font-semibold mt-[2px]">{wings.sponsorName}</div>
        </div>
      )}

      {/* Recruits */}
      <div className={`${card}`}>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-[8px]">Your recruits</div>
        {wings.recruits.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No recruits yet. Sponsor a crew to earn overrides on their jobs.</p>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {wings.recruits.map((r, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[14px] font-medium">{r.crewName}</span>
                <span className="flex items-center gap-[6px]">
                  <span className={`px-[8px] py-[2px] rounded-full text-[10px] font-bold  ${WINGS_TIER_STYLES[r.tier] || "bg-muted text-muted-foreground"}`}>{r.tier}</span>
                  <span className="text-[13px] font-semibold">{Math.round(r.haloScore)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Override earnings */}
      <div className={`${card}`}>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-[8px]">Your override earnings</div>
        {wings.overrides.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No overrides yet.</p>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {wings.overrides.map((o) => (
              <div key={o.id} className="border-b border-border/50 pb-[8px] last:border-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="text-[13.5px] font-semibold">{o.jobNo || "Job"}</span>
                  <span className="text-[10px] font-bold px-[8px] py-[2px] rounded-full bg-muted text-muted-foreground">{o.status}</span>
                </div>
                <div className="flex gap-[16px] text-[12px] text-muted-foreground mt-[3px]">
                  <span>Immediate <b className="text-foreground">{wingsMoney(o.immediateAmount)}</b></span>
                  <span>Reserve <b className="text-foreground">{wingsMoney(o.reserveAmount)}</b></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reserve totals */}
      <div className={`${card}`}>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-[8px]">Guardian Reserve</div>
        <div className="grid grid-cols-3 gap-[8px] text-center">
          <div>
            <div className="text-[18px] font-display font-bold text-[var(--ink)]">{wingsMoney(wings.reserve.held)}</div>
            <div className="text-[10px] text-muted-foreground">Held</div>
          </div>
          <div>
            <div className="text-[18px] font-display font-bold text-[var(--green,#2e7d32)]">{wingsMoney(wings.reserve.released)}</div>
            <div className="text-[10px] text-muted-foreground">Released</div>
          </div>
          <div>
            <div className="text-[18px] font-display font-bold text-muted-foreground">{wingsMoney(wings.reserve.debited)}</div>
            <div className="text-[10px] text-muted-foreground">Debited</div>
          </div>
        </div>
      </div>

      {/* Inline program guide */}
      <div className={`${card}`}>
        <div className="flex items-center justify-between mb-[10px]">
          <div className="flex items-center gap-[6px] font-display font-bold text-[15px]">
            <Feather className="w-[16px] h-[16px] text-[var(--gold)]" /> Program guide
          </div>
          <LangToggle lang={lang} onChange={setLang} />
        </div>
        <WingsGuideContent lang={lang} />
      </div>
    </div>
  );
}

function OffersTab({ portal, token}: { portal: PortalBundle; token: string}) {
  const queryClient = useQueryClient();
  const respond = useRespondPortalOffer();
  const [declineConfirmId, setDeclineConfirmId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<{ [id: string]: string}>({});
  const [errorMsg, setErrorMsg] = useState<{ [id: string]: string}>({});

  const offers = portal.offers || [];

  const handleRespond = (offerId: string, decision: "approved" | "declined") => {
    setErrorMsg((prev) => ({ ...prev, [offerId]: ""}));
    respond.mutate(
      { token, offerId, data: { decision}},
      {
        onSuccess: (res) => {
          if (decision === "approved") {
            setSuccessMsg((prev) => ({ ...prev, [offerId]: res.message ?? "You're on the schedule."}));
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
            className={`bg-card rounded-[20px] shadow-sm overflow-hidden border ${
              isPending
                ? "border-[var(--gold-light)]"
                : "border-border opacity-80"
           }`}
          >
            <div className={`px-[16px] py-[12px] flex items-start justify-between border-b ${
              isPending ? "bg-[var(--gold-tint)] border-[var(--gold-light)]" : "bg-muted border-border"
           }`}>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-[6px]">
                  {isPending && <span className="w-[8px] h-[8px] rounded-full bg-[var(--gold-light)]" />}
                  {o.jobNo} {o.category ?`· ${o.category}` : ""}
                </div>
                <div className="font-display font-bold text-[18px] mt-[2px] leading-tight">
                  {o.propertyName || "Assignment"}
                  {o.unitNo ?` · Unit ${o.unitNo}` : ""}
                </div>
              </div>
              <div className="text-right">
                {isPending && (
                  <div className="text-[11px] font-bold text-[var(--ink)] bg-[var(--gold-light)] px-[8px] py-[2px] rounded-full">
                    Action Needed
                  </div>
                )}
                {isFilled && (
                  <div className="text-[11px] font-bold text-muted-foreground bg-black/5 px-[8px] py-[2px] rounded-full">
                    Filled by another crew
                  </div>
                )}
                {o.status === "approved" && (
                  <div className="text-[11px] font-bold text-green-700 bg-green-50 px-[8px] py-[2px] rounded-full flex items-center gap-1">
                    <Check className="w-3 h-3" /> Accepted
                  </div>
                )}
                {o.status === "declined" && (
                  <div className="text-[11px] font-bold text-red-700 bg-red-50 px-[8px] py-[2px] rounded-full">
                    Declined
                  </div>
                )}
                {o.status === "withdrawn" && (
                  <div className="text-[11px] font-bold text-muted-foreground bg-black/5 px-[8px] py-[2px] rounded-full">
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
                    : "bg-[var(--gold-tint)] border-[var(--gold-light)] text-[var(--gold-dark)]"
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
                      <div className="text-[11px] font-bold text-muted-foreground">When needed</div>
                      <div className="text-[13px] font-semibold">{o.scheduleType === "flex" && o.flexDueBy ?`By ${formatDay(o.flexDueBy)}` : o.scheduledOn ? formatDay(o.scheduledOn) : "TBD"}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-[8px]">
                    <MapPin className="w-[16px] h-[16px] text-muted-foreground shrink-0 mt-[2px]" />
                    <div>
                      <div className="text-[11px] font-bold text-muted-foreground">Location</div>
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
                    <div className="text-[11px] font-bold text-muted-foreground">Unit(s) to work</div>
                    <div className="text-[13px] font-semibold">{o.unitNo ?`Unit ${o.unitNo}` : "See scope of work — ask the site contact if unsure"}</div>
                  </div>
                </div>

                {/* Scope */}
                {(o.description || (o.tasks && o.tasks.length > 0)) && (
                  <div className="mt-[4px] pt-[12px] border-t border-border">
                    <div className="text-[11px] font-bold text-muted-foreground mb-[6px]">Scope of work</div>
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
                    <div className="text-[11px] font-bold text-muted-foreground mb-[6px]">Reference Photos</div>
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
                     <div className="text-[11px] font-bold text-muted-foreground mb-[2px]">Site Contact</div>
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

function ScheduleTab({ portal}: { portal: PortalBundle}) {
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
                ?`${s.propertyName}${s.propertyCity ?`, ${s.propertyCity}` : ""}`
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
                    <span className="ml-auto text-[10px] font-bold px-[8px] py-[2px] rounded-full bg-[var(--gold-light)] text-[var(--ink)]">
                      Today
                    </span>
                  )}
                </div>
                <div className="font-semibold text-[14.5px]">
                  {s.propertyName || s.description || "Assignment"}
                  {s.unitNo ?` · Unit ${s.unitNo}` : ""}
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
                       `${s.propertyName}${s.propertyCity ?`, ${s.propertyCity}` : ""}`}
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
                    <div className="text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground mb-[6px]">
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

function MessagesTab({ token}: { token: string}) {
  const queryClient = useQueryClient();
  const { data: messages} = useListPortalMessages(token, {
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
      { token, data: { body}},
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
                    : "self-start bg-muted text-foreground rounded-bl-[4px]"
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

function CheckinTab({ token}: { token: string}) {
  const queryClient = useQueryClient();
  const checkin = useCreatePortalCheckin();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");

  const doCheckin = () => {
    setStatus(null);
    if (!navigator.geolocation) {
      setStatus("Location isn't available on this device.");
      return;
   }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        checkin.mutate(
          {
            token,
            data: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              label: label.trim() || null,
           },
         },
          {
            onSuccess: () => {
              setBusy(false);
              setLabel("");
              setStatus("Checked in! The office can see your location.");
              queryClient.invalidateQueries({
                queryKey: getGetPortalQueryKey(token),
             });
           },
            onError: () => {
              setBusy(false);
              setStatus("Couldn't save your check-in. Try again.");
           },
         },
        );
     },
      () => {
        setBusy(false);
        setStatus("Location permission was denied.");
     },
      { enableHighAccuracy: true, timeout: 15000},
    );
 };

  return (
    <div className="animate-in fade-in duration-200">
      <div className={card}>
        <div className="grid place-items-center py-[10px]">
          <div className="w-[68px] h-[68px] rounded-full bg-[var(--gold-tint)] grid place-items-center mb-[14px]">
            <MapPin className="w-[30px] h-[30px] text-[var(--ink)]" />
          </div>
          <div className="font-display font-bold text-[17px]">Live GPS check-in</div>
          <p className="text-[12.5px] text-muted-foreground text-center mt-[4px] mb-[16px] max-w-[300px]">
            Tap below to share your current location with the office when you
            arrive on site.
          </p>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional note (e.g. Arrived on site)"
            className="w-full rounded-[12px] border border-border bg-background px-[13px] py-[11px] text-[14px] mb-[10px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
          />
          <button
            onClick={doCheckin}
            disabled={busy}
            className="w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] disabled:opacity-60 transition-transform active:scale-[0.98]"
          >
            {busy ? (
              <>
                <Loader2 className="w-[18px] h-[18px] animate-spin" /> Getting location…
              </>
            ) : (
              <>
                <MapPin className="w-[18px] h-[18px]" /> Check in now
              </>
            )}
          </button>
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

function PhotosTab({ token}: { token: string}) {
  const queryClient = useQueryClient();
  const { data: photos} = useListPortalPhotos(token, {
    query: { queryKey: getListPortalPhotosQueryKey(token)},
 });
  const sendPhoto = useUploadPortalPhoto();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { uploadFile} = useUpload({
    onError: () =>
      setUploadError("Upload failed. Check your connection and try again."),
 });

  const onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setSending(true);
    setUploadError(null);
    try {
      for (const file of files) {
        const res = await uploadFile(file);
        if (!res) return;
        await sendPhoto.mutateAsync({
          token,
          data: { storagePath: res.objectPath, takenOn: localToday()},
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

  return (
    <div className="animate-in fade-in duration-200">
      <label className="w-full mb-[14px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] cursor-pointer transition-transform active:scale-[0.98]">
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
        <div className="grid grid-cols-3 gap-[6px]">
          {photos.map((p) => (
            <a
              key={p.id}
              href={`/api/storage${p.storagePath}`}
              target="_blank"
              rel="noreferrer"
              className="block aspect-square rounded-[10px] overflow-hidden bg-[var(--paper)] border border-border"
            >
              <img
                src={`/api/storage${p.storagePath}`}
                alt={p.note || "Crew photo"}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentsTab({ token}: { token: string}) {
  const queryClient = useQueryClient();
  const { data: documents} = useListPortalDocuments(token);
  const upload = useUploadPortalDocument();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { uploadFile, isUploading} = useUpload({
    onSuccess: async (res) => {
      try {
        await upload.mutateAsync({
          token,
          data: {
            name: res.metadata.name,
            storagePath: res.objectPath,
            contentType: res.metadata.contentType,
            size: res.metadata.size,
         },
       });
        setUploadError(null);
        queryClient.invalidateQueries({
          queryKey: getListPortalDocumentsQueryKey(token),
       });
     } catch {
        setUploadError("Your file uploaded but we couldn't save it. Please try again.");
     }
   },
    onError: () => setUploadError("Upload failed. Check your connection and try again."),
 });

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
 };

  return (
    <div className="animate-in fade-in duration-200">
      <label className="w-full mb-[14px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] cursor-pointer transition-transform active:scale-[0.98]">
        <FileUp className="w-[18px] h-[18px]" />
        {isUploading ? "Uploading…" : "Upload a document"}
        <input
          type="file"
          className="hidden"
          onChange={onFilePicked}
          disabled={isUploading}
        />
      </label>
      {uploadError && (
        <div className="text-[12.5px] text-[var(--red,#be3c3c)] bg-[rgba(190,60,60,0.08)] rounded-[11px] px-[12px] py-[9px] mb-[14px]">
          {uploadError}
        </div>
      )}
      {!documents || documents.length === 0 ? (
        <div className={`${card} text-center text-[13px] text-muted-foreground py-[26px]`}>
          No documents yet.
        </div>
      ) : (
        <div className={card}>
          {documents.map((d, idx) => {
            const url =`/api/storage${d.storagePath}`;
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
          className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] disabled:opacity-60 transition-transform active:scale-[0.98]"
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
  { key: "individual", label: "Individual / sole proprietor"},
  { key: "c_corp", label: "C Corporation"},
  { key: "s_corp", label: "S Corporation"},
  { key: "partnership", label: "Partnership"},
  { key: "trust_estate", label: "Trust / estate"},
  { key: "llc", label: "LLC"},
  { key: "other", label: "Other"},
];

function W9Tab({ token}: { token: string}) {
  const queryClient = useQueryClient();
  const { data: w9, isLoading} = useGetPortalW9(token);
  const submit = useSubmitPortalW9();
  const [form, setForm] = useState<W9Data>({});
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (w9?.data) setForm(w9.data);
 }, [w9?.data]);

  const set = (k: keyof W9Data, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v}));

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
          signedDate: form.signedDate || localToday(),
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
            onClick={() => downloadW9Pdf({ ...w9.data, ...form})}
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
        className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] disabled:opacity-60 transition-transform active:scale-[0.98]"
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
