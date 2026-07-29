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
  useListClientAccounts,
  type ClientBoardFeedCard,
} from "@workspace/api-client-react";
import {
  ChevronLeft,
  Pencil,
  Briefcase,
  CalendarClock,
  Camera,
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
  StickyNote,
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

// Apple-watch-tile templates. Each tile is one thing the office tells the
// client, mapped onto a board card kind with sensible prefills.
type PushTemplate = {
  id: string;
  kind: string;
  label: string;
  desc: string;
  icon: typeof FileText;
  tint: string; // tile icon chip
  quick?: "invoices" | "trackers";
  money?: boolean; // show amount + due
  due?: boolean; // show due only
  titlePrefill?: string;
  bodyPlaceholder?: string;
  linkLabel?: string;
};

const TEMPLATES: PushTemplate[] = [
  { id: "invoice", kind: "invoice", label: "Invoice", desc: "Bill with a pay link", icon: FileText, tint: "bg-amber-100 text-amber-700", quick: "invoices", money: true, linkLabel: "Pay now" },
  { id: "payment", kind: "payment_request", label: "Payment notice", desc: "Payment due or received", icon: CreditCard, tint: "bg-emerald-100 text-emerald-700", quick: "invoices", money: true, linkLabel: "Pay now" },
  { id: "crew_on_site", kind: "tracker", label: "Crew on site", desc: "Live tracker + scope", icon: MapPin, tint: "bg-violet-100 text-violet-700", quick: "trackers", bodyPlaceholder: "Short scope summary — what the crew is doing today", linkLabel: "Watch live" },
  { id: "crew_checkout", kind: "summary", label: "Crew checked out", desc: "Work wrapped for the day", icon: CheckCircle2, tint: "bg-sky-100 text-sky-700", quick: "trackers", titlePrefill: "Crew checked out", bodyPlaceholder: "What got done today, in one or two lines" },
  { id: "photos", kind: "photos", label: "Before & after", desc: "Photo report link", icon: Camera, tint: "bg-pink-100 text-pink-700", titlePrefill: "Before & after photos", linkLabel: "View photos" },
  { id: "new_job", kind: "manual", label: "New job created", desc: "Work scheduled for you", icon: Briefcase, tint: "bg-indigo-100 text-indigo-700", quick: "trackers", titlePrefill: "New job created", bodyPlaceholder: "What the job covers and when it starts" },
  { id: "reminder", kind: "manual", label: "Schedule reminder", desc: "A date to know about", icon: CalendarClock, tint: "bg-orange-100 text-orange-700", due: true, bodyPlaceholder: "What's happening and what (if anything) you need to do" },
  { id: "flag", kind: "flag", label: "Flagged item", desc: "Needs your attention", icon: Flag, tint: "bg-red-100 text-red-700", bodyPlaceholder: "Why it's flagged — from the summary report or a walkthrough" },
  { id: "note", kind: "manual", label: "Note", desc: "Anything else", icon: StickyNote, tint: "bg-neutral-200 text-neutral-700" },
];

function PushCardDialog({ propertyId, open, onOpenChange }: { propertyId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const push = usePushClientBoardCard();

  // Which client board this card lands on — defaults to the board being viewed.
  const [targetId, setTargetId] = useState(propertyId);
  const [template, setTemplate] = useState<PushTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("Open");
  // Dedupe source + job ref set by quick-picks; cleared when the user edits by hand.
  const [source, setSource] = useState<{ type: string; id: string; jobId?: string } | null>(null);

  const { data: accounts } = useListClientAccounts({
    query: { queryKey: ["push-card-accounts"], enabled: open },
  });

  const { data: quickPicks } = useGetClientBoardPushQuickPicks(targetId, {
    query: {
      queryKey: getGetClientBoardPushQuickPicksQueryKey(targetId),
      enabled: open && !!targetId,
    },
  });

  const resetFields = () => {
    setTitle("");
    setBody("");
    setAmount("");
    setDueDate("");
    setLinkUrl("");
    setLinkLabel("Open");
    setSource(null);
  };

  useEffect(() => {
    if (open) {
      setTargetId(propertyId);
      setTemplate(null);
      resetFields();
    }
  }, [open, propertyId]);

  const chooseTemplate = (t: PushTemplate) => {
    resetFields();
    setTemplate(t);
    setTitle(t.titlePrefill ?? "");
    if (t.linkLabel) setLinkLabel(t.linkLabel);
  };

  const pickInvoice = (inv: NonNullable<typeof quickPicks>["invoices"][number]) => {
    setTitle(`Invoice ${inv.invoiceNo}`);
    setAmount(String(inv.amount));
    setDueDate(inv.dueDate ?? "");
    setLinkUrl(inv.payUrl ?? "");
    setLinkLabel(inv.payUrl ? "Pay now" : "Open");
    setSource({ type: "invoice", id: inv.id });
  };

  const pickTracker = (t: NonNullable<typeof quickPicks>["trackers"][number]) => {
    const base = template?.titlePrefill;
    setTitle(base ? `${base} — Job ${t.jobNo}` : `Live tracker — Job ${t.jobNo}`);
    if (template?.id === "crew_on_site") {
      setBody(t.description || "");
      setLinkUrl(t.trackerUrl);
      setLinkLabel("Watch live");
    } else if (template?.id === "new_job") {
      setBody(t.description || "");
    } else {
      setLinkUrl(t.trackerUrl);
      setLinkLabel("Watch live");
    }
    setSource({ type: "tracker", id: t.jobId, jobId: t.jobId });
  };

  const handleSubmit = () => {
    if (!template) return;
    const kind = template.kind;
    push.mutate(
      {
        propertyId: targetId,
        data: {
          kind,
          title: title.trim(),
          body: body.trim() || null,
          amount: template.money && amount ? Number(amount) : null,
          dueDate: (template.money || template.due) && dueDate ? dueDate : null,
          linkUrl: linkUrl.trim() || null,
          linkLabel: linkUrl.trim() ? linkLabel.trim() || "Open" : null,
          sourceType: source?.type ?? null,
          sourceId: source?.id ?? null,
          jobId: source?.jobId ?? null,
        },
      },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(targetId) });

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

  const showQuick =
    template?.quick === "invoices"
      ? (quickPicks?.invoices ?? []).length > 0
      : template?.quick === "trackers"
        ? (quickPicks?.trackers ?? []).length > 0
        : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 sm:rounded-3xl border-[#101c33]/10">
        <DialogHeader className="mb-3">
          <DialogTitle className="text-xl font-display font-bold text-[#101c33] flex items-center gap-2">
            {template && (
              <button
                type="button"
                onClick={() => setTemplate(null)}
                className="text-muted-foreground hover:text-foreground -ml-1"
                data-testid="button-push-back"
                aria-label="Back to card types"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {template ? template.label : "Push a card"}
          </DialogTitle>
        </DialogHeader>

        {/* Property picker — which client board this lands on */}
        <div className="mb-4">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">To</label>
          <select
            value={targetId}
            onChange={(e) => {
              // Different client — nothing from the previous property may leak
              // into their card. Start the compose over.
              setTargetId(e.target.value);
              resetFields();
              if (template) {
                setTitle(template.titlePrefill ?? "");
                if (template.linkLabel) setLinkLabel(template.linkLabel);
              }
            }}
            className={inputCls}
            data-testid="select-push-property"
          >
            {(accounts ?? []).map((a) => (
              <option key={a.propertyId} value={a.propertyId}>
                {a.propertyName}
              </option>
            ))}
            {(accounts ?? []).every((a) => a.propertyId !== targetId) && (
              <option value={targetId}>This property</option>
            )}
          </select>
        </div>

        {!template ? (
          <div className="grid grid-cols-3 gap-2.5" data-testid="grid-push-templates">
            {TEMPLATES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => chooseTemplate(t)}
                  className="group rounded-2xl border border-border bg-card p-3 text-left hover:border-[#101c33]/30 hover:shadow-sm transition-all active:scale-[0.97]"
                  data-testid={`tile-push-${t.id}`}
                >
                  <span className={`inline-flex items-center justify-center w-9 h-9 rounded-xl ${t.tint} mb-2`}>
                    <Icon className="w-4.5 h-4.5" />
                  </span>
                  <div className="text-[13px] font-bold leading-tight text-[#101c33]">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{t.desc}</div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            {showQuick && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {template.quick === "invoices" ? "Pick an unpaid invoice" : "Pick a job"}
                  </label>
                  {source && (
                    <button
                      type="button"
                      onClick={() => setSource(null)}
                      className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                      data-testid="button-clear-quick-pick"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                  {template.quick === "invoices" &&
                    (quickPicks?.invoices ?? []).map((inv) => (
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
                  {template.quick === "trackers" &&
                    (quickPicks?.trackers ?? []).map((t) => (
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
                        Job {t.jobNo}
                        {t.unitNo ? ` · Unit ${t.unitNo}` : ""}
                      </button>
                    ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Title</label>
              <input
                className={inputCls}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setSource(null);
                }}
                data-testid="input-push-title"
                placeholder="Short and clear"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Message</label>
              <textarea
                className={`${inputCls} min-h-[72px] resize-none`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                data-testid="input-push-body"
                placeholder={template.bodyPlaceholder ?? "Optional details…"}
              />
            </div>

            {(template.money || template.due) && (
              <div className="grid grid-cols-2 gap-4">
                {template.money && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-muted-foreground text-sm font-medium">$</span>
                      <input
                        type="number"
                        step="0.01"
                        className={`${inputCls} pl-7`}
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          setSource(null);
                        }}
                        data-testid="input-push-amount"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {template.due ? "Date" : "Due date"}
                  </label>
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
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Link (optional)</label>
                <input
                  className={inputCls}
                  value={linkUrl}
                  onChange={(e) => {
                    setLinkUrl(e.target.value);
                    setSource(null);
                  }}
                  data-testid="input-push-link-url"
                  placeholder="https://…"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Link label</label>
                <input
                  className={inputCls}
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  data-testid="input-push-link-label"
                  placeholder="Open"
                />
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!title.trim() || push.isPending}
              className="w-full mt-1 py-3 bg-[#B4FF44] text-black text-sm font-bold uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
              data-testid="button-push-submit"
            >
              {push.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <BellRing className="w-5 h-5" />}
              Push to their board
            </button>
          </div>
        )}
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
      // Live-sync with the client's board: when they drag a card to another
      // column, the office view catches up within a few seconds.
      refetchInterval: 4000,
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
