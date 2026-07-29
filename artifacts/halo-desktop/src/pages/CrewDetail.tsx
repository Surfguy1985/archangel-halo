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
  Navigation,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadW9Pdf } from "@/lib/w9pdf";
import { EditCrewDialog } from "@/components/CrewDialogs";
import { CrewCommandCenter } from "@/components/CrewCommandCenter";

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

const sectionTitle =
  "font-display font-bold text-[11px] tracking-[0.2em] uppercase text-[var(--ink)] mb-4 flex items-center gap-2";

function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
      className="relative overflow-hidden rounded-[12px] border border-border shrink-0 bg-muted"
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
    <div className="flex items-center gap-4 py-3">
      {hasCoords ? (
        <MapThumb lat={c.lat!} lng={c.lng!} />
      ) : (
        <div className="w-[88px] h-[64px] rounded-[12px] bg-black/5 flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5 text-muted-foreground opacity-50" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-[var(--ink)] truncate">{c.label || "Check-in"}</div>
        <div className="text-[11px] font-medium text-muted-foreground mt-0.5">
          {formatCheckinWhen(c.createdAt)}
        </div>
        {hasCoords && geo?.address && (
          <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
            {geo.address}
          </div>
        )}
      </div>
    </div>
  );
}

function CrewInvoicesReview({
  crewId,
  invoices,
}: {
  crewId: string;
  invoices?: CrewInvoice[];
}) {
  const queryClient = useQueryClient();
  const review = useReviewCrewInvoice();
  const { toast } = useToast();

  const handleAction = (invId: string, action: "approve" | "send_back") => {
    let note: string | undefined;
    if (action === "send_back") {
      const input = window.prompt("What should the crew fix? (required)");
      if (!input || !input.trim()) return;
      note = input.trim();
    }
    review.mutate(
      { id: invId, data: note ? { action, note } : { action } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListCrewInvoicesQueryKey(crewId),
          });
          toast({
            title: action === "approve" ? "Invoice approved" : "Invoice rejected",
          });
        },
      },
    );
  };

  if (!invoices || invoices.length === 0) {
    return <div className="text-sm text-muted-foreground py-2 text-center">No invoices yet.</div>;
  }

  return (
    <div className="flex flex-col divide-y divide-[var(--hairline)]">
      {invoices.map((inv) => (
        <div key={inv.id} className="py-3 flex items-start justify-between gap-4 group">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-bold text-[var(--ink)] truncate">{inv.jobLabel || "General Invoice"}</span>
              {inv.status === "needs_corrections" && (
                <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-bold uppercase tracking-wider">Rejected</span>
              )}
              {inv.status === "submitted" && (
                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold uppercase tracking-wider">Review needed</span>
              )}
              {inv.status === "approved" && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wider">Approved</span>
              )}
              {inv.status === "paid" && (
                <span className="px-2 py-0.5 rounded-full bg-black/[0.05] text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Paid</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Submitted {formatWhen(inv.createdAt)}
            </div>
            {inv.adminNote && (
              <div className="text-sm text-[var(--ink)] mt-2 italic bg-black/5 px-3 py-2 rounded-lg">"{inv.adminNote}"</div>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <div className="font-mono font-bold text-base text-[var(--ink)]">${inv.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            {inv.status === "submitted" && (
              <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleAction(inv.id, "approve")}
                  disabled={review.isPending}
                  className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleAction(inv.id, "send_back")}
                  disabled={review.isPending}
                  className="px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 mt-4 bg-black/5 rounded-xl p-4">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 text-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className="font-medium text-[var(--ink)] break-words">{value}</span>
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
        return a[1].label.localeCompare(b[1].label);
      })
      .map(([jobId, { label, days }]) => ({
        jobId,
        label,
        days: Array.from(days.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([date, list]) => ({ date, photos: list })),
      }));
  }, [photos]);

  const handleSharePhotos = (takenOn: string) => {
    setSharingDay(takenOn);
    createShare.mutate(
      { id: crewId, data: { day: takenOn } },
      {
        onSuccess: async (res) => {
          setSharingDay(null);
          const url = `${window.location.origin}/photos/${res.token}`;
          const message = `Photos from ${crewName} — ${formatDayLabel(takenOn)}: ${url}`;
          try {
            await navigator.clipboard.writeText(url);
            toast({ title: "Share link copied", description: "Opening Messages with a prefilled text…" });
          } catch {
            toast({ title: "Share link ready", description: url });
          }
          window.location.href = `sms:?&body=${encodeURIComponent(message)}`;
        },
        onError: () => {
          setSharingDay(null);
          toast({ title: "Couldn't create share link", description: "Please try again.", variant: "destructive" });
        },
      },
    );
  };

  const handleCreateShare = (takenOn: string) => {
    createShare.mutate(
      { id: crewId, data: { day: takenOn } },
      {
        onSuccess: (res) => {
          setSharingDay(null);
          setNotesDraft("");
          setReportDay(takenOn);
          setReportToken(res.token);
          toast({ title: "Report link generated" });
        },
        onError: (err) =>
          toast({ title: "Failed", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleUpdateNotes = (token: string, newNotes: string, day: string) => {
    updateNotes.mutate(
      { id: token, data: { day, notes: newNotes } },
      {
        onSuccess: () => {
          setSharingDay(null);
          setNotesDraft("");
          toast({ title: "Notes updated" });
        },
        onError: (err) =>
          toast({ title: "Failed", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6 lg:col-span-2">
      <div className={sectionTitle}><Camera className="w-3.5 h-3.5" /> Daily Activity Photos</div>
      {!photos || photos.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2 text-center">No photos uploaded yet.</div>
      ) : (
        <div className="space-y-8">
          {jobGroups.map((group) => (
            <div key={group.jobId}>
              <h3 className="font-display font-bold text-base text-[var(--ink)] mb-4">{group.label}</h3>
              <div className="space-y-6 pl-4 border-l-2 border-black/5">
                {group.days.map((dayGroup) => (
                  <div key={dayGroup.date} className="relative">
                    <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-[var(--gold)]" />
                    <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                      <div className="text-sm font-semibold text-muted-foreground">
                        {formatDayLabel(dayGroup.date)}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSharePhotos(dayGroup.date)}
                          disabled={sharingDay === dayGroup.date}
                          className="flex items-center gap-1.5 text-xs font-bold rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-[var(--paper)] transition-colors disabled:opacity-60"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          {sharingDay === dayGroup.date ? "Preparing…" : "Share link to photos"}
                        </button>
                        <button
                          onClick={() => {
                            if (reportDay === dayGroup.date) {
                              setReportDay(null);
                              setReportToken(null);
                              return;
                            }
                            handleCreateShare(dayGroup.date);
                          }}
                          disabled={createShare.isPending && reportDay !== dayGroup.date}
                          className={`flex items-center gap-1.5 text-xs font-bold rounded-full px-3 py-1.5 transition-colors disabled:opacity-60 ${
                            reportDay === dayGroup.date
                              ? "bg-[var(--ink)] text-white"
                              : "border border-border text-foreground hover:bg-[var(--paper)]"
                          }`}
                        >
                          <FileDown className="w-3.5 h-3.5" /> Full report
                        </button>
                      </div>
                    </div>
                    {reportDay === dayGroup.date && reportToken && (
                      <div className="mb-3 rounded-lg border border-border bg-[var(--paper)] p-3">
                        <div className="text-[11px] font-display font-bold tracking-[0.1em] text-muted-foreground mb-1.5">
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
                            onClick={() => handleUpdateNotes(crewId, notesDraft, dayGroup.date)}
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
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {dayGroup.photos.map((p) => (
                        <div key={p.id} className="group relative aspect-[4/3] rounded-xl overflow-hidden bg-black/5">
                          <img
                            src={`/api/storage${p.storagePath}`}
                            alt="Activity"
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                            {p.note && <div className="text-[10px] text-white line-clamp-2 leading-tight">{p.note}</div>}
                            <div className="text-[9px] text-white/70 mt-0.5">
                              {new Date(p.takenOn + "T00:00:00").toLocaleDateString()}
                            </div>
                          </div>
                          {p.phase && (
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm">
                              {p.phase}
                            </div>
                          )}
                        </div>
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
  const [mapOpen, setMapOpen] = useState(false);
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
  const card = "bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6";
  const goldBtn =
    "flex items-center justify-center gap-2 rounded-full py-2.5 px-5 text-sm font-display font-bold text-black bg-[var(--gold-light)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:brightness-95 transition-all disabled:opacity-50";

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link href="/crews" className="flex items-center gap-2 text-muted-foreground text-sm font-semibold mb-4 w-fit hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to Crews
      </Link>

      <header className="flex justify-between items-start">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[var(--ink)] text-[var(--gold-light)] font-display font-bold text-2xl grid place-items-center shrink-0 overflow-hidden shadow-sm">
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
          <div>
            <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)] leading-tight">{crew.name}</h1>
            <div className="text-muted-foreground mt-1 text-sm flex items-center gap-3 flex-wrap font-medium">
              <span>{crew.trade || "General"}</span>
              {crew.phone && (
                <span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {crew.phone}</span>
              )}
              {crew.email && (
                <span className="inline-flex items-center gap-1.5 truncate"><Mail className="w-3.5 h-3.5" /> {crew.email}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMapOpen(true)}
            className="flex items-center gap-2 bg-[var(--ink)] text-white px-5 py-2.5 rounded-full font-bold shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:opacity-90 transition-opacity"
          >
            <Navigation className="w-4 h-4 text-[var(--gold-light)]" /> Command Center
          </button>
          <button
            onClick={() => setEditOpen(true)}
            className="flex items-center gap-2 bg-card text-[var(--ink)] px-5 py-2.5 rounded-full font-medium border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:border-[var(--ink)] transition-colors"
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>
        </div>
      </header>

      {mapOpen && <CrewCommandCenter onClose={() => setMapOpen(false)} />}
      <EditCrewDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        crew={crew}
        onDeleted={() => navigate("/crews")}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          ["Paid", `$${(crew.paidTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}`],
          ["Outstanding", `$${(crew.outstandingTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}`],
          ["Invoices", String(crewInvoices?.length || 0)],
          ["Check-ins today", String(checkins?.filter(c => c.createdAt && new Date(c.createdAt).toDateString() === new Date().toDateString()).length || 0)],
        ].map(([label, value]) => (
          <div key={label} className="bg-[var(--ink)] rounded-[20px] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            <div className="text-white/60 uppercase text-[11px] font-bold tracking-[0.1em] mb-1">{label}</div>
            <div className="font-display font-bold text-[28px] text-white tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Messages */}
          <div className={card}>
            <div className={sectionTitle}><Send className="w-3.5 h-3.5" /> Messages</div>
            <div className="flex flex-col gap-3 max-h-96 overflow-y-auto mb-4 p-2 custom-scrollbar">
              {!messages || messages.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center bg-black/5 rounded-xl">No messages yet. Say hi!</div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${m.sender === "admin" ? "self-end bg-[var(--ink)] text-white rounded-br-sm" : "self-start bg-white border border-[var(--hairline)] text-[var(--ink)] rounded-bl-sm"}`}>
                    <div>{m.body}</div>
                    <div className={`text-[10px] mt-1.5 font-medium ${m.sender === "admin" ? "text-white/60" : "text-muted-foreground"}`}>{formatWhen(m.createdAt)}</div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-end gap-2 bg-black/5 p-2 rounded-2xl">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message the crew…"
                rows={1}
                className="flex-1 resize-none bg-transparent px-3 py-2 text-sm focus:outline-none placeholder:text-muted-foreground font-medium text-[var(--ink)]"
              />
              <button onClick={handleSend} disabled={sendMessage.isPending || !draft.trim()} aria-label="Send message" className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-[var(--gold-light)] text-black disabled:opacity-40 hover:brightness-95 transition-all shadow-sm">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          <DailyActivitySection crewId={id} crewName={crew.name} />

          {/* Invoices from crew */}
          <div className={card}>
            <div className={sectionTitle}><Receipt className="w-3.5 h-3.5" /> Invoices from crew</div>
            <CrewInvoicesReview crewId={id} invoices={crewInvoices} />
          </div>
        </div>

        {/* Secondary Column */}
        <div className="space-y-6">
          {/* Live portal link (Compact) */}
          <div className={card}>
            <div className={sectionTitle}><Link2 className="w-3.5 h-3.5" /> Portal Link</div>
            {portalUrl ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-[10px] font-mono bg-[var(--paper)] border border-[var(--hairline)] rounded-lg px-2 py-1.5 truncate text-muted-foreground">{portalUrl}</div>
                  <button onClick={handleCopy} className="shrink-0 w-8 h-8 rounded-full bg-card border border-[var(--hairline)] hover:border-[var(--ink)] flex items-center justify-center transition-colors text-[var(--ink)]">
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => copyGuideLink("en")}
                    className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-[var(--ink)] bg-card border border-[var(--hairline)] hover:border-[var(--ink)] transition-colors"
                  >
                    {copiedGuide === "en" ? <Check className="w-3.5 h-3.5" /> : <BookOpen className="w-3.5 h-3.5" />} Guide EN
                  </button>
                  <button
                    onClick={() => copyGuideLink("es")}
                    className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-[var(--ink)] bg-card border border-[var(--hairline)] hover:border-[var(--ink)] transition-colors"
                  >
                    {copiedGuide === "es" ? <Check className="w-3.5 h-3.5" /> : <BookOpen className="w-3.5 h-3.5" />} Guía ES
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={handleGenerate} disabled={genLink.isPending} className={`w-full ${goldBtn}`}>
                <Link2 className="w-4 h-4" /> Generate link
              </button>
            )}
          </div>

          {/* Paperwork & payment (Merged compact) */}
          <div className={card}>
            <div className={sectionTitle}><ClipboardCheck className="w-3.5 h-3.5" /> Paperwork & Payment</div>
            
            <div className="space-y-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Payment Method</div>
                {crew.preferredPaymentMethod ? (
                  <div>
                    <div className="text-sm font-bold text-[var(--ink)]">{crew.preferredPaymentMethod}</div>
                    {crew.paymentDetails && <div className="text-xs text-muted-foreground mt-0.5 break-words font-mono bg-black/5 px-2 py-1 rounded inline-block">{crew.paymentDetails}</div>}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground italic">Not set</div>
                )}
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Terms</div>
                <div className="text-sm font-bold text-[var(--ink)]">{paymentTermsLabel(crew.paymentTerms)}</div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">W-9 Form</div>
                {crew.w9Submitted && crew.w9 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-emerald-700 text-xs font-semibold">
                      <Check className="w-3.5 h-3.5" /> Submitted {formatWhen(crew.w9SubmittedAt)}
                    </div>
                    <button onClick={() => downloadW9Pdf(crew.w9 as Record<string, unknown>, crew.name)} className="w-full flex items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-bold bg-card border border-[var(--hairline)] hover:border-[var(--ink)] transition-colors text-[var(--ink)]">
                      <Download className="w-3.5 h-3.5" /> Download PDF
                    </button>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground italic">Not submitted</div>
                )}
              </div>
            </div>
          </div>

          {/* Onboarding welcome kit */}
          <div className={card}>
            <div className={sectionTitle}><PackageCheck className="w-3.5 h-3.5" /> Packets</div>
            <div className="flex flex-col gap-2 mb-3">
              <select
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value)}
                className="w-full rounded-lg border border-[var(--hairline)] bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--ink)] text-[var(--ink)] font-medium"
              >
                <option value="">Choose a packet…</option>
                {(packetTemplates ?? []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <button onClick={handleSendPacket} disabled={!templateKey || sendPacket.isPending} className={`w-full ${goldBtn} !py-2`}>
                <Send className="w-3.5 h-3.5" /> {sendPacket.isPending ? "Sending…" : "Send"}
              </button>
            </div>
            {packets && packets.length > 0 && (
              <div className="flex flex-col mt-4 divide-y divide-[var(--hairline)] border-t border-[var(--hairline)] pt-2">
                {packets.map((p) => {
                  const submitted = p.status === "submitted";
                  return (
                    <div key={p.id} className="flex items-center gap-2 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-[var(--ink)] truncate">{packetLabel(p.templateKey)}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {submitted ? `Done ${formatWhen(p.submittedAt)}` : `Sent ${formatWhen(p.sentAt)}`}
                        </div>
                      </div>
                      <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0 ${submitted ? "bg-emerald-100 text-emerald-800" : p.status === "in_progress" ? "bg-[var(--gold-tint)] text-[var(--gold-dark)]" : "bg-black/5 text-muted-foreground"}`}>
                        {submitted ? "Done" : p.status === "in_progress" ? "Working" : "Sent"}
                      </span>
                      {submitted && (
                        <a href={`/api/packets/${p.id}/pdf`} download className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors text-[var(--ink)]" aria-label="Download">
                          <Download className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Documents */}
          <div className={card}>
            <div className={sectionTitle}><FileText className="w-3.5 h-3.5" /> Documents</div>
            <label className="w-full mb-3 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold bg-card border border-[var(--hairline)] cursor-pointer hover:border-[var(--ink)] transition-colors text-[var(--ink)]">
              <FileUp className="w-3.5 h-3.5" />
              {isUploading ? "Uploading…" : "Upload file"}
              <input type="file" className="hidden" onChange={onFilePicked} disabled={isUploading} />
            </label>
            {!documents || documents.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2 text-center bg-black/5 rounded-lg">No docs yet.</div>
            ) : (
              <div className="flex flex-col divide-y divide-[var(--hairline)]">
                {documents.map((d) => {
                  const url = `/api/storage${d.storagePath}`;
                  return (
                    <div key={d.id} className="flex items-center gap-3 py-2.5">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <a href={url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 hover:underline decoration-muted-foreground">
                        <div className="text-xs font-bold text-[var(--ink)] truncate">{d.name}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {d.direction === "from_crew" ? "From crew" : "Sent"} · {formatWhen(d.createdAt)}
                        </div>
                      </a>
                      <a href={url} download={d.name} className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors text-[var(--ink)]" aria-label={`Download ${d.name}`}>
                        <Download className="w-3 h-3" />
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Check-ins */}
          <div className={card}>
            <div className={sectionTitle}><MapPin className="w-3.5 h-3.5" /> GPS Check-ins</div>
            {!checkins || checkins.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center bg-black/5 rounded-xl">No check-ins.</div>
            ) : (
              <div className="flex flex-col divide-y divide-[var(--hairline)]">
                {checkins.map((c) => (
                  <CheckinRow key={c.id} checkin={c} />
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
