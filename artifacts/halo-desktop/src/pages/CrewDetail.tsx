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
  useGetCrewWorkHistory,
  getGetCrewWorkHistoryQueryKey,
  useUpdateCrew,
  useCreateCrewPayment,
  useGetCrewMapPins,
  getGetCrewMapPinsQueryKey,
  useListWingsMembers,
  getListWingsMembersQueryKey,
  useDecideWingsMembership,
  useUpdateWingsMember,
  useRecalculateWingsScore,
  type CrewPhoto,
  type CrewInvoice,
  type CrewAvailability,
  type CrewDetail,
} from "@workspace/api-client-react";
import { MapContainer, TileLayer, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  CalendarClock,
  Gift,
  ClipboardList,
  Feather,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  TrendingUp,
  Loader2,
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

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function availabilitySummary(avail?: CrewAvailability | null): string {
  if (!avail) return "Not set";
  const on = DAYS.filter((d) => avail[d.key]?.on);
  if (on.length === 0) return "None";
  if (on.length === 7) return "Every day";
  return on.map((d) => d.label).join(" ");
}

/** Small live map of where this crew last was — click to open the full Command Center. */
function CrewLocationThumb({ crewId, crewName, onExpand }: { crewId: string; crewName: string; onExpand: () => void }) {
  const { data: pins } = useGetCrewMapPins({
    query: { queryKey: getGetCrewMapPinsQueryKey(), refetchInterval: 30000 },
  });
  const pin = pins?.find((p) => p.id === crewId);
  const hasPos = pin && pin.lat != null && pin.lng != null;
  return (
    <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] overflow-hidden">
      <div className="px-6 pt-5 pb-3 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" /> Current location
        </div>
        <button type="button" onClick={onExpand} className="text-xs font-bold text-[var(--gold-dark)] hover:underline" data-testid="expand-map">
          Open live map
        </button>
      </div>
      {hasPos ? (
        <button type="button" onClick={onExpand} className="block w-full" aria-label={`Open live map for ${crewName}`} data-testid="crew-map-thumb">
          {/* isolation:isolate scopes Leaflet's z-index so it can't overlay dialogs/popups */}
          <div className="h-44 w-full pointer-events-none" style={{ isolation: "isolate" }}>
            <MapContainer
              key={`crew-map-${pin.lat}-${pin.lng}`}
              center={[pin.lat as number, pin.lng as number]}
              zoom={14}
              zoomControl={false}
              dragging={false}
              scrollWheelZoom={false}
              doubleClickZoom={false}
              attributionControl={false}
              className="h-full w-full"
              style={{ zIndex: 0 }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <CircleMarker
                center={[pin.lat as number, pin.lng as number]}
                radius={10}
                pathOptions={{ color: "#111827", fillColor: "#B4FF44", fillOpacity: 1, weight: 3 }}
              />
            </MapContainer>
          </div>
          <div className="px-6 py-3 text-left text-xs text-muted-foreground border-t border-[var(--hairline)]">
            {pin.lastCheckinLabel ? `${pin.lastCheckinLabel} · ` : ""}
            {pin.lastCheckinAt ? `last seen ${formatWhen(pin.lastCheckinAt)}` : "live position"}
          </div>
        </button>
      ) : (
        <div className="h-44 grid place-items-center text-sm text-muted-foreground bg-black/[0.03] mx-6 mb-6 rounded-xl">
          No location yet — appears after their first GPS check-in.
        </div>
      )}
    </div>
  );
}

/** Weekly availability the office keeps current — days + times this crew can work. */
function AvailabilityCard({ crewId, availability }: { crewId: string; availability: CrewAvailability | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateCrew = useUpdateCrew();
  const [draft, setDraft] = useState<CrewAvailability | null>(null);
  const value = draft ?? availability ?? {};

  const setDay = (key: string, patch: Partial<{ on: boolean; from: string; to: string }>) => {
    const cur = value[key] ?? { on: false, from: "8:00 AM", to: "5:00 PM" };
    setDraft({ ...value, [key]: { ...cur, ...patch } });
  };

  const save = () =>
    updateCrew.mutate(
      { id: crewId, data: { availability: draft ?? {} } },
      {
        onSuccess: () => {
          setDraft(null);
          queryClient.invalidateQueries({ queryKey: getGetCrewDetailQueryKey(crewId) });
          toast({ title: "Availability saved" });
        },
        onError: () => toast({ title: "Couldn't save availability", variant: "destructive" }),
      },
    );

  return (
    <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5" /> Availability — days &amp; times
        </div>
        {draft && (
          <Button size="sm" onClick={save} disabled={updateCrew.isPending} className="rounded-full bg-[var(--gold-light)] text-black font-bold hover:bg-[var(--gold-dark)] h-7 px-4" data-testid="save-availability">
            {updateCrew.isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        {DAYS.map((d) => {
          const day = value[d.key];
          const on = !!day?.on;
          return (
            <div key={d.key} className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setDay(d.key, { on: !on })}
                className={`w-14 shrink-0 rounded-full px-2 py-1 text-xs font-bold transition-colors ${on ? "bg-[var(--gold-light)] text-black" : "bg-black/[0.05] text-muted-foreground"}`}
                data-testid={`avail-day-${d.key}`}
              >
                {d.label}
              </button>
              {on ? (
                <>
                  <input
                    value={day?.from ?? ""}
                    onChange={(e) => setDay(d.key, { from: e.target.value })}
                    placeholder="8:00 AM"
                    className="w-24 rounded-lg border border-[var(--hairline)] px-2 py-1 text-xs bg-white"
                  />
                  <span className="text-muted-foreground text-xs">to</span>
                  <input
                    value={day?.to ?? ""}
                    onChange={(e) => setDay(d.key, { to: e.target.value })}
                    placeholder="5:00 PM"
                    className="w-24 rounded-lg border border-[var(--hairline)] px-2 py-1 text-xs bg-white"
                  />
                </>
              ) : (
                <span className="text-xs text-muted-foreground">Off</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Everything this crew has done: completed jobs, invoices by property, bonuses & gift cards. */
function WorkHistoryDialog({ open, onOpenChange, crewId, crewName }: { open: boolean; onOpenChange: (o: boolean) => void; crewId: string; crewName: string }) {
  const { data, isLoading } = useGetCrewWorkHistory(crewId, {
    query: { queryKey: getGetCrewWorkHistoryQueryKey(crewId), enabled: open },
  });
  const createPayment = useCreateCrewPayment();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [extraKind, setExtraKind] = useState<"bonus" | "gift_card">("bonus");
  const [extraAmount, setExtraAmount] = useState("");
  const [extraNote, setExtraNote] = useState("");

  const statusChip = (status: string) => {
    const paid = status === "paid";
    const bad = status === "rejected";
    return (
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${paid ? "bg-emerald-100 text-emerald-800" : bad ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
        {paid ? "Paid" : bad ? "Rejected" : "Pending"}
      </span>
    );
  };

  const invoiceGroups = (() => {
    const map = new Map<string, NonNullable<typeof data>["invoices"]>();
    for (const inv of data?.invoices ?? []) {
      const list = map.get(inv.propertyName) ?? [];
      list.push(inv);
      map.set(inv.propertyName, list);
    }
    return [...map.entries()];
  })();

  const addExtra = () => {
    const amount = parseFloat(extraAmount);
    if (!amount || amount <= 0) return;
    createPayment.mutate(
      { data: { crewId, amount, kind: extraKind, status: "completed", note: extraNote.trim() || null } },
      {
        onSuccess: () => {
          setExtraAmount("");
          setExtraNote("");
          queryClient.invalidateQueries({ queryKey: getGetCrewWorkHistoryQueryKey(crewId) });
          queryClient.invalidateQueries({ queryKey: getGetCrewDetailQueryKey(crewId) });
          toast({ title: extraKind === "bonus" ? "Bonus recorded" : "Gift card recorded" });
        },
        onError: () => toast({ title: "Couldn't record it", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{crewName} — work history</DialogTitle>
          <DialogDescription>Completed jobs, invoices by property, and any bonuses or gift cards.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="space-y-6 py-1">
            <section>
              <h4 className="text-xs font-bold text-[var(--secondary)] mb-2 flex items-center gap-1.5">
                <ClipboardList className="w-3.5 h-3.5" /> Completed jobs · {data?.jobs.length ?? 0}
              </h4>
              {(data?.jobs.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No completed jobs yet.</p>
              ) : (
                <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                  {data!.jobs.map((j) => (
                    <div key={j.jobId} className="grid grid-cols-[90px_1fr] gap-3 px-4 py-2.5 text-sm" data-testid={`wh-job-${j.jobId}`}>
                      <span className="text-xs text-muted-foreground pt-0.5">{j.completedOn ?? "—"}</span>
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground">{j.services.length > 0 ? j.services.join(" · ") : "Job"}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {j.propertyName}{j.unitNo ? ` · #${j.unitNo}` : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="text-xs font-bold text-[var(--secondary)] mb-2 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5" /> Invoices by property · {data?.invoices.length ?? 0}
              </h4>
              {invoiceGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices submitted yet.</p>
              ) : (
                <div className="space-y-3">
                  {invoiceGroups.map(([prop, list]) => (
                    <div key={prop} className="rounded-xl border border-border overflow-hidden">
                      <div className="bg-black/[0.04] px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{prop}</div>
                      <div className="divide-y divide-border">
                        {list.map((inv) => (
                          <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm" data-testid={`wh-inv-${inv.id}`}>
                            <span className="min-w-0 truncate">
                              <span className="font-mono text-xs font-bold">{inv.invoiceNo || "Invoice"}</span>
                              {inv.invoiceDate && <span className="text-xs text-muted-foreground"> · {inv.invoiceDate}</span>}
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span className="font-display font-bold tabular-nums">${inv.amount.toLocaleString()}</span>
                              {statusChip(inv.status)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="text-xs font-bold text-[var(--secondary)] mb-2 flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5" /> Bonuses &amp; gift cards · {data?.extras.length ?? 0}
              </h4>
              {(data?.extras.length ?? 0) > 0 && (
                <div className="divide-y divide-border rounded-xl border border-border overflow-hidden mb-3">
                  {data!.extras.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm" data-testid={`wh-extra-${p.id}`}>
                      <span className="min-w-0 truncate">
                        <span className="font-semibold">{p.kind === "gift_card" ? "Gift card" : "Bonus"}</span>
                        {p.note && <span className="text-xs text-muted-foreground"> · {p.note}</span>}
                        {p.createdAt && <span className="text-xs text-muted-foreground"> · {formatWhen(p.createdAt)}</span>}
                      </span>
                      <span className="font-display font-bold tabular-nums shrink-0">${p.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={extraKind}
                  onChange={(e) => setExtraKind(e.target.value as "bonus" | "gift_card")}
                  className="rounded-lg border border-border px-2 py-1.5 text-xs bg-white"
                  data-testid="extra-kind"
                >
                  <option value="bonus">Bonus</option>
                  <option value="gift_card">Gift card</option>
                </select>
                <input
                  value={extraAmount}
                  onChange={(e) => setExtraAmount(e.target.value)}
                  placeholder="Amount"
                  inputMode="decimal"
                  className="w-24 rounded-lg border border-border px-2 py-1.5 text-xs bg-white"
                  data-testid="extra-amount"
                />
                <input
                  value={extraNote}
                  onChange={(e) => setExtraNote(e.target.value)}
                  placeholder="Note (optional)"
                  className="flex-1 min-w-[140px] rounded-lg border border-border px-2 py-1.5 text-xs bg-white"
                />
                <Button size="sm" onClick={addExtra} disabled={createPayment.isPending || !parseFloat(extraAmount)} className="rounded-full bg-[var(--gold-light)] text-black font-bold hover:bg-[var(--gold-dark)] h-8 px-4" data-testid="add-extra">
                  {createPayment.isPending ? "Saving…" : "Record"}
                </Button>
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CrewDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: crew, isLoading } = useGetCrewDetail(id, { query: { queryKey: getGetCrewDetailQueryKey(id), refetchInterval: 30000 } });
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
  const [historyOpen, setHistoryOpen] = useState(false);
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {([
          ["Paid", `$${(crew.paidTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}`, null],
          ["Outstanding", `$${(crew.outstandingTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}`, null],
          ["Invoices · view all work", String(crewInvoices?.length || 0), () => setHistoryOpen(true)],
          ["Available days", availabilitySummary(crew.availability), null],
        ] as [string, string, (() => void) | null][]).map(([label, value, onClick]) => (
          <div
            key={label}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onClick={onClick ?? undefined}
            onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
            className={`bg-[var(--ink)] rounded-[20px] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] ${onClick ? "cursor-pointer hover:ring-2 hover:ring-[var(--gold-light)] transition-all" : ""}`}
            data-testid={onClick ? "kpi-invoices" : undefined}
          >
            <div className="text-white/60 uppercase text-[11px] font-bold tracking-[0.1em] mb-1">{label}</div>
            <div className="font-display font-bold text-[28px] text-white tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      {/* Where they are + when they work — the two things dispatch needs first. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <CrewLocationThumb crewId={id} crewName={crew.name} onExpand={() => setMapOpen(true)} />
        <AvailabilityCard crewId={id} availability={crew.availability ?? null} />
      </div>

      <WorkHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} crewId={id} crewName={crew.name} />

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
                    {m.attachmentPath ? (
                      <a
                        href={`/api/storage${m.attachmentPath}`}
                        target="_blank"
                        rel="noreferrer"
                        download={m.attachmentName ?? undefined}
                        className={`mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${m.sender === "admin" ? "bg-white/10 text-white hover:bg-white/20" : "bg-black/5 text-[var(--ink)] hover:bg-black/10"}`}
                      >
                        <Receipt className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{m.attachmentName || "Attachment"}</span>
                      </a>
                    ) : null}
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

          {/* Wings Program enrollment & scoring */}
          <WingsCard crewId={id} crewWingsExcluded={!!crew.wingsExcluded} crewDetailQueryKey={getGetCrewDetailQueryKey(id)} />

        </div>
      </div>
    </div>
  );
}

// ─── Wings Program Card ───────────────────────────────────────────────────────

const TIER_CHIP: Record<string, string> = {
  GROUNDED:  "bg-gray-100 text-gray-600",
  TRAINING:  "bg-blue-100 text-blue-700",
  SILVER:    "bg-slate-200 text-slate-700",
  GOLD:      "bg-amber-100 text-amber-700",
  PLATINUM:  "bg-purple-100 text-purple-700",
};
const STATUS_CHIP: Record<string, string> = {
  ACTIVE:           "bg-emerald-100 text-emerald-800",
  SUSPENDED:        "bg-red-100 text-red-700",
  PENDING_APPROVAL: "bg-amber-100 text-amber-700",
  AUTO_IMPORT:      "bg-sky-100 text-sky-700",
};
const FOUNDER_OPTIONS = [
  { value: "NONE",         label: "None" },
  { value: "CANDIDATE",   label: "Candidate" },
  { value: "FOUNDING_50",  label: "Founding 50" },
  { value: "FOUNDING_100", label: "Founding 100" },
];

function WingsCard({
  crewId,
  crewWingsExcluded,
  crewDetailQueryKey,
}: {
  crewId: string;
  crewWingsExcluded: boolean;
  crewDetailQueryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allMembers, isLoading } = useListWingsMembers({
    query: { queryKey: getListWingsMembersQueryKey(), refetchInterval: 30000 },
  });
  const member = allMembers?.find((m) => m.crewId === crewId);

  const updateCrew      = useUpdateCrew();
  const decideMember    = useDecideWingsMembership();
  const updateMember    = useUpdateWingsMember();
  const recalculate     = useRecalculateWingsScore();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListWingsMembersQueryKey() });
    queryClient.invalidateQueries({ queryKey: crewDetailQueryKey });
  };

  const toggleExclusion = () => {
    updateCrew.mutate(
      { id: crewId, data: { wingsExcluded: !crewWingsExcluded } },
      {
        onSuccess: () => { invalidate(); toast({ title: crewWingsExcluded ? "Crew enrolled in Wings" : "Crew excluded from Wings" }); },
        onError:   () => toast({ title: "Couldn't update enrollment", variant: "destructive" }),
      },
    );
  };

  const decide = (approve: boolean) => {
    decideMember.mutate(
      { crewId, data: { approve } },
      {
        onSuccess: () => { invalidate(); toast({ title: approve ? "Membership approved" : "Membership suspended" }); },
        onError:   () => toast({ title: "Couldn't update status", variant: "destructive" }),
      },
    );
  };

  const setFounder = (founderStatus: string) => {
    updateMember.mutate(
      { crewId, data: { founderStatus } },
      { onSuccess: () => { invalidate(); toast({ title: "Founder status updated" }); } },
    );
  };

  const handleRecalculate = () => {
    recalculate.mutate(
      { crewId },
      {
        onSuccess: (m) => { invalidate(); toast({ title: `Score updated: ${m.haloScore}/100 · ${m.tier}` }); },
        onError:   () => toast({ title: "Recalculate failed — crew may not be enrolled yet", variant: "destructive" }),
      },
    );
  };

  const card = "bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-6";
  const sectionTitle = "text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-1.5 mb-4";

  return (
    <div className={card}>
      {/* Header + enrollment toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className={sectionTitle} style={{ marginBottom: 0 }}>
          <Feather className="w-3.5 h-3.5 text-[var(--gold-dark)]" /> Wings Program
        </div>
        <button
          type="button"
          title={crewWingsExcluded ? "Click to enroll in Wings" : "Click to exclude from Wings"}
          disabled={updateCrew.isPending}
          onClick={toggleExclusion}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
            crewWingsExcluded ? "bg-muted" : "bg-[var(--gold-light)]"
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            crewWingsExcluded ? "translate-x-1" : "translate-x-6"
          }`} />
        </button>
      </div>

      <div className="text-[11px] text-muted-foreground mb-4">
        {crewWingsExcluded
          ? "Excluded — this crew won't be auto-imported into the profit-share program."
          : "Enrolled — crew is eligible for Wings profit-share payouts."}
      </div>

      {crewWingsExcluded ? null : isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : !member ? (
        <div className="text-center py-4 text-sm text-muted-foreground bg-black/5 rounded-xl">
          Not yet initialized — run Wings automation to create a member record.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Tier + status chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${TIER_CHIP[member.tier] ?? "bg-gray-100 text-gray-600"}`}>
              {member.tier}
            </span>
            <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${STATUS_CHIP[member.membershipStatus ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
              {(member.membershipStatus ?? "UNKNOWN").replace(/_/g, " ")}
            </span>
            {member.founderStatus !== "NONE" && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-[var(--gold-tint,#fdf6e3)] text-[var(--gold-dark)]">
                {member.founderStatus.replace(/_/g, " ")}
              </span>
            )}
          </div>

          {/* Halo score bar */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground mb-1.5">
              <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Halo Score</span>
              <span className="text-[var(--ink)] tabular-nums">{member.haloScore}<span className="font-normal text-muted-foreground">/100</span></span>
            </div>
            <div className="h-2 bg-black/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  member.haloScore >= 90 ? "bg-emerald-500" :
                  member.haloScore >= 75 ? "bg-[var(--gold-light)]" :
                  member.haloScore >= 60 ? "bg-amber-400" : "bg-red-400"
                }`}
                style={{ width: `${member.haloScore}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Confidence {Math.round(member.scoreConfidence * 100)}%
              {member.scoreUpdatedAt ? ` · updated ${formatWhen(member.scoreUpdatedAt)}` : ""}
            </div>
          </div>

          {/* Score reason bullets */}
          {member.scoreReasons && member.scoreReasons.length > 0 && (
            <div className="bg-black/[0.03] rounded-xl px-3 py-2.5 space-y-1">
              {member.scoreReasons.map((r, i) => (
                <div key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5">·</span><span>{r}</span>
                </div>
              ))}
            </div>
          )}

          {/* Founder status */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Founder Level</div>
            <select
              value={member.founderStatus}
              onChange={(e) => setFounder(e.target.value)}
              disabled={updateMember.isPending}
              className="w-full text-sm rounded-lg border border-[var(--hairline)] bg-card px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--ink)] text-[var(--ink)] font-medium"
            >
              {FOUNDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Approve / Suspend */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => decide(true)}
              disabled={decideMember.isPending || member.membershipStatus === "ACTIVE"}
              className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors disabled:opacity-40"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Approve
            </button>
            <button
              type="button"
              onClick={() => decide(false)}
              disabled={decideMember.isPending || member.membershipStatus === "SUSPENDED"}
              className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-40"
            >
              <ShieldOff className="w-3.5 h-3.5" /> Suspend
            </button>
          </div>

          {/* Recalculate */}
          <button
            type="button"
            onClick={handleRecalculate}
            disabled={recalculate.isPending}
            className="w-full flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold bg-card border border-[var(--hairline)] hover:border-[var(--ink)] transition-colors text-[var(--ink)]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${recalculate.isPending ? "animate-spin" : ""}`} />
            {recalculate.isPending ? "Recalculating…" : "Recalculate score now"}
          </button>

          {/* AI note */}
          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground bg-black/[0.03] px-3 py-2.5 rounded-xl leading-relaxed">
            <Feather className="w-3 h-3 mt-0.5 shrink-0 text-[var(--gold-dark)]" />
            <span>
              AI reviews quality evidence daily and feeds the Halo Score engine — quality 35%, reliability 25%, professionalism 15%, safety 15%, team 10%.
              Payout = base role × tenure multiplier × score band. Score ≥ 95 pays 1.3×; 80–89 pays 1.0×; below 60 pays zero.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
