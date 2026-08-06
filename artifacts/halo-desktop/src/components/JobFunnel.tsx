import { useRef, useState} from "react";
import { Link} from "wouter";
import { useQueryClient} from "@tanstack/react-query";
import {
  useCreateInvoice,
  useSetInvoiceStatus,
  useCreateCrewPayment,
  useCloseOutJob,
  useListCrews,
  useUpdateJob,
  useBroadcastJob,
  useGetJob,
  useListJobEvents,
  useScanIngest,
  getGetPropertyQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  getGetTodayQueryKey,
  getListJobsQueryKey,
  getGetJobQueryKey,
  getGetCalendarQueryKey,
  getListJobEventsQueryKey,
} from "@workspace/api-client-react";
import type { Job, Invoice} from "@workspace/api-client-react";
import {
  Users,
  Hammer,
  Receipt,
  Banknote,
  Sparkles,
  Check,
  CalendarDays,
  AlertTriangle,
  Paperclip,
  Upload,
  Loader2,
  Send,
  CircleDollarSign,
  X,
  Radio,
  Camera,
  LogIn,
  LogOut,
  StickyNote,
  Mail,
  FileDown,
} from "lucide-react";
import { uploadReceiptFile} from "@/components/MoneyDialogs";

type StageKey = "crew" | "work" | "invoice" | "pay" | "close";

const STAGES: {
  key: StageKey;
  label: string;
  Icon: typeof Users;
  active: string;
  done: string;
  ring: string;
}[] = [
  { key: "crew", label: "Crew", Icon: Users, active: "bg-sky-500 text-white", done: "bg-sky-100 text-sky-700", ring: "ring-sky-200"},
  { key: "work", label: "Work", Icon: Hammer, active: "bg-amber-500 text-white", done: "bg-amber-100 text-amber-700", ring: "ring-amber-200"},
  { key: "invoice", label: "Invoice", Icon: Receipt, active: "bg-violet-500 text-white", done: "bg-violet-100 text-violet-700", ring: "ring-violet-200"},
  { key: "pay", label: "Crew pay", Icon: Banknote, active: "bg-teal-500 text-white", done: "bg-teal-100 text-teal-700", ring: "ring-teal-200"},
  { key: "close", label: "Close out", Icon: Sparkles, active: "bg-[var(--gold-dark)] text-black", done: "bg-emerald-100 text-emerald-700", ring: "ring-[rgba(143,106,31,0.25)]"},
];

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
 });
}

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric"}) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit"});
}

const EVENT_ICONS: Record<string, typeof Users> = {
  accepted: Check,
  checkin: LogIn,
  checkout: LogOut,
  photo_before: Camera,
  photo_after: Camera,
  photo_progress: Camera,
  note: StickyNote,
  completed: Sparkles,
  email: Mail,
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
   };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
 });
}

const SCAN_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ScanMediaType = (typeof SCAN_TYPES)[number] | "application/pdf";

/**
 * Normalize any browser-decodable image (HEIC on Safari, TIFF, BMP, oversized
 * photos…) to a reasonably-sized JPEG so the scan endpoint can always read it.
 * Returns null when the browser cannot decode the file.
 */
async function imageToJpegBase64(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 2200;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
 } catch {
    return null;
 }
}

