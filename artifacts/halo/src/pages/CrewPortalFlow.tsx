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
  ChevronLeft,
  Clock,
  PartyPopper,
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
  | { kind: "job-agreement"; job: PortalJobShape }
  | { kind: "walk-approved"; job: PortalJobShape }
  | {
      kind: "scheduled";
      job: PortalJobShape;
      schedItem: ScheduleShape | null;
      windowOpen: boolean;
      minsToWindow: number;
    }
  | { kind: "before-photos"; job: PortalJobShape; areas: string[] }
  | { kind: "checklist"; job: PortalJobShape }
  | { kind: "cleaning-checklist"; job: PortalJobShape }
  | { kind: "job-checklist"; job: PortalJobShape; checklistType: string }
  | { kind: "after-photos"; job: PortalJobShape; areas: string[] }
  | { kind: "notes"; job: PortalJobShape; nextJob: PortalJobShape | null };

// True for jobs that show the turn-cleaning checklist. Trade-specific jobs
// (carpet, painting, make-ready/punch) have their own checklists and are excluded.
function isCleaningJob(category?: string | null, description?: string | null): boolean {
  const hay = `${category ?? ""} ${description ?? ""}`.toLowerCase();
  if (hay.includes("carpet")) return false;
  if (hay.includes("paint")) return false;
  if (hay.includes("make ready") || hay.includes("make-ready") || hay.includes("make_ready") || hay.includes("punch")) return false;
  return hay.includes("clean") || hay.includes("turn");
}

// Returns the trade-specific checklist type for carpet / painting / make-ready jobs.
function getJobChecklistType(
  category?: string | null,
  description?: string | null,
): "carpet" | "make_ready" | "painting" | null {
  const hay = `${category ?? ""} ${description ?? ""}`.toLowerCase();
  if (hay.includes("carpet")) return "carpet";
  if (hay.includes("paint")) return "painting";
  if (
    hay.includes("make ready") ||
    hay.includes("make-ready") ||
    hay.includes("make_ready") ||
    hay.includes("punch") ||
    hay.includes("unit punch")
  ) return "make_ready";
  return null;
}

const JOB_CHECKLIST_LABEL: Record<string, string> = {
  carpet: "Carpet Cleaning Checklist",
  make_ready: "Make-Ready / Unit Punch Checklist",
  painting: "Painting Checklist",
};
const JOB_CHECKLIST_PDF_URL: Record<string, string> = {
  carpet: "/api/docs/archangel-carpet-cleaning-checklist.pdf",
  make_ready: "/api/docs/archangel-make-ready-checklist.pdf",
  painting: "/api/docs/archangel-painting-checklist.pdf",
};
const CHECKLIST_AGREEMENT_TEXT =
  "By starting this checklist, you confirm that if Archangel later determines you did not complete some or all of the items, it could delay your pay until the agreed work is completed, or result in the loss of future work and removal from the platform. Payouts would be calculated pro-rata based on the actual work completed and the time and resource costs involved in completing the assigned work.";

function jobPaymentTermsPhrase(terms: string | null | undefined): string {
  switch (terms) {
    case "due_on_receipt": return "immediately upon receipt of payment from the property";
    case "net15":          return "within 15 days of job completion";
    case "net45":          return "within 45 days of job completion";
    case "net30":
    default:               return "within 30 days of job completion";
  }
}

function jobPaymentTermsLabel(terms: string | null | undefined): string {
  switch (terms) {
    case "due_on_receipt": return "Due on Receipt";
    case "net15":          return "Net 15";
    case "net45":          return "Net 45";
    case "net30":
    default:               return "Net 30";
  }
}

// Shape returned by GET /portal/:token/jobs/:jobId/cleaning-checklist
interface CleaningSection {
  id: string;
  title: string;
  items: { id: string; label: string; checked: boolean; checkedAt: string | null }[];
}
interface CleaningChecklistState {
  sections: CleaningSection[];
  checkedCount: number;
  totalItems: number;
  signedOff: boolean;
  signedOffAt: string | null;
  signedOffBy: string | null;
  pdfUrl: string;
  loading: boolean;
  error: string | null;
}

