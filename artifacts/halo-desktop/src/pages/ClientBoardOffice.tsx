import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOfficeClientBoard,
  getGetOfficeClientBoardQueryKey,
  useCreateOfficeClientBoardCard,
  type ClientBoardCard,
} from "@workspace/api-client-react";
import {
  ChevronLeft,
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
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

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

function CardView({ card }: { card: ClientBoardCard }) {
  const meta = KIND_META[card.kind] ?? KIND_META.manual;
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-2" data-testid={`card-${card.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>
          {card.kind === "flag" ? <Flag className="inline h-3 w-3 mr-1 -mt-0.5" /> : null}
          {meta.label}
        </span>
        {card.amount != null && (
          <span className="text-sm font-bold tabular-nums">
            {card.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}
          </span>
        )}
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

function SendCardForm({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [links, setLinks] = useState<DraftLink[]>([]);
  const create = useCreateOfficeClientBoardCard();

  const submit = () => {
    create.mutate(
      {
        propertyId,
        data: {
          title: title.trim(),
          body: body.trim() || null,
          dueDate: dueDate || null,
          links: links
            .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
            .filter((l) => l.label && l.url),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(propertyId) });
          toast({ title: "Card sent", description: "It's now in the client's From Archangel column." });
          onClose();
        },
        onError: (err: Error) =>
          toast({ title: "Couldn't send the card", description: err.message, variant: "destructive" }),
      },
    );
  };

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--primary)]";

  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm space-y-4 border border-[var(--primary)]/40">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-bold">Send a card to the client</h2>
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
        disabled={create.isPending || !title.trim()}
        className="px-5 py-2.5 bg-[var(--gold-light,#B4FF44)] text-black text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
        data-testid="button-send-card"
      >
        {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Send to their board
      </button>
    </div>
  );
}

export default function ClientBoardOffice() {
  const { propertyId = "" } = useParams<{ propertyId: string }>();
  const [formOpen, setFormOpen] = useState(false);
  const { data: board, isLoading } = useGetOfficeClientBoard(propertyId);

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
            onClick={() => setFormOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-bold rounded-lg bg-[var(--gold-light,#B4FF44)] text-black px-3 py-2 hover:opacity-90 transition-opacity"
            data-testid="button-open-send-card"
          >
            <Plus className="h-3.5 w-3.5" /> Send a card
          </button>
        </div>
      </div>

      {board.accountStatus !== "active" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm font-medium px-4 py-3">
          This client account is {board.accountStatus} — the client can't open their
          dashboard link right now, but cards you send will be waiting when it's active again.
        </div>
      )}

      {formOpen && <SendCardForm propertyId={propertyId} onClose={() => setFormOpen(false)} />}

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
                cards.map((card) => <CardView key={card.id} card={card} />)
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
