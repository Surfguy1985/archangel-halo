import { useState, useEffect } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOfficeClientBoard,
  getGetOfficeClientBoardQueryKey,
  useCreateOfficeClientBoardCard,
  useUpdateOfficeClientBoardCard,
  useDeleteOfficeClientBoardCard,
  usePushClientBoardCard,
  useGetClientBoardPushQuickPicks,
  getGetClientBoardPushQuickPicksQueryKey,
  type ClientBoardFeedCard,
} from "@workspace/api-client-react";
import {
  ChevronLeft,
  Pencil,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  FileText,
  Flag,
  Inbox,
  Link2,
  ListTodo,
  Loader2,
  MapPin,
  Play,
  Plus,
  Send,
  Trash2,
  Webhook,
  X,
  BellRing,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Mirrors the client-facing board (halo /client/:token/board) — same columns,
// same card anatomy — so the office sees exactly what the client sees.
const COLUMNS = [
  { key: "inbox", label: "From Archangel", icon: Inbox },
  { key: "todo", label: "To do", icon: ListTodo },
  { key: "in_progress", label: "In progress", icon: Play },
  { key: "done", label: "Done", icon: CheckCircle2 },
] as const;

const KIND_META: Record<string, { label: string; cls: string }> = {
  invoice: { label: "Invoice", cls: "bg-amber-100 text-amber-800" },
  payment_request: { label: "Payment", cls: "bg-emerald-100 text-emerald-800" },
  summary: { label: "Recap", cls: "bg-sky-100 text-sky-800" },
  flag: { label: "Flagged", cls: "bg-red-100 text-red-700" },
  tracker: { label: "Live job", cls: "bg-violet-100 text-violet-800" },
  photos: { label: "Photos", cls: "bg-pink-100 text-pink-800" },
  manual: { label: "Note", cls: "bg-neutral-200 text-neutral-700" },
};

function linkIcon(kind?: string | null) {
  if (kind === "pay") return CreditCard;
  if (kind === "pdf") return FileText;
  if (kind === "tracker") return MapPin;
  return Link2;
}

function CardView({
  card,
  onEdit,
  onRemove,
  removing,
}: {
  card: ClientBoardFeedCard;
  onEdit?: () => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const meta = KIND_META[card.kind] ?? KIND_META.manual;
  const editable = card.kind === "manual" && (onEdit || onRemove);
  return (
    <div className="group rounded-xl border border-border bg-card p-3 shadow-sm space-y-2" data-testid={`card-${card.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>
          {card.kind === "flag" ? <Flag className="inline h-3 w-3 mr-1 -mt-0.5" /> : null}
          {meta.label}
        </span>
        <div className="flex items-center gap-2">
          {card.amount != null && (
            <span className="text-sm font-bold tabular-nums">
              {card.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}
            </span>
          )}
          {editable && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {onEdit && (
                <button
                  onClick={onEdit}
                  title="Edit this card"
                  className="text-muted-foreground hover:text-foreground p-0.5"
                  data-testid={`button-edit-card-${card.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              {onRemove && (
                <button
                  onClick={onRemove}
                  disabled={removing}
                  title="Take this card back"
                  className="text-muted-foreground hover:text-red-600 p-0.5 disabled:opacity-50"
                  data-testid={`button-remove-card-${card.id}`}
                >
                  {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="text-sm font-semibold leading-snug">{card.title}</div>
      {card.body && (
        <div className="text-xs text-muted-foreground whitespace-pre-line line-clamp-4">{card.body}</div>
      )}
      {card.dueDate && <div className="text-[11px] text-muted-foreground">Due {card.dueDate}</div>}
      {card.links.length > 0 && (
        <div className="space-y-1">
          {card.links.map((l, i) => {
            const Icon = linkIcon(l.kind);
            return (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium underline underline-offset-2 hover:text-muted-foreground"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {l.label}
              </a>
            );
          })}
        </div>
      )}
      {card.actionLabel && (
        <div className="text-[11px] text-muted-foreground truncate">{card.actionLabel}</div>
      )}
    </div>
  );
}

type DraftLink = { label: string; url: string };

function SendCardForm({
  propertyId,
  editCard,
  onClose,
}: {
  propertyId: string;
  editCard?: ClientBoardFeedCard | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState(editCard?.title ?? "");
  const [body, setBody] = useState(editCard?.body ?? "");
  const [dueDate, setDueDate] = useState(editCard?.dueDate ?? "");
  const [links, setLinks] = useState<DraftLink[]>(
    editCard?.links.map((l) => ({ label: l.label, url: l.url })) ?? [],
  );
  const create = useCreateOfficeClientBoardCard();
  const update = useUpdateOfficeClientBoardCard();
  const isPending = create.isPending || update.isPending;

  const submit = () => {
    const data = {
      title: title.trim(),
      body: body.trim() || null,
      dueDate: dueDate || null,
      links: links
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.label && l.url),
    };
    const opts = {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(propertyId) });
        toast(
          editCard
            ? { title: "Card updated", description: "The client sees the corrected card." }
            : { title: "Card sent", description: "It's now in the client's From Archangel column." },
        );
        onClose();
      },
      onError: (err: Error) =>
        toast({
          title: editCard ? "Couldn't update the card" : "Couldn't send the card",
          description: err.message,
          variant: "destructive" as const,
        }),
    };
    if (editCard) {
      update.mutate({ propertyId, cardId: editCard.id, data }, opts);
    } else {
      create.mutate({ propertyId, data }, opts);
    }
  };

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--primary)]";

  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm space-y-4 border border-[var(--primary)]/40">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-bold">
          {editCard ? "Edit this card" : "Send a card to the client"}
        </h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-close-send-card">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='Title — e.g. "Please clear unit 4B by Friday"'
            className={inputCls}
            data-testid="input-card-title"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Note (optional) — any detail the client needs"
            rows={3}
            className={inputCls}
            data-testid="input-card-body"
          />
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Due date (optional)</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputCls}
              data-testid="input-card-due"
            />
          </div>
          <button
            onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}
            className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground"
            data-testid="button-add-link"
          >
            <Plus className="w-3.5 h-3.5" /> Add a link
          </button>
        </div>
      </div>
      {links.length > 0 && (
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={l.label}
                onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Link label"
                className={`${inputCls} max-w-[220px]`}
                data-testid={`input-link-label-${i}`}
              />
              <input
                value={l.url}
                onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                placeholder="https://…"
                className={inputCls}
                data-testid={`input-link-url-${i}`}
              />
              <button
                onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-red-600 shrink-0"
                data-testid={`button-remove-link-${i}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={submit}
        disabled={isPending || !title.trim()}
        className="px-5 py-2.5 bg-[var(--gold-light,#B4FF44)] text-black text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
        data-testid="button-send-card"
      >
        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {editCard ? "Save changes" : "Send to their board"}
      </button>
    </div>
  );
}

const PUSH_KINDS = [
  { value: "invoice", label: "Invoice" },
  { value: "payment_request", label: "Payment request" },
  { value: "summary", label: "Job summary" },
  { value: "tracker", label: "Live tracker" },
  { value: "photos", label: "Photos" },
  { value: "flag", label: "Heads-up" },
  { value: "manual", label: "Note" },
];

function PushCardDialog({ propertyId, open, onOpenChange }: { propertyId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const push = usePushClientBoardCard();

  const [kind, setKind] = useState("manual");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("Open");
  // Dedupe source + job ref set by quick-picks; cleared when the user edits by hand.
  const [source, setSource] = useState<{ type: string; id: string; jobId?: string } | null>(null);

  const { data: quickPicks } = useGetClientBoardPushQuickPicks(propertyId, {
    query: {
      queryKey: getGetClientBoardPushQuickPicksQueryKey(propertyId),
      enabled: open,
    },
  });

  useEffect(() => {
    if (open) {
      setKind("manual");
      setTitle("");
      setBody("");
      setAmount("");
      setDueDate("");
      setLinkUrl("");
      setLinkLabel("Open");
      setSource(null);
    }
  }, [open]);

  const pickInvoice = (inv: NonNullable<typeof quickPicks>["invoices"][number]) => {
    setKind("invoice");
    setTitle(`Invoice ${inv.invoiceNo}`);
    setAmount(String(inv.amount));
    setDueDate(inv.dueDate ?? "");
    setLinkUrl(inv.payUrl ?? "");
    setLinkLabel(inv.payUrl ? "Pay now" : "Open");
    setSource({ type: "invoice", id: inv.id });
  };

  const pickTracker = (t: NonNullable<typeof quickPicks>["trackers"][number]) => {
    setKind("tracker");
    setTitle(`Live tracker — Job ${t.jobNo}`);
    setBody(t.description || `Watch crew arrivals, GPS check-ins, and photos live for job ${t.jobNo}.`);
    setAmount("");
    setDueDate("");
    setLinkUrl(t.trackerUrl);
    setLinkLabel("Watch live");
    setSource({ type: "tracker", id: t.jobId, jobId: t.jobId });
  };

  const handleSubmit = () => {
    push.mutate(
      {
        propertyId,
        data: {
          kind,
          title: title.trim(),
          body: body.trim() || null,
          amount: (kind === "invoice" || kind === "payment_request") && amount ? Number(amount) : null,
          dueDate: (kind === "invoice" || kind === "payment_request") && dueDate ? dueDate : null,
          linkUrl: linkUrl.trim() || null,
          linkLabel: linkUrl.trim() ? linkLabel.trim() || "Open" : null,
          sourceType: source?.type ?? null,
          sourceId: source?.id ?? null,
          jobId: source?.jobId ?? null,
        },
      },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(propertyId) });

          let desc = "Card added to board";
          if (res.notified) {
            desc = `Card sent — client notified at ${res.notifiedTo || "their contact info"}`;
          } else {
            if (res.notifySkippedReason === "off") desc = "Card added to board (client notifications are off)";
            else if (res.notifySkippedReason === "no_contact") desc = "Card added — no client email on file yet";
            else if (res.notifySkippedReason === "send_failed") desc = "Card added — email failed, will retry hourly";
          }

          toast({ title: "Card pushed", description: desc });
          onOpenChange(false);
        },
        onError: (err: Error) => {
          toast({ title: "Couldn't push card", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[#B4FF44] focus:border-[#101c33]/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 sm:rounded-3xl border-[#101c33]/10">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-xl font-display font-bold text-[#101c33]">Push a card</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {quickPicks && (quickPicks.invoices.length > 0 || quickPicks.trackers.length > 0) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#101c33]">Quick picks</label>
                {source && (
                  <button
                    type="button"
                    onClick={() => setSource(null)}
                    className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                    data-testid="button-clear-quick-pick"
                  >
                    Clear selection
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                {quickPicks.invoices.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => pickInvoice(inv)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors flex items-center gap-1.5 ${
                      source?.type === "invoice" && source.id === inv.id
                        ? "bg-[#B4FF44] border-[#B4FF44] text-black"
                        : "bg-transparent border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                    }`}
                    data-testid={`button-quick-pick-invoice-${inv.invoiceNo}`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {inv.invoiceNo} · ${inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </button>
                ))}
                {quickPicks.trackers.map((t) => (
                  <button
                    key={t.jobId}
                    type="button"
                    onClick={() => pickTracker(t)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors flex items-center gap-1.5 ${
                      source?.type === "tracker" && source.id === t.jobId
                        ? "bg-[#B4FF44] border-[#B4FF44] text-black"
                        : "bg-transparent border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                    }`}
                    data-testid={`button-quick-pick-tracker-${t.jobNo}`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Job {t.jobNo}{t.unitNo ? ` · Unit ${t.unitNo}` : ""} tracker
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Tap an unpaid invoice or a live job tracker to prefill the card.
              </p>
            </div>
          )}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#101c33] mb-2">Card Type</label>
            <div className="flex flex-wrap gap-2">
              {PUSH_KINDS.map((k) => (
                <button
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                    kind === k.value
                      ? "bg-[#101c33] border-[#101c33] text-white"
                      : "bg-transparent border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                  }`}
                  type="button"
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#101c33]">Title</label>
              <input
                className={inputCls}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-push-title"
                placeholder="e.g. Please clear unit 4B by Friday"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#101c33]">Message</label>
              <textarea
                className={`${inputCls} min-h-[80px] resize-none`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                data-testid="input-push-body"
                placeholder="Optional details..."
              />
            </div>

            {(kind === "invoice" || kind === "payment_request") && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#101c33]">Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground text-sm font-medium">$</span>
                    <input
                      type="number"
                      step="0.01"
                      className={`${inputCls} pl-7`}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      data-testid="input-push-amount"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#101c33]">Due Date</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    data-testid="input-push-due-date"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[#101c33]">Link URL</label>
                <input
                  className={inputCls}
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  data-testid="input-push-link-url"
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[#101c33]">Link Label</label>
                <input
                  className={inputCls}
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  data-testid="input-push-link-label"
                  placeholder="Open"
                />
              </div>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!title.trim() || push.isPending}
            className="w-full mt-2 py-3 bg-[#B4FF44] text-black text-sm font-bold uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {push.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <BellRing className="w-5 h-5" />}
            Push Card
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientBoardOffice() {
  const { propertyId = "" } = useParams<{ propertyId: string }>();
  const [pushOpen, setPushOpen] = useState(false);
  const [editCard, setEditCard] = useState<ClientBoardFeedCard | null>(null);
  const { data: board, isLoading } = useGetOfficeClientBoard(propertyId, {
    query: {
      queryKey: getGetOfficeClientBoardQueryKey(propertyId),
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
    },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const remove = useDeleteOfficeClientBoardCard();

  const removeCard = (card: ClientBoardFeedCard) => {
    if (!window.confirm(`Take back "${card.title}"? It disappears from the client's board.`)) return;
    remove.mutate(
      { propertyId, cardId: card.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(propertyId) });
          toast({ title: "Card taken back", description: "It's off the client's board." });
        },
        onError: (err: Error) =>
          toast({ title: "Couldn't remove the card", description: err.message, variant: "destructive" }),
      },
    );
  };

  if (isLoading || !board) {
    return (
      <div className="p-8 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link
        href={`/admin/${propertyId}`}
        className="flex items-center gap-2 text-muted-foreground text-sm font-semibold w-fit hover:text-foreground"
      >
        <ChevronLeft className="w-4 h-4" /> Back to account
      </Link>

      <div className="bg-[var(--ink)] text-white rounded-2xl p-6 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-display font-bold truncate">
            {board.propertyName} — client board
          </h1>
          <p className="text-white/60 text-sm font-medium mt-0.5">
            This is exactly what the client sees on their board. Cards you send land in
            their "From Archangel" column.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {board.webhookConnected && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border border-emerald-400/40 text-emerald-300 px-2.5 py-1.5">
              <Webhook className="h-3.5 w-3.5" /> Client webhook connected
            </span>
          )}
          {board.dashboardUrl && (
            <a
              href={board.dashboardUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 transition-colors"
              data-testid="link-open-client-board"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open their board
            </a>
          )}
          <button
            onClick={() => setPushOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-[var(--gold-light,#B4FF44)] text-black px-4 py-2 hover:opacity-90 transition-opacity shadow-sm"
            data-testid="button-push-card"
          >
            <BellRing className="h-3.5 w-3.5" /> Push Card
          </button>
        </div>
      </div>

      {board.accountStatus !== "active" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm font-medium px-4 py-3">
          This client account is {board.accountStatus} — the client can't open their
          dashboard link right now, but cards you send will be waiting when it's active again.
        </div>
      )}

      <PushCardDialog propertyId={propertyId} open={pushOpen} onOpenChange={setPushOpen} />

      {editCard && (
        <SendCardForm
          key={editCard.id}
          propertyId={propertyId}
          editCard={editCard}
          onClose={() => setEditCard(null)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const cards = board.cards.filter((c) => c.column === col.key);
          const Icon = col.icon;
          return (
            <section key={col.key} className="space-y-3" data-testid={`column-${col.key}`}>
              <div className="flex items-center gap-2 px-1">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-bold">{col.label}</h2>
                <span className="text-xs text-muted-foreground font-medium">{cards.length}</span>
              </div>
              {cards.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Empty
                </div>
              ) : (
                cards.map((card) => (
                  <CardView
                    key={card.id}
                    card={card}
                    onEdit={card.kind === "manual" ? () => setEditCard(card) : undefined}
                    onRemove={card.kind === "manual" ? () => removeCard(card) : undefined}
                    removing={remove.isPending && remove.variables?.cardId === card.id}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
