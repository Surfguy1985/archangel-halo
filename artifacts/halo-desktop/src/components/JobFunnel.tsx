import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateInvoice,
  useSetInvoiceStatus,
  useCreateCrewPayment,
  useCloseOutJob,
  getGetPropertyQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  getGetTodayQueryKey,
  getListJobsQueryKey,
  getGetJobQueryKey,
  getGetCalendarQueryKey,
} from "@workspace/api-client-react";
import type { Job, Invoice } from "@workspace/api-client-react";
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
} from "lucide-react";
import { uploadReceiptFile } from "@/components/MoneyDialogs";

type StageKey = "crew" | "work" | "invoice" | "pay" | "close";

const STAGES: {
  key: StageKey;
  label: string;
  Icon: typeof Users;
  active: string;
  done: string;
  ring: string;
}[] = [
  { key: "crew", label: "Crew", Icon: Users, active: "bg-sky-500 text-white", done: "bg-sky-100 text-sky-700", ring: "ring-sky-200" },
  { key: "work", label: "Work", Icon: Hammer, active: "bg-amber-500 text-white", done: "bg-amber-100 text-amber-700", ring: "ring-amber-200" },
  { key: "invoice", label: "Invoice", Icon: Receipt, active: "bg-violet-500 text-white", done: "bg-violet-100 text-violet-700", ring: "ring-violet-200" },
  { key: "pay", label: "Crew pay", Icon: Banknote, active: "bg-teal-500 text-white", done: "bg-teal-100 text-teal-700", ring: "ring-teal-200" },
  { key: "close", label: "Close out", Icon: Sparkles, active: "bg-[var(--gold-dark)] text-white", done: "bg-emerald-100 text-emerald-700", ring: "ring-[rgba(143,106,31,0.25)]" },
];

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function JobFunnel({
  job,
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [amountDraft, setAmountDraft] = useState("");
  const [missing, setMissing] = useState<string[] | null>(null);
  const [closedOut, setClosedOut] = useState<{ emailSent: boolean } | null>(null);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(job.id) });
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

  const defaultAmount = job.lineTotal && job.lineTotal > 0 ? job.lineTotal : 0;

  const doCreateInvoice = async () => {
    const amount = amountDraft.trim() === "" ? defaultAmount : Number(amountDraft);
    if (!amount || Number.isNaN(amount) || amount <= 0) return;
    let attachmentPath: string | undefined;
    if (pendingFile) {
      setUploading(true);
      const path = await uploadReceiptFile(pendingFile);
      setUploading(false);
      if (path) attachmentPath = path;
    }
    createInvoice.mutate(
      { data: { propertyId, jobId: job.id, amount, ...(attachmentPath ? { attachmentPath } : {}) } },
      {
        onSuccess: () => {
          setPendingFile(null);
          setAmountDraft("");
          invalidateAll();
        },
      },
    );
  };

  const doCloseOut = () => {
    setMissing(null);
    closeOut.mutate(
      { id: job.id },
      {
        onSuccess: (res) => {
          setClosedOut({ emailSent: !!res.emailSent });
          invalidateAll();
        },
        onError: (err: unknown) => {
          const data = (err as { data?: { missing?: string[]; error?: string } })?.data;
          setMissing(data?.missing?.length ? data.missing : [data?.error ?? "Close-out failed — please try again."]);
        },
      },
    );
  };

  const pillBtn =
    "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors disabled:opacity-50";

  return (
    <div className="mt-3 rounded-xl border border-border bg-black/[0.015] p-3">
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
                    done ? s.done : isCurrent ? `${s.active} ring-4 ${s.ring}` : "bg-black/[0.05] text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="w-4 h-4" /> : <s.Icon className="w-4 h-4" />}
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${done || isCurrent ? "text-[var(--ink)]" : "text-muted-foreground"}`}>
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
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Users className="w-3.5 h-3.5" /> No crew yet
          </span>
        )}
        {job.nextVisitOn && (
          <span className="inline-flex items-center gap-1.5 text-[var(--ink)]">
            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
            Next visit <b>{fmtDate(job.nextVisitOn)}</b>
          </span>
        )}
        {payDone && (
          <span className="inline-flex items-center gap-1.5 text-teal-700 font-semibold">
            <Banknote className="w-3.5 h-3.5" /> Crew paid
          </span>
        )}
      </div>

      {/* Action row for current stage */}
      <div className="mt-3">
        {closeDone ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <Sparkles className="w-4 h-4" />
            Job closed out{closedOut ? (closedOut.emailSent ? " — thank-you email sent to the crew." : " — no crew email on file, so no email was sent.") : "."}
          </div>
        ) : current === "crew" ? (
          <div className="flex items-center flex-wrap gap-2">
            <Link href="/job-board" className={`${pillBtn} bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100`}>
              <Send className="w-3 h-3" /> Broadcast on job board
            </Link>
            <span className="text-xs text-muted-foreground">A crew accepts the offer and appears here automatically.</span>
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
                <Receipt className="w-3 h-3" /> {invoice!.invoiceNo} · {invoice!.status === "sent" ? "Sent" : invoice!.status === "past_due" ? "Past due" : "Draft"}
              </Link>
              {invoice!.attachmentPath && (
                <a href={`/api/storage${invoice!.attachmentPath}`} target="_blank" rel="noreferrer" className={`${pillBtn} bg-black/[0.05] text-[var(--ink)] hover:bg-black/[0.08]`}>
                  <Paperclip className="w-3 h-3" /> View uploaded invoice
                </a>
              )}
              {invoice!.status === "draft" && (
                <button
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: invoice!.id, data: { status: "sent" } }, { onSuccess: invalidateAll })}
                  className={`${pillBtn} bg-[var(--ink)] text-background hover:opacity-90`}
                >
                  <Send className="w-3 h-3" /> Mark sent
                </button>
              )}
              <button
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: invoice!.id, data: { status: "paid" } }, { onSuccess: invalidateAll })}
                className={`${pillBtn} bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100`}
              >
                <CircleDollarSign className="w-3 h-3" /> Payment received
              </button>
            </div>
          ) : (
            <div className="flex items-center flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
              />
              <button onClick={() => fileRef.current?.click()} className={`${pillBtn} bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100`}>
                <Upload className="w-3 h-3" /> {pendingFile ? "Change file" : "Upload invoice image"}
              </button>
              {pendingFile && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground max-w-[180px]">
                  <Paperclip className="w-3 h-3 shrink-0" />
                  <span className="truncate">{pendingFile.name}</span>
                  <button aria-label="Remove file" onClick={() => setPendingFile(null)} className="hover:text-[var(--ink)]"><X className="w-3 h-3" /></button>
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-xs">
                $
                <input
                  inputMode="decimal"
                  placeholder={defaultAmount > 0 ? String(defaultAmount) : "Amount"}
                  value={amountDraft}
                  onChange={(e) => setAmountDraft(e.target.value)}
                  className="w-24 px-2 py-1 rounded-md border border-border bg-background text-xs tabular-nums"
                />
              </span>
              <button
                disabled={createInvoice.isPending || uploading || (amountDraft.trim() === "" && defaultAmount <= 0)}
                onClick={doCreateInvoice}
                className={`${pillBtn} bg-violet-500 text-white hover:bg-violet-600`}
              >
                {createInvoice.isPending || uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Receipt className="w-3 h-3" />}
                Create invoice
              </button>
              <Link href={`/invoices/new?jobId=${job.id}&propertyId=${propertyId}`} className="text-xs font-semibold text-muted-foreground hover:text-[var(--ink)]">
                Full editor
              </Link>
            </div>
          )
        ) : current === "pay" ? (
          <div className="flex items-center flex-wrap gap-2">
            <button
              disabled={createCrewPayment.isPending || !job.crewLeaderId}
              onClick={() =>
                createCrewPayment.mutate(
                  {
                    data: {
                      crewId: job.crewLeaderId!,
                      amount: job.crewRate ?? 0,
                      status: "completed",
                      jobId: job.id,
                      note: `Job ${job.jobNo} close-out`,
                    },
                  },
                  { onSuccess: invalidateAll },
                )
              }
              className={`${pillBtn} bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100`}
            >
              {createCrewPayment.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Banknote className="w-3 h-3" />}
              Mark crew paid{job.crewRate != null ? ` · $${job.crewRate.toLocaleString()}` : ""}
            </button>
            {job.crewRate == null && (
              <span className="text-xs text-amber-700">Tip: set the crew rate above so the payout amount is right.</span>
            )}
          </div>
        ) : (
          <button
            disabled={closeOut.isPending}
            onClick={doCloseOut}
            className={`${pillBtn} bg-[var(--gold-dark)] text-white hover:opacity-90`}
          >
            {closeOut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Close out job — clear &amp; thank the crew
          </button>
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

      {/* Red safeguard warning */}
      {missing && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-red-700">
            <AlertTriangle className="w-3.5 h-3.5" /> Not ready to close out
          </div>
          <ul className="mt-1.5 space-y-1">
            {missing.map((m) => (
              <li key={m} className="text-sm text-red-700 flex items-start gap-1.5">
                <span className="mt-[7px] w-1 h-1 rounded-full bg-red-500 shrink-0" />
                {m}
              </li>
            ))}
          </ul>
          <button onClick={() => setMissing(null)} className="mt-2 text-[11px] font-semibold text-red-600 hover:text-red-800 underline underline-offset-2">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