// State for trade-specific checklists (carpet / make_ready / painting).
// Key in the state map is `${jobId}:${checklistType}`.
interface JobChecklistState extends CleaningChecklistState {
  checklistType: string;
  agreed: boolean;
  agreedAt: string | null;
}

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
    walkApprovedTag: "Client approved",
    walkApprovedTitle: "Ready to start!",
    walkApprovedBody: "The client has reviewed and approved the walk findings. You're cleared to begin work.",
    walkApprovedCta: "Check in — I'm here",
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
    notesTag: "Clock out",
    notesPlaceholder: "What did you complete? Any issues? (shown to office & client)",
    clockOut: "Clock out",
    moveOn: "Move on to next job →",
    nextLabel: (label: string) => `Up next: ${label}`,
    clockoutTitle: "Job complete — ready to clock out",
    clockoutTasks: (n: number) => `${n} task${n !== 1 ? "s" : ""} checked off`,
    clockoutBeforePhotos: (n: number) => `${n} before photo${n !== 1 ? "s" : ""}`,
    clockoutAfterPhotos: (n: number) => `${n} after photo${n !== 1 ? "s" : ""}`,
    idleTitle: "You're all caught up.",
    idleBody: "No jobs queued right now. New offers will appear here automatically.",
    back: "Back",
    homeTitle: "Today's jobs",
    homeNoJobs: "No jobs scheduled today.",
    statusWaiting: "Waiting",
    statusOnSite: "On site",
    statusDone: "Done",
    resumeBtn: "Resume",
    emergencyTitle: "Emergency alert",
    emergencyAccept: "Accept",
    emergencyDismiss: "Dismiss",
    locationErr: "Location needed — turn on location access and try again.",
    alreadyIn: "You're already clocked in on this job.",
    saveErr: "Something went wrong — try again.",
    noGpsTitle: "Can't get a location fix",
    noGpsBody: "You can still start. We'll tell the office the location is missing.",
    noGpsStart: "Start without location",
    noGpsRetry: "Try location again",
    noGpsLabel: "Checked in without a GPS fix",
    noGpsActive: "Started without location — no travel trail today.",
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
    walkApprovedTag: "Cliente aprobó",
    walkApprovedTitle: "¡Listo para empezar!",
    walkApprovedBody: "El cliente revisó y aprobó los hallazgos de la visita. Estás autorizado para comenzar el trabajo.",
    walkApprovedCta: "Registrarme — ya llegué",
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
    notesTag: "Cerrar turno",
    notesPlaceholder: "¿Qué completaste? ¿Algún problema? (visible a la oficina y cliente)",
    clockOut: "Cerrar turno",
    moveOn: "Siguiente trabajo →",
    nextLabel: (label: string) => `Próximo: ${label}`,
    clockoutTitle: "Trabajo completo — listo para cerrar",
    clockoutTasks: (n: number) => `${n} tarea${n !== 1 ? "s" : ""} completada${n !== 1 ? "s" : ""}`,
    clockoutBeforePhotos: (n: number) => `${n} foto${n !== 1 ? "s" : ""} antes`,
    clockoutAfterPhotos: (n: number) => `${n} foto${n !== 1 ? "s" : ""} después`,
    idleTitle: "Todo listo por ahora.",
    idleBody: "No hay trabajos en cola. Las ofertas nuevas aparecerán aquí.",
    back: "Atrás",
    homeTitle: "Trabajos de hoy",
    homeNoJobs: "Sin trabajos programados hoy.",
    statusWaiting: "En espera",
    statusOnSite: "En sitio",
    statusDone: "Completado",
    resumeBtn: "Continuar",
    emergencyTitle: "Alerta de emergencia",
    emergencyAccept: "Aceptar",
    emergencyDismiss: "Descartar",
    locationErr: "Necesito tu ubicación — activa el acceso a la ubicación.",
    alreadyIn: "Ya estás registrado en este trabajo.",
    saveErr: "Algo salió mal — inténtalo de nuevo.",
    noGpsTitle: "No se puede fijar la ubicación",
    noGpsBody: "Puedes empezar igual. Le avisamos a la oficina que falta la ubicación.",
    noGpsStart: "Empezar sin ubicación",
    noGpsRetry: "Intentar ubicación otra vez",
    noGpsLabel: "Registrado sin señal de GPS",
    noGpsActive: "Empezaste sin ubicación — hoy no hay ruta registrada.",
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
  cleanSignedOff: Record<string, boolean> = {},
  jobChecklistSignedOff: Record<string, boolean> = {},
  jobAgreed: Record<string, boolean> = {},
): ActiveCard {
  const today = localToday();
  const activeJobs = (jobs ?? []).filter((j) => j.status !== "cancelled");
  const schedules = ((portal as unknown as { schedule?: ScheduleShape[] }).schedule) ?? [];

  for (const job of activeJobs) {
    const isOut = !!localCheckedOut[job.id] || !!job.checkedOut;
    if (isOut) continue;

    const isIn = !!job.checkedIn || tracking?.jobId === job.id;

    // Only surface jobs that are either already on-site (isIn), have a
    // dispatch schedule entry for today, or were assigned directly on the job
    // board for today (crewLeaderId set but no schedule row written).
    // Future-dated jobs are still suppressed — crews shouldn't see them early.
    const schedItem = schedules.find((s) => s.jobNo === job.jobNo && s.scheduledOn === today) ?? null;
    const jobDay = (job as unknown as { scheduledOn?: string | null }).scheduledOn;
    const isAssignedAndDue = !jobDay || jobDay <= today; // undated = immediate; today or past = due
    if (!isIn && !schedItem && !isAssignedAndDue) continue;

    const before = (photos ?? []).filter((p) => p.jobId === job.id && p.phase === "before");
    const after = (photos ?? []).filter((p) => p.jobId === job.id && p.phase === "after");
    const myItems = (job.lineItems ?? []).filter((li) => li.mine);
    const allMyDone = myItems.length === 0 || myItems.every((li) => li.completed);

    if (!isIn) {
      // Walk-approved jobs get a celebratory "green-lit" card before check-in
      // instead of the plain scheduled card.
      const jAny2 = job as unknown as { walkApprovedAt?: string | null };
      if (jAny2.walkApprovedAt) {
        return { kind: "walk-approved", job };
      }
      const { open, minsToWindow } = parseWindow(schedItem?.windowStart, nowMs);
      return { kind: "scheduled", job, schedItem, windowOpen: open, minsToWindow };
    }
    // Require payout-terms agreement before any work starts.
    // Skip for jobs already in progress (before-photos taken or items completed)
    // so existing in-progress jobs aren't retroactively blocked.
    const hasProgress = before.length > 0 || myItems.some((li) => li.completed);
    if (!jobAgreed[job.id] && !hasProgress) {
      return { kind: "job-agreement", job };
    }
    if (before.length === 0) {
      const areas = myItems.map((li) => li.service ?? "").filter(Boolean);
      return { kind: "before-photos", job, areas: areas.length ? areas : ["the work area"] };
    }
    if (!allMyDone) return { kind: "checklist", job };

    // After line items — check for trade-specific checklists first (carpet /
    // painting / make_ready), then the turn-cleaning checklist for cleaning jobs.
    const jAny = job as unknown as { category?: string; description?: string };
    const checklistType = getJobChecklistType(jAny.category, jAny.description);
    if (checklistType && !jobChecklistSignedOff[`${job.id}:${checklistType}`]) {
      return { kind: "job-checklist", job, checklistType };
    }
    // Show the cleaning checklist for ALL jobs that don't have a trade-specific
    // checklist — it's the universal quality gate before after-photos.
    if (!cleanSignedOff[job.id]) {
      return { kind: "cleaning-checklist", job };
    }

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

function JobHeader({
  job, checkedIn, t, onBack,
}: {
  job: PortalJobShape; checkedIn: boolean; t: typeof COPY.en; onBack?: () => void;
}) {
  return (
    <div className="px-[16px] pt-[16px] pb-[14px] border-b border-white/[0.06]">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-[4px] text-[12px] font-bold text-white/35 hover:text-white/70 mb-[10px] transition-colors active:scale-[0.96]"
        >
          <ChevronLeft className="w-[14px] h-[14px]" />
          {t.back}
        </button>
      )}
      <div className="flex items-start justify-between gap-2 px-[6px]">
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
  // Job id whose check-in is waiting on a location decision. Null = no prompt.
  const [gpsBlocked, setGpsBlocked] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showHome, setShowHome] = useState(false);
  const [cleanChecklists, setCleanChecklists] = useState<Record<string, CleaningChecklistState>>({});
  // Key: `${jobId}:${checklistType}`
  const [jobChecklists, setJobChecklists] = useState<Record<string, JobChecklistState>>({});
  // Jobs the crew has agreed to payout terms for in this session (supplements server state).
  const [locallyAgreedJobs, setLocallyAgreedJobs] = useState<Set<string>>(new Set());
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

  // Load cleaning checklist for any job that qualifies. Runs whenever the job
  // list changes so the sign-off state is always current. `category` and
  // `description` come from the server but aren't in the generated PortalJob
  // type — access them via an unknown cast.
  useEffect(() => {
    if (!jobs) return;
    for (const job of jobs) {
      const j = job as unknown as { category?: string; description?: string };
      // Load cleaning checklist for every non-trade job (it's now the universal gate).
      if (getJobChecklistType(j.category, j.description)) continue; // trade checklist handles this job
      if (cleanChecklists[job.id]?.loading === false) continue; // already loaded
      if (cleanChecklists[job.id]?.loading === true) continue;  // in-flight
      setCleanChecklists((prev) => ({
        ...prev,
        [job.id]: {
          sections: [],
          checkedCount: 0,
          totalItems: 31,
          signedOff: false,
          signedOffAt: null,
          signedOffBy: null,
          pdfUrl: "/api/docs/archangel-turn-cleaning-checklist.pdf",
          loading: true,
          error: null,
        },
      }));
      fetch(`/api/portal/${token}/jobs/${job.id}/cleaning-checklist`)
        .then((r) => r.ok ? r.json() : Promise.reject(r.status))
        .then((data) => {
          setCleanChecklists((prev) => ({
            ...prev,
            [job.id]: {
              sections: data.sections,
              checkedCount: data.checkedCount,
              totalItems: data.totalItems,
              signedOff: !!data.signedOffAt,
              signedOffAt: data.signedOffAt,
              signedOffBy: data.signedOffBy,
              pdfUrl: data.pdfUrl ?? "/api/docs/archangel-turn-cleaning-checklist.pdf",
              loading: false,
              error: null,
            },
          }));
        })
        .catch(() => {
          setCleanChecklists((prev) => ({
            ...prev,
            [job.id]: {
              ...(prev[job.id] ?? {} as CleaningChecklistState),
              loading: false,
              error: "Could not load checklist",
            },
          }));
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, token]);

  // Load trade-specific checklists for carpet / painting / make-ready jobs.
  useEffect(() => {
    if (!jobs) return;
    for (const job of jobs) {
      const j = job as unknown as { category?: string; description?: string };
      const ctype = getJobChecklistType(j.category, j.description);
      if (!ctype) continue;
      const key = `${job.id}:${ctype}`;
      if (jobChecklists[key]?.loading === false) continue;
      if (jobChecklists[key]?.loading === true) continue;
      setJobChecklists((prev) => ({
        ...prev,
        [key]: {
          sections: [],
          checkedCount: 0,
          totalItems: 0,
          signedOff: false,
          signedOffAt: null,
          signedOffBy: null,
          pdfUrl: JOB_CHECKLIST_PDF_URL[ctype] ?? "",
          loading: true,
          error: null,
          checklistType: ctype,
          agreed: false,
          agreedAt: null,
        },
      }));
      fetch(`/api/portal/${token}/jobs/${job.id}/checklist/${ctype}`)
        .then((r) => r.ok ? r.json() : Promise.reject(r.status))
        .then((data) => {
          setJobChecklists((prev) => ({
            ...prev,
            [key]: {
              sections: data.sections,
              checkedCount: data.checkedCount,
              totalItems: data.totalItems,
              signedOff: !!data.signedOffAt,
              signedOffAt: data.signedOffAt,
              signedOffBy: data.signedOffBy,
              pdfUrl: data.pdfUrl ?? JOB_CHECKLIST_PDF_URL[ctype] ?? "",
              loading: false,
              error: null,
              checklistType: ctype,
              agreed: !!data.agreedAt,
              agreedAt: data.agreedAt ?? null,
            },
          }));
        })
        .catch(() => {
          setJobChecklists((prev) => ({
            ...prev,
            [key]: {
              ...(prev[key] ?? {} as JobChecklistState),
              loading: false,
              error: "Could not load checklist",
            },
          }));
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, token]);

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

  const cleanSignedOff: Record<string, boolean> = Object.fromEntries(
    Object.entries(cleanChecklists).map(([id, s]) => [id, s.signedOff]),
  );
  const jobChecklistSignedOff: Record<string, boolean> = Object.fromEntries(
    Object.entries(jobChecklists).map(([key, s]) => [key, s.signedOff]),
  );
  // Merge server-side agreement timestamps (from jobs feed) with local session agreements.
  const jobAgreed: Record<string, boolean> = {};
  for (const job of jobs ?? []) {
    const j = job as unknown as { jobAgreedAt?: string | null };
    jobAgreed[job.id] = !!j.jobAgreedAt || locallyAgreedJobs.has(job.id);
  }
  const card = deriveCard(portal, jobs, photos, tracking, localCheckedOut, nowMs, cleanSignedOff, jobChecklistSignedOff, jobAgreed);

  // Emergency offers that haven't been dismissed
  const activeEmergency = (portal.emergencyOffers ?? []).find(
    (o: PortalEmergencyOffer) =>
      o.status === "pending" &&
      (o as unknown as { pingStatus?: string }).pingStatus === "open" &&
      !dismissedEmergency.has(o.id),
  ) ?? null;

  // ── action handlers ──────────────────────────────────────────────────

  const doCheckIn = async (jobId: string, allowNoGps = false) => {
    setErr(null); setNotice(null); setBusy(`ci:${jobId}`);
    const pos = await getPosition();

    if (!pos && !allowNoGps) {
      setBusy(null);
      setGpsBlocked(jobId);   // a fork, not a dead end
      return;
    }
    setGpsBlocked(null);

    checkinMut.mutate(
      {
        token,
        data: {
          jobId,
          kind: "checkin",
          lat: pos?.coords.latitude ?? null,
          lng: pos?.coords.longitude ?? null,
          accuracy: pos?.coords.accuracy ?? null,
          // Goes straight into the office notification body — must read as a
          // sentence, not a slug.
          label: pos ? null : t.noGpsLabel,
        },
      },
      {
        onSuccess: () => {
          setBusy(null);
          // No fix means no trail. Starting one from a device that just failed
          // to produce a position writes null points for the rest of the shift.
          if (pos) startTrail(jobId);
          setNotice(pos ? t.checkinOk : t.noGpsActive);
          refresh();
        },
        onError: (e) => {
          setBusy(null);
          const data = (e as { data?: { code?: string; error?: string } | null })?.data;
          if (data?.code === "duplicate_punch") { setNotice(t.alreadyIn); refresh(); return; }
          setErr(data?.error ?? t.saveErr);
        },
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

  const doToggleCleanItem = async (jobId: string, itemId: string, checked: boolean) => {
    // Optimistically update UI first
    setCleanChecklists((prev) => {
      const state = prev[jobId];
      if (!state) return prev;
      const sections = state.sections.map((sec) => ({
        ...sec,
        items: sec.items.map((it) =>
          it.id === itemId ? { ...it, checked, checkedAt: checked ? new Date().toISOString() : null } : it,
        ),
      }));
      const checkedCount = sections.flatMap((s) => s.items).filter((i) => i.checked).length;
      return { ...prev, [jobId]: { ...state, sections, checkedCount } };
    });
    setBusy(`cleanItem:${itemId}`);
    try {
      await fetch(`/api/portal/${token}/jobs/${jobId}/cleaning-checklist/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, checked }),
      });
    } catch {
      // Revert on error by reloading
      setCleanChecklists((prev) => {
        const state = prev[jobId];
        if (!state) return prev;
        return { ...prev, [jobId]: { ...state, loading: false, error: null } };
      });
    } finally {
      setBusy(null);
    }
  };

  const doSignOffClean = async (jobId: string) => {
    setBusy(`cleanSignOff:${jobId}`);
    setErr(null);
    try {
      const r = await fetch(`/api/portal/${token}/jobs/${jobId}/cleaning-checklist/sign-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error("sign-off failed");
      const now = new Date().toISOString();
      setCleanChecklists((prev) => {
        const state = prev[jobId];
        if (!state) return prev;
        return {
          ...prev,
          [jobId]: { ...state, signedOff: true, signedOffAt: now, loading: false },
        };
      });
      setNotice("Cleaning checklist signed off ✓");
      refresh();
    } catch {
      setErr("Couldn't sign off — try again.");
    } finally {
      setBusy(null);
    }
  };

  // ── Per-job payout agreement handler ─────────────────────────────────────────

  const doAgreeJob = async (jobId: string) => {
    setBusy(`jobAgree:${jobId}`);
    setErr(null);
    try {
      const r = await fetch(`/api/portal/${token}/jobs/${jobId}/agreement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error("agreement failed");
      setLocallyAgreedJobs((prev) => new Set([...prev, jobId]));
    } catch {
      setErr("Couldn't save your agreement — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  // ── Job-specific checklist handlers ──────────────────────────────────────────

  const doAgreeJobChecklist = async (jobId: string, checklistType: string) => {
    setBusy(`jclAgree:${jobId}:${checklistType}`);
    try {
      const r = await fetch(`/api/portal/${token}/jobs/${jobId}/checklist/${checklistType}/agree`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error("agree failed");
      const key = `${jobId}:${checklistType}`;
      setJobChecklists((prev) => {
        const state = prev[key];
        if (!state) return prev;
        return { ...prev, [key]: { ...state, agreed: true, agreedAt: new Date().toISOString() } };
      });
    } catch {
      setErr("Couldn't record agreement — try again.");
    } finally {
      setBusy(null);
    }
  };

  const doToggleJobItem = async (jobId: string, checklistType: string, itemId: string, checked: boolean) => {
    const key = `${jobId}:${checklistType}`;
    // Optimistic update
    setJobChecklists((prev) => {
      const state = prev[key];
      if (!state) return prev;
      const sections = state.sections.map((sec) => ({
        ...sec,
        items: sec.items.map((it) =>
          it.id === itemId ? { ...it, checked, checkedAt: checked ? new Date().toISOString() : null } : it,
        ),
      }));
      const checkedCount = sections.flatMap((s) => s.items).filter((i) => i.checked).length;
      return { ...prev, [key]: { ...state, sections, checkedCount } };
    });
    setBusy(`jclItem:${itemId}`);
    try {
      await fetch(`/api/portal/${token}/jobs/${jobId}/checklist/${checklistType}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, checked }),
      });
    } catch {
      // Revert on error
      setJobChecklists((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? {} as JobChecklistState), loading: false, error: null },
      }));
    } finally {
      setBusy(null);
    }
  };

  const doSignOffJobChecklist = async (jobId: string, checklistType: string) => {
    setBusy(`jclSignOff:${jobId}:${checklistType}`);
    setErr(null);
    try {
      const r = await fetch(`/api/portal/${token}/jobs/${jobId}/checklist/${checklistType}/sign-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error("sign-off failed");
      const now = new Date().toISOString();
      const key = `${jobId}:${checklistType}`;
      setJobChecklists((prev) => {
        const state = prev[key];
        if (!state) return prev;
        return { ...prev, [key]: { ...state, signedOff: true, signedOffAt: now, loading: false } };
      });
      setNotice(`${JOB_CHECKLIST_LABEL[checklistType] ?? "Checklist"} signed off ✓`);
      refresh();
    } catch {
      setErr("Couldn't sign off — try again.");
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
    { tab: "invoice", icon: Receipt, label: t.invoice, badge: (portal.unseen as unknown as Record<string, number> | undefined)?.invoices },
    { tab: "messages", icon: MessageSquare, label: t.messages, badge: (portal.unseen as unknown as Record<string, number> | undefined)?.messages },
    { tab: "schedule", icon: Calendar, label: t.schedule, badge: ((portal.unseen as unknown as Record<string, number> | undefined)?.schedule ?? 0) + ((portal.unseen as unknown as Record<string, number> | undefined)?.approvals ?? 0) },
    { tab: "pay", icon: Wallet, label: t.pay, badge: (portal.unseen as unknown as Record<string, number> | undefined)?.pay },
    { tab: "w9", icon: ClipboardCheck, label: t.w9 },
    { tab: "wings", icon: Feather, label: t.wings },
    { tab: "photos", icon: Camera, label: t.photos },
    { tab: "packets", icon: PackageCheck, label: t.kit, badge: (portal.unseen as unknown as Record<string, number> | undefined)?.packets },
    { tab: "documents", icon: FileText, label: t.docs, badge: (portal.unseen as unknown as Record<string, number> | undefined)?.documents },
    { tab: "guide", icon: BookOpen, label: t.guide },
    { tab: "checkin", icon: MapPin, label: t.tracker },
  ];

  // ── home / overview card ─────────────────────────────────────────────

  const renderHome = () => {
    const today = localToday();
    const schedules = ((portal as unknown as { schedule?: ScheduleShape[] }).schedule) ?? [];
    const activeJobs = (jobs ?? []).filter((j) => j.status !== "cancelled");
    const todayJobs = activeJobs.filter((j) => {
      const hasSchedule = schedules.some((s) => s.jobNo === j.jobNo && s.scheduledOn === today);
      const isIn = !!j.checkedIn || tracking?.jobId === j.id;
      return hasSchedule || isIn;
    });

    return (
      <div className={cardBase}>
        <div className="px-[22px] pt-[20px] pb-[6px] border-b border-white/[0.06]">
          <div className="font-display font-bold text-[18px] text-white">{t.homeTitle}</div>
        </div>
        <div className="px-[16px] py-[14px] flex flex-col gap-[8px]">
          {todayJobs.length === 0 && (
            <div className="text-[13px] text-white/40 text-center py-[16px]">{t.homeNoJobs}</div>
          )}
          {todayJobs.map((j) => {
            const isOut = !!localCheckedOut[j.id] || !!j.checkedOut;
            const isIn = !!j.checkedIn || tracking?.jobId === j.id;
            const myItems = (j.lineItems ?? []).filter((li) => li.mine);
            const doneCount = myItems.filter((li) => li.completed).length;
            const status = isOut ? "done" : isIn ? "active" : "waiting";
            return (
              <button
                key={j.id}
                type="button"
                onClick={() => !isOut && setShowHome(false)}
                disabled={isOut}
                className={`flex items-center gap-[12px] rounded-[18px] px-[14px] py-[13px] text-left transition-all active:scale-[0.98] ${
                  isOut
                    ? "bg-white/[0.03] border border-white/[0.05] opacity-50"
                    : "bg-white/[0.05] border border-white/[0.08] hover:border-[#B4FF44]/30"
                }`}
              >
                <div className={`w-[10px] h-[10px] rounded-full shrink-0 ${
                  status === "done" ? "bg-green-500" :
                  status === "active" ? "bg-[#B4FF44] animate-pulse" :
                  "bg-white/25"
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[14px] text-white/85 truncate">
                    {j.propertyName ?? j.jobNo}
                    {j.unitNo ? ` · Unit ${j.unitNo}` : ""}
                  </div>
                  <div className="text-[12px] text-white/35 mt-[2px]">
                    {status === "done" ? t.statusDone :
                     status === "active" ? (myItems.length > 0 ? `${doneCount}/${myItems.length} tasks` : t.statusOnSite) :
                     t.statusWaiting}
                  </div>
                </div>
                {!isOut && (
                  <ChevronRight className="w-[14px] h-[14px] text-white/25 shrink-0" />
                )}
                {isOut && (
                  <Check className="w-[14px] h-[14px] text-green-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
        <div className="px-[16px] pb-[16px]">
          <button
            type="button"
            onClick={() => setShowHome(false)}
            className="w-full rounded-[14px] py-[12px] text-[14px] font-display font-bold text-white bg-white/[0.06] border border-white/[0.08] active:scale-[0.97] transition-transform"
          >
            {t.resumeBtn} →
          </button>
        </div>
      </div>
    );
  };

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

    if (card.kind === "walk-approved") {
      const { job } = card;
      const isBusy = busy === `ci:${job.id}`;
      return (
        <div className={cardBase}>
          <JobHeader job={job} checkedIn={false} t={t} onBack={() => setShowHome(true)} />
          <div className="px-[22px] py-[20px] flex flex-col gap-[14px]">
            {/* Celebratory header */}
            <div className="flex items-center gap-[10px]">
              {tag(t.walkApprovedTag, "#B4FF44")}
            </div>
            <div className="flex items-center gap-[10px]">
              <PartyPopper className="w-[26px] h-[26px] text-[#B4FF44] shrink-0" />
              <div className="font-display font-bold text-[22px] text-white leading-tight">
                {t.walkApprovedTitle}
              </div>
            </div>
            {/* Info block */}
            <div className="rounded-[16px] border border-[#B4FF44]/20 bg-[#B4FF44]/[0.06] px-[16px] py-[14px]">
              <p className="text-[13.5px] text-white/75 leading-relaxed">
                {t.walkApprovedBody}
              </p>
            </div>
          </div>
          <div className="px-[22px] pb-[22px] flex flex-col gap-[10px]">
            {gpsBlocked === job.id ? (
              <div className="flex flex-col gap-[10px]">
                <div className="rounded-[14px] bg-amber-500/10 border border-amber-500/25 px-[13px] py-[12px]">
                  <div className="flex items-center gap-[7px]">
                    <AlertCircle className="w-[15px] h-[15px] text-amber-400 shrink-0" />
                    <span className="text-[13.5px] font-bold text-amber-300">{t.noGpsTitle}</span>
                  </div>
                  <p className="text-[12.5px] text-white/55 mt-[7px] leading-[1.45]">{t.noGpsBody}</p>
                </div>
                <PrimaryBtn
                  onClick={() => doCheckIn(job.id, true)}
                  busy={isBusy}
                  disabled={isBusy}
                  icon={LogIn}
                  label={t.noGpsStart}
                />
                <button
                  type="button"
                  onClick={() => { setGpsBlocked(null); void doCheckIn(job.id); }}
                  disabled={isBusy}
                  className="w-full py-[12px] text-[14px] font-bold text-white/55 disabled:opacity-40"
                >
                  {t.noGpsRetry}
                </button>
              </div>
            ) : (
              <PrimaryBtn
                onClick={() => doCheckIn(job.id)}
                busy={isBusy}
                disabled={isBusy}
                icon={LogIn}
                label={t.walkApprovedCta}
              />
            )}
          </div>
        </div>
      );
    }

    if (card.kind === "scheduled") {
      const { job, schedItem, windowOpen, minsToWindow } = card;
      const isBusy = busy === `ci:${job.id}`;
      return (
        <div className={cardBase}>
          <JobHeader job={job} checkedIn={false} t={t} onBack={() => setShowHome(true)} />
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
            {gpsBlocked === job.id ? (
              <div className="flex flex-col gap-[10px]">
                <div className="rounded-[14px] bg-amber-500/10 border border-amber-500/25 px-[13px] py-[12px]">
                  <div className="flex items-center gap-[7px]">
                    <AlertCircle className="w-[15px] h-[15px] text-amber-400 shrink-0" />
                    <span className="text-[13.5px] font-bold text-amber-300">{t.noGpsTitle}</span>
                  </div>
                  <p className="text-[12.5px] text-white/55 mt-[7px] leading-[1.45]">{t.noGpsBody}</p>
                </div>
                <PrimaryBtn
                  onClick={() => doCheckIn(job.id, true)}
                  busy={isBusy}
                  disabled={isBusy}
                  icon={LogIn}
                  label={t.noGpsStart}
                />
                <button
                  type="button"
                  onClick={() => { setGpsBlocked(null); void doCheckIn(job.id); }}
                  disabled={isBusy}
                  className="w-full py-[12px] text-[14px] font-bold text-white/55 disabled:opacity-40"
                >
                  {t.noGpsRetry}
                </button>
              </div>
            ) : (
              <PrimaryBtn
                onClick={() => doCheckIn(job.id)}
                busy={isBusy}
                disabled={isBusy || !windowOpen}
                icon={LogIn}
                label={windowOpen ? t.checkInBtn : t.checkInLocked(minsToWindow)}
              />
            )}
          </div>
        </div>
      );
    }

    if (card.kind === "job-agreement") {
      const { job } = card;
      const portalCrew = portal.crew as unknown as { paymentTerms?: string | null };
      const terms = portalCrew?.paymentTerms ?? null;
      const termsLabel = jobPaymentTermsLabel(terms);
      const termsPhrase = jobPaymentTermsPhrase(terms);
      const isAgreeing = busy === `jobAgree:${job.id}`;
      return (
        <div className={cardBase}>
          <JobHeader job={job} checkedIn={true} t={t} />
          <div className="px-[22px] py-[14px] flex flex-col gap-[14px]">
            {/* Payout terms badge */}
            <div className="flex items-center gap-[9px]">
              {tag("Payout Agreement", "#B4FF44")}
              <span className="text-[12px] font-bold text-white/50">{termsLabel}</span>
            </div>

            {/* Agreement card */}
            <div className="rounded-[16px] border border-white/[0.10] bg-white/[0.03] p-[16px] flex flex-col gap-[12px]">
              {/* Payout schedule */}
              <div className="flex flex-col gap-[4px]">
                <div className="text-[10px] font-bold uppercase tracking-[0.10em] text-white/35">Your Payout Schedule</div>
                <div className="text-[13.5px] font-semibold text-white/90 leading-snug capitalize">{termsPhrase}</div>
              </div>

              <div className="h-px bg-white/[0.07]" />

              {/* Two release conditions */}
              <div className="flex flex-col gap-[8px]">
                <div className="text-[10px] font-bold uppercase tracking-[0.10em] text-white/35">Payout Release Conditions</div>
                <div className="flex items-start gap-[9px]">
                  <span className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#B4FF44]/15 text-[#B4FF44] text-[11px] font-bold">1</span>
                  <p className="text-[12.5px] text-white/70 leading-[1.55]">
                    The property has verified that the work was completed correctly and to their satisfaction.
                  </p>
                </div>
                <div className="flex items-start gap-[9px]">
                  <span className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#B4FF44]/15 text-[#B4FF44] text-[11px] font-bold">2</span>
                  <p className="text-[12.5px] text-white/70 leading-[1.55]">
                    Archangel has received full payment from the property for this job.
                  </p>
                </div>
              </div>

              <div className="h-px bg-white/[0.07]" />
              <p className="text-[11px] text-white/40 leading-relaxed">
                If either condition has not been met, your payout will be held until both are satisfied. Tapping "I Agree & Start Work" confirms you understand your full scope of work and accept these payment terms.
              </p>
            </div>

            {/* CTA */}
            <button
              type="button"
              disabled={isAgreeing}
              onClick={() => doAgreeJob(job.id)}
              className="flex items-center justify-center gap-[8px] rounded-[18px] bg-[#B4FF44] text-black font-bold text-[14px] py-[15px] px-[20px] active:scale-[0.97] transition-transform disabled:opacity-60 shadow-[0_4px_24px_rgba(180,255,68,0.25)]"
            >
              {isAgreeing ? (
                <Loader2 className="w-[16px] h-[16px] animate-spin" />
              ) : (
                <Check className="w-[16px] h-[16px]" />
              )}
              I Agree &amp; Start Work
            </button>
          </div>
        </div>
      );
    }

    if (card.kind === "before-photos" || card.kind === "after-photos") {
      const isAfter = card.kind === "after-photos";
      const { job, areas } = card;
      const phase = isAfter ? "after" : "before";
      const phasePhotos = (photos ?? []).filter(
        (p) => p.jobId === job.id && p.phase === phase,
      );
      const photoCount = phasePhotos.length;
      const photoBusy = busy === `photo:${job.id}:${phase}`;
      const accentColor = isAfter ? "#818cf8" : "#34d399";
      const accentBg = isAfter ? "rgba(129,140,248,0.12)" : "rgba(52,211,153,0.12)";
      const accentBorder = isAfter ? "rgba(129,140,248,0.25)" : "rgba(52,211,153,0.25)";
      return (
        <div className={cardBase}>
          <JobHeader job={job} checkedIn={true} t={t} onBack={() => setShowHome(true)} />
          <div className="px-[22px] pt-[16px] pb-[10px] flex flex-col gap-[12px]">
            {/* Phase pill + instruction */}
            <div className="flex items-center gap-[8px]">
              {tag(isAfter ? t.afterTag : t.beforeTag, accentColor)}
              {photoCount > 0 && (
                <span
                  className="text-[11px] font-bold px-[8px] py-[3px] rounded-full"
                  style={{ background: accentBg, color: accentColor, border: `1px solid ${accentBorder}` }}
                >
                  {photoCount} saved
                </span>
              )}
            </div>
            <div>
              {areas.map((area, i) => (
                <div key={i} className="text-[14px] font-semibold text-white/80 leading-snug mt-[3px] first:mt-0">
                  {isAfter ? t.afterInstr(area) : t.beforeInstr(area)}
                </div>
              ))}
            </div>

            {/* Photo thumbnail strip */}
            {photoCount > 0 && (
              <div className="overflow-x-auto -mx-[4px] px-[4px]">
                <div className="flex gap-[8px] pb-[4px]">
                  {phasePhotos.map((p, i) => (
                    <a
                      key={i}
                      href={`/api/storage${p.storagePath}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 w-[72px] h-[72px] rounded-[12px] overflow-hidden border-2 bg-white/5"
                      style={{ borderColor: accentBorder }}
                    >
                      <img
                        src={`/api/storage${p.storagePath}`}
                        alt={`${phase} photo ${i + 1}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="px-[22px] pb-[22px] flex flex-col gap-[10px]">
            <PrimaryBtn
              onClick={() => doPhoto(job.id, phase)}
              busy={photoBusy}
              icon={Camera}
              label={photoCount > 0 ? (isAfter ? t.afterMore : t.beforeMore) : (isAfter ? t.afterBtn : t.beforeBtn)}
            />
            {photoCount > 0 && (
              <div
                className="flex items-center justify-center gap-[6px] rounded-[10px] px-[10px] py-[8px]"
                style={{ background: accentBg, border: `1px solid ${accentBorder}` }}
              >
                <Check className="w-[13px] h-[13px] shrink-0" style={{ color: accentColor }} />
                <span className="text-[12.5px] font-semibold" style={{ color: accentColor }}>
                  {isAfter ? t.afterCount(photoCount) : t.beforeCount(photoCount)} — tap to add more
                </span>
              </div>
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
          <JobHeader job={job} checkedIn={true} t={t} onBack={() => setShowHome(true)} />
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

    if (card.kind === "cleaning-checklist") {
      const { job } = card;
      const state = cleanChecklists[job.id];
      const sections = state?.sections ?? [];
      const totalItems = state?.totalItems ?? 31;
      const checkedCount = state?.checkedCount ?? 0;
      const allDone = checkedCount === totalItems;
      const alreadySigned = state?.signedOff ?? false;
      const isSigningOff = busy === `cleanSignOff:${job.id}`;

      return (
        <div className={cardBase}>
          <JobHeader job={job} checkedIn={true} t={t} onBack={() => setShowHome(true)} />
          <div className="px-[22px] py-[14px] flex flex-col gap-[6px]">
            {/* Header row */}
            <div className="flex items-center justify-between">
              {tag("Turn Cleaning Checklist", "#B4FF44")}
              <span className="text-[12px] text-white/40 font-bold tabular-nums">
                {checkedCount}/{totalItems}
              </span>
            </div>
            <p className="text-[12px] text-white/40 leading-relaxed">
              Check off each item as you go. Sign off when the unit is complete.
            </p>
            {/* Progress bar */}
            <div className="w-full h-[4px] rounded-full bg-white/[0.08] overflow-hidden mt-[2px]">
              <div
                className="h-full rounded-full bg-[#B4FF44] transition-all"
                style={{ width: totalItems > 0 ? `${(checkedCount / totalItems) * 100}%` : "0%" }}
              />
            </div>
            {/* Reference PDF link */}
            <a
              href={state?.pdfUrl ?? "/api/docs/archangel-turn-cleaning-checklist.pdf"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-[6px] text-[11.5px] font-semibold text-[#B4FF44]/60 hover:text-[#B4FF44] transition-colors mt-[2px]"
            >
              <FileText className="w-[13px] h-[13px]" />
              View full checklist PDF ↗
            </a>
          </div>

          {/* Scrollable sections */}
          <div className="px-[14px] pb-[4px] flex flex-col gap-[10px] max-h-[38vh] overflow-y-auto">
            {state?.loading && sections.length === 0 && (
              <div className="flex justify-center py-[20px]">
                <Loader2 className="w-[18px] h-[18px] animate-spin text-white/30" />
              </div>
            )}
            {sections.map((sec) => (
              <div key={sec.id}>
                <div className="text-[9.5px] font-bold tracking-[0.09em] uppercase text-white/30 mb-[5px] px-[2px]">
                  {sec.title}
                </div>
                <div className="flex flex-col gap-[4px]">
                  {sec.items.map((item) => {
                    const itemBusy = busy === `cleanItem:${item.id}`;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={itemBusy || alreadySigned}
                        onClick={() => doToggleCleanItem(job.id, item.id, !item.checked)}
                        className={`flex items-start gap-[9px] rounded-[12px] px-[12px] py-[10px] text-left transition-all active:scale-[0.98] ${
                          item.checked
                            ? "bg-green-500/10 border border-green-500/20"
                            : "bg-white/[0.03] border border-white/[0.06]"
                        } ${alreadySigned ? "opacity-60" : ""}`}
                      >
                        <span
                          className={`mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                            item.checked
                              ? "border-green-500 bg-green-500 text-black"
                              : "border-white/20 bg-transparent"
                          }`}
                        >
                          {itemBusy ? (
                            <Loader2 className="w-[10px] h-[10px] animate-spin text-white/50" />
                          ) : item.checked ? (
                            <Check className="w-[11px] h-[11px]" />
                          ) : null}
                        </span>
                        <span
                          className={`flex-1 text-[12.5px] leading-snug font-medium ${
                            item.checked ? "line-through text-white/25" : "text-white/75"
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Bottom actions */}
          <div className="px-[22px] py-[16px] flex flex-col gap-[8px]">
            {alreadySigned ? (
              <div className="flex items-center gap-[8px] rounded-[14px] bg-green-500/10 border border-green-500/20 px-[14px] py-[11px]">
                <Check className="w-[15px] h-[15px] text-green-400" />
                <span className="text-[13px] text-green-300 font-semibold">
                  Checklist signed off — great work!
                </span>
              </div>
            ) : (
              <>
                {allDone && (
                  <div className="flex items-center gap-[6px] rounded-[12px] bg-[#B4FF44]/10 border border-[#B4FF44]/25 px-[12px] py-[9px]">
                    <Check className="w-[13px] h-[13px] text-[#B4FF44]" />
                    <span className="text-[12.5px] text-[#B4FF44] font-semibold">
                      All {totalItems} items checked — ready to sign off.
                    </span>
                  </div>
                )}
                <PrimaryBtn
                  onClick={() => doSignOffClean(job.id)}
                  busy={isSigningOff}
                  disabled={isSigningOff}
                  icon={ClipboardCheck}
                  label={allDone ? "Sign off & continue" : `Sign off (${checkedCount}/${totalItems} done)`}
                />
                <GhostBtn
                  onClick={() => {
                    // Mark as locally skipped so flow advances to after-photos
                    setCleanChecklists((prev) => ({
                      ...prev,
                      [job.id]: {
                        ...(prev[job.id] ?? {} as CleaningChecklistState),
                        signedOff: true,
                        loading: false,
                      } as CleaningChecklistState,
                    }));
                  }}
                  label="Skip for now →"
                />
              </>
            )}
          </div>
        </div>
      );
    }

    if (card.kind === "job-checklist") {
      const { job, checklistType } = card;
      const key = `${job.id}:${checklistType}`;
      const state = jobChecklists[key];
      const sections = state?.sections ?? [];
      const totalItems = state?.totalItems ?? 0;
      const checkedCount = state?.checkedCount ?? 0;
      const allDone = totalItems > 0 && checkedCount === totalItems;
      const alreadySigned = state?.signedOff ?? false;
      const agreed = state?.agreed ?? false;
      const isAgreeing = busy === `jclAgree:${job.id}:${checklistType}`;
      const isSigningOff = busy === `jclSignOff:${job.id}:${checklistType}`;
      const label = JOB_CHECKLIST_LABEL[checklistType] ?? "Checklist";
      const pdfUrl = JOB_CHECKLIST_PDF_URL[checklistType] ?? "#";

      return (
        <div className={cardBase}>
          <JobHeader job={job} checkedIn={true} t={t} onBack={() => setShowHome(true)} />

          {/* Agreement gate — shown if crew hasn't tapped "I Agree" yet */}
          {!agreed && !alreadySigned && (
            <div className="px-[22px] py-[14px] flex flex-col gap-[14px]">
              <div>{tag(label, "#B4FF44")}</div>
              <div className="rounded-[16px] border border-amber-500/30 bg-amber-500/[0.07] p-[14px] flex flex-col gap-[10px]">
                <div className="flex items-center gap-[7px]">
                  <span className="text-amber-400 text-[18px]">⚠</span>
                  <span className="text-[13px] font-bold text-amber-300">Before you begin</span>
                </div>
                <p className="text-[12px] text-white/65 leading-[1.6]">{CHECKLIST_AGREEMENT_TEXT}</p>
              </div>
              <button
                type="button"
                disabled={isAgreeing}
                onClick={() => doAgreeJobChecklist(job.id, checklistType)}
                className="flex items-center justify-center gap-[8px] rounded-[18px] bg-[#B4FF44] text-black font-bold text-[14px] py-[14px] px-[20px] active:scale-[0.97] transition-transform disabled:opacity-60"
              >
                {isAgreeing ? (
                  <Loader2 className="w-[16px] h-[16px] animate-spin" />
                ) : (
                  <Check className="w-[16px] h-[16px]" />
                )}
                I Agree — Start Checklist
              </button>
            </div>
          )}

          {/* Checklist header + items (only after agreement) */}
          {(agreed || alreadySigned) && (
            <>
              <div className="px-[22px] py-[14px] flex flex-col gap-[6px]">
                <div className="flex items-center justify-between">
                  {tag(label, "#B4FF44")}
                  <span className="text-[12px] text-white/40 font-bold tabular-nums">
                    {checkedCount}/{totalItems}
                  </span>
                </div>
                <p className="text-[12px] text-white/40 leading-relaxed">
                  Check off each item as you go. Sign off when done.
                </p>
                {/* Progress bar */}
                <div className="w-full h-[4px] rounded-full bg-white/[0.08] overflow-hidden mt-[2px]">
                  <div
                    className="h-full rounded-full bg-[#B4FF44] transition-all"
                    style={{ width: totalItems > 0 ? `${(checkedCount / totalItems) * 100}%` : "0%" }}
                  />
                </div>
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-[6px] text-[11.5px] font-semibold text-[#B4FF44]/60 hover:text-[#B4FF44] transition-colors mt-[2px]"
                >
                  <FileText className="w-[13px] h-[13px]" />
                  View full checklist PDF ↗
                </a>
              </div>

              {/* Scrollable item list */}
              <div className="px-[14px] pb-[4px] flex flex-col gap-[10px] max-h-[38vh] overflow-y-auto">
                {state?.loading && sections.length === 0 && (
                  <div className="flex justify-center py-[20px]">
                    <Loader2 className="w-[18px] h-[18px] animate-spin text-white/30" />
                  </div>
                )}
                {sections.map((sec) => (
                  <div key={sec.id}>
                    <div className="text-[9.5px] font-bold tracking-[0.09em] uppercase text-white/30 mb-[5px] px-[2px]">
                      {sec.title}
                    </div>
                    <div className="flex flex-col gap-[4px]">
                      {sec.items.map((item) => {
                        const itemBusy = busy === `jclItem:${item.id}`;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={itemBusy || alreadySigned}
                            onClick={() => doToggleJobItem(job.id, checklistType, item.id, !item.checked)}
                            className={`flex items-start gap-[9px] rounded-[12px] px-[12px] py-[10px] text-left transition-all active:scale-[0.98] ${
                              item.checked
                                ? "bg-green-500/10 border border-green-500/20"
                                : "bg-white/[0.03] border border-white/[0.06]"
                            } ${alreadySigned ? "opacity-60" : ""}`}
                          >
                            <span
                              className={`mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                                item.checked
                                  ? "border-green-500 bg-green-500 text-black"
                                  : "border-white/20 bg-transparent"
                              }`}
                            >
                              {itemBusy ? (
                                <Loader2 className="w-[10px] h-[10px] animate-spin text-white/50" />
                              ) : item.checked ? (
                                <Check className="w-[11px] h-[11px]" />
                              ) : null}
                            </span>
                            <span
                              className={`flex-1 text-[12.5px] leading-snug font-medium ${
                                item.checked ? "line-through text-white/25" : "text-white/75"
                              }`}
                            >
                              {item.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom actions */}
              <div className="px-[22px] py-[16px] flex flex-col gap-[8px]">
                {alreadySigned ? (
                  <div className="flex items-center gap-[8px] rounded-[14px] bg-green-500/10 border border-green-500/20 px-[14px] py-[11px]">
                    <Check className="w-[15px] h-[15px] text-green-400" />
                    <span className="text-[13px] text-green-300 font-semibold">
                      Checklist signed off — great work!
                    </span>
                  </div>
                ) : (
                  <>
                    {allDone && (
                      <div className="flex items-center gap-[6px] rounded-[12px] bg-[#B4FF44]/10 border border-[#B4FF44]/25 px-[12px] py-[9px]">
                        <Check className="w-[13px] h-[13px] text-[#B4FF44]" />
                        <span className="text-[12.5px] text-[#B4FF44] font-semibold">
                          All {totalItems} items checked — ready to sign off.
                        </span>
                      </div>
                    )}
                    <PrimaryBtn
                      onClick={() => doSignOffJobChecklist(job.id, checklistType)}
                      busy={isSigningOff}
                      disabled={isSigningOff}
                      icon={ClipboardCheck}
                      label={allDone ? "Sign off & continue" : `Sign off (${checkedCount}/${totalItems} done)`}
                    />
                    <GhostBtn
                      onClick={() => {
                        // Locally skip so flow advances — consequences already acknowledged.
                        setJobChecklists((prev) => ({
                          ...prev,
                          [key]: {
                            ...(prev[key] ?? {} as JobChecklistState),
                            signedOff: true,
                            loading: false,
                          } as JobChecklistState,
                        }));
                      }}
                      label="Skip for now →"
                    />
                  </>
                )}
              </div>
            </>
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
      <div
        className="flex items-start justify-between px-[20px] pb-[6px]"
        style={{ paddingTop: "max(28px, calc(env(safe-area-inset-top) + 16px))" }}
      >
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

      {/* ── Leader / team context banner (members only) ──────────── */}
      {(() => {
        const c = portal.crew as unknown as { leaderId?: string | null; leaderName?: string | null; isLeader?: boolean | null };
        if (!c.leaderId || c.isLeader) return null;
        const leaderName = c.leaderName;
        return (
          <div className="mx-[20px] mt-[10px] rounded-[14px] bg-white/[0.04] border border-white/[0.07] px-[14px] py-[9px] flex items-center gap-[8px]">
            <span className="w-[7px] h-[7px] rounded-full bg-[#B4FF44] shrink-0" />
            <span className="text-[12px] text-white/50 font-semibold">
              {leaderName ? `You're part of ${leaderName}'s crew` : "You're part of a crew team"}
            </span>
          </div>
        );
      })()}

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
          {/* Peek cards behind the main card — hidden when showing home overview */}
          {!showHome && pendingCount > 1 && (
            <div
              className="absolute inset-x-[16px] top-[12px] h-[60px] rounded-[28px] bg-[#0F1929]/70 border border-white/[0.05]"
              style={{ zIndex: 0 }}
            />
          )}
          {!showHome && pendingCount > 2 && (
            <div
              className="absolute inset-x-[8px] top-[6px] h-[60px] rounded-[28px] bg-[#0F1929]/40 border border-white/[0.03]"
              style={{ zIndex: 0 }}
            />
          )}
          {/* Main card — or home overview when back is pressed */}
          <div className="relative" style={{ zIndex: 1 }}>
            {showHome ? renderHome() : renderCard()}
          </div>
        </div>

        {/* Step indicator dots (only when working through a job, not when on home) */}
        {!showHome && (card.kind === "job-agreement" || card.kind === "scheduled" || card.kind === "before-photos" || card.kind === "checklist" || card.kind === "cleaning-checklist" || card.kind === "job-checklist" || card.kind === "after-photos" || card.kind === "notes") && (
          <div className="flex justify-center gap-[6px] mt-[18px]">
            {(["scheduled", "job-agreement", "before-photos", "checklist", "cleaning-checklist", "after-photos", "notes"] as const).map((k) => (
              <div
                key={k}
                className="rounded-full transition-all"
                style={{
                  // job-checklist shares the cleaning-checklist dot position
                  width: card.kind === k || (k === "cleaning-checklist" && card.kind === "job-checklist") ? 20 : 6,
                  height: 6,
                  background: card.kind === k || (k === "cleaning-checklist" && card.kind === "job-checklist") ? "#B4FF44" : "rgba(255,255,255,0.15)",
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