export function JobFunnel({
  job: jobProp,
  invoice,
  propertyId,
  onCompleteWork,
  completePending,
}: {
  job: Job;
  invoice: Invoice | undefined;
  propertyId: string;
  onCompleteWork: () => void;
  completePending: boolean;
}) {
  const queryClient = useQueryClient();
  const createInvoice = useCreateInvoice();
  const setStatus = useSetInvoiceStatus();
  const createCrewPayment = useCreateCrewPayment();
  const closeOut = useCloseOutJob();
  const updateJob = useUpdateJob();
  const broadcast = useBroadcastJob();
  const scanIngest = useScanIngest();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [amountDraft, setAmountDraft] = useState("");
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [missingCodes, setMissingCodes] = useState<string[]>([]);
  const [closedOut, setClosedOut] = useState<{ emailSent: boolean} | null>(null);
  const [broadcasted, setBroadcasted] = useState(false);
  const [pickingCrew, setPickingCrew] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [closing, setClosing] = useState(false);

  const crewsQuery = useListCrews();
  const crews = crewsQuery.data ?? [];

  // Live-poll the job while we're waiting for a crew to accept an offer.
  // Gate on the freshest data we have (live poll result, falling back to the
  // prop) so polling stops immediately once a crew accepts.
  const liveJobQuery = useGetJob(jobProp.id, {
    query: {
      queryKey: getGetJobQueryKey(jobProp.id),
      enabled: !jobProp.crewLeaderId && !jobProp.clearedAt,
      refetchInterval: (q) => {
        const fresh = q.state.data?.job;
        const waiting = fresh
          ? !fresh.crewLeaderId && !fresh.clearedAt
          : !jobProp.crewLeaderId && !jobProp.clearedAt;
        return waiting ? 5000 : false;
     },
   },
 });
  const job = liveJobQuery.data?.job ?? jobProp;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId)});
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(job.id)});
    queryClient.invalidateQueries({ queryKey: getListJobEventsQueryKey(job.id)});
 };

  const crewDone = !!job.crewLeaderId;
  const workDone = job.status === "complete";
  const invoiceDone = invoice?.status === "paid";
  const invoiceStarted = !!invoice;
  const payDone = job.crewPaymentStatus === "paid";
  const closeDone = !!job.clearedAt || !!closedOut;

  const stageDone: Record<StageKey, boolean> = {
    crew: crewDone,
    work: workDone,
    invoice: invoiceDone,
    pay: payDone,
    close: closeDone,
 };
  const current: StageKey = !crewDone
    ? "crew"
    : !workDone
      ? "work"
      : !invoiceDone
        ? "invoice"
        : !payDone
          ? "pay"
          : "close";

  // Live work history — only fetched when the panel is open or work is underway.
  const eventsQuery = useListJobEvents(job.id, {
    query: {
      queryKey: getListJobEventsQueryKey(job.id),
      enabled: showHistory,
      refetchInterval: showHistory && !workDone ? 10000 : false,
   },
 });
  const events = eventsQuery.data ?? [];

  const defaultAmount = job.lineTotal && job.lineTotal > 0 ? job.lineTotal : 0;

  const assignCrew = (crewId: string) => {
    if (!crewId || crewId === job.crewLeaderId) {
      setPickingCrew(false);
      return;
   }
    updateJob.mutate(
      { id: job.id, data: { crewLeaderId: crewId}},
      {
        onSuccess: () => {
          setPickingCrew(false);
          setBroadcasted(false);
          invalidateAll();
       },
     },
    );
 };

  const doQuickBroadcast = () => {
    broadcast.mutate(
      { id: job.id, data: { mode: "all"}},
      {
        onSuccess: () => {
          setBroadcasted(true);
          invalidateAll();
       },
     },
    );
 };

  const createFromFile = async (file: File, amount: number) => {
    setUploading(true);
    let path: string | null = null;
    try {
      path = await uploadReceiptFile(file);
   } finally {
      setUploading(false);
   }
    createInvoice.mutate(
      { data: { propertyId, jobId: job.id, amount, ...(path ? { attachmentPath: path} : {})}},
      {
        onSuccess: () => {
          setPendingFile(null);
          setAmountDraft("");
          setScanNote(null);
          setScanError(null);
          invalidateAll();
       },
        onError: (err: unknown) => {
          const data = (err as { data?: { error?: string}})?.data;
          setScanError(data?.error ?? "Couldn't save the invoice. Please try again.");
       },
     },
    );
 };

  const onPickInvoiceFile = async (file: File | null) => {
    setPendingFile(file);
    setScanNote(null);
    setScanError(null);
    if (!file) return;

    // Get the file into a form the scanner can read.
    let image: string | null = null;
    let mediaType: ScanMediaType = "image/jpeg";
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      try {
        image = await fileToBase64(file);
        mediaType = "application/pdf";
     } catch {
        image = null;
     }
   } else {
      image = await imageToJpegBase64(file);
      if (!image && (SCAN_TYPES as readonly string[]).includes(file.type)) {
        try {
          image = await fileToBase64(file);
          mediaType = file.type as ScanMediaType;
       } catch {
          image = null;
       }
     }
   }

    if (!image) {
      setScanError(
       `Couldn't open "${file.name}" — that file type isn't readable here. Use a photo (JPG/PNG) or a PDF, or type the amount below.`,
      );
      return;
   }

    try {
      const res = await scanIngest.mutateAsync({
        data: { image, mediaType, filename: file.name},
     });
      for (const rec of res.records) {
        const f = rec.fields as Record<string, unknown>;
        const amt = Number(f.amount ?? f.total ?? f.totalAmount);
        if (Number.isFinite(amt) && amt > 0) {
          await createFromFile(file, amt);
          return;
       }
     }
      setScanNote("HALO read the file but couldn't find a total — type the amount and it's done.");
   } catch (err: unknown) {
      const data = (err as { data?: { error?: string}})?.data;
      setScanError(data?.error ?? "Couldn't read the file. Check your connection and try again, or type the amount below.");
   }
 };

  const doCreateInvoice = async () => {
    if (!pendingFile) return;
    const amount = Number(amountDraft);
    if (!amount || Number.isNaN(amount) || amount <= 0) return;
    try {
      await createFromFile(pendingFile, amount);
   } catch {
      setScanError("Couldn't save the invoice. Please try again.");
   }
 };

  const doCloseOut = () => {
    setMissing(null);
    setClosing(true);
    closeOut.mutate(
      { id: job.id},
      {
        onSuccess: (res) => {
          setClosedOut({ emailSent: !!res.emailSent});
          setClosing(false);
          invalidateAll();
       },
        onError: (err: unknown) => {
          const data = (err as { data?: { missing?: string[]; missingCodes?: string[]; error?: string}})?.data;
          setMissing(data?.missing?.length ? data.missing : [data?.error ?? "Close-out failed — please try again."]);
          setMissingCodes(data?.missingCodes ?? []);
          setClosing(false);
       },
     },
    );
 };

  const pillBtn =
    "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors disabled:opacity-50";

  // Gold walk-approved flash — persistent lime glow until staff assigns a crew.
  const walkApproved = !!(job as any).walkApprovedAt && !job.crewLeaderId;

  return (
    <div className={[
      "mt-3 rounded-xl border p-3",
      walkApproved
        ? "border-[#B4FF44]/60 bg-[#B4FF44]/[0.04] ring-2 ring-[#B4FF44]/40 shadow-[0_0_18px_0_rgba(180,255,68,0.22)]"
        : "border-border bg-black/[0.015]",
    ].join(" ")}>
      {/* Stepper */}
      <div className="flex items-center">
        {STAGES.map((s, i) => {
          const done = stageDone[s.key];
          const isCurrent = s.key === current && !closeDone;
          return (
            <div key={s.key} className={`flex items-center ${i > 0 ? "flex-1" : ""}`}>
              {i > 0 && (
                <div className={`h-[2px] flex-1 mx-1.5 rounded-full ${stageDone[STAGES[i - 1].key] ? "bg-emerald-300" : "bg-border"}`} />
              )}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    done ? s.done : isCurrent ?`${s.active} ring-4 ${s.ring}` : "bg-black/[0.05] text-muted-foreground"
                 }`}
                >
                  {done ? <Check className="w-4 h-4" /> : <s.Icon className="w-4 h-4" />}
                </div>
                <span className={`text-[10px] font-bold   ${done || isCurrent ? "text-[var(--ink)]" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </div>
            </div>
          );
       })}
      </div>

      {/* Live crew line */}
      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
        {crewDone ? (
          <span className="inline-flex items-center gap-1.5 text-sky-700 font-semibold">
            <Users className="w-3.5 h-3.5" /> {job.crewLeaderName ?? "Crew assigned"}
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Users className="w-3.5 h-3.5" /> No crew yet
            {broadcasted && (
              <span className="inline-flex items-center gap-1 text-sky-700 font-semibold">
                <Loader2 className="w-3 h-3 animate-spin" /> Broadcast live — watching for a crew…
              </span>
            )}
          </span>
        )}
        {!closeDone && (
          <button
            onClick={() => setPickingCrew((v) => !v)}
            className="text-[11px] font-semibold text-sky-700 hover:text-sky-900 underline underline-offset-2"
          >
            {crewDone ? "Change crew" : "Assign a crew"}
          </button>
        )}
        {crewDone && (
          <Link href="/calendar" className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-[var(--ink)] underline underline-offset-2">
            <CalendarDays className="w-3 h-3" /> Schedule
          </Link>
        )}
        {job.nextVisitOn && (
          <span className="inline-flex items-center gap-1.5 text-[var(--ink)]">
            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
            Next visit <b>{fmtDate(job.nextVisitOn)}</b>
          </span>
        )}
        {crewDone && !closeDone && (
          payDone ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
              <Banknote className="w-3 h-3" /> Crew paid
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              <Banknote className="w-3 h-3" /> Crew pay pending
            </span>
          )
        )}
      </div>

      {/* Pre-close checklist — always visible so nothing surprises at close-out */}
      {!closeDone && (
        <div className="mt-3 flex items-center flex-wrap gap-2">
          <span className="text-[10px] font-bold text-muted-foreground">Before close-out:</span>
          {([
            ["Crew assigned", crewDone],
            ["Work verified", workDone],
            ["Invoice paid", invoiceDone],
            ["Crew paid", payDone],
          ] as const).map(([label, done]) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1 text-[10px] font-bold   px-2 py-0.5 rounded-full border ${
                done
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-black/[0.03] text-muted-foreground border-border"
             }`}
            >
              {done ? <Check className="w-3 h-3" /> : <X className="w-3 h-3 opacity-60" />}
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Crew picker */}
      {pickingCrew && !closeDone && (
        <div className="mt-2 flex items-center flex-wrap gap-2">
          <select
            defaultValue={job.crewLeaderId ?? ""}
            disabled={updateJob.isPending}
            onChange={(e) => assignCrew(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-md border border-border bg-background font-semibold"
          >
            <option value="">Pick a crew…</option>
            {crews.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {updateJob.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          <span className="text-[11px] text-muted-foreground">Assigning manually also marks the job filled on the job board.</span>
        </div>
      )}

      {/* Live work history link + panel */}
      {crewDone && (
        <div className="mt-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 hover:text-red-800 underline underline-offset-2"
          >
            <Radio className="w-3 h-3" /> {showHistory ? "Hide live work updates" : "Live work updates"}
          </button>
          {showHistory && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50/60 p-2.5 max-h-56 overflow-y-auto">
              {eventsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-red-700">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading work history…
                </div>
              ) : events.length === 0 ? (
                <div className="text-xs text-red-700">No field activity yet — updates appear here the moment the crew checks in, uploads photos, or completes the job.</div>
              ) : (
                <ul className="space-y-1.5">
                  {events.map((ev, i) => {
                    const Icon = EVENT_ICONS[ev.kind] ?? StickyNote;
                    return (
                      <li key={`${ev.kind}-${ev.at}-${i}`} className="flex items-start gap-2 text-xs text-red-700">
                        <Icon className="w-3.5 h-3.5 mt-[1px] shrink-0" />
                        <span>
                          <b>{ev.label}</b>
                          {ev.crewName ?` — ${ev.crewName}` : ""}
                          <span className="text-red-500"> · {fmtWhen(ev.at)}</span>
                        </span>
                      </li>
                    );
                 })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Invoice status badges */}
      {invoiceStarted && (
        <div className="mt-2 flex items-center flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
            <Receipt className="w-3 h-3" /> {invoice!.invoiceNo}
          </span>
          {invoice!.status === "paid" ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Paid</span>
          ) : invoice!.status === "sent" || invoice!.status === "past_due" ? (
            <>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">Sent</span>
              <span className={`text-[10px] font-bold   px-2 py-0.5 rounded-full ${invoice!.status === "past_due" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                {invoice!.status === "past_due" ? "Past due" : "Pending payment"}
              </span>
            </>
          ) : (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/[0.06] text-muted-foreground">Draft — not sent</span>
          )}
        </div>
      )}

      {/* Action row for current stage */}
      <div className="mt-3">
        {closeDone ? (
          <div className="flex items-center flex-wrap gap-2 text-sm font-semibold text-emerald-700">
            <Sparkles className="w-4 h-4" />
            Job closed out
            {closedOut
              ? closedOut.emailSent
                ? " — thank-you email sent to the crew."
                : " — no crew email on file, so no crew email was sent."
              : "."}
            <a
              href={`/api/jobs/${job.id}/report`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900"
            >
              <FileDown className="w-3 h-3" /> Download PDF summary
            </a>
          </div>
        ) : current === "crew" ? (
          <div className="flex items-center flex-wrap gap-2">
            <button
              disabled={broadcast.isPending}
              onClick={doQuickBroadcast}
              className={`${pillBtn} bg-sky-500 text-white hover:bg-sky-600`}
            >
              {broadcast.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radio className="w-3 h-3" />}
              {broadcasted ? "Re-broadcast to all crews" : "Broadcast to all crews"}
            </button>
            <Link href="/job-board" className={`${pillBtn} bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100`}>
              <Send className="w-3 h-3" /> Open job board
            </Link>
            <span className="text-xs text-muted-foreground">The first crew to accept appears here automatically with a green check.</span>
          </div>
        ) : current === "work" ? (
          <button
            disabled={completePending}
            onClick={onCompleteWork}
            className={`${pillBtn} bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100`}
          >
            <Check className="w-3 h-3" /> Verified — work complete
          </button>
        ) : current === "invoice" ? (
          invoiceStarted ? (
            <div className="flex items-center flex-wrap gap-2">
              <Link href={`/invoices/${invoice!.id}`} className={`${pillBtn} bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100`}>
                <Receipt className="w-3 h-3" /> Open invoice
              </Link>
              {invoice!.attachmentPath && (
                <a href={`/api/storage${invoice!.attachmentPath}`} target="_blank" rel="noreferrer" className={`${pillBtn} bg-black/[0.05] text-[var(--ink)] hover:bg-black/[0.08]`}>
                  <Paperclip className="w-3 h-3" /> View uploaded invoice
                </a>
              )}
              {invoice!.status === "draft" && (
                <button
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: invoice!.id, data: { status: "sent"}}, { onSuccess: invalidateAll})}
                  className={`${pillBtn} bg-[var(--ink)] text-background hover:opacity-90`}
                >
                  <Send className="w-3 h-3" /> Mark sent
                </button>
              )}
              <button
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: invoice!.id, data: { status: "paid"}}, { onSuccess: invalidateAll})}
                className={`${pillBtn} bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100`}
              >
                <CircleDollarSign className="w-3 h-3" /> Payment received
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => void onPickInvoiceFile(e.target.files?.[0] ?? null)}
                />
                <button
                  disabled={scanIngest.isPending || uploading || createInvoice.isPending}
                  onClick={() => fileRef.current?.click()}
                  className={`${pillBtn} bg-violet-500 text-white hover:bg-violet-600`}
                >
                  {scanIngest.isPending || uploading || createInvoice.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  {scanIngest.isPending
                    ? "Reading the invoice…"
                    : uploading || createInvoice.isPending
                      ? "Saving invoice…"
                      : "Upload invoice"}
                </button>
                <span className="text-xs text-muted-foreground">Snap or upload it — HALO reads the amount and files it.</span>
              </div>
              {scanError && (
                <div className="mt-2 text-[11px] font-semibold text-red-600">{scanError}</div>
              )}
              {(scanNote || scanError) && pendingFile && (
                <div className="mt-2 flex items-center flex-wrap gap-2">
                  {scanNote && <span className="text-[11px] font-semibold text-violet-700">{scanNote}</span>}
                  <span className="inline-flex items-center gap-1 text-xs">
                    $
                    <input
                      inputMode="decimal"
                      autoFocus
                      placeholder="Amount"
                      value={amountDraft}
                      onChange={(e) => setAmountDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void doCreateInvoice();}}
                      className="w-24 px-2 py-1 rounded-md border border-border bg-background text-xs tabular-nums"
                    />
                  </span>
                  <button
                    disabled={createInvoice.isPending || uploading || amountDraft.trim() === ""}
                    onClick={() => void doCreateInvoice()}
                    className={`${pillBtn} bg-violet-500 text-white hover:bg-violet-600`}
                  >
                    <Receipt className="w-3 h-3" /> Save
                  </button>
                  <button aria-label="Cancel upload" onClick={() => { setPendingFile(null); setScanNote(null); setScanError(null);}} className="text-muted-foreground hover:text-[var(--ink)]"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
          )
        ) : current === "pay" ? (
          <div className="flex items-center flex-wrap gap-3">
            <label className={`flex items-center gap-2 text-sm font-semibold ${createCrewPayment.isPending ? "opacity-60" : "cursor-pointer"} text-teal-700`}>
              <input
                type="checkbox"
                checked={false}
                disabled={createCrewPayment.isPending || !job.crewLeaderId}
                onChange={() =>
                  createCrewPayment.mutate(
                    {
                      data: {
                        crewId: job.crewLeaderId!,
                        amount: job.crewRate ?? 0,
                        status: "completed",
                        jobId: job.id,
                        note:`Job ${job.jobNo} close-out`,
                     },
                   },
                    { onSuccess: invalidateAll},
                  )
               }
                className="w-4 h-4 accent-teal-600"
              />
              Crew paid{job.crewRate != null ?` · $${job.crewRate.toLocaleString()}` : ""}
              {createCrewPayment.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            </label>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Payment pending</span>
            {job.crewRate == null && (
              <span className="text-xs text-amber-700">Tip: set the crew rate above so the payout amount is right.</span>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="text-[10px] font-bold text-emerald-800">
              Final check — verify, then close out
            </div>
            <ul className="mt-2 space-y-1">
              {([
                ["Crew assigned", crewDone, job.crewLeaderName ?? undefined],
                ["Work verified complete", workDone, undefined],
                [
                  "Invoice paid",
                  invoiceDone,
                  invoice ?`${invoice.invoiceNo} · $${invoice.amount.toLocaleString()}` : undefined,
                ],
                [
                  "Crew paid",
                  payDone,
                  job.crewRate != null ?`$${job.crewRate.toLocaleString()}` : undefined,
                ],
              ] as const).map(([label, done, detail]) => (
                <li key={label} className="flex items-center gap-2 text-sm">
                  {done ? (
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <X className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                  <span className={`font-semibold ${done ? "text-[var(--ink)]" : "text-red-700"}`}>{label}</span>
                  {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center flex-wrap gap-2">
              <button
                disabled={closing || closeOut.isPending}
                onClick={doCloseOut}
                className={`${pillBtn} bg-[var(--primary)] text-black hover:opacity-90 shadow-[0_2px_10px_rgba(180,255,68,0.35)]`}
              >
                {closing || closeOut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Looks right — close out job
              </button>
              <a
                href={`/api/jobs/${job.id}/report`}
                className={`${pillBtn} bg-black/[0.05] text-[var(--ink)] hover:bg-black/[0.08]`}
              >
                <FileDown className="w-3 h-3" /> Download PDF summary
              </a>
              <span className="text-[11px] text-muted-foreground">The PDF is a keeper copy for your records — nothing is sent to anyone.</span>
            </div>
          </div>
        )}
        {!closeDone && current !== "close" && (
          <div className="mt-2">
            <button
              disabled={closeOut.isPending}
              onClick={doCloseOut}
              className="text-[11px] font-semibold text-muted-foreground hover:text-[var(--ink)] underline underline-offset-2"
            >
              Try to close out now
            </button>
          </div>
        )}
      </div>

      {/* Actionable close-out blockers — each item has a fix right here */}
      {missing && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div className="flex items-center gap-1.5 text-sm font-bold text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" /> Fix these before closing out:
          </div>
          <div className="space-y-2.5">
            {missing.map((m, i) => {
              const code = missingCodes[i] ?? "";
              return (
                <div key={m} className="flex items-start justify-between gap-3 p-2.5 bg-white rounded-lg border border-amber-100">
                  <span className="text-sm text-amber-900 leading-snug">{m}</span>
                  <div className="shrink-0">
                    {/* invoice missing → create one from line total */}
                    {code === "invoice" && (
                      <button
                        onClick={() =>
                          createInvoice.mutate(
                            { data: { propertyId, jobId: job.id, amount: defaultAmount } },
                            { onSuccess: () => { setMissing(null); setMissingCodes([]); invalidateAll(); } },
                          )
                        }
                        disabled={createInvoice.isPending}
                        className="text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--primary)] text-black hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                      >
                        {createInvoice.isPending ? "Creating…" : "Create invoice"}
                      </button>
                    )}
                    {/* invoice not paid → mark paid */}
                    {code === "invoice_paid" && invoice && (
                      <button
                        onClick={() =>
                          setStatus.mutate(
                            { id: invoice.id, data: { status: "paid" } },
                            { onSuccess: () => { setMissing(null); setMissingCodes([]); invalidateAll(); } },
                          )
                        }
                        disabled={setStatus.isPending}
                        className="text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--primary)] text-black hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                      >
                        {setStatus.isPending ? "Saving…" : "Mark invoice paid"}
                      </button>
                    )}
                    {/* no crew → open crew picker */}
                    {code === "crew" && (
                      <button
                        onClick={() => { setPickingCrew(true); setMissing(null); setMissingCodes([]); }}
                        className="text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--primary)] text-black hover:opacity-90 whitespace-nowrap"
                      >
                        Assign crew
                      </button>
                    )}
                    {/* work or crew_pay → go to job board */}
                    {(code === "work" || code === "crew_pay") && (
                      <Link
                        href="/jobboard"
                        className="text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--secondary)] text-white hover:opacity-90 whitespace-nowrap inline-block"
                      >
                        Go to Job Board →
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => { setMissing(null); setMissingCodes([]); }}
            className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
