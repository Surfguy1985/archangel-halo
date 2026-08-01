// "Update client" — one prefilled sheet that pushes photos, live tracker,
// recap, invoice, or a note straight onto the client's board via the
// existing push/dedupe pipeline (raiseClientCard: propertyId+sourceType+sourceId).
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePushClientBoardCard,
  useGetClientBoardPushQuickPicks,
  getGetClientBoardPushQuickPicksQueryKey,
  getGetTodayQueryKey,
  type ClientCardPushInput,
} from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Camera, CheckCircle2, FileText, Loader2, MapPin, Send, StickyNote } from "lucide-react";

export type UpdateClientKind = "tracker" | "photos" | "summary" | "invoice" | "manual";

const KINDS: {
  kind: UpdateClientKind;
  label: string;
  icon: typeof MapPin;
  titlePrefill: string;
  bodyPlaceholder: string;
  actionLabel?: string;
}[] = [
  { kind: "tracker", label: "Live tracker", icon: MapPin, titlePrefill: "Crew on site", bodyPlaceholder: "Short scope summary — what the crew is doing today" },
  { kind: "photos", label: "Photos", icon: Camera, titlePrefill: "Job photos", bodyPlaceholder: "What the photos show" },
  { kind: "summary", label: "Recap", icon: CheckCircle2, titlePrefill: "", bodyPlaceholder: "What got done, in one or two lines" },
  { kind: "invoice", label: "Invoice", icon: FileText, titlePrefill: "", bodyPlaceholder: "Optional note about the invoice" },
  { kind: "manual", label: "Note", icon: StickyNote, titlePrefill: "", bodyPlaceholder: "Anything the client should know" },
];

