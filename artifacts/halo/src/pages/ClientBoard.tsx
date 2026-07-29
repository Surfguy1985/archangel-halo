import { useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetClientBoardFeed,
  getGetClientBoardFeedQueryKey,
  useUpdateClientBoardFeedCard,
  useUpdateClientBoardWebhook,
  type ClientBoardFeedCard,
} from "@workspace/api-client-react";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  FileText,
  Flag,
  Headphones,
  Inbox,
  Link2,
  ListTodo,
  Loader2,
  MapPin,
  Play,
  Undo2,
  Webhook,
} from "lucide-react";
import { FalkonBadge } from "@/components/FalkonBadge";
import { BoardTour } from "@/components/BoardTour";

const COLUMNS = [
  { key: "inbox", label: "From Archangel", icon: Inbox },
  { key: "todo", label: "To do", icon: ListTodo },
  { key: "in_progress", label: "In progress", icon: Play },
  { key: "done", label: "Done", icon: CheckCircle2 },
] as const;

const NEXT: Record<string, string> = {
  inbox: "todo",
  todo: "in_progress",
  in_progress: "done",
};

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
  token,
}: {
  card: ClientBoardFeedCard;
  token: string;
}) {
  const queryClient = useQueryClient();
  const move = useUpdateClientBoardFeedCard({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetClientBoardFeedQueryKey(token) }),
    },
  });
  const meta = KIND_META[card.kind] ?? KIND_META.manual;
  const next = NEXT[card.column];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>
          {card.kind === "flag" ? <Flag className="inline h-3 w-3 mr-1 -mt-0.5" /> : null}
          {meta.label}
        </span>
        {card.amount != null && (
          <span className="text-sm font-bold">
            {card.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}
          </span>
        )}
      </div>
      <div className="text-sm font-semibold leading-snug">{card.title}</div>
      {card.body && (
        <div className="text-xs text-neutral-500 whitespace-pre-line line-clamp-4">{card.body}</div>
      )}
      {card.dueDate && (
        <div className="text-[11px] text-neutral-500">Due {card.dueDate}</div>
      )}
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
                className="flex items-center gap-1.5 text-xs font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {l.label}
              </a>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        {next && (
          <button
            onClick={() => move.mutate({ token, cardId: card.id, data: { column: next } })}
            disabled={move.isPending}
            className="flex items-center gap-1 text-xs font-bold bg-[#B4FF44] text-black rounded-lg px-2.5 py-1.5 disabled:opacity-50"
            data-testid={`button-move-${card.id}`}
          >
            {move.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ArrowRight className="h-3 w-3" />
            )}
            {card.column === "inbox" ? "Accept" : next === "done" ? "Mark done" : "Start"}
          </button>
        )}
        {card.column !== "inbox" && (
          <button
            onClick={() => move.mutate({ token, cardId: card.id, data: { column: "inbox" } })}
            disabled={move.isPending}
            className="flex items-center gap-1 text-xs text-neutral-500 px-1.5 py-1.5"
            data-testid={`button-reset-${card.id}`}
          >
            <Undo2 className="h-3 w-3" /> Reset
          </button>
        )}
        {card.actionLabel && (
          <span className="ml-auto text-[11px] text-neutral-400 truncate">{card.actionLabel}</span>
        )}
      </div>
    </div>
  );
}

function WebhookBox({ token, current }: { token: string; current: string | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(current ?? "");
  const save = useUpdateClientBoardWebhook({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientBoardFeedQueryKey(token) });
        setOpen(false);
      },
    },
  });
  return (
    <div className="text-right">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border px-2.5 py-1.5 ${current ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-neutral-200 text-neutral-600 bg-white"}`}
        data-testid="button-webhook"
      >
        <Webhook className="h-3.5 w-3.5" />
        {current ? "Webhook connected" : "Connect your board"}
      </button>
      {open && (
        <div className="mt-2 p-3 rounded-xl border border-neutral-200 bg-white text-left w-80 ml-auto space-y-2 shadow-lg">
          <div className="text-xs text-neutral-500">
            Every card we raise is also POSTed to this URL — point it at your Trello,
            Slack, or Zapier webhook and your own board stays in sync, hands-off.
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.example.com/…"
            className="w-full text-xs border border-neutral-300 rounded-lg px-2.5 py-2"
            data-testid="input-webhook-url"
          />
          {save.isError && (
            <div className="text-xs text-red-600">
              {(save.error as { data?: { error?: string } })?.data?.error ?? "Could not save"}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => save.mutate({ token, data: { webhookUrl: url } })}
              disabled={save.isPending}
              className="text-xs font-bold bg-black text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
              data-testid="button-webhook-save"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
            {current && (
              <button
                onClick={() => save.mutate({ token, data: { webhookUrl: null } })}
                className="text-xs text-red-600 px-2 py-1.5"
                data-testid="button-webhook-remove"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClientBoard() {
  const { token = "" } = useParams<{ token: string }>();
  const [tourOpen, setTourOpen] = useState(false);
  const boardQuery = useGetClientBoardFeed(token, {
    query: {
      queryKey: getGetClientBoardFeedQueryKey(token),
      enabled: !!token,
      retry: false,
    },
  });
  const board = boardQuery.data;

  if (boardQuery.isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-neutral-50">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }
  if (!board) {
    return (
      <div className="min-h-screen grid place-items-center bg-neutral-50 p-6 text-center">
        <div>
          <div className="text-lg font-bold">This link isn't active</div>
          <div className="text-sm text-neutral-500 mt-1">
            Ask your Archangel Contractors contact for a fresh dashboard link.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-black text-white px-4 py-4 sm:px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FalkonBadge />
              <span className="text-xs font-bold tracking-widest text-[#B4FF44] uppercase">
                Archangel Contractors
              </span>
            </div>
            <h1 className="text-lg font-bold mt-1">{board.propertyName} — your board</h1>
            <p className="text-xs text-neutral-400 mt-0.5">
              Everything we send you lands here automatically — invoices, pay links,
              recaps, and live job trackers, ready to open.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <WebhookBox token={token} current={board.webhookUrl ?? null} />
            <button
              onClick={() => setTourOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border border-neutral-700 text-neutral-300 px-2.5 py-1.5 hover:text-white"
              data-testid="button-board-tour"
            >
              <Headphones className="h-3.5 w-3.5" /> Take the guided tour
            </button>
          </div>
        </div>
      </header>
      {tourOpen && <BoardTour onClose={() => setTourOpen(false)} />}
      <main className="max-w-6xl mx-auto p-4 sm:p-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {COLUMNS.map((col) => {
            const cards = board.cards.filter((c) => c.column === col.key);
            const Icon = col.icon;
            return (
              <section key={col.key} className="space-y-3" data-testid={`column-${col.key}`}>
                <div className="flex items-center gap-2 px-1">
                  <Icon className="h-4 w-4 text-neutral-500" />
                  <h2 className="text-sm font-bold">{col.label}</h2>
                  <span className="text-xs text-neutral-400 font-medium">{cards.length}</span>
                </div>
                {cards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-neutral-200 p-4 text-center text-xs text-neutral-400">
                    {col.key === "inbox" ? "Nothing new from us" : "Empty"}
                  </div>
                ) : (
                  cards.map((card) => <CardView key={card.id} card={card} token={token} />)
                )}
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
