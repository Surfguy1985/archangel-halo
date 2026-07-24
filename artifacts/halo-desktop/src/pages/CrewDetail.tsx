import { useMemo, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCrewDetail,
  useGenerateCrewPortalLink,
  useListCrewMessages,
  useSendCrewMessage,
  useListCrewCheckins,
  useListCrewDocuments,
  useSendCrewDocument,
  useListPacketTemplates,
  useListCrewPackets,
  useSendCrewPacket,
  getGetCrewDetailQueryKey,
  getListCrewMessagesQueryKey,
  getListCrewCheckinsQueryKey,
  getListCrewDocumentsQueryKey,
  getListCrewPacketsQueryKey,
  useReverseGeocode,
  getReverseGeocodeQueryKey,
  useListCrewPhotos,
  getListCrewPhotosQueryKey,
  useCreatePhotoShare,
  useUpdatePhotoShareNotes,
  useListCrewInvoices,
  getListCrewInvoicesQueryKey,
  useReviewCrewInvoice,
  type CrewPhoto,
  type CrewInvoice,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import {
  ChevronLeft,
  FileDown,
  Link2,
  Copy,
  BookOpen,
  Check,
  Send,
  MapPin,
  FileUp,
  FileText,
  Wallet,
  ClipboardCheck,
  Download,
  PackageCheck,
  Pencil,
  Mail,
  Phone,
  Camera,
  Share2,
  Receipt,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadW9Pdf } from "@/lib/w9pdf";
import { EditCrewDialog } from "@/components/CrewDialogs";

function paymentTermsLabel(v?: string | null): string {
  switch (v) {
    case "due_on_receipt": return "Due on receipt";
    case "net15": return "Net 15";
    case "net30": return "Net 30";
    case "net45": return "Net 45";
    default: return "Not set";
  }
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

const sectionTitle =
  "font-display font-semibold text-xs tracking-wider uppercase text-muted-foreground mb-4 flex items-center gap-2";

function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CrewDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: crew, isLoading } = useGetCrewDetail(id);
  const { data: messages } = useListCrewMessages(id, {
    query: { queryKey: getListCrewMessagesQueryKey(id), refetchInterval: 8000 },
  });
  const { data: checkins } = useListCrewCheckins(id, {
    query: { queryKey: getListCrewCheckinsQueryKey(id), refetchInterval: 8000 },
  });
  const { data: documents } = useListCrewDocuments(id, {
    query: { queryKey: getListCrewDocumentsQueryKey(id), refetchInterval: 8000 },
  });
  const { data: crewInvoices } = useListCrewInvoices(id, {
    query: { queryKey: getListCrewInvoicesQueryKey(id), refetchInterval: 8000 },
  });
  const { data: packetTemplates } = useListPacketTemplates();
  const { data: packets } = useListCrewPackets(id, {
    query: { queryKey: getListCrewPacketsQueryKey(id), refetchInterval: 8000 },
  });

  const genLink = useGenerateCrewPortalLink();
  const sendMessage = useSendCrewMessage();
  const sendDocument = useSendCrewDocument();
  const sendPacket = useSendCrewPacket();

  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedGuide, setCopiedGuide] = useState<"en" | "es" | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [, navigate] = useLocation();
  const [templateKey, setTemplateKey] = useState("");

  const { uploadFile, isUploading } = useUpload({
    onSuccess: async (res) => {
      try {
        await sendDocument.mutateAsync({
          id,
          data: {
            name: res.metadata.name,
            storagePath: res.objectPath,
            contentType: res.metadata.contentType,
            size: res.metadata.size,
          },
        });
        queryClient.invalidateQueries({ queryKey: getListCrewDocumentsQueryKey(id) });
        toast({ title: "Document sent to crew" });
      } catch (e) {
        toast({
          title: "Couldn't send document",
          description: e instanceof Error ? e.message : "The file uploaded but saving failed. Try again.",
          variant: "destructive",
        });
      }
    },
    onError: (e) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !crew) {
    return (
      <div className="p-8 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const portalToken = crew.portalToken;
  // Always share the mobile-friendly portal (served at the site root) — crews open this on their phones.
  const portalUrl = portalToken
    ? `${window.location.origin}/portal/${portalToken}`
    : null;

  const handleGenerate = () =>
    genLink.mutate(
      { id },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCrewDetailQueryKey(id) }) },
    );

  const handleCopy = async () => {
    if (!portalUrl) return;
    await navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    toast({ title: "Live link copied", description: "Send it to the crew manually." });
    setTimeout(() => setCopied(false), 1800);
  };

  const copyGuideLink = async (lang: "en" | "es") => {
    if (!portalUrl) return;
    await navigator.clipboard.writeText(`${portalUrl}?guide=${lang}`);
    setCopiedGuide(lang);
    toast({
      title: lang === "es" ? "Enlace de la guía copiado" : "Guide link copied",
      description:
        lang === "es"
          ? "Abre el portal del equipo en la guía en español."
          : "Opens the crew's portal on the English how-to guide.",
    });
    setTimeout(() => setCopiedGuide(null), 1800);
  };

  const handleSend = () => {
    const body = draft.trim();
    if (!body) return;
    sendMessage.mutate(
      { id, data: { body } },
      {
        onSuccess: () => {
          setDraft("");
          queryClient.invalidateQueries({ queryKey: getListCrewMessagesQueryKey(id) });
        },
      },
    );
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const handleSendPacket = () => {
    if (!templateKey) return;
    sendPacket.mutate(
      { id, data: { templateKey } },
      {
        onSuccess: () => {
          setTemplateKey("");
          queryClient.invalidateQueries({ queryKey: getListCrewPacketsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListCrewMessagesQueryKey(id) });
          toast({ title: "Packet sent", description: "The crew can now complete it in their portal." });
        },
        onError: (e) => toast({ title: "Couldn't send packet", description: e.message, variant: "destructive" }),
      },
    );
  };

  const packetLabel = (key: string) => packetTemplates?.find((t) => t.key === key)?.label ?? key;
  const card = "bg-card rounded-xl shadow-sm border border-border p-6";
  const goldBtn =
    "flex items-center justify-center gap-2 rounded-md py-2.5 px-4 text-sm font-display font-bold text-black bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] transition-colors disabled:opacity-50";

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link href="/crews" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ChevronLeft className="w-4 h-4" /> Crews
      </Link>

      <header className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-[var(--ink)] text-[var(--gold-light)] font-display font-bold text-2xl grid place-items-center shrink-0 overflow-hidden">
          {crew.selfiePath ? (
            <img
              src={`/api/storage${crew.selfiePath}`}
              alt={crew.name}
              className="w-full h-full object-cover"
            />
          ) : (
            crew.name.substring(0, 1)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display font-bold text-3xl tracking-tight text-[var(--ink)] truncate">{crew.name}</h1>
          <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
            <span>{crew.trade || "General"}</span>
            {crew.phone && (
              <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {crew.phone}</span>
            )}
            {crew.email && (
              <span className="inline-flex items-center gap-1 truncate"><Mail className="w-3.5 h-3.5" /> {crew.email}</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-2 rounded-md py-2 px-4 text-sm font-display font-semibold text-muted-foreground bg-black/5 hover:bg-black/10 transition-colors shrink-0"
        >
          <Pencil className="w-4 h-4" /> Edit
        </button>
      </header>

      <EditCrewDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        crew={crew}
        onDeleted={() => navigate("/crews")}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live portal link */}
        <div className={card}>
          <div className={sectionTitle}><Link2 className="w-3.5 h-3.5" /> Live portal link</div>
          {portalUrl ? (
            <>
              <div className="text-xs font-mono bg-black/5 rounded-md px-3 py-2.5 break-all mb-3">{portalUrl}</div>
              <button onClick={handleCopy} className="w-full flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-display font-semibold text-muted-foreground bg-black/5 hover:bg-black/10 transition-colors">
                {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy live link</>}
              </button>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  onClick={() => copyGuideLink("en")}
                  data-testid="button-copy-guide-en"
                  className="flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-display font-semibold text-muted-foreground bg-black/5 hover:bg-black/10 transition-colors"
                >
                  {copiedGuide === "en" ? <><Check className="w-4 h-4" /> Copied</> : <><BookOpen className="w-4 h-4" /> Guide link (English)</>}
                </button>
                <button
                  onClick={() => copyGuideLink("es")}
                  data-testid="button-copy-guide-es"
                  className="flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-display font-semibold text-muted-foreground bg-black/5 hover:bg-black/10 transition-colors"
                >
                  {copiedGuide === "es" ? <><Check className="w-4 h-4" /> Copiado</> : <><BookOpen className="w-4 h-4" /> Guía (Español)</>}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed">Anyone with this link can open the crew's onboarding portal. The guide links open the same portal on its how-to guide, in English or Spanish — send whichever your crew prefers.</p>
            </>
          ) : (
            <button onClick={handleGenerate} disabled={genLink.isPending} className={`w-full ${goldBtn}`}>
              <Link2 className="w-4 h-4" /> Generate live link
            </button>
          )}
        </div>

        {/* Onboarding welcome kit */}
        <div className={card}>
          <div className={sectionTitle}><PackageCheck className="w-3.5 h-3.5" /> Onboarding Welcome Kit</div>
          <div className="flex flex-col gap-2">
            <select
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Choose a packet to send…</option>
              {(packetTemplates ?? []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <button onClick={handleSendPacket} disabled={!templateKey || sendPacket.isPending} className={`w-full ${goldBtn}`}>
              <Send className="w-4 h-4" /> {sendPacket.isPending ? "Sending…" : "Send packet to crew"}
            </button>
          </div>
          {packets && packets.length > 0 && (
            <div className="flex flex-col mt-4 divide-y divide-border">
              {packets.map((p) => {
                const submitted = p.status === "submitted";
                const label = submitted ? "Completed" : p.status === "in_progress" ? "In progress" : "Sent";
                return (
                  <div key={p.id} className="flex items-center gap-3 py-3">
                    <PackageCheck className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{packetLabel(p.templateKey)}</div>
                      <div className="text-xs text-muted-foreground">
                        {submitted ? `Submitted ${formatWhen(p.submittedAt)}` : `Sent ${formatWhen(p.sentAt)}`}
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${submitted ? "bg-emerald-100 text-emerald-800" : p.status === "in_progress" ? "bg-[var(--gold-tint)] text-[var(--gold-dark)]" : "bg-black/5 text-muted-foreground"}`}>{label}</span>
                    {submitted && (
                      <a href={`/api/packets/${p.id}/pdf`} download className="shrink-0 w-8 h-8 grid place-items-center rounded-full bg-[var(--paper)] border border-border text-muted-foreground hover:text-foreground" aria-label="Download packet PDF">
                        <Download className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className={card}>
          <div className={sectionTitle}><Send className="w-3.5 h-3.5" /> Messages</div>
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto mb-3">
            {!messages || messages.length === 0 ? (
              <div className="text-sm text-muted-foreground py-3 text-center">No messages yet.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`max-w-[82%] rounded-xl px-3 py-2 text-sm leading-relaxed ${m.sender === "admin" ? "self-end bg-[var(--ink)] text-white rounded-br-sm" : "self-start bg-black/5 text-foreground rounded-bl-sm"}`}>
                  <div>{m.body}</div>
                  <div className={`text-[10px] mt-1 ${m.sender === "admin" ? "text-white/60" : "text-muted-foreground"}`}>{formatWhen(m.createdAt)}</div>
                </div>
              ))
            )}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message the crew…"
              rows={1}
              className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button onClick={handleSend} disabled={sendMessage.isPending || !draft.trim()} aria-label="Send message" className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-[var(--ink)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Invoices from crew */}
        <div className={card}>
          <div className={sectionTitle}><Receipt className="w-3.5 h-3.5" /> Invoices from crew</div>
          <CrewInvoicesReview crewId={id} invoices={crewInvoices} />
        </div>

        {/* Documents */}
        <div className={card}>
          <div className={sectionTitle}><FileText className="w-3.5 h-3.5" /> Documents</div>
          <label className="w-full mb-3 flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-display font-bold bg-card border border-border shadow-sm cursor-pointer hover:bg-black/[0.03] transition-colors">
            <FileUp className="w-4 h-4" />
            {isUploading ? "Uploading…" : "Send document to crew"}
            <input type="file" className="hidden" onChange={onFilePicked} disabled={isUploading} />
          </label>
          {!documents || documents.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2 text-center">No documents yet.</div>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {documents.map((d) => {
                const url = `/api/storage${d.storagePath}`;
                return (
                  <div key={d.id} className="flex items-center gap-3 py-3">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <a href={url} target="_blank" rel="noreferrer" className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{d.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.direction === "from_crew" ? "From crew" : "Sent to crew"} · {formatWhen(d.createdAt)}
                      </div>
                    </a>
                    {d.direction === "from_crew" && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 shrink-0">New</span>
                    )}
                    <a href={url} download={d.name} className="shrink-0 w-8 h-8 grid place-items-center rounded-full bg-[var(--paper)] border border-border text-muted-foreground hover:text-foreground" aria-label={`Download ${d.name}`}>
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Check-ins */}
        <div className={card}>
          <div className={sectionTitle}><MapPin className="w-3.5 h-3.5" /> GPS check-ins</div>
          {!checkins || checkins.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2 text-center">No check-ins yet.</div>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {checkins.map((c) => (
                <CheckinRow key={c.id} checkin={c} />
              ))}
            </div>
          )}
        </div>

        {/* Daily activity */}
        <DailyActivitySection crewId={id} crewName={crew.name} />

        {/* Terms & money */}
        <div className={card}>
          <div className={sectionTitle}><Wallet className="w-3.5 h-3.5" /> Terms & money</div>
          <div className="flex gap-3 mb-4">
            <div className="flex-1 rounded-lg bg-emerald-50 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Paid</div>
              <div className="font-display font-bold text-lg tabular-nums text-emerald-700">
                ${(crew.paidTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="flex-1 rounded-lg bg-amber-50 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Outstanding</div>
              <div className="font-display font-bold text-lg tabular-nums text-amber-700">
                ${(crew.outstandingTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
          <div className="text-sm mb-3">
            <span className="text-muted-foreground">Payment terms: </span>
            <span className="font-semibold">{paymentTermsLabel(crew.paymentTerms)}</span>
          </div>
          {crew.services && crew.services.length > 0 ? (
            <div className="rounded-lg bg-[var(--paper)] overflow-hidden">
              {crew.services.map((s, i) => (
                <div key={i} className={`flex items-center justify-between px-3 py-2 text-sm ${i > 0 ? "border-t border-black/5" : ""}`}>
                  <span className="font-semibold">{s.name}</span>
                  <span className="font-mono font-semibold">{s.rate != null ? `$${s.rate.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No services on file. Add them from Edit.</div>
          )}
        </div>

        {/* Payment method */}
        <div className={card}>
          <div className={sectionTitle}><Wallet className="w-3.5 h-3.5" /> Preferred payment</div>
          {crew.preferredPaymentMethod ? (
            <div>
              <div className="text-sm font-semibold">{crew.preferredPaymentMethod}</div>
              {crew.paymentDetails && <div className="text-sm text-muted-foreground mt-1 break-words">{crew.paymentDetails}</div>}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Crew hasn't set a payment method yet.</div>
          )}
        </div>

        {/* W-9 */}
        <div className={`${card} lg:col-span-2`}>
          <div className={sectionTitle}><ClipboardCheck className="w-3.5 h-3.5" /> IRS Form W-9</div>
          {crew.w9Submitted && crew.w9 ? (
            <div className="text-sm">
              <div className="flex items-center gap-2 text-emerald-700 mb-3">
                <Check className="w-4 h-4" />
                <span className="font-semibold">Submitted {formatWhen(crew.w9SubmittedAt)}</span>
              </div>
              <W9Readout data={crew.w9 as Record<string, unknown>} />
              <button onClick={() => downloadW9Pdf(crew.w9 as Record<string, unknown>, crew.name)} className="mt-4 flex items-center justify-center gap-2 rounded-md py-2.5 px-4 text-sm font-display font-bold bg-card border border-border shadow-sm hover:bg-black/[0.03] transition-colors">
                <Download className="w-4 h-4" /> Download W-9 (PDF)
              </button>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Crew hasn't submitted a W-9 yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatCheckinWhen(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

const THUMB_W = 88;
const THUMB_H = 64;
const TILE = 256;
const MAP_ZOOM = 15;

function MapThumb({ lat, lng }: { lat: number; lng: number }) {
  const n = 2 ** MAP_ZOOM;
  const xF = ((lng + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const yF =
    ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const xTile = Math.floor(xF);
  const yTile = Math.floor(yF);
  const clamp = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, v));
  const left = clamp((xF - xTile) * TILE - THUMB_W / 2, 0, TILE - THUMB_W);
  const top = clamp((yF - yTile) * TILE - THUMB_H / 2, 0, TILE - THUMB_H);
  return (
    <div
      className="relative overflow-hidden rounded-md border border-border shrink-0 bg-muted"
      style={{ width: THUMB_W, height: THUMB_H }}
    >
      <img
        src={`https://tile.openstreetmap.org/${MAP_ZOOM}/${xTile}/${yTile}.png`}
        alt="Check-in location map"
        width={TILE}
        height={TILE}
        loading="lazy"
        className="absolute max-w-none"
        style={{ left: -left, top: -top }}
      />
      <MapPin
        className="absolute w-4 h-4 text-red-600 drop-shadow"
        style={{
          left: (xF - xTile) * TILE - left - 8,
          top: (yF - yTile) * TILE - top - 16,
        }}
      />
    </div>
  );
}

type CheckinItem = {
  id: string;
  label?: string | null;
  lat?: number | null;
  lng?: number | null;
  createdAt?: string | null;
};

function CheckinRow({ checkin: c }: { checkin: CheckinItem }) {
  const hasCoords = c.lat != null && c.lng != null;
  const params = { lat: c.lat ?? 0, lng: c.lng ?? 0 };
  const { data: geo } = useReverseGeocode(params, {
    query: {
      queryKey: getReverseGeocodeQueryKey(params),
      enabled: hasCoords,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    },
  });
  return (
    <div className="flex items-center gap-3 py-3">
      {hasCoords ? (
        <MapThumb lat={c.lat!} lng={c.lng!} />
      ) : (
        <MapPin className="w-4 h-4 text-[var(--gold)] shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{c.label || "Check-in"}</div>
        <div className="text-xs font-medium text-foreground/80">
          {formatCheckinWhen(c.createdAt)}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {hasCoords ? `${c.lat!.toFixed(5)}, ${c.lng!.toFixed(5)}` : "No coordinates"}
        </div>
        {hasCoords && geo?.address && (
          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {geo.address}
          </div>
        )}
      </div>
    </div>
  );
}

function W9Readout({ data }: { data: Record<string, unknown> }) {
  const rows: [string, string][] = [];
  const push = (label: string, key: string) => {
    const v = data[key];
    if (v != null && v !== "") rows.push([label, String(v)]);
  };
  push("Name", "name");
  push("Business name", "businessName");
  push("Tax classification", "taxClassification");
  push("Address", "address");
  push("City", "city");
  push("State", "state");
  push("ZIP", "zip");
  if (data.tinType === "ein") push("EIN", "ein");
  else push("SSN", "ssn");
  push("Signature", "signature");
  push("Signed", "signedDate");
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-3 text-sm">
          <span className="text-muted-foreground w-28 shrink-0">{label}</span>
          <span className="font-medium break-words">{value}</span>
        </div>
      ))}
    </div>
  );
}

function DailyActivitySection({
  crewId,
  crewName,
}: {
  crewId: string;
  crewName: string;
}) {
  const { toast } = useToast();
  const { data: photos } = useListCrewPhotos(crewId, {
    query: {
      queryKey: getListCrewPhotosQueryKey(crewId),
      refetchInterval: 8000,
    },
  });
  const createShare = useCreatePhotoShare();
  const updateNotes = useUpdatePhotoShareNotes();
  const [sharingDay, setSharingDay] = useState<string | null>(null);
  const [reportDay, setReportDay] = useState<string | null>(null);
  const [reportToken, setReportToken] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");

  const jobGroups = useMemo(() => {
    const map = new Map<
      string,
      { label: string; days: Map<string, CrewPhoto[]> }
    >();
    for (const p of photos ?? []) {
      const key = p.jobId ?? "none";
      const g = map.get(key) ?? {
        label: p.jobLabel ?? (p.jobId ? "Job" : "General photos"),
        days: new Map<string, CrewPhoto[]>(),
      };
      const arr = g.days.get(p.takenOn) ?? [];
      arr.push(p);
      g.days.set(p.takenOn, arr);
      map.set(key, g);
    }
    return Array.from(map.entries())
      .sort((a, b) => {
        if (a[0] === "none") return 1;
        if (b[0] === "none") return -1;
        return 0;
      })
      .map(([key, g]) => ({
        key,
        label: g.label,
        count: Array.from(g.days.values()).reduce((n, arr) => n + arr.length, 0),
        days: Array.from(g.days.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1)),
      }));
  }, [photos]);

  const onShare = async (day: string) => {
    setSharingDay(day);
    try {
      const res = await createShare.mutateAsync({ id: crewId, data: { day } });
      const url = `${window.location.origin}/photos/${res.token}`;
      const message = `Photos from ${crewName} — ${formatDayLabel(day)}: ${url}`;
      try {
        await navigator.clipboard.writeText(url);
        toast({
          title: "Share link copied",
          description: "Opening Messages with a prefilled text…",
        });
      } catch {
        toast({ title: "Share link ready", description: url });
      }
      window.location.href = `sms:?&body=${encodeURIComponent(message)}`;
    } catch {
      toast({
        title: "Couldn't create share link",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSharingDay(null);
    }
  };

  const onToggleReport = async (day: string) => {
    if (reportDay === day) {
      setReportDay(null);
      setReportToken(null);
      return;
    }
    try {
      const res = await createShare.mutateAsync({ id: crewId, data: { day } });
      setReportDay(day);
      setReportToken(res.token);
      setNotesDraft(res.notes ?? "");
    } catch {
      toast({
        title: "Couldn't prepare the report",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const onSaveNotes = async () => {
    if (!reportDay) return;
    try {
      await updateNotes.mutateAsync({
        id: crewId,
        data: { day: reportDay, notes: notesDraft },
      });
      toast({ title: "Notes saved", description: "They'll appear in the report PDF." });
    } catch {
      toast({
        title: "Couldn't save notes",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="bg-card rounded-xl shadow-sm border border-border p-6">
      <div className={sectionTitle}>
        <Camera className="w-3.5 h-3.5" /> Daily activity
      </div>
      {jobGroups.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2 text-center">
          No photos yet. Photos the crew sends from their portal show up here.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {jobGroups.map((jg) => (
            <div key={jg.key}>
              <div className="text-sm font-display font-bold mb-2.5">
                {jg.label}
                <span className="text-muted-foreground font-normal font-sans">
                  {" "}
                  · {jg.count} photo{jg.count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex flex-col gap-4">
                {jg.days.map(([day, dayPhotos]) => (
                  <div key={`${jg.key}-${day}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold text-muted-foreground">
                        {formatDayLabel(day)}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onShare(day)}
                          disabled={sharingDay === day}
                          className="flex items-center gap-1.5 text-xs font-bold rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-[var(--paper)] transition-colors disabled:opacity-60"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          {sharingDay === day ? "Preparing…" : "Share link to photos"}
                        </button>
                        <button
                          onClick={() => onToggleReport(day)}
                          disabled={createShare.isPending && reportDay !== day}
                          className={`flex items-center gap-1.5 text-xs font-bold rounded-full px-3 py-1.5 transition-colors disabled:opacity-60 ${
                            reportDay === day
                              ? "bg-[var(--ink)] text-white"
                              : "border border-border text-foreground hover:bg-[var(--paper)]"
                          }`}
                        >
                          <FileDown className="w-3.5 h-3.5" />
                          Full report
                        </button>
                      </div>
                    </div>
                    {reportDay === day && reportToken && (
                      <div className="mb-3 rounded-lg border border-border bg-[var(--paper)] p-3">
                        <div className="text-[11px] font-display font-bold tracking-[0.1em] uppercase text-muted-foreground mb-1.5">
                          Notes for the report
                        </div>
                        <textarea
                          value={notesDraft}
                          onChange={(e) => setNotesDraft(e.target.value)}
                          rows={3}
                          placeholder="Anything the property manager should know — scope notes, follow-ups, scheduling…"
                          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm resize-y outline-none focus:border-[var(--gold)]"
                        />
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={onSaveNotes}
                            disabled={updateNotes.isPending}
                            className="text-xs font-bold rounded-full border border-border px-3.5 py-1.5 text-foreground hover:bg-card transition-colors disabled:opacity-60"
                          >
                            {updateNotes.isPending ? "Saving…" : "Save notes"}
                          </button>
                          <a
                            href={`/api/photo-shares/${reportToken}/report`}
                            className="flex items-center gap-1.5 text-xs font-bold rounded-full px-3.5 py-1.5 text-[var(--ink)] bg-[var(--primary)] hover:opacity-90 transition-opacity"
                          >
                            <FileDown className="w-3.5 h-3.5" /> Download PDF
                          </a>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-4 gap-2">
                      {dayPhotos.map((p) => (
                        <a
                          key={p.id}
                          href={`/api/storage${p.storagePath}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block aspect-square rounded-lg overflow-hidden bg-[var(--paper)] border border-border"
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
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const invoiceStatusChip = (s: string) =>
  ((
    {
      submitted: "bg-blue-100 text-blue-800",
      approved: "bg-emerald-100 text-emerald-700",
      paid: "bg-emerald-100 text-emerald-700",
      needs_corrections: "bg-amber-100 text-amber-800",
    } as Record<string, string>
  )[s] ?? "bg-muted text-muted-foreground");

function CrewInvoicesReview({
  crewId,
  invoices,
}: {
  crewId: string;
  invoices: CrewInvoice[] | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const review = useReviewCrewInvoice();
  const [openId, setOpenId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const all = invoices ?? [];
  const active = all.filter((i) => !i.clearedAt);
  const history = all.filter((i) => i.clearedAt);

  const act = async (
    invId: string,
    action: "approve" | "send_back" | "mark_paid" | "clear",
    n?: string,
  ) => {
    try {
      await review.mutateAsync({ id: invId, data: { action, note: n ?? null } });
      queryClient.invalidateQueries({ queryKey: getListCrewInvoicesQueryKey(crewId) });
      setNoteFor(null);
      setNote("");
      toast({
        title:
          action === "approve"
            ? "Invoice approved"
            : action === "send_back"
              ? "Sent back for corrections"
              : action === "mark_paid"
                ? "Invoice marked paid"
                : "Invoice cleared to history",
      });
    } catch (e) {
      const err = e as { data?: { error?: string } };
      toast({
        title: "Couldn't update invoice",
        description: err.data?.error ?? "Please try again",
        variant: "destructive",
      });
    }
  };

  const renderRow = (inv: CrewInvoice, cleared: boolean) => {
    const isOpen = openId === inv.id;
    return (
      <div key={inv.id} className="py-3">
        <button
          type="button"
          onClick={() => setOpenId(isOpen ? null : inv.id)}
          className="w-full flex items-center justify-between gap-3 text-left"
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {inv.invoiceNo ? `#${inv.invoiceNo} · ` : ""}
              {inv.propertyAddress}
            </div>
            <div className="text-xs text-muted-foreground">
              {inv.fromCompany} · {formatWhen(inv.createdAt)}
              {inv.terms ? ` · ${inv.terms}` : ""}
              {inv.dueDate ? ` · Due ${inv.dueDate}` : ""}
              {inv.jobLabel ? ` · ${inv.jobLabel}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-bold tabular-nums">
              ${inv.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${invoiceStatusChip(inv.status)}`}
            >
              {inv.status.replace(/_/g, " ")}
            </span>
          </div>
        </button>
        {isOpen && (
          <div className="mt-2">
            <div className="flex flex-col gap-1">
              {inv.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">
                    {it.dateOfWork}
                    {it.unitNo ? ` · Unit ${it.unitNo}` : ""} · {it.typeOfWork}
                  </span>
                  <span className="tabular-nums shrink-0 ml-2">
                    {it.qty} × ${it.unitPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} = $
                    {it.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground italic">
              Signed by {inv.signatureName}
              {inv.signedAt ? ` on ${formatWhen(inv.signedAt)}` : ""}
            </div>
            {inv.status === "needs_corrections" && inv.adminNote && (
              <div className="mt-2 text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-1.5">
                Sent back: {inv.adminNote}
              </div>
            )}
            {!cleared && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(inv.status === "submitted" || inv.status === "needs_corrections") && (
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => act(inv.id, "approve")}
                    className="px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    Approve
                  </button>
                )}
                {inv.status === "submitted" && (
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => {
                      setNoteFor(noteFor === inv.id ? null : inv.id);
                      setNote("");
                    }}
                    className="px-3 py-1.5 rounded-md text-xs font-bold bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                  >
                    Send back for corrections
                  </button>
                )}
                {inv.status === "approved" && (
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => act(inv.id, "mark_paid")}
                    className="px-3 py-1.5 rounded-md text-xs font-bold bg-[var(--ink)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    Mark paid
                  </button>
                )}
                {inv.status !== "submitted" && (
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => act(inv.id, "clear")}
                    className="px-3 py-1.5 rounded-md text-xs font-bold bg-black/5 text-foreground hover:bg-black/10 disabled:opacity-50 transition-colors"
                  >
                    Clear to history
                  </button>
                )}
              </div>
            )}
            {!cleared && noteFor === inv.id && (
              <div className="mt-2 flex items-end gap-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What should the crew fix?"
                  rows={2}
                  className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  disabled={review.isPending || !note.trim()}
                  onClick={() => act(inv.id, "send_back", note.trim())}
                  className="px-3 py-2 rounded-md text-xs font-bold bg-amber-600 text-white disabled:opacity-40 hover:bg-amber-700 transition-colors"
                >
                  Send back
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (all.length === 0) {
    return <div className="text-sm text-muted-foreground py-2 text-center">No invoices submitted yet.</div>;
  }

  return (
    <div>
      {active.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2 text-center">No open invoices.</div>
      ) : (
        <div className="flex flex-col divide-y divide-border">{active.map((inv) => renderRow(inv, false))}</div>
      )}
      {history.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            {showHistory ? "Hide" : "Show"} history ({history.length})
          </button>
          {showHistory && (
            <div className="flex flex-col divide-y divide-border opacity-70">
              {history.map((inv) => renderRow(inv, true))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
