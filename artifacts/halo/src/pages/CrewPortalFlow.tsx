/**
 * CrewPortalFlow — Tinder-style guided card stack for the crew portal.
 *
 * One card is visible at a time. The current card type is derived from live
 * server data and drives the exact same mutations the old tab flow used, so
 * everything the crew does here (check-in, photos, checklist, clock-out) is
 * reflected on the office Job Board, client board, and the property timeline.
 *
 * Card priority:
 *   1. Active job that needs the next action
 *      (scheduled → before photos → checklist → after photos → notes/clock-out)
 *   2. Pending job offer (accept / pass)
 *   3. Idle (all done)
 *
 * Emergency pings surface as a floating red banner above whatever card is
 * active — they never block the main flow.
 *
 * Bilingual EN/ES: toggle in the header.
 * Other tabs (Invoice, Pay, Messages, …) are accessible via "More ···".
 */
import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPortalJobs,
  useListPortalPhotos,
  useCreatePortalCheckin,
  useCompletePortalLineItem,
  useUploadPortalPhoto,
  useRespondPortalOffer,
  useCommitPortalEmergency,
  getListPortalJobsQueryKey,
  getListPortalPhotosQueryKey,
  getGetPortalQueryKey,
  type PortalBundle,
  type PortalOffer,
  type PortalEmergencyOffer,
  type PortalJob,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import {
  Camera,
  Check,
  LogIn,
  LogOut,
  Loader2,
  X,
  AlertCircle,
  MoreHorizontal,
  MapPin,
  Calendar,
  Receipt,
  MessageSquare,
  Wallet,
  ClipboardCheck,
  FileText,
  Feather,
  BookOpen,
  PackageCheck,
  Zap,
  ChevronRight,
  Clock,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useGpsTrail, getPosition, localDay } from "@/hooks/useGpsTrail";

// ─── Types ────────────────────────────────────────────────────────────────────

type Lang = "en" | "es";

// Use the generated API type directly to avoid shape drift.
type PortalJobShape = PortalJob;
type PortalPhotoShape = {
  id: string;
  jobId?: string | null;
  phase?: string | null;
  storagePath: string;
  note?: string | null;
  takenOn: string;
};

type ScheduleShape = {
  jobNo?: string | null;
  scheduledOn?: string | null;
  windowStart?: string | null;
  propertyName?: string | null;
  propertyAddress?: string | null;
  propertyCity?: string | null;
};

type ActiveCard =
  | { kind: "idle" }
  | { kind: "offer"; offer: PortalOffer }
  | {
      kind: "scheduled";
      job: PortalJobShape;
      schedItem: ScheduleShape | null;
      windowOpen: boolean;
      minsToWindow: number;
    }
  | { kind: "before-photos"; job: PortalJobShape; areas: string[] }
  | { kind: "checklist"; job: PortalJobShape }
  | { kind: "after-photos"; job: PortalJobShape; areas: string[] }
  | { kind: "notes"; job: PortalJobShape; nextJob: PortalJobShape | null };

// ─── Translations ─────────────────────────────────────────────────────────────

