import { useState, useEffect, useRef } from "react";
import { Link, useParams, useSearch } from "wouter";
import { OfficeBoardDemo } from "@/components/OfficeBoardDemo";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOfficeClientBoard,
  getGetOfficeClientBoardQueryKey,
  useCreateOfficeClientBoardCard,
  useGetOfficeBoardHistory,
  getGetOfficeBoardHistoryQueryKey,
  useListOfficeCardComments,
  getListOfficeCardCommentsQueryKey,
  useAddOfficeCardComment,
  useMarkOfficeCardCommentsSeen,
  useResolveOfficeInvoiceDispute,
  type ClientBoardFeedCard,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Archive,
  ChevronLeft,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  Flag,
  ImagePlus,
  Inbox,
  Link2,
  ListTodo,
  Loader2,
  MapPin,
  MessageSquare,
  Paperclip,
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

// Slack-style thread on a board card — the office side of the client ↔ office
// conversation. Opening it marks client messages read (clears unread badges).
function ThreadSheet({
  propertyId,
  cardKey,
  title,
  onClose,
}: {
  propertyId: string;
  cardKey: string;
  title: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListOfficeCardComments(propertyId, cardKey, {
    query: {
      queryKey: getListOfficeCardCommentsQueryKey(propertyId, cardKey),
      refetchInterval: 5000,
    },
  });
  const addComment = useAddOfficeCardComment();
  const markSeen = useMarkOfficeCardCommentsSeen();
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const comments = data?.comments ?? [];
  const unreadFromClient = comments.filter((c) => c.authorType === "client" && !c.read).length;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [comments.length]);

  useEffect(() => {
    if (unreadFromClient === 0) return;
    markSeen.mutate(
      { propertyId, cardKey },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListOfficeCardCommentsQueryKey(propertyId, cardKey),
          });
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(propertyId) });
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadFromClient, cardKey]);

  const pickFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      // Manual /api URLs must be absolute — never BASE_URL-prefixed.
      const r = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        }),
      });
      if (!r.ok) throw new Error("upload");
      const { uploadURL, objectPath } = await r.json();
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("upload");
      setAttachment({ name: file.name || "Photo", path: objectPath });
    } catch {
      toast({ title: "Upload failed", description: "Try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    if (!body.trim() && !attachment) return;
    addComment.mutate(
      {
        propertyId,
        cardKey,
        data: {
          body: body.trim(),
          attachmentName: attachment?.name ?? null,
          attachmentPath: attachment?.path ?? null,
        },
      },
      {
        onSuccess: () => {
          setBody("");
          setAttachment(null);
          queryClient.invalidateQueries({
            queryKey: getListOfficeCardCommentsQueryKey(propertyId, cardKey),
          });
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(propertyId) });
        },
        onError: (err: Error) =>
          toast({ title: "Couldn't send", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full bg-background rounded-t-[20px] flex flex-col max-h-[85dvh]"
        onClick={(e) => e.stopPropagation()}
        data-testid="sheet-card-thread"
      >
        <div className="p-[16px] border-b border-border shrink-0 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-display font-bold text-[16px] truncate">{title}</div>
            <div className="text-[11px] font-medium text-muted-foreground mt-0.5">
              Client ↔ office thread
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground p-1" data-testid="button-close-thread">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-[16px] flex flex-col gap-[14px] bg-muted/30 min-h-[220px]">
          {isLoading && <Loader2 className="w-6 h-6 animate-spin mx-auto mt-8 text-muted-foreground" />}
          {!isLoading && comments.length === 0 && (
            <div className="text-center text-[13px] font-medium text-muted-foreground mt-8">
              No messages yet. Start the conversation.
            </div>
          )}
          {comments.map((c) => {
            const isOffice = c.authorType === "office";
            const isImg =
              !!c.attachmentUrl && /\.(png|jpe?g|webp|gif|heic)$/i.test(c.attachmentName ?? c.attachmentUrl);
            return (
              <div
                key={c.id}
                className={`flex flex-col max-w-[85%] ${isOffice ? "ml-auto items-end" : "mr-auto items-start"}`}
              >
                <div className="text-[10px] font-bold text-muted-foreground mb-1 px-1">
                  {c.authorName} · {new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div
                  className={`px-[14px] py-[9px] text-[13.5px] shadow-sm ${
                    isOffice
                      ? "bg-[var(--gold-light,#B4FF44)] text-[#041029] rounded-2xl rounded-tr-sm font-medium"
                      : "bg-card border border-border rounded-2xl rounded-tl-sm"
                  }`}
                >
                  {c.attachmentUrl &&
                    (isImg ? (
                      <a href={c.attachmentUrl} target="_blank" rel="noreferrer" className="block mb-1">
                        <img
                          src={c.attachmentUrl}
                          alt={c.attachmentName ?? "Attachment"}
                          className="rounded-lg max-h-44 max-w-full object-cover"
                        />
                      </a>
                    ) : (
                      <a
                        href={c.attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 underline mb-1"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        {c.attachmentName ?? "Attachment"}
                      </a>
                    ))}
                  {c.body}
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-[12px] border-t border-border shrink-0 pb-[max(12px,env(safe-area-inset-bottom))]">
          {attachment && (
            <div className="flex items-center gap-2 text-[12px] bg-muted rounded-[10px] px-3 py-2 mb-2">
              <Paperclip className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate flex-1">{attachment.name}</span>
              <button onClick={() => setAttachment(null)}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="p-[11px] rounded-[12px] border border-border text-muted-foreground disabled:opacity-50 shrink-0"
              data-testid="button-attach-thread"
            >
              {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
            </button>
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Reply to the client…"
              className="flex-1 px-[14px] py-[11px] rounded-[12px] border border-border bg-background text-[14px] font-medium outline-none focus:ring-2 focus:ring-[var(--gold-light,#B4FF44)]"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              data-testid="input-thread-reply"
            />
            <button
              onClick={submit}
              disabled={(!body.trim() && !attachment) || addComment.isPending || uploading}
              className="p-[11px] bg-[var(--ink,#17181C)] text-[var(--gold-light,#B4FF44)] rounded-[12px] disabled:opacity-50 shrink-0"
              data-testid="button-send-thread"
            >
              {addComment.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// One disputed invoice → an actionable row: the client's complaint, an
// optional response box, and one button that clears the banner on their card.
function DisputeRow({ propertyId, card }: { propertyId: string; card: ClientBoardFeedCard }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const resolve = useResolveOfficeInvoiceDispute();
  const [note, setNote] = useState("");
  const mod = (card.module ?? {}) as Record<string, unknown>;
  const submit = () => {
    resolve.mutate(
      { propertyId, cardId: card.id, data: { note: note.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(propertyId) });
          toast({ title: "Dispute cleared", description: "The banner is off the client's card." });
        },
        onError: (err: any) =>
          toast({
            title: "Couldn't clear the dispute",
            description: err?.data?.error ?? err.message,
            variant: "destructive",
          }),
      },
    );
  };
  return (
    <div
      className="rounded-[14px] border border-red-200 bg-red-50/60 p-[12px] space-y-[8px]"
      data-testid={`dispute-row-${card.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold truncate">{card.title}</div>
          <div className="text-[11px] font-medium text-red-700 mt-0.5">
            Disputed{typeof mod.disputedBy === "string" && mod.disputedBy ? ` by ${mod.disputedBy}` : ""}
            {typeof mod.disputedAt === "string"
              ? ` · ${new Date(mod.disputedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : ""}
          </div>
        </div>
        {card.amount != null && (
          <span className="text-[13px] font-bold tabular-nums shrink-0">{usd(card.amount)}</span>
        )}
      </div>
      {typeof mod.disputeNote === "string" && mod.disputeNote && (
        <div className="text-[12.5px] text-red-800 bg-white/70 border border-red-100 rounded-[10px] px-[10px] py-[8px]">
          “{mod.disputeNote}”
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Response to the client (optional)"
          className="flex-1 px-[12px] py-[9px] rounded-[10px] border border-border bg-background text-[13px] font-medium outline-none focus:ring-2 focus:ring-[var(--gold-light,#B4FF44)]"
          data-testid={`input-dispute-response-${card.id}`}
        />
        <button
          onClick={submit}
          disabled={resolve.isPending}
          className="px-[12px] py-[9px] bg-[var(--ink,#17181C)] text-white text-[12.5px] font-bold rounded-[10px] disabled:opacity-50 shrink-0 flex items-center gap-1.5 transition-transform active:scale-[0.97]"
          data-testid={`button-resolve-dispute-${card.id}`}
        >
          {resolve.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Clear dispute
        </button>
      </div>
    </div>
  );
}

function DisputesSection({ propertyId, cards }: { propertyId: string; cards: ClientBoardFeedCard[] }) {
  const disputed = cards.filter(
    (c) => (c.module as any)?.type === "invoice" && (c.module as any)?.disputedAt,
  );
  if (disputed.length === 0) return null;
  return (
    <section className="mb-[18px]" data-testid="section-disputes">
      <div className="flex items-center gap-2 px-[2px] mb-[8px]">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        <h2 className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-red-700">
          Disputed invoices
        </h2>
        <span className="text-[11px] font-bold bg-red-600 text-white rounded-full px-1.5 py-px" data-testid="badge-disputes-count">
          {disputed.length}
        </span>
      </div>
      <div className="space-y-[10px]">
        {disputed.map((c) => (
          <DisputeRow key={c.id} propertyId={propertyId} card={c} />
        ))}
      </div>
    </section>
  );
}

function CardView({
  card,
  onOpenThread,
}: {
  card: ClientBoardFeedCard;
  onOpenThread: () => void;
}) {
  const meta = KIND_META[card.kind] ?? KIND_META.manual;
  const isDisputed = (card.module as any)?.type === "invoice" && !!(card.module as any)?.disputedAt;
  return (
    <div
      className="rounded-[14px] border border-border bg-card p-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] space-y-[8px]"
      data-testid={`card-${card.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>
            {card.kind === "flag" ? <Flag className="inline h-3 w-3 mr-1 -mt-0.5" /> : null}
            {meta.label}
          </span>
          {isDisputed && (
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white"
              data-testid={`badge-disputed-${card.id}`}
            >
              Disputed
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {card.amount != null && (
            <span className="text-[13.5px] font-bold tabular-nums">
              {card.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}
            </span>
          )}
          <button
            onClick={onOpenThread}
            className="text-muted-foreground p-1 -m-1 active:scale-[0.9] transition-transform"
            title="Message thread"
            data-testid={`button-thread-${card.id}`}
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
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

// Cleared-card history — mirrors the client dashboard's History tab so the
// office sees exactly what clients cleared, with the same CSV export.
const HISTORY_STATUS_META: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-800", Icon: CheckCircle2 },
  paid: { label: "Paid", cls: "bg-sky-100 text-sky-800", Icon: DollarSign },
  cleared: { label: "Cleared", cls: "bg-neutral-200 text-neutral-700", Icon: Archive },
};

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function HistorySection({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const { data, isLoading } = useGetOfficeBoardHistory(propertyId, {
    query: { enabled: !!propertyId, queryKey: getGetOfficeBoardHistoryQueryKey(propertyId) },
  });
  const entries = data?.entries ?? [];
  const totalPaid = entries.reduce((s, e) => s + e.amountPaid, 0);

  const handleExport = async () => {
    setExporting(true);
    try {
      // Manual /api URLs must be absolute — never BASE_URL-prefixed.
      const res = await fetch(`/api/admin/accounts/${propertyId}/board/history.csv`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "board-history.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Couldn't export the history CSV", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="mt-[24px]" data-testid="section-history">
      <div className="flex items-center justify-between px-[2px] mb-[8px]">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground">
            Cleared history
          </h2>
          {!isLoading && (
            <span className="text-[12px] text-muted-foreground font-medium">
              {entries.length} · {usd(totalPaid)} paid
            </span>
          )}
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || entries.length === 0}
          className="flex items-center gap-1.5 text-[12px] font-bold rounded-[10px] bg-[var(--ink,#17181C)] text-white px-[10px] py-[7px] disabled:opacity-40 transition-transform active:scale-[0.97]"
          data-testid="button-export-history"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export CSV
        </button>
      </div>
      {isLoading ? (
        <div className="h-20 rounded-[12px] bg-card animate-pulse" />
      ) : entries.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-border p-[14px] text-center text-[12px] text-muted-foreground">
          Nothing cleared yet — when the client trashes a card, it lands here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card divide-y divide-border">
          {entries.map((e) => {
            const meta = HISTORY_STATUS_META[e.status] ?? HISTORY_STATUS_META.cleared!;
            return (
              <div key={e.id} className="flex items-start gap-3 p-[12px]" data-testid={`history-entry-${e.id}`}>
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.cls}`}>
                  <meta.Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[13.5px] font-semibold">{e.title}</p>
                    {e.amountPaid > 0 && (
                      <span className="shrink-0 text-[13px] font-bold tabular-nums">{usd(e.amountPaid)}</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-muted-foreground">
                    <span className={`rounded-full px-1.5 py-px font-semibold ${meta.cls}`}>{meta.label}</span>
                    {e.unitLabel && <span>Unit {e.unitLabel}</span>}
                    {e.jobLabel && <span>{e.jobLabel}</span>}
                    <span>{e.frequency === "recurring" ? "Recurring" : "One time"}</span>
                    <span>
                      {new Date(e.clearedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    {e.clearedBy && <span>by {e.clearedBy}</span>}
                  </div>
                  {e.summary && (
                    <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{e.summary}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
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
  const [threadTarget, setThreadTarget] = useState<{ cardKey: string; title: string } | null>(null);
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

      <DisputesSection propertyId={propertyId} cards={board.cards} />

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
                    <CardView
                      key={card.id}
                      card={card}
                      onOpenThread={() => setThreadTarget({ cardKey: `push:${card.id}`, title: card.title })}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <HistorySection propertyId={propertyId} />

      {threadTarget && (
        <ThreadSheet
          propertyId={propertyId}
          cardKey={threadTarget.cardKey}
          title={threadTarget.title}
          onClose={() => setThreadTarget(null)}
        />
      )}
    </div>
  );
}
