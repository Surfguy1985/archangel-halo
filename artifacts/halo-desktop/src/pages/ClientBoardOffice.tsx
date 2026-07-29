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
  Users,
  Image as ImageIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Mirrors the client-facing board (halo /client/:token/board) — same columns,
// same card anatomy — so the office sees exactly what the client sees.
const COLUMNS = [
  { key: "inbox", label: "From Archangel", icon: Inbox },
  { key: "todo", label: "To do", icon: ListTodo },
  { key: "in_progress", label: "In progress", icon: Play },
  { key: "done", label: "Done", icon: CheckCircle2 },
] as const;

// Apple app tile aesthetic — kind color identity + icon
type KindMeta = {
  label: string;
  icon: typeof FileText;
  gradient: string; // squircle icon chip bg
  textColor: string; // icon color inside chip
};

const KIND_META: Record<string, KindMeta> = {
  invoice: {
    label: "Invoice",
    icon: FileText,
    gradient: "bg-gradient-to-br from-amber-400 to-amber-500",
    textColor: "text-white",
  },
  payment_request: {
    label: "Payment",
    icon: CreditCard,
    gradient: "bg-gradient-to-br from-emerald-400 to-emerald-500",
    textColor: "text-white",
  },
  summary: {
    label: "Recap",
    icon: CheckCircle2,
    gradient: "bg-gradient-to-br from-sky-400 to-sky-500",
    textColor: "text-white",
  },
  flag: {
    label: "Flagged",
    icon: Flag,
    gradient: "bg-gradient-to-br from-red-400 to-red-500",
    textColor: "text-white",
  },
  tracker: {
    label: "Live job",
    icon: MapPin,
    gradient: "bg-gradient-to-br from-violet-400 to-violet-500",
    textColor: "text-white",
  },
  photos: {
    label: "Photos",
    icon: Camera,
    gradient: "bg-gradient-to-br from-pink-400 to-pink-500",
    textColor: "text-white",
  },
  referral: {
    label: "Referral",
    icon: Users,
    gradient: "bg-gradient-to-br from-teal-400 to-teal-500",
    textColor: "text-white",
  },
  manual: {
    label: "Note",
    icon: StickyNote,
    gradient: "bg-gradient-to-br from-slate-300 to-slate-400",
    textColor: "text-slate-700",
  },
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
  const Icon = meta.icon;
  const mod = card.module as any;

  const showLinks = card.links.length > 0;
  const showDueDate = card.dueDate && !mod?.dueDate;
  const showActionLabel = !!card.actionLabel;
  const hasFooter = showLinks || showDueDate || showActionLabel;

  return (
    <div
      className="group flex flex-col h-[220px] rounded-2xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
      data-testid={`card-${card.id}`}
    >
      {/* Apple tile header: squircle icon chip + kind + actions */}
      <div className="flex items-start gap-3 mb-3 shrink-0">
        <div
          className={`flex items-center justify-center w-10 h-10 rounded-2xl shadow-sm ${meta.gradient} shrink-0`}
        >
          <Icon className={`w-5 h-5 ${meta.textColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {meta.label}
          </div>
          {card.amount != null && (
            <div className="text-sm font-bold tabular-nums mt-0.5">
              {card.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}
            </div>
          )}
        </div>
        {/* CRUD actions on ALL cards now */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {onEdit && (
            <button
              onClick={onEdit}
              title="Edit this card"
              className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors"
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
              className="text-muted-foreground hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
              data-testid={`button-delete-card-${card.id}`}
            >
              {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Title + body */}
      <div className="flex-1 min-h-0 flex flex-col space-y-1.5 mb-2">
        <div className="text-[13px] font-bold leading-snug line-clamp-2 shrink-0">{card.title}</div>
        {card.body && (
          <div className="text-[11px] text-muted-foreground whitespace-pre-line line-clamp-2 shrink-0">
            {card.body}
          </div>
        )}

        {/* Module snapshots */}
        {mod && (
          <div className="mt-auto pt-2 overflow-hidden">
            {/* Invoice module */}
            {card.kind === "invoice" && (
              <div className="rounded-xl bg-amber-50/80 border border-amber-200/60 p-2.5 text-xs space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-amber-900">Inv {mod.invoiceNo}</span>
                  {mod.dueDate && <span className="text-[10px] text-amber-600">Due {mod.dueDate}</span>}
                </div>
                {mod.approvedAt ? (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#041029] bg-[#B4FF44] px-2 py-1 rounded-lg w-max">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approved by client
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 bg-amber-100/70 px-2 py-1 rounded-lg w-max">
                    <Loader2 className="w-3 h-3 animate-spin" /> Waiting on client...
                  </div>
                )}
              </div>
            )}

            {/* Tracker module */}
            {card.kind === "tracker" && (
              <div className="rounded-xl bg-violet-50/80 border border-violet-200/60 p-2.5 text-xs space-y-1.5">
                <div className="font-semibold text-violet-900">
                  Job {mod.jobNo} {mod.unitNo ? `· Unit ${mod.unitNo}` : ""}
                </div>
                {mod.scope && <div className="text-violet-700 line-clamp-1">{mod.scope}</div>}
                {mod.trackerUrl && (
                  <a
                    href={mod.trackerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] font-bold text-violet-700 hover:text-violet-900 w-max bg-violet-100/60 px-2 py-1 rounded-lg transition-colors"
                  >
                    <MapPin className="w-3 h-3" /> Live GPS
                  </a>
                )}
              </div>
            )}

            {/* Summary module (NEW) */}
            {card.kind === "summary" && (
              <div className="rounded-xl bg-sky-50/80 border border-sky-200/60 p-2.5 text-xs space-y-1.5">
                <div className="flex items-center gap-2">
                  {mod.result === "exceeded" && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      Exceeded
                    </span>
                  )}
                  {mod.result === "met" && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
                      Met
                    </span>
                  )}
                  {mod.result === "followup" && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                      Follow-up
                    </span>
                  )}
                  <span className="text-[10px] text-sky-600">
                    {mod.unitNo ? `Unit ${mod.unitNo}` : ""} {mod.serviceDate ? `· ${mod.serviceDate}` : ""}
                  </span>
                </div>
                <div className="text-[10px] text-sky-700">
                  {mod.checkedCount}/{mod.itemCount} done · {mod.flagCount} flags · {mod.photoCount} photos
                </div>
                {mod.summaryUrl && (
                  <a
                    href={mod.summaryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] font-bold text-sky-700 hover:text-sky-900 w-max bg-sky-100/60 px-2 py-1 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" /> View recap
                  </a>
                )}
              </div>
            )}

            {/* Photos module (NEW) */}
            {card.kind === "photos" && (
              <div className="rounded-xl bg-pink-50/80 border border-pink-200/60 p-2.5 text-xs space-y-1.5">
                {mod.photoUrls && mod.photoUrls.length > 0 && (
                  <div className="flex gap-1.5 overflow-hidden">
                    {mod.photoUrls.slice(0, 4).map((url: string, i: number) => (
                      <img
                        key={i}
                        src={url}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover border border-pink-200/40"
                      />
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-pink-700 font-medium">
                  {mod.totalCount} photo{mod.totalCount === 1 ? "" : "s"} · Job {mod.jobNo}
                </div>
              </div>
            )}

            {/* Flag module */}
            {card.kind === "flag" && (
              <div className="rounded-xl bg-red-50/80 border border-red-200/60 p-2.5 text-xs space-y-1.5">
                {mod.requestedAt ? (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#041029] bg-[#B4FF44] px-2 py-1 rounded-lg w-max">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Work requested
                  </div>
                ) : (
                  <div className="font-semibold text-red-900">
                    {mod.totalCount} item{mod.totalCount === 1 ? "" : "s"} flagged
                  </div>
                )}
                {mod.items && mod.items.length > 0 && (
                  <div className="text-[10px] text-red-800 line-clamp-1">
                    {mod.items.map((i: any) => `${i.unit}: ${i.label}`).join(", ")}
                  </div>
                )}
              </div>
            )}

            {/* Referral module */}
            {(card.kind === "referral" || (card.module as any)?.type === "referral") && (
              <div className="rounded-xl bg-teal-50/80 border border-teal-200/60 p-2.5 text-xs space-y-1.5">
                {mod.referredAt ? (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#041029] bg-[#B4FF44] px-2 py-1 rounded-lg w-max">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Referral received
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-teal-700 bg-teal-100/60 px-2 py-1 rounded-lg w-max">
                    <Loader2 className="w-3 h-3 animate-spin" /> Waiting for referral...
                  </div>
                )}
              </div>
            )}

            {/* Link module */}
            {card.kind === "link" && (
              <a
                href={mod.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-lg mt-1 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" /> {mod.label}
              </a>
            )}
          </div>
        )}
      </div>

      {/* Footer: links, due date, action label */}
      {hasFooter && (
        <div className="shrink-0 flex flex-col gap-1.5 border-t border-border pt-2">
          {showDueDate && (
            <div className="text-[11px] font-medium text-muted-foreground">Due {card.dueDate}</div>
          )}

          {showLinks && (
            <div className="flex flex-wrap gap-1.5">
              {card.links.map((l, i) => {
                const Icon = linkIcon(l.kind);
                return (
                  <a
                    key={i}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted px-1.5 py-0.5 rounded transition-colors"
                  >
                    <Icon className="h-3 w-3 shrink-0" />
                    <span className="truncate max-w-[120px]">{l.label}</span>
                  </a>
                );
              })}
            </div>
          )}

          {showActionLabel && (
            <div className="text-[10px] font-semibold text-muted-foreground truncate">{card.actionLabel}</div>
          )}
        </div>
      )}
    </div>
  );
}

type DraftLink = { label: string; url: string };

// Edit dialog for ANY card (not just manual)
function EditCardDialog({
  propertyId,
  card,
  onClose,
}: {
  propertyId: string;
  card: ClientBoardFeedCard;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body ?? "");
  const [amount, setAmount] = useState(card.amount?.toString() ?? "");
  const [dueDate, setDueDate] = useState(card.dueDate ?? "");
  const [actionLabel, setActionLabel] = useState(card.actionLabel ?? "");
  const [refreshModule, setRefreshModule] = useState(false);
  const [links, setLinks] = useState<DraftLink[]>(
    card.links.map((l) => ({ label: l.label, url: l.url }))
  );
  const update = useUpdateOfficeClientBoardCard();

  const submit = () => {
    const data = {
      title: title.trim(),
      body: body.trim() || null,
      amount: amount ? Number(amount) : null,
      dueDate: dueDate || null,
      actionLabel: actionLabel.trim() || null,
      refreshModule,
      links: links
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.label && l.url),
    };
    update.mutate(
      { propertyId, cardId: card.id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(propertyId) });
          toast({ title: "Card updated", description: "The client sees the updated card." });
          onClose();
        },
        onError: (err: Error) =>
          toast({
            title: "Couldn't update the card",
            description: err.message,
            variant: "destructive",
          }),
      }
    );
  };

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[#B4FF44] transition-shadow";

  const hasSourceModule = card.kind !== "manual" && card.module;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg p-6 sm:rounded-3xl">
        <DialogHeader className="mb-3">
          <DialogTitle className="text-xl font-display font-bold">Edit card</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short and clear"
              className={inputCls}
              data-testid="input-edit-title"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Optional details"
              rows={3}
              className={inputCls}
              data-testid="input-edit-body"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Amount (optional)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-muted-foreground text-sm font-medium">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={`${inputCls} pl-7`}
                  data-testid="input-edit-amount"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Due date (optional)
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputCls}
                data-testid="input-edit-due"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Action label (optional)
            </label>
            <input
              value={actionLabel}
              onChange={(e) => setActionLabel(e.target.value)}
              placeholder='e.g. "Pay by Friday"'
              className={inputCls}
              data-testid="input-edit-action-label"
            />
          </div>

          {/* Refresh module toggle (for cards with source data) */}
          {hasSourceModule && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border">
              <Switch
                id="refresh-module"
                checked={refreshModule}
                onCheckedChange={setRefreshModule}
                data-testid="toggle-refresh-module"
              />
              <div className="flex-1">
                <Label htmlFor="refresh-module" className="text-sm font-semibold cursor-pointer">
                  Refresh data from source
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Re-pulls the latest invoice/tracker/recap data; client actions are kept
                </p>
              </div>
            </div>
          )}

          {/* Links */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Links (optional)
              </label>
              <button
                onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}
                className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-add-link-edit"
              >
                <Plus className="w-3.5 h-3.5" /> Add link
              </button>
            </div>
            {links.length > 0 && (
              <div className="space-y-2">
                {links.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={l.label}
                      onChange={(e) =>
                        setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                      }
                      placeholder="Link label"
                      className={`${inputCls} max-w-[140px]`}
                      data-testid={`input-edit-link-label-${i}`}
                    />
                    <input
                      value={l.url}
                      onChange={(e) =>
                        setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                      }
                      placeholder="https://…"
                      className={inputCls}
                      data-testid={`input-edit-link-url-${i}`}
                    />
                    <button
                      onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-red-600 shrink-0 transition-colors"
                      data-testid={`button-remove-link-edit-${i}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={submit}
            disabled={update.isPending || !title.trim()}
            className="w-full py-3 bg-[#B4FF44] text-black text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            data-testid="button-save-edit"
          >
            {update.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            Save changes
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Apple-tile push templates
type PushTemplate = {
  id: string;
  kind: string;
  label: string;
  desc: string;
  icon: typeof FileText;
  gradient: string;
  textColor: string;
  quick?: "invoices" | "trackers" | "summaries" | "photos";
  money?: boolean;
  due?: boolean;
  titlePrefill?: string;
  bodyPlaceholder?: string;
  linkLabel?: string;
};

const TEMPLATES: PushTemplate[] = [
  {
    id: "invoice",
    kind: "invoice",
    label: "Invoice",
    desc: "Bill with a pay link",
    icon: FileText,
    gradient: "bg-gradient-to-br from-amber-400 to-amber-500",
    textColor: "text-white",
    quick: "invoices",
    money: true,
    linkLabel: "Pay now",
  },
  {
    id: "payment",
    kind: "payment_request",
    label: "Payment notice",
    desc: "Payment due or received",
    icon: CreditCard,
    gradient: "bg-gradient-to-br from-emerald-400 to-emerald-500",
    textColor: "text-white",
    quick: "invoices",
    money: true,
    linkLabel: "Pay now",
  },
  {
    id: "crew_on_site",
    kind: "tracker",
    label: "Crew on site",
    desc: "Live tracker + scope",
    icon: MapPin,
    gradient: "bg-gradient-to-br from-violet-400 to-violet-500",
    textColor: "text-white",
    quick: "trackers",
    bodyPlaceholder: "Short scope summary — what the crew is doing today",
    linkLabel: "Watch live",
  },
  {
    id: "job_recap",
    kind: "summary",
    label: "Job recap",
    desc: "Service summary",
    icon: CheckCircle2,
    gradient: "bg-gradient-to-br from-sky-400 to-sky-500",
    textColor: "text-white",
    quick: "summaries",
    bodyPlaceholder: "What got done, in one or two lines",
  },
  {
    id: "photos",
    kind: "photos",
    label: "Photos",
    desc: "Before & after gallery",
    icon: Camera,
    gradient: "bg-gradient-to-br from-pink-400 to-pink-500",
    textColor: "text-white",
    quick: "photos",
    titlePrefill: "Job photos",
    linkLabel: "View photos",
  },
  {
    id: "new_job",
    kind: "manual",
    label: "New job created",
    desc: "Work scheduled",
    icon: Briefcase,
    gradient: "bg-gradient-to-br from-indigo-400 to-indigo-500",
    textColor: "text-white",
    quick: "trackers",
    titlePrefill: "New job created",
    bodyPlaceholder: "What the job covers and when it starts",
  },
  {
    id: "reminder",
    kind: "manual",
    label: "Schedule reminder",
    desc: "A date to know about",
    icon: CalendarClock,
    gradient: "bg-gradient-to-br from-orange-400 to-orange-500",
    textColor: "text-white",
    due: true,
    bodyPlaceholder: "What's happening and what (if anything) you need to do",
  },
  {
    id: "flag",
    kind: "flag",
    label: "Flagged item",
    desc: "Auto-attaches flagged items by unit",
    icon: Flag,
    gradient: "bg-gradient-to-br from-red-400 to-red-500",
    textColor: "text-white",
    bodyPlaceholder: "Why it's flagged — from the summary or walkthrough",
  },
  {
    id: "referral",
    kind: "referral",
    label: "Refer us",
    desc: "Ask for a referral",
    icon: Users,
    gradient: "bg-gradient-to-br from-teal-400 to-teal-500",
    textColor: "text-white",
    titlePrefill: "Know another PM?",
    bodyPlaceholder: "We'd love an intro.",
  },
  {
    id: "note",
    kind: "manual",
    label: "Note",
    desc: "Anything else",
    icon: StickyNote,
    gradient: "bg-gradient-to-br from-slate-300 to-slate-400",
    textColor: "text-slate-700",
  },
];

function PushCardDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const push = usePushClientBoardCard();

  const [targetId, setTargetId] = useState(propertyId);
  const [template, setTemplate] = useState<PushTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("Open");
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

  const pickSummary = (s: NonNullable<typeof quickPicks>["summaries"][number]) => {
    setTitle(`Service recap — Unit ${s.unitNo ?? "?"}`);
    setSource({ type: "summary", id: s.id });
  };

  const pickPhotoJob = (pj: NonNullable<typeof quickPicks>["photoJobs"][number]) => {
    setTitle(`Job photos — ${pj.jobNo} (${pj.photoCount} photo${pj.photoCount === 1 ? "" : "s"})`);
    setSource({ type: "photos", id: pj.jobId, jobId: pj.jobId });
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
            else if (res.notifySkippedReason === "send_failed")
              desc = "Card added — email failed, will retry hourly";
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
    "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[#B4FF44] transition-shadow";

  const showQuick =
    template?.quick === "invoices"
      ? (quickPicks?.invoices ?? []).length > 0
      : template?.quick === "trackers"
        ? (quickPicks?.trackers ?? []).length > 0
        : template?.quick === "summaries"
          ? (quickPicks?.summaries ?? []).length > 0
          : template?.quick === "photos"
            ? (quickPicks?.photoJobs ?? []).length > 0
            : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 sm:rounded-3xl">
        <DialogHeader className="mb-3">
          <DialogTitle className="text-xl font-display font-bold flex items-center gap-2">
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

        {/* Property picker */}
        <div className="mb-4">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            To
          </label>
          <select
            value={targetId}
            onChange={(e) => {
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
          /* Apple tile template grid */
          <div className="grid grid-cols-3 gap-2.5" data-testid="grid-push-templates">
            {TEMPLATES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => chooseTemplate(t)}
                  className="group rounded-2xl border border-border bg-card p-3 text-left hover:border-[#101c33]/30 hover:shadow-md transition-all active:scale-[0.97]"
                  data-testid={`tile-push-${t.id}`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-9 h-9 rounded-2xl shadow-sm mb-2 ${t.gradient}`}
                  >
                    <Icon className={`w-4.5 h-4.5 ${t.textColor}`} />
                  </span>
                  <div className="text-[13px] font-bold leading-tight">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{t.desc}</div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Quick-pick library */}
            {showQuick && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {template.quick === "invoices"
                      ? "Pick an unpaid invoice"
                      : template.quick === "trackers"
                        ? "Pick a job"
                        : template.quick === "summaries"
                          ? "Pick a recap"
                          : "Pick a photo job"}
                  </label>
                  {source && (
                    <button
                      type="button"
                      onClick={() => setSource(null)}
                      className="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
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
                        {inv.invoiceNo} · $
                        {inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                  {template.quick === "summaries" &&
                    (quickPicks?.summaries ?? []).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => pickSummary(s)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors flex items-center gap-1.5 ${
                          source?.type === "summary" && source.id === s.id
                            ? "bg-[#B4FF44] border-[#B4FF44] text-black"
                            : "bg-transparent border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                        }`}
                        data-testid={`button-quick-pick-summary-${s.id}`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {s.unitNo ? `Unit ${s.unitNo}` : s.title}
                      </button>
                    ))}
                  {template.quick === "photos" &&
                    (quickPicks?.photoJobs ?? []).map((pj) => (
                      <button
                        key={pj.jobId}
                        type="button"
                        onClick={() => pickPhotoJob(pj)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors flex items-center gap-1.5 ${
                          source?.type === "photos" && source.id === pj.jobId
                            ? "bg-[#B4FF44] border-[#B4FF44] text-black"
                            : "bg-transparent border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                        }`}
                        data-testid={`button-quick-pick-photos-${pj.jobId}`}
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        {pj.jobNo} ({pj.photoCount})
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
                onChange={(e) => setTitle(e.target.value)}
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
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Amount
                    </label>
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
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Link (optional)
                </label>
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
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Link label
                </label>
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
      }
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
        className="flex items-center gap-2 text-muted-foreground text-sm font-semibold w-fit hover:text-foreground transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> Back to account
      </Link>

      <div className="bg-[var(--ink)] text-white rounded-2xl p-6 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-display font-bold truncate">{board.propertyName} — client board</h1>
          <p className="text-white/60 text-sm font-medium mt-0.5">
            This is exactly what the client sees on their board. Cards you send land in their "From Archangel" column.
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
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-[#B4FF44] text-black px-4 py-2 hover:opacity-90 transition-opacity shadow-sm"
            data-testid="button-push-card"
          >
            <BellRing className="h-3.5 w-3.5" /> Push Card
          </button>
        </div>
      </div>

      {board.accountStatus !== "active" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm font-medium px-4 py-3">
          This client account is {board.accountStatus} — the client can't open their dashboard link right now, but
          cards you send will be waiting when it's active again.
        </div>
      )}

      <PushCardDialog propertyId={propertyId} open={pushOpen} onOpenChange={setPushOpen} />

      {editCard && (
        <EditCardDialog
          key={editCard.id}
          propertyId={propertyId}
          card={editCard}
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
                    onEdit={() => setEditCard(card)}
                    onRemove={() => removeCard(card)}
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