const COPY = {
  en: {
    brand: "ArchAngel · HALO",
    switchLang: "ES",
    more: "More",
    offerTag: "New offer",
    offerAccept: "Accept job",
    offerDecline: "Pass",
    offerPay: "Crew pay",
    offerDate: "Date",
    offerUnit: "Unit",
    offerProp: "Property",
    scheduledTag: "Today",
    checkInBtn: "Check in — I'm here",
    checkInLocked: (mins: number) => `Window opens in ${mins} min`,
    checkInNote: "GPS location is recorded as on-site proof.",
    windowNote: "Window: 30 min before to 30 min after scheduled start.",
    beforeTag: "Before photos",
    beforeInstr: (area: string) => `Photograph "${area}" before starting`,
    beforeBtn: "Take photo",
    beforeMore: "Add more",
    beforeCount: (n: number) => `${n} saved`,
    checklistTag: "Checklist",
    checklistInstr: "Tap each item when done.",
    checklistOthers: (n: number) => `${n} task${n !== 1 ? "s" : ""} belong to other crew members.`,
    afterTag: "After photos",
    afterInstr: (area: string) => `Photograph "${area}" after finishing`,
    afterBtn: "Take photo",
    afterMore: "Add more",
    afterCount: (n: number) => `${n} saved`,
    notesTag: "Notes & clock-out",
    notesPlaceholder: "What did you complete? Any issues? (shown to office & client)",
    clockOut: "Clock out",
    moveOn: "Move on to next job →",
    nextLabel: (label: string) => `Up next: ${label}`,
    idleTitle: "You're all caught up.",
    idleBody: "No jobs queued right now. New offers will appear here automatically.",
    emergencyTitle: "Emergency alert",
    emergencyAccept: "Accept",
    emergencyDismiss: "Dismiss",
    locationErr: "Location needed — turn on location access and try again.",
    photoErr: "Photo upload failed. Check your connection and try again.",
    saving: "Saving…",
    uploading: "Uploading…",
    onSite: "On site",
    photoSaved: "Photo saved!",
    checkinOk: "Checked in — GPS trail is live.",
    checkoutOk: "Clocked out! Send your invoice below.",
    moreSheetTitle: "Menu",
    invoice: "Invoice",
    messages: "Messages",
    schedule: "Schedule",
    pay: "Pay",
    w9: "W-9",
    wings: "Wings",
    photos: "Photos",
    docs: "Docs",
    guide: "Guide",
    kit: "Welcome Kit",
    tracker: "Job Tracker",
  },
  es: {
    brand: "ArchAngel · HALO",
    switchLang: "EN",
    more: "Más",
    offerTag: "Nueva oferta",
    offerAccept: "Aceptar trabajo",
    offerDecline: "Pasar",
    offerPay: "Pago",
    offerDate: "Fecha",
    offerUnit: "Unidad",
    offerProp: "Propiedad",
    scheduledTag: "Hoy",
    checkInBtn: "Registrarme — ya llegué",
    checkInLocked: (mins: number) => `Ventana abre en ${mins} min`,
    checkInNote: "Se registra tu ubicación GPS como prueba de llegada.",
    windowNote: "Ventana: 30 min antes y después del horario programado.",
    beforeTag: "Fotos antes",
    beforeInstr: (area: string) => `Fotografía "${area}" antes de empezar`,
    beforeBtn: "Tomar foto",
    beforeMore: "Agregar más",
    beforeCount: (n: number) => `${n} guardada${n !== 1 ? "s" : ""}`,
    checklistTag: "Lista de tareas",
    checklistInstr: "Toca cada tarea cuando la termines.",
    checklistOthers: (n: number) => `${n} tarea${n !== 1 ? "s" : ""} pertenece${n === 1 ? "" : "n"} a otros.`,
    afterTag: "Fotos después",
    afterInstr: (area: string) => `Fotografía "${area}" después de terminar`,
    afterBtn: "Tomar foto",
    afterMore: "Agregar más",
    afterCount: (n: number) => `${n} guardada${n !== 1 ? "s" : ""}`,
    notesTag: "Notas y cierre",
    notesPlaceholder: "¿Qué completaste? ¿Algún problema? (visible a la oficina y cliente)",
    clockOut: "Cerrar turno",
    moveOn: "Siguiente trabajo →",
    nextLabel: (label: string) => `Próximo: ${label}`,
    idleTitle: "Todo listo por ahora.",
    idleBody: "No hay trabajos en cola. Las ofertas nuevas aparecerán aquí.",
    emergencyTitle: "Alerta de emergencia",
    emergencyAccept: "Aceptar",
    emergencyDismiss: "Descartar",
    locationErr: "Necesito tu ubicación — activa el acceso a la ubicación.",
    photoErr: "Error al subir foto. Verifica tu conexión.",
    saving: "Guardando…",
    uploading: "Subiendo…",
    onSite: "En sitio",
    photoSaved: "¡Foto guardada!",
    checkinOk: "¡Registrado! El rastreo GPS está activo.",
    checkoutOk: "¡Turno cerrado! Envía tu factura abajo.",
    moreSheetTitle: "Menú",
    invoice: "Factura",
    messages: "Mensajes",
    schedule: "Horario",
    pay: "Pago",
    w9: "W-9",
    wings: "Wings",
    photos: "Fotos",
    docs: "Docs",
    guide: "Guía",
    kit: "Kit de bienvenida",
    tracker: "Rastreador",
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns whether a check-in is within the valid window (±30 min around the
 * scheduled windowStart). Also returns how many minutes until the window opens
 * (> 0 when still too early) so the UI can show a live countdown.
 *
 * @param ws   Free-text time string from the schedule ("9:00", "9:00 am", etc.)
 * @param nowMs Current epoch ms — passed explicitly so the caller can drive live
 *              updates by ticking a state variable.
 */
function parseWindow(
  ws: string | null | undefined,
  nowMs: number,
): { open: boolean; minsToWindow: number } {
  if (!ws) return { open: true, minsToWindow: 0 };
  let h = -1, m = 0;
  const m24 = ws.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (m24) { h = parseInt(m24[1], 10); m = parseInt(m24[2], 10); }
  const m12 = ws.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m12) {
    h = parseInt(m12[1], 10); m = parseInt(m12[2], 10);
    const pm = m12[3].toLowerCase() === "pm";
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h < 0) return { open: true, minsToWindow: 0 };
  const wsDate = new Date(); wsDate.setHours(h, m, 0, 0);
  // mins > 0: window hasn't opened yet; mins < 0: window is in the past
  const diffMins = Math.ceil((wsDate.getTime() - nowMs) / 60000);
  if (diffMins > 30) return { open: false, minsToWindow: diffMins };
  if (diffMins < -30) return { open: false, minsToWindow: 0 }; // window closed 30 min past start
  return { open: true, minsToWindow: 0 };
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDay(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatClock(hhmm?: string | null): string {
  if (!hhmm) return "";
  const [h, mRaw] = hhmm.split(":").map((n) => parseInt(n, 10));
  if (h == null || Number.isNaN(h)) return hhmm;
  const am = h < 12;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(mRaw ?? 0).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

function fmtPay(val: number | string | null | undefined): string {
  if (val == null) return "";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (Number.isNaN(n)) return "";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function deriveCard(
  portal: PortalBundle,
  jobs: PortalJobShape[] | undefined,
  photos: PortalPhotoShape[] | undefined,
  tracking: { day: string; jobId: string | null } | null,
  localCheckedOut: Record<string, boolean>,
  nowMs: number,
): ActiveCard {
  const today = localToday();
  const activeJobs = (jobs ?? []).filter((j) => j.status !== "cancelled");
  const schedules = ((portal as unknown as { schedule?: ScheduleShape[] }).schedule) ?? [];

  for (const job of activeJobs) {
    const isOut = !!localCheckedOut[job.id] || !!job.checkedOut;
    if (isOut) continue;

    const isIn = !!job.checkedIn || tracking?.jobId === job.id;

    // Only surface jobs that are either already on-site (isIn) or have a
    // schedule entry for today. Future-dated jobs that appear in the feed
    // but aren't scheduled today are skipped — they would otherwise be shown
    // as immediately checkable, which is incorrect.
    const schedItem = schedules.find((s) => s.jobNo === job.jobNo && s.scheduledOn === today) ?? null;
    if (!isIn && !schedItem) continue;

    const before = (photos ?? []).filter((p) => p.jobId === job.id && p.phase === "before");
    const after = (photos ?? []).filter((p) => p.jobId === job.id && p.phase === "after");
    const myItems = (job.lineItems ?? []).filter((li) => li.mine);
    const allMyDone = myItems.length === 0 || myItems.every((li) => li.completed);

    if (!isIn) {
      const { open, minsToWindow } = parseWindow(schedItem?.windowStart, nowMs);
      return { kind: "scheduled", job, schedItem, windowOpen: open, minsToWindow };
    }
    if (before.length === 0) {
      const areas = myItems.map((li) => li.service ?? "").filter(Boolean);
      return { kind: "before-photos", job, areas: areas.length ? areas : ["the work area"] };
    }
    if (!allMyDone) return { kind: "checklist", job };
    if (after.length === 0) {
      const areas = myItems.map((li) => li.service ?? "").filter(Boolean);
      return { kind: "after-photos", job, areas: areas.length ? areas : ["the work area"] };
    }
    const nextJob = activeJobs.find((j) => j.id !== job.id && !localCheckedOut[j.id] && !j.checkedOut) ?? null;
    return { kind: "notes", job, nextJob };
  }

  const pendingOffer = (portal.offers ?? []).find((o) => o.status === "pending" && !o.filledByOther);
  if (pendingOffer) return { kind: "offer", offer: pendingOffer };

  return { kind: "idle" };
}

// ─── Card visual primitives ───────────────────────────────────────────────────

const cardBase =
  "relative w-full rounded-[28px] border overflow-hidden shadow-2xl"
    + " bg-[#0F1929] border-[rgba(255,255,255,0.09)]";

const tag = (label: string, color = "#B4FF44") => (
  <span
    className="inline-block rounded-full px-[9px] py-[3px] text-[10.5px] font-bold tracking-[0.08em] uppercase"
    style={{ background: color, color: color === "#B4FF44" ? "#000" : "#fff" }}
  >
    {label}
  </span>
);

function PrimaryBtn({
  onClick, disabled, busy, icon: Icon, label,
}: {
  onClick: () => void; disabled?: boolean; busy?: boolean; icon?: React.FC<{ className?: string }>; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="w-full flex items-center justify-center gap-[9px] rounded-[16px] py-[15px] text-[16px] font-display font-bold text-black bg-[#B4FF44] disabled:opacity-50 transition-transform active:scale-[0.97]"
    >
      {busy ? (
        <Loader2 className="w-[18px] h-[18px] animate-spin" />
      ) : Icon ? (
        <Icon className="w-[18px] h-[18px]" />
      ) : null}
      {label}
    </button>
  );
}

function GhostBtn({
  onClick, disabled, label,
}: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-[9px] rounded-[16px] py-[14px] text-[15px] font-display font-bold text-white/60 border border-white/10 disabled:opacity-40 transition-transform active:scale-[0.97]"
    >
      {label}
    </button>
  );
}

function JobHeader({ job, checkedIn, t }: { job: PortalJobShape; checkedIn: boolean; t: typeof COPY.en }) {
  return (
    <div className="px-[22px] pt-[22px] pb-[16px] border-b border-white/[0.06]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display font-bold text-[20px] text-white leading-tight">
            {job.propertyName ?? "Job"}
          </div>
          {job.unitNo && (
            <div className="text-[13px] text-[#B4FF44] font-bold mt-[2px]">Unit {job.unitNo}</div>
          )}
          <div className="text-[12px] text-white/40 mt-[3px] font-mono">{job.jobNo}</div>
        </div>
        {checkedIn && (
          <span className="shrink-0 flex items-center gap-[5px] text-[11px] font-bold text-[#4ade80] mt-1">
            <span className="w-[7px] h-[7px] rounded-full bg-[#4ade80] animate-pulse" />
            {t.onSite}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  token: string;
  portal: PortalBundle;
  /** Called when crew taps the More button. Parent opens a sheet for that tab. */
  onOpenMore: (tab: string, jobId?: string) => void;
  /** Called from the Notes card "Send invoice" shortcut. */
  onInvoice: (jobId: string) => void;
}

export default function CrewPortalFlow({ token, portal, onOpenMore, onInvoice }: Props) {
  const [lang, setLang] = useState<Lang>("en");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localCheckedOut, setLocalCheckedOut] = useState<Record<string, boolean>>({});
  const [dismissedEmergency, setDismissedEmergency] = useState<Set<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingPhoto = useRef<{ jobId: string; phase: "before" | "after" } | null>(null);

  // Live clock — ticks every 30 s so the check-in window countdown stays
  // accurate without requiring a data refetch. Drives parseWindow.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);

  const queryClient = useQueryClient();
  const { tracking, startTrail, stopTrail } = useGpsTrail(token);

  const { data: jobs } = useListPortalJobs(token, {
    query: { queryKey: getListPortalJobsQueryKey(token), refetchInterval: 30_000 },
  });
  const { data: photos } = useListPortalPhotos(token, {
    query: { queryKey: getListPortalPhotosQueryKey(token) },
  });

  const checkinMut = useCreatePortalCheckin();
  const completeItem = useCompletePortalLineItem();
  const sendPhoto = useUploadPortalPhoto();
  const respondOffer = useRespondPortalOffer();
  const commitEmergency = useCommitPortalEmergency();
  const { uploadFile } = useUpload({
    onError: () => { setBusy(null); setErr(t.photoErr); },
  });

  // Cast away literal-string narrowing so both locales satisfy typeof COPY.en.
  const t = COPY[lang] as typeof COPY.en;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListPortalJobsQueryKey(token) });
    queryClient.invalidateQueries({ queryKey: getListPortalPhotosQueryKey(token) });
    queryClient.invalidateQueries({ queryKey: getGetPortalQueryKey(token) });
  };

  const card = deriveCard(portal, jobs, photos, tracking, localCheckedOut, nowMs);

  // Emergency offers that haven't been dismissed
  const activeEmergency = (portal.emergencyOffers ?? []).find(
    (o: PortalEmergencyOffer) =>
      o.status === "pending" &&
      (o as unknown as { pingStatus?: string }).pingStatus === "open" &&
      !dismissedEmergency.has(o.id),
  ) ?? null;

  // ── action handlers ──────────────────────────────────────────────────

  const doCheckIn = async (jobId: string) => {
    setErr(null); setNotice(null); setBusy(`ci:${jobId}`);
    const pos = await getPosition();
    if (!pos) { setBusy(null); setErr(t.locationErr); return; }
    checkinMut.mutate(
      { token, data: { jobId, kind: "checkin", lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } },
      {
        onSuccess: () => { setBusy(null); startTrail(jobId); setNotice(t.checkinOk); refresh(); },
        onError: () => { setBusy(null); setErr(t.locationErr); },
      },
    );
  };

  const doCheckOut = async (jobId: string, movingToUnit?: string) => {
    setErr(null); setNotice(null); setBusy(`co:${jobId}`);
    const pos = await getPosition();
    if (!pos) { setBusy(null); setErr(t.locationErr); return; }
    checkinMut.mutate(
      { token, data: { jobId, kind: "checkout", lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, note: note.trim() || null } },
      {
        onSuccess: async () => {
          stopTrail();
          setLocalCheckedOut((m) => ({ ...m, [jobId]: true }));
          setNote("");
          // If moving to next unit, tell the server so the office map shows a bubble.
          // Use an absolute /api path — BASE_URL is only for in-app route links
          // (see halo-desktop-api-urls memory), not for API calls.
          if (movingToUnit) {
            try {
              const resp = await fetch(`/api/portal/${token}/moving-to`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ unit: movingToUnit }),
              });
              if (!resp.ok) {
                console.warn("[portal] moving-to PATCH failed:", resp.status, await resp.text().catch(() => ""));
              }
            } catch (err) {
              console.warn("[portal] moving-to PATCH network error:", err);
            }
          }
          setBusy(null);
          setNotice(t.checkoutOk);
          refresh();
        },
        onError: (e) => {
          setBusy(null);
          const data = (e as { data?: { code?: string; error?: string } | null })?.data;
          if (data?.code === "after_photos_required") {
            setErr("Add at least one AFTER photo before clocking out.");
          } else {
            setErr(data?.error ?? "Couldn't save — check your connection.");
          }
        },
      },
    );
  };

  const doPhoto = (jobId: string, phase: "before" | "after") => {
    setErr(null);
    pendingPhoto.current = { jobId, phase };
    fileRef.current?.click();
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const target = pendingPhoto.current;
    if (!files.length || !target) return;
    setBusy(`photo:${target.jobId}:${target.phase}`);
    const pos = await getPosition();
    try {
      for (const file of files) {
        const res = await uploadFile(file);
        if (!res) continue;
        await sendPhoto.mutateAsync({
          token,
          data: {
            storagePath: res.objectPath,
            takenOn: localDay(),
            jobId: target.jobId,
            phase: target.phase,
            lat: pos?.coords.latitude ?? null,
            lng: pos?.coords.longitude ?? null,
            accuracy: pos?.coords.accuracy ?? null,
            capturedAt: new Date().toISOString(),
          },
        });
      }
      setNotice(t.photoSaved);
      refresh();
    } catch {
      setErr(t.photoErr);
    } finally {
      setBusy(null);
      pendingPhoto.current = null;
    }
  };

  const doToggleItem = async (jobId: string, itemId: string, done: boolean) => {
    setErr(null); setBusy(`item:${itemId}`);
    try {
      await completeItem.mutateAsync({ token, jobId, lineItemId: itemId, data: { done } });
      refresh();
    } catch {
      setErr("Couldn't update that item — try again.");
    } finally {
      setBusy(null);
    }
  };

  const doAcceptOffer = (offerId: string) => {
    setBusy(`offer:${offerId}`);
    respondOffer.mutate(
      { token, offerId, data: { decision: "approved" } },
      {
        onSuccess: () => { setBusy(null); refresh(); },
        onError: () => { setBusy(null); setErr("Couldn't accept — try again."); },
      },
    );
  };

  const doDeclineOffer = (offerId: string) => {
    setBusy(`offerDecline:${offerId}`);
    respondOffer.mutate(
      { token, offerId, data: { decision: "declined" } },
      {
        onSuccess: () => { setBusy(null); refresh(); },
        onError: () => { setBusy(null); setErr("Couldn't decline — try again."); },
      },
    );
  };

  const doAcceptEmergency = (offerId: string) => {
    setBusy(`emergency:${offerId}`);
    commitEmergency.mutate(
      { token, targetId: offerId },
      {
        onSuccess: () => { setBusy(null); setDismissedEmergency((s) => new Set([...s, offerId])); refresh(); },
        onError: () => { setBusy(null); setErr("Couldn't accept — try again."); },
      },
    );
  };

  // ── "more" quick links ───────────────────────────────────────────────

  const moreLinks: { tab: string; icon: React.FC<{ className?: string }>; label: string; badge?: number }[] = [
    { tab: "invoice", icon: Receipt, label: t.invoice },
    { tab: "messages", icon: MessageSquare, label: t.messages, badge: (portal.unseen as unknown as Record<string, number> | undefined)?.messages },
    { tab: "schedule", icon: Calendar, label: t.schedule, badge: ((portal.unseen as unknown as Record<string, number> | undefined)?.schedule ?? 0) + ((portal.unseen as unknown as Record<string, number> | undefined)?.approvals ?? 0) },
    { tab: "pay", icon: Wallet, label: t.pay },
    { tab: "w9", icon: ClipboardCheck, label: t.w9 },
    { tab: "wings", icon: Feather, label: t.wings },
    { tab: "photos", icon: Camera, label: t.photos },
    { tab: "packets", icon: PackageCheck, label: t.kit, badge: (portal.unseen as unknown as Record<string, number> | undefined)?.packets },
    { tab: "documents", icon: FileText, label: t.docs, badge: (portal.unseen as unknown as Record<string, number> | undefined)?.documents },
    { tab: "guide", icon: BookOpen, label: t.guide },
    { tab: "checkin", icon: MapPin, label: t.tracker },
  ];

  // ── render helpers ───────────────────────────────────────────────────

  const renderCard = () => {
    if (card.kind === "offer") {
      const o = card.offer;
      const isBusy = busy === `offer:${o.id}` || busy === `offerDecline:${o.id}`;
      const pay = fmtPay((o as unknown as { crewRate?: unknown }).crewRate as number | null);
      return (
        <div className={cardBase}>
          <div className="px-[22px] pt-[22px] pb-0">
            {tag(t.offerTag, "#F59E0B")}
            <div className="mt-[12px] font-display font-bold text-[22px] text-white leading-tight">
              {(o as unknown as { propertyName?: string }).propertyName ?? "Job offer"}
            </div>
            {(o as unknown as { unitNo?: string }).unitNo && (
              <div className="text-[14px] text-[#B4FF44] font-bold mt-[3px]">
                Unit {(o as unknown as { unitNo?: string }).unitNo}
              </div>
            )}
          </div>

          <div className="px-[22px] py-[16px] flex flex-col gap-[8px]">
            {pay && (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-white/40 w-[80px]">{t.offerPay}</span>
                <span className="font-display font-bold text-[20px] text-[#B4FF44]">{pay}</span>
              </div>
            )}
            {(o as unknown as { scheduledOn?: string }).scheduledOn && (
              <div className="flex items-center gap-2">
                <Calendar className="w-[14px] h-[14px] text-white/30 shrink-0" />
                <span className="text-[13px] text-white/60">
                  {formatDay((o as unknown as { scheduledOn?: string }).scheduledOn)}
                </span>
              </div>
            )}
            {(o as unknown as { description?: string }).description && (
              <div className="mt-[4px] text-[13px] text-white/50 leading-relaxed line-clamp-3">
                {(o as unknown as { description?: string }).description}
              </div>
            )}
          </div>

          <div className="px-[22px] pb-[22px] flex flex-col gap-[10px]">
            <PrimaryBtn
              onClick={() => doAcceptOffer(o.id)}
              busy={busy === `offer:${o.id}`}
              disabled={isBusy}
              icon={Check}
              label={t.offerAccept}
            />
            <GhostBtn
              onClick={() => doDeclineOffer(o.id)}
              disabled={isBusy}
              label={t.offerDecline}
            />
          </div>
        </div>
      );
    }

    if (card.kind === "scheduled") {
      const { job, schedItem, windowOpen, minsToWindow } = card;
      const isBusy = busy === `ci:${job.id}`;
      return (
        <div className={cardBase}>
          <JobHeader job={job} checkedIn={false} t={t} />
          <div className="px-[22px] py-[18px] flex flex-col gap-[10px]">
            {tag(t.scheduledTag)}
            {schedItem?.windowStart && (
              <div className="flex items-center gap-2 mt-[4px]">
                <Clock className="w-[14px] h-[14px] text-white/30 shrink-0" />
                <span className="text-[14px] font-bold text-white/70">
                  {formatClock(schedItem.windowStart)}
                </span>
              </div>
            )}
            {schedItem?.propertyAddress && (
              <div className="flex items-center gap-2">
                <MapPin className="w-[14px] h-[14px] text-white/30 shrink-0" />
                <span className="text-[13px] text-white/50">
                  {schedItem.propertyAddress}{schedItem.propertyCity ? `, ${schedItem.propertyCity}` : ""}
                </span>
              </div>
            )}
            <p className="text-[12px] text-white/35 mt-[2px]">{t.checkInNote}</p>
            {!windowOpen && (
              <div className="flex items-center gap-[6px] rounded-[12px] bg-amber-500/10 border border-amber-500/20 px-[12px] py-[10px]">
                <Clock className="w-[14px] h-[14px] text-amber-400 shrink-0" />
                <span className="text-[12.5px] text-amber-300 font-semibold">
                  {t.checkInLocked(minsToWindow)}
                </span>
              </div>
            )}
          </div>
          <div className="px-[22px] pb-[22px]">
            <PrimaryBtn
              onClick={() => doCheckIn(job.id)}
              busy={isBusy}
              disabled={isBusy || !windowOpen}
              icon={LogIn}
              label={windowOpen ? t.checkInBtn : t.checkInLocked(minsToWindow)}
            />
          </div>
        </div>
      );
    }

    if (card.kind === "before-photos" || card.kind === "after-photos") {
      const isAfter = card.kind === "after-photos";
      const { job, areas } = card;
      const photoCount = (photos ?? []).filter(
        (p) => p.jobId === job.id && p.phase === (isAfter ? "after" : "before"),
      ).length;
      const photoBusy = busy === `photo:${job.id}:${isAfter ? "after" : "before"}`;
      return (
        <div className={cardBase}>
          <JobHeader job={job} checkedIn={true} t={t} />
          <div className="px-[22px] py-[18px] flex flex-col gap-[10px]">
            {tag(isAfter ? t.afterTag : t.beforeTag, isAfter ? "#818cf8" : "#34d399")}
            <div className="mt-[4px]">
              {areas.map((area, i) => (
                <div key={i} className="text-[14px] font-semibold text-white/80 leading-snug mt-[4px] first:mt-0">
                  {isAfter ? t.afterInstr(area) : t.beforeInstr(area)}
                </div>
              ))}
            </div>
            {photoCount > 0 && (
              <div className="flex items-center gap-[6px] rounded-[10px] bg-green-500/10 border border-green-500/20 px-[10px] py-[8px]">
                <Check className="w-[13px] h-[13px] text-green-400 shrink-0" />
                <span className="text-[12.5px] text-green-300 font-semibold">
                  {isAfter ? t.afterCount(photoCount) : t.beforeCount(photoCount)}
                </span>
              </div>
            )}
          </div>
          <div className="px-[22px] pb-[22px] flex flex-col gap-[10px]">
            <PrimaryBtn
              onClick={() => doPhoto(job.id, isAfter ? "after" : "before")}
              busy={photoBusy}
              icon={Camera}
              label={isAfter ? t.afterBtn : t.beforeBtn}
            />
            {photoCount > 0 && (
              <button
                type="button"
                onClick={() => doPhoto(job.id, isAfter ? "after" : "before")}
                className="text-[13px] font-semibold text-white/40 text-center"
              >
                {isAfter ? t.afterMore : t.beforeMore}
              </button>
            )}
          </div>
        </div>
      );
    }

    if (card.kind === "checklist") {
      const { job } = card;
      const myItems = (job.lineItems ?? []).filter((li) => li.mine);
      const othersItems = (job.lineItems ?? []).filter((li) => !li.mine);
      const doneCount = myItems.filter((li) => li.completed).length;
      return (
        <div className={cardBase}>
          <JobHeader job={job} checkedIn={true} t={t} />
          <div className="px-[22px] py-[16px] flex flex-col gap-[8px]">
            <div className="flex items-center justify-between">
              {tag(t.checklistTag, "#60a5fa")}
              <span className="text-[12px] text-white/40 font-bold">
                {doneCount}/{myItems.length}
              </span>
            </div>
            <p className="text-[12px] text-white/40">{t.checklistInstr}</p>
            <div className="flex flex-col gap-[6px] mt-[4px]">
              {myItems.map((li) => (
                <button
                  key={li.id}
                  type="button"
                  disabled={busy === `item:${li.id}`}
                  onClick={() => doToggleItem(job.id, li.id, !li.completed)}
                  className={`flex items-center gap-[10px] rounded-[14px] px-[14px] py-[13px] text-left transition-all active:scale-[0.98] ${
                    li.completed
                      ? "bg-green-500/15 border border-green-500/25"
                      : "bg-white/[0.04] border border-white/[0.07]"
                  }`}
                >
                  <span
                    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                      li.completed
                        ? "border-green-500 bg-green-500 text-black"
                        : "border-white/20 bg-transparent"
                    }`}
                  >
                    {busy === `item:${li.id}` ? (
                      <Loader2 className="w-[12px] h-[12px] animate-spin text-white/50" />
                    ) : li.completed ? (
                      <Check className="w-[13px] h-[13px]" />
                    ) : null}
                  </span>
                  <span
                    className={`flex-1 min-w-0 text-[14px] font-semibold ${
                      li.completed ? "line-through text-white/30" : "text-white/80"
                    }`}
                  >
                    {li.service}
                    {li.startTime && !li.completed && (
                      <span className="ml-[8px] text-[11px] font-bold text-[#B4FF44]">
                        @ {formatClock(li.startTime)}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            {othersItems.length > 0 && (
              <p className="text-[12px] text-white/30 mt-[4px]">{t.checklistOthers(othersItems.length)}</p>
            )}
          </div>
          {myItems.every((li) => li.completed) && (
            <div className="px-[22px] pb-[22px]">
              <div className="flex items-center gap-[8px] rounded-[14px] bg-green-500/10 border border-green-500/20 px-[14px] py-[11px]">
                <Check className="w-[15px] h-[15px] text-green-400" />
                <span className="text-[13px] text-green-300 font-semibold">All tasks done — take your after photos.</span>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (card.kind === "notes") {
      const { job, nextJob } = card;
      const isBusy = busy === `co:${job.id}`;
      const nextLabel = nextJob
        ? `${nextJob.propertyName ?? "Next job"}${nextJob.unitNo ? ` · Unit ${nextJob.unitNo}` : ""}`
        : null;
      return (
        <div className={cardBase}>
          <JobHeader job={job} checkedIn={true} t={t} />
          <div className="px-[22px] py-[16px] flex flex-col gap-[10px]">
            {tag(t.notesTag, "#f472b6")}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={t.notesPlaceholder}
              className="w-full rounded-[14px] bg-white/[0.05] border border-white/[0.08] px-[14px] py-[12px] text-[14px] text-white placeholder-white/25 resize-none focus:outline-none focus:border-[#B4FF44]/40 focus:ring-1 focus:ring-[#B4FF44]/20 transition-colors"
            />
          </div>
          <div className="px-[22px] pb-[22px] flex flex-col gap-[10px]">
            {nextJob ? (
              <>
                <PrimaryBtn
                  onClick={() => doCheckOut(job.id, nextLabel ?? undefined)}
                  busy={isBusy}
                  icon={ChevronRight}
                  label={t.moveOn}
                />
                {nextLabel && (
                  <div className="text-[12px] text-white/35 text-center">{t.nextLabel(nextLabel)}</div>
                )}
                <GhostBtn
                  onClick={() => doCheckOut(job.id)}
                  disabled={isBusy}
                  label={t.clockOut}
                />
              </>
            ) : (
              <>
                <PrimaryBtn
                  onClick={() => doCheckOut(job.id)}
                  busy={isBusy}
                  icon={LogOut}
                  label={t.clockOut}
                />
                <button
                  type="button"
                  onClick={() => onInvoice(job.id)}
                  className="text-[13px] font-semibold text-[#B4FF44]/70 text-center mt-[2px]"
                >
                  Or send invoice now →
                </button>
              </>
            )}
          </div>
        </div>
      );
    }

    // idle
    return (
      <div className={cardBase}>
        <div className="px-[22px] py-[32px] flex flex-col items-center text-center gap-[12px]">
          <div className="w-[56px] h-[56px] rounded-full bg-[#B4FF44]/10 border border-[#B4FF44]/20 grid place-items-center">
            <Zap className="w-[26px] h-[26px] text-[#B4FF44]" />
          </div>
          <div>
            <div className="font-display font-bold text-[20px] text-white">{t.idleTitle}</div>
            <div className="text-[13px] text-white/40 mt-[6px] leading-relaxed">{t.idleBody}</div>
          </div>
          <button
            type="button"
            onClick={() => onOpenMore("offers")}
            className="mt-[8px] flex items-center gap-[6px] text-[13px] font-bold text-[#B4FF44]/80"
          >
            View offers <ChevronRight className="w-[14px] h-[14px]" />
          </button>
        </div>
      </div>
    );
  };

  // count of next cards (for "peek" depth indicator)
  const pendingCount = (() => {
    const activeJobs = (jobs ?? []).filter((j) => j.status !== "cancelled");
    const remaining = activeJobs.filter((j) => !localCheckedOut[j.id] && !j.checkedOut).length;
    const pendingOffers = (portal.offers ?? []).filter((o) => o.status === "pending" && !o.filledByOther).length;
    return remaining + pendingOffers;
  })();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#080D1A" }}>
      {/* Hidden file input for photo capture */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={onFilePicked}
      />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between px-[20px] pt-[20px] pb-[6px]">
        <div>
          <div className="text-[10px] font-bold tracking-[0.22em] uppercase text-[#B4FF44]/80">
            {t.brand}
          </div>
          <div className="font-display font-bold text-[22px] text-white leading-tight mt-[2px]">
            {portal.crew.name}
          </div>
          {portal.crew.trade && (
            <div className="text-[12px] text-white/35 mt-[1px]">{portal.crew.trade}</div>
          )}
        </div>
        <div className="flex items-center gap-[10px] mt-[4px]">
          <button
            type="button"
            onClick={() => setLang((l) => (l === "en" ? "es" : "en"))}
            className="text-[11.5px] font-bold text-white/40 hover:text-white/70 px-[10px] py-[5px] rounded-full border border-white/10 transition-colors"
          >
            {t.switchLang}
          </button>
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex items-center gap-[5px] text-[11.5px] font-bold text-white/40 hover:text-white/70 px-[10px] py-[5px] rounded-full border border-white/10 transition-colors"
          >
            <MoreHorizontal className="w-[14px] h-[14px]" />
            {t.more}
            {(portal.unseen as unknown as Record<string, number> | undefined) &&
              Object.values(portal.unseen as unknown as Record<string, number>).some((v) => v > 0) && (
                <span className="w-[7px] h-[7px] rounded-full bg-red-500" />
              )}
          </button>
        </div>
      </div>

      {/* ── Emergency banner ──────────────────────────────────────── */}
      {activeEmergency && (
        <div className="mx-[20px] mt-[10px] rounded-[16px] bg-red-950/60 border border-red-500/40 px-[14px] py-[12px] flex items-start gap-[10px]">
          <AlertCircle className="w-[18px] h-[18px] text-red-400 shrink-0 mt-[1px]" />
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-bold text-red-300">{t.emergencyTitle}</div>
            <div className="text-[12px] text-red-200/70 mt-[2px] line-clamp-2">
              {(activeEmergency as unknown as { title?: string }).title ??
                (activeEmergency as unknown as { body?: string }).body ??
                "Emergency crew needed"}
            </div>
          </div>
          <div className="flex gap-[8px] shrink-0">
            <button
              type="button"
              disabled={busy === `emergency:${activeEmergency.id}`}
              onClick={() => doAcceptEmergency(activeEmergency.id)}
              className="rounded-full bg-red-500 text-white text-[12px] font-bold px-[10px] py-[5px] disabled:opacity-50"
            >
              {busy === `emergency:${activeEmergency.id}` ? (
                <Loader2 className="w-[12px] h-[12px] animate-spin" />
              ) : (
                t.emergencyAccept
              )}
            </button>
            <button
              type="button"
              onClick={() => setDismissedEmergency((s) => new Set([...s, activeEmergency.id]))}
              className="rounded-full border border-red-500/30 text-red-400 text-[12px] font-bold px-[10px] py-[5px]"
            >
              <X className="w-[12px] h-[12px]" />
            </button>
          </div>
        </div>
      )}

      {/* ── Notices / errors ──────────────────────────────────────── */}
      {notice && (
        <div className="mx-[20px] mt-[10px] rounded-[14px] bg-green-900/40 border border-green-500/25 px-[14px] py-[10px] flex items-center gap-[8px]">
          <Check className="w-[14px] h-[14px] text-green-400 shrink-0" />
          <span className="text-[12.5px] text-green-300 font-semibold">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="ml-auto text-green-500/50 hover:text-green-400">
            <X className="w-[13px] h-[13px]" />
          </button>
        </div>
      )}
      {err && (
        <div className="mx-[20px] mt-[10px] rounded-[14px] bg-red-900/30 border border-red-500/25 px-[14px] py-[10px] flex items-center gap-[8px]">
          <AlertCircle className="w-[14px] h-[14px] text-red-400 shrink-0" />
          <span className="text-[12.5px] text-red-300 font-semibold">{err}</span>
          <button type="button" onClick={() => setErr(null)} className="ml-auto text-red-500/50 hover:text-red-400">
            <X className="w-[13px] h-[13px]" />
          </button>
        </div>
      )}

      {/* ── Card stack ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center px-[20px] pb-[24px] pt-[16px]">
        <div className="w-full max-w-[440px] mx-auto relative">
          {/* Peek cards behind the main card */}
          {pendingCount > 1 && (
            <div
              className="absolute inset-x-[16px] top-[12px] h-[60px] rounded-[28px] bg-[#0F1929]/70 border border-white/[0.05]"
              style={{ zIndex: 0 }}
            />
          )}
          {pendingCount > 2 && (
            <div
              className="absolute inset-x-[8px] top-[6px] h-[60px] rounded-[28px] bg-[#0F1929]/40 border border-white/[0.03]"
              style={{ zIndex: 0 }}
            />
          )}
          {/* Main card */}
          <div className="relative" style={{ zIndex: 1 }}>
            {renderCard()}
          </div>
        </div>

        {/* Step indicator dots (only when working through a job) */}
        {(card.kind === "scheduled" || card.kind === "before-photos" || card.kind === "checklist" || card.kind === "after-photos" || card.kind === "notes") && (
          <div className="flex justify-center gap-[6px] mt-[18px]">
            {(["scheduled", "before-photos", "checklist", "after-photos", "notes"] as const).map((k) => (
              <div
                key={k}
                className="rounded-full transition-all"
                style={{
                  width: card.kind === k ? 20 : 6,
                  height: 6,
                  background: card.kind === k ? "#B4FF44" : "rgba(255,255,255,0.15)",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── More sheet ────────────────────────────────────────────── */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-[24px] bg-[#0F1929] border-t border-white/[0.08] text-white max-h-[80vh] flex flex-col">
          <SheetHeader className="pb-[4px]">
            <SheetTitle className="text-white text-[16px] font-display">{t.moreSheetTitle}</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-[10px] overflow-y-auto pb-[20px] pt-[6px]">
            {moreLinks.map(({ tab, icon: Icon, label, badge }) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onOpenMore(tab);
                }}
                className="relative flex flex-col items-center gap-[6px] rounded-[16px] bg-white/[0.04] border border-white/[0.06] py-[14px] px-[10px] hover:bg-white/[0.08] transition-colors active:scale-[0.96]"
              >
                <Icon className="w-[22px] h-[22px] text-white/60" />
                <span className="text-[11.5px] font-semibold text-white/60">{label}</span>
                {badge && badge > 0 && (
                  <span className="absolute top-[8px] right-[10px] w-[8px] h-[8px] rounded-full bg-red-500" />
                )}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