export function UpdateClientSheet({
  open,
  onOpenChange,
  propertyId,
  jobId,
  initialKind,
  invoiceId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: string;
  /** When set, quick-picks are narrowed to this job. */
  jobId?: string | null;
  initialKind?: UpdateClientKind | null;
  /** When set with initialKind="invoice", anchors the push to this invoice. */
  invoiceId?: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const push = usePushClientBoardCard();

  const [kind, setKind] = useState<UpdateClientKind>(initialKind ?? "tracker");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [source, setSource] = useState<{ type: string; id: string; jobId?: string } | null>(null);

  const { data: quickPicks } = useGetClientBoardPushQuickPicks(propertyId, {
    query: {
      queryKey: getGetClientBoardPushQuickPicksQueryKey(propertyId),
      enabled: open && !!propertyId,
    },
  });

  const selectKind = (k: UpdateClientKind) => {
    const def = KINDS.find((x) => x.kind === k)!;
    setKind(k);
    setTitle(def.titlePrefill);
    setBody("");
    setAmount("");
    setDueDate("");
    setLinkUrl("");
    setSource(null);
  };

  useEffect(() => {
    if (open) selectKind(initialKind ?? "tracker");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKind]);

  // Auto-select the quick pick for this job when there's an obvious match.
  useEffect(() => {
    if (!open || !quickPicks || !jobId || source) return;
    if (kind === "tracker") {
      const tr = quickPicks.trackers.find((t) => t.jobId === jobId);
      if (tr) {
        setSource({ type: "tracker", id: tr.jobId, jobId: tr.jobId });
        setTitle(`Job ${tr.jobNo} — crew on site`);
        if (tr.description) setBody(tr.description);
        setLinkUrl(tr.trackerUrl);
      }
    } else if (kind === "photos") {
      const p = quickPicks.photoJobs.find((x) => x.jobId === jobId);
      if (p) {
        setSource({ type: "photos", id: p.jobId, jobId: p.jobId });
        setTitle(`Photos: Job ${p.jobNo}`);
        if (p.description) setBody(p.description);
      }
    }
  }, [open, quickPicks, jobId, kind, source]);

  // Anchor to a specific invoice when the caller passed one.
  useEffect(() => {
    if (!open || !quickPicks || kind !== "invoice" || !invoiceId || source) return;
    const inv = quickPicks.invoices.find((x) => x.id === invoiceId);
    if (inv) {
      setSource({ type: "invoice", id: inv.id });
      setTitle(`Invoice ${inv.invoiceNo}`);
      setAmount(String(inv.amount));
      setDueDate(inv.dueDate ?? "");
      if (inv.payUrl) setLinkUrl(inv.payUrl);
    }
  }, [open, quickPicks, kind, invoiceId, source]);

  const picks = useMemo(() => {
    if (!quickPicks) return [];
    switch (kind) {
      case "tracker":
        return quickPicks.trackers.map((t) => ({
          id: t.jobId,
          label: `Job ${t.jobNo}${t.unitNo ? ` · Unit ${t.unitNo}` : ""}`,
          sub: t.description ?? "",
          apply: () => {
            setSource({ type: "tracker", id: t.jobId, jobId: t.jobId });
            setTitle(`Job ${t.jobNo} — crew on site`);
            if (t.description) setBody(t.description);
            setLinkUrl(t.trackerUrl);
          },
        }));
      case "photos":
        return quickPicks.photoJobs.map((p) => ({
          id: p.jobId,
          label: `Job ${p.jobNo}${p.unitNo ? ` · Unit ${p.unitNo}` : ""}`,
          sub: `${p.photoCount} photos`,
          apply: () => {
            setSource({ type: "photos", id: p.jobId, jobId: p.jobId });
            setTitle(`Photos: Job ${p.jobNo}`);
            if (p.description) setBody(p.description);
          },
        }));
      case "summary":
        return quickPicks.summaries.map((s) => ({
          id: s.id,
          label: s.title,
          sub: `${s.serviceDate} · ${s.status}`,
          apply: () => {
            setSource({ type: "summary", id: s.id });
            setTitle(s.title);
          },
        }));
      case "invoice":
        return quickPicks.invoices.map((inv) => ({
          id: inv.id,
          label: `Inv ${inv.invoiceNo}`,
          sub: `$${inv.amount.toFixed(2)}${inv.dueDate ? ` · due ${inv.dueDate}` : ""}`,
          apply: () => {
            setSource({ type: "invoice", id: inv.id });
            setTitle(`Invoice ${inv.invoiceNo}`);
            setAmount(String(inv.amount));
            setDueDate(inv.dueDate ?? "");
            if (inv.payUrl) setLinkUrl(inv.payUrl);
          },
        }));
      default:
        return [];
    }
  }, [quickPicks, kind]);

  const submit = () => {
    // Guarantee a canonical dedupe identity for tracker/photos pushes even if
    // the quick pick hasn't resolved: fall back to the job id from context.
    const effectiveSource: { type: string; id: string; jobId?: string } | null =
      source ??
      ((kind === "tracker" || kind === "photos") && jobId
        ? { type: kind, id: jobId, jobId }
        : kind === "invoice" && invoiceId
          ? { type: "invoice", id: invoiceId }
          : null);
    const data: ClientCardPushInput = {
      kind: kind as ClientCardPushInput["kind"],
      title: title.trim(),
      body: body.trim() || null,
      amount: amount ? Number(amount) : null,
      dueDate: dueDate || null,
      linkUrl: linkUrl.trim() || null,
      linkLabel: linkUrl.trim()
        ? kind === "tracker"
          ? "Watch live"
          : kind === "invoice"
            ? "Pay now"
            : "Open"
        : null,
      sourceType: effectiveSource?.type || null,
      sourceId: effectiveSource?.id || null,
      jobId: effectiveSource?.jobId ?? jobId ?? null,
    };
    push.mutate(
      { propertyId, data },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          toast({
            title: "Client updated",
            description: res.notified ? "Card pushed — instant email sent." : "Card added to their board.",
          });
          onOpenChange(false);
        },
        onError: (err) => {
          const e = err as { data?: { error?: string } };
          toast({
            title: "Couldn't update the client",
            description: e?.data?.error ?? "This property may not have a client dashboard yet.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const inputCls =
    "w-full text-[14px] bg-[var(--paper)] border border-[var(--hairline)] rounded-[10px] px-[12px] py-[9px] outline-none focus:border-[var(--gold)] text-[var(--ink)] focus:ring-1 focus:ring-[var(--gold)]/40 transition-all";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[26px] bg-card p-0 flex flex-col max-h-[86vh] border-none">
        <SheetHeader className="p-[18px] pb-[10px] text-left shrink-0">
          <SheetTitle className="font-display font-bold text-[18px] text-[var(--ink)]">Update the client</SheetTitle>
          <p className="text-[12.5px] text-muted-foreground">Pushes a card to their board instantly.</p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-[18px] pb-[18px] space-y-[14px]">
          <div className="flex flex-wrap gap-[8px]">
            {KINDS.map((k) => {
              const Icon = k.icon;
              const active = kind === k.kind;
              return (
                <button
                  key={k.kind}
                  onClick={() => selectKind(k.kind)}
                  data-testid={`chip-update-kind-${k.kind}`}
                  className={`flex items-center gap-[6px] px-[12px] py-[8px] rounded-full text-[12.5px] font-display font-bold border transition-all active:scale-[0.96] ${
                    active
                      ? "bg-[var(--gold-light)] text-black border-transparent"
                      : "bg-[var(--paper)] text-[var(--ink)] border-[var(--hairline)]"
                  }`}
                >
                  <Icon className="w-[14px] h-[14px]" /> {k.label}
                </button>
              );
            })}
          </div>

          {picks.length > 0 && (
            <div className="space-y-[6px]">
              <div className="text-[11px] font-display font-bold uppercase tracking-[0.1em] text-muted-foreground">Quick pick</div>
              <div className="flex flex-col gap-[6px]">
                {picks.slice(0, 6).map((p) => (
                  <button
                    key={p.id}
                    onClick={p.apply}
                    data-testid={`button-quickpick-${p.id}`}
                    className={`text-left px-[12px] py-[9px] rounded-[12px] border transition-all active:scale-[0.98] ${
                      source?.id === p.id
                        ? "bg-[var(--gold-tint)] border-[var(--gold)]"
                        : "bg-[var(--paper)] border-[var(--hairline)]"
                    }`}
                  >
                    <div className="text-[13.5px] font-bold text-[var(--ink)]">{p.label}</div>
                    {p.sub && <div className="text-[12px] text-muted-foreground truncate">{p.sub}</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] font-display font-bold uppercase tracking-[0.1em] text-muted-foreground mb-[6px]">Title</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short and punchy" className={inputCls} data-testid="input-update-title" />
          </div>
          <div>
            <div className="text-[11px] font-display font-bold uppercase tracking-[0.1em] text-muted-foreground mb-[6px]">Message</div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder={KINDS.find((k) => k.kind === kind)?.bodyPlaceholder}
              className={`${inputCls} resize-y`}
              data-testid="input-update-body"
            />
          </div>
          {kind === "invoice" && (
            <div className="grid grid-cols-2 gap-[10px]">
              <div>
                <div className="text-[11px] font-display font-bold uppercase tracking-[0.1em] text-muted-foreground mb-[6px]">Amount</div>
                <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={inputCls} />
              </div>
              <div>
                <div className="text-[11px] font-display font-bold uppercase tracking-[0.1em] text-muted-foreground mb-[6px]">Due date</div>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
              </div>
            </div>
          )}
        </div>
        <div className="p-[18px] pt-[10px] border-t border-[var(--hairline)] shrink-0">
          <button
            onClick={submit}
            disabled={push.isPending || !title.trim()}
            data-testid="button-send-update"
            className="w-full flex items-center justify-center gap-[8px] py-[13px] rounded-[16px] bg-[var(--gold-light)] text-black text-[15px] font-bold disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            {push.isPending ? <Loader2 className="w-[17px] h-[17px] animate-spin" /> : <Send className="w-[17px] h-[17px]" />}
            Send to client board
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
