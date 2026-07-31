import { useState } from "react";
import { Link, useParams, useSearch } from "wouter";
import { OfficeBoardDemo } from "@/components/OfficeBoardDemo";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOfficeClientBoard,
  getGetOfficeClientBoardQueryKey,
  useCreateOfficeClientBoardCard,
  type ClientBoardFeedCard,
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
import { useToast } from "@/hooks/use-toast";

// Mirrors the client-facing board (/client/:token/board) and the desktop office
// board — same columns, same card anatomy — so the office sees what the client sees.
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

function CardView({ card }: { card: ClientBoardFeedCard }) {
  const meta = KIND_META[card.kind] ?? KIND_META.manual;
  return (
    <div
      className="rounded-[14px] border border-border bg-card p-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] space-y-[8px]"
      data-testid={`card-${card.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>
          {card.kind === "flag" ? <Flag className="inline h-3 w-3 mr-1 -mt-0.5" /> : null}
          {meta.label}
        </span>
        {card.amount != null && (
          <span className="text-[13.5px] font-bold tabular-nums">
            {card.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}
          </span>
        )}
      </div>
      <div className="text-[14px] font-semibold leading-snug">{card.title}</div>
      {card.body && (
        <div className="text-[12px] text-muted-foreground whitespace-pre-line line-clamp-4">{card.body}</div>
      )}
      {card.dueDate && <div className="text-[11px] text-muted-foreground">Due {card.dueDate}</div>}
      {card.links.length > 0 && (
        <div className="space-y-1">
          {card.links.map((l: { kind: string; label: string; url: string }, i: number) => {
            const Icon = linkIcon(l.kind);
            return (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-[12px] font-medium underline underline-offset-2"
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
    "w-full px-[12px] py-[10px] rounded-[12px] border border-border bg-background text-[14px] font-medium outline-none focus:ring-2 focus:ring-[var(--gold-light,#B4FF44)]";

  return (
    <div className="bg-card rounded-[16px] p-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] space-y-[12px] border border-[var(--gold-light,#B4FF44)]/60 mb-[16px]">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-display font-bold">Send a card</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground transition-transform active:scale-[0.9]"
          data-testid="button-close-send-card"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
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
        placeholder="Note (optional)"
        rows={3}
        className={inputCls}
        data-testid="input-card-body"
      />
      <div>
        <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Due date (optional)
        </label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className={inputCls}
          data-testid="input-card-due"
        />
      </div>
      {links.map((l, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={l.label}
            onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            placeholder="Label"
            className={`${inputCls} max-w-[120px]`}
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
            className="text-muted-foreground shrink-0 active:scale-[0.9]"
            data-testid={`button-remove-link-${i}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}
          className="flex items-center gap-1.5 text-[12px] font-bold text-muted-foreground"
          data-testid="button-add-link"
        >
          <Plus className="w-3.5 h-3.5" /> Add a link
        </button>
        <button
          onClick={submit}
          disabled={create.isPending || !title.trim()}
          className="px-[16px] py-[10px] bg-[var(--gold-light,#B4FF44)] text-black text-[13.5px] font-bold rounded-[12px] disabled:opacity-50 flex items-center gap-2 transition-transform active:scale-[0.97]"
          data-testid="button-send-card"
        >
          {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send to their board
        </button>
      </div>
    </div>
  );
}

export default function ClientBoardOffice() {
  const params = useParams();
  const propertyId = (params.id as string) ?? "";
  const search = useSearch();
  // ?present=1 → narrated Board Demo walkthrough of the office side.
  const [demoOpen, setDemoOpen] = useState(() => new URLSearchParams(search).get("present") === "1");
  const [formOpen, setFormOpen] = useState(false);
  const { data: board, isLoading } = useGetOfficeClientBoard(propertyId, {
    query: {
      enabled: !!propertyId,
      queryKey: getGetOfficeClientBoardQueryKey(propertyId),
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
    },
  });

  if (isLoading || !board) {
    return (
      <div className="animate-pulse space-y-4 pt-4">
        <div className="h-8 bg-muted rounded w-1/2"></div>
        <div className="h-40 bg-card rounded-[16px]"></div>
        <div className="h-40 bg-card rounded-[16px]"></div>
      </div>
    );
  }

  return (
    <div className="pt-2 pb-[24px] animate-in fade-in slide-in-from-bottom-4 duration-300">
      {demoOpen && <OfficeBoardDemo onClose={() => setDemoOpen(false)} />}
      <Link
        href={`/properties/${propertyId}`}
        className="flex items-center gap-[6px] text-muted-foreground text-[13.5px] font-semibold mb-[10px] w-fit"
      >
        <ChevronLeft className="w-[16px] h-[16px]" /> Back
      </Link>

      <div className="bg-[var(--ink,#17181C)] text-white rounded-[16px] p-[16px] mb-[14px]">
        <div className="font-display font-bold text-[19px] leading-[1.15]">
          {board.propertyName} — client board
        </div>
        <p className="text-white/60 text-[12.5px] font-medium mt-[4px]">
          This is exactly what the client sees. Cards you send land in their "From Archangel" column.
        </p>
        <div className="flex flex-wrap items-center gap-[8px] mt-[12px]">
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold rounded-[10px] bg-[var(--gold-light,#B4FF44)] text-black px-[12px] py-[8px] transition-transform active:scale-[0.97]"
            data-testid="button-open-send-card"
          >
            <Plus className="h-3.5 w-3.5" /> Send a card
          </button>
          {board.dashboardUrl && (
            <a
              href={board.dashboardUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-bold rounded-[10px] bg-white/10 px-[12px] py-[8px]"
              data-testid="link-open-client-board"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open their board
            </a>
          )}
          {board.webhookConnected && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium rounded-[10px] border border-emerald-400/40 text-emerald-300 px-[10px] py-[6px]">
              <Webhook className="h-3.5 w-3.5" /> Webhook connected
            </span>
          )}
        </div>
      </div>

      {board.accountStatus !== "active" && (
        <div className="rounded-[12px] border border-amber-300 bg-amber-50 text-amber-800 text-[13px] font-medium px-[14px] py-[10px] mb-[14px]">
          This client account is {board.accountStatus} — the client can't open their dashboard
          link right now, but cards you send will be waiting when it's active again.
        </div>
      )}

      {formOpen && <SendCardForm propertyId={propertyId} onClose={() => setFormOpen(false)} />}

      <div className="space-y-[18px]">
        {COLUMNS.map((col) => {
          const cards = board.cards.filter((c) => c.column === col.key);
          const Icon = col.icon;
          return (
            <section key={col.key} data-testid={`column-${col.key}`}>
              <div className="flex items-center gap-2 px-[2px] mb-[8px]">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground">
                  {col.label}
                </h2>
                <span className="text-[12px] text-muted-foreground font-medium">{cards.length}</span>
              </div>
              {cards.length === 0 ? (
                <div className="rounded-[12px] border border-dashed border-border p-[14px] text-center text-[12px] text-muted-foreground">
                  Empty
                </div>
              ) : (
                <div className="space-y-[10px]">
                  {cards.map((card) => (
                    <CardView key={card.id} card={card} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
