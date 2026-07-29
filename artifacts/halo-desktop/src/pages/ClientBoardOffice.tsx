import { useState, useEffect } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOfficeBoardFull,
  getGetOfficeBoardFullQueryKey,
  useGetOfficeClientBoard,
  getGetOfficeClientBoardQueryKey,
  useCreateOfficeClientBoardCard,
  useUpdateOfficeClientBoardCard,
  useDeleteOfficeClientBoardCard,
  usePushClientBoardCard,
  useGetClientBoardPushQuickPicks,
  getGetClientBoardPushQuickPicksQueryKey,
  useListClientAccounts,
  useGetClientBoardInbox,
  getGetClientBoardInboxQueryKey,
  useDispatchOfficeBoardAction,
  useRespondClientInboxCard,
  useListOfficeCardComments,
  getListOfficeCardCommentsQueryKey,
  useAddOfficeCardComment,
  type ClientBoardFeedCard,
  type ClientInboxCard,
  type BoardCardComment,
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
  Paperclip,
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
  MessageSquare,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AppleBoard } from "@workspace/board-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const COLUMNS = [
  { key: "inbox", label: "From Archangel", icon: Inbox },
  { key: "todo", label: "To do", icon: ListTodo },
  { key: "in_progress", label: "In progress", icon: Play },
  { key: "done", label: "Done", icon: CheckCircle2 },
] as const;

type KindMeta = {
  label: string;
  icon: typeof FileText;
  gradient: string;
  textColor: string;
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
  crewmap: {
    label: "Crew Map",
    icon: MapPin,
    gradient: "bg-gradient-to-br from-emerald-400 to-emerald-500",
    textColor: "text-white",
  },
  invoice_batch: {
    label: "Invoices",
    icon: FileText,
    gradient: "bg-gradient-to-br from-amber-400 to-amber-500",
    textColor: "text-white",
  },
  bid: {
    label: "Proposal",
    icon: Briefcase,
    gradient: "bg-gradient-to-br from-indigo-400 to-indigo-500",
    textColor: "text-white",
  },
  document: {
    label: "Document",
    icon: Link2,
    gradient: "bg-gradient-to-br from-slate-400 to-slate-500",
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
  onComment,
}: {
  card: ClientBoardFeedCard;
  onEdit?: () => void;
  onRemove?: () => void;
  removing?: boolean;
  onComment?: () => void;
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
      <div className="flex items-start gap-3 mb-3 shrink-0">
        <div className={`flex items-center justify-center w-10 h-10 rounded-2xl shadow-sm ${meta.gradient} shrink-0`}>
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
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {onComment && (
            <button
              onClick={onComment}
              title="Thread"
              className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors"
              data-testid={`button-comment-card-${card.id}`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          )}
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

      <div className="flex-1 min-h-0 flex flex-col space-y-1.5 mb-2">
        <div className="text-[13px] font-bold leading-snug line-clamp-2 shrink-0">{card.title}</div>
        {card.body && (
          <div className="text-[11px] text-muted-foreground whitespace-pre-line line-clamp-2 shrink-0">
            {card.body}
          </div>
        )}

        {mod && (
          <div className="mt-auto pt-2 overflow-hidden">
            {mod.type === "crewmap" && (
              <div className="rounded-xl bg-emerald-50/80 border border-emerald-200/60 p-2.5 text-xs space-y-1.5">
                <div className="font-semibold text-emerald-900">
                  {mod.onSiteCount || 0} crew members on site
                </div>
                {mod.crews && mod.crews.length > 0 && (
                  <div className="space-y-1 mt-1">
                    {mod.crews.map((c: any, i: number) => (
                      <div key={i} className="flex items-center gap-1.5 text-emerald-800 bg-emerald-100/50 px-2 py-1 rounded">
                        <Users className="w-3 h-3" />
                        <span>{c.crewName} {c.unitNo && `• Unit ${c.unitNo}`}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mod.type === "invoice_batch" && (
              <div className="rounded-xl bg-amber-50/80 border border-amber-200/60 p-2.5 text-xs space-y-1.5">
                <div className="font-semibold text-amber-900 flex justify-between">
                  <span>Batch of {mod.invoices?.length || 0}</span>
                  <span>${mod.totalAmount?.toFixed(2)}</span>
                </div>
                {mod.invoices && mod.invoices.length > 0 && (
                  <div className="space-y-1 mt-1">
                    {mod.invoices.slice(0, 3).map((inv: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-amber-800">
                        <span>Inv {inv.invoiceNo}</span>
                        <div className="flex items-center gap-2">
                          <span>${inv.amount?.toFixed(2)}</span>
                          {inv.pdfUrl && (
                            <a href={inv.pdfUrl} target="_blank" rel="noreferrer" className="text-amber-600 hover:text-amber-900" title="View PDF">
                              <FileText className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                    {mod.invoices.length > 3 && (
                      <div className="text-[10px] text-amber-600/80 text-center pt-0.5">
                        +{mod.invoices.length - 3} more
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {mod.type === "bid" && (
              <div className="rounded-xl bg-indigo-50/80 border border-indigo-200/60 p-2.5 text-xs space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-indigo-900">Bid {mod.bidNo}</span>
                  <span className="font-semibold text-indigo-900">${mod.amount?.toFixed(2)}</span>
                </div>
                {mod.status === "approved" ? (
                   <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#041029] bg-[#B4FF44] px-2 py-1 rounded-lg w-max">
                     <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                   </div>
                ) : mod.status === "declined" ? (
                   <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-900 bg-red-200 px-2 py-1 rounded-lg w-max">
                     Declined
                   </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-700 bg-indigo-100/70 px-2 py-1 rounded-lg w-max">
                    <Loader2 className="w-3 h-3 animate-spin" /> Waiting on client...
                  </div>
                )}
                {mod.lineItems && mod.lineItems.length > 0 && (
                  <div className="space-y-0.5 mt-1 text-[10px] text-indigo-800/80">
                     {mod.lineItems.slice(0,2).map((item: any, i: number) => (
                       <div key={i} className="truncate">• {item.description}</div>
                     ))}
                     {mod.lineItems.length > 2 && <div className="pl-2">+{mod.lineItems.length - 2} more</div>}
                  </div>
                )}
                {mod.pdfUrl && (
                  <a
                    href={mod.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] font-bold text-indigo-700 hover:text-indigo-900 w-max bg-indigo-100/60 px-2 py-1 rounded-lg transition-colors mt-2"
                  >
                    <FileText className="w-3 h-3" /> View PDF
                  </a>
                )}
              </div>
            )}
            {mod.type === "document" && (
              <div className="rounded-xl bg-slate-50/80 border border-slate-200/60 p-2.5 text-xs space-y-1.5">
                <a
                  href={mod.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 hover:text-slate-900 w-max bg-slate-200/60 px-2 py-1 rounded-lg transition-colors"
                >
                  <Link2 className="w-3.5 h-3.5" /> View Document
                </a>
              </div>
            )}
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
            {card.kind === "summary" && (
              <div className="rounded-xl bg-sky-50/80 border border-sky-200/60 p-2.5 text-xs space-y-1.5">
                <div className="flex items-center gap-2">
                  {mod.result === "exceeded" && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Exceeded</span>
                  )}
                  {mod.result === "met" && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">Met</span>
                  )}
                  {mod.result === "followup" && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Follow-up</span>
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
            {card.kind === "photos" && (
              <div className="rounded-xl bg-pink-50/80 border border-pink-200/60 p-2.5 text-xs space-y-1.5">
                {mod.photoUrls && mod.photoUrls.length > 0 && (
                  <div className="flex gap-1.5 overflow-hidden">
                    {mod.photoUrls.slice(0, 4).map((url: string, i: number) => (
                      <img key={i} src={url} alt="" className="w-12 h-12 rounded-lg object-cover border border-pink-200/40" />
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-pink-700 font-medium">
                  {mod.totalCount} photo{mod.totalCount === 1 ? "" : "s"} · Job {mod.jobNo}
                </div>
              </div>
            )}
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

function InboxCardView({
  card,
  onRespond,
  onComment,
}: {
  card: ClientInboxCard;
  onRespond: (status: "accepted" | "declined") => void;
  onComment: () => void;
}) {
  const isPending = card.status === "pending";

  return (
    <div className="group flex flex-col p-5 rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-shadow relative">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {isPending ? (
            <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wider">
              Pending
            </span>
          ) : card.status === "accepted" ? (
            <span className="px-2 py-0.5 rounded-md bg-[#B4FF44]/30 text-[#041029] text-[10px] font-bold uppercase tracking-wider">
              Accepted
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-800 text-[10px] font-bold uppercase tracking-wider">
              Declined
            </span>
          )}
          {card.priority === "high" && (
            <span className="px-2 py-0.5 rounded-md bg-orange-100 text-orange-800 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
              <Flag className="w-3 h-3" /> High Priority
            </span>
          )}
        </div>
        <button
          onClick={onComment}
          className="text-muted-foreground hover:text-foreground relative p-1.5 rounded-lg hover:bg-muted transition-colors"
          title="Thread"
        >
          <MessageSquare className="w-5 h-5" />
          {card.commentCount != null && card.commentCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-[#041029] text-[#B4FF44] text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] flex items-center justify-center border border-card shadow-sm">
              {card.commentCount}
            </span>
          )}
        </button>
      </div>

      <div className="text-base font-bold text-foreground mb-1.5 leading-snug">
        {card.title}
      </div>

      {card.description && (
        <div className="text-sm text-muted-foreground mb-4 whitespace-pre-line">
          {card.description}
        </div>
      )}

      {card.checklist && card.checklist.length > 0 && (
        <div className="mb-4 space-y-1.5 bg-muted/30 p-3 rounded-xl border border-border/50">
          {card.checklist.map((item) => (
            <div key={item.id} className="flex items-start gap-2 text-sm">
              {item.done ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <div className="w-4 h-4 rounded-full border-2 border-border shrink-0 mt-0.5" />
              )}
              <span className={item.done ? "text-muted-foreground line-through" : "text-foreground"}>
                {item.text}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-5">
        {card.labels?.map((l, i) => (
          <span key={i} className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 uppercase tracking-wider border border-slate-200">
            {l}
          </span>
        ))}
      </div>

      <div className="mt-auto border-t border-border pt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
          <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[10px]">
            {card.createdBy ? card.createdBy.substring(0, 2).toUpperCase() : "CL"}
          </span>
          <span>
            {card.createdBy || "Client"} • {new Date(card.sentAt).toLocaleDateString()}
            {card.dueOn && ` • Due ${new Date(card.dueOn).toLocaleDateString()}`}
          </span>
        </div>

        {isPending && (
          <div className="flex gap-2">
            <button
              onClick={() => onRespond("declined")}
              className="px-4 py-2 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 transition-colors border border-transparent hover:border-red-200"
            >
              Decline
            </button>
            <button
              onClick={() => onRespond("accepted")}
              className="px-5 py-2 rounded-xl text-sm font-bold bg-[#041029] text-[#B4FF44] hover:opacity-90 transition-opacity"
            >
              Accept Request
            </button>
          </div>
        )}

        {!isPending && card.note && (
          <div className="w-full mt-2 p-3 rounded-xl bg-muted/50 border border-border text-sm text-muted-foreground flex gap-2">
            <span className="font-bold text-foreground">Note:</span> {card.note}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentsDialog({
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
  const { data, isLoading } = useListOfficeCardComments(propertyId, cardKey, {
    query: {
      queryKey: getListOfficeCardCommentsQueryKey(propertyId, cardKey),
      refetchInterval: 5000,
    },
  });
  const addComment = useAddOfficeCardComment();
  const [body, setBody] = useState("");

  const submit = () => {
    if (!body.trim()) return;
    addComment.mutate(
      { propertyId, cardKey, data: { body: body.trim() } },
      {
        onSuccess: () => {
          setBody("");
          queryClient.invalidateQueries({
            queryKey: getListOfficeCardCommentsQueryKey(propertyId, cardKey),
          });
        },
      }
    );
  };

  const comments = data?.comments ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-background h-[600px] flex flex-col sm:rounded-3xl">
        <div className="p-5 border-b border-border bg-card shrink-0">
          <DialogTitle className="text-lg font-display font-bold truncate pr-6">{title}</DialogTitle>
          <div className="text-xs font-medium text-muted-foreground mt-1">Internal & Client Thread</div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5 bg-slate-50">
          {isLoading && <Loader2 className="w-6 h-6 animate-spin mx-auto mt-10 text-muted-foreground" />}
          {!isLoading && comments.length === 0 && (
            <div className="text-center text-sm font-medium text-muted-foreground mt-10">
              No comments yet. Start the conversation.
            </div>
          )}
          {comments.map((c: BoardCardComment) => {
            const isOffice = c.authorType === "office";
            return (
              <div
                key={c.id}
                className={`flex flex-col max-w-[85%] ${isOffice ? "ml-auto items-end" : "mr-auto items-start"}`}
              >
                <div className="text-[10px] font-bold text-muted-foreground mb-1.5 px-1 tracking-wide">
                  {c.authorName} • {new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div
                  className={`px-4 py-2.5 text-sm shadow-sm ${
                    isOffice
                      ? "bg-[#B4FF44] text-[#041029] rounded-2xl rounded-tr-sm font-medium"
                      : "bg-white border border-border text-foreground rounded-2xl rounded-tl-sm"
                  }`}
                >
                  {c.body}
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-4 bg-card border-t border-border shrink-0">
          <div className="flex gap-2">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a reply..."
              className="flex-1 px-4 py-3 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[#B4FF44] transition-shadow"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button
              onClick={submit}
              disabled={!body.trim() || addComment.isPending}
              className="p-3 bg-[#041029] text-[#B4FF44] rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center shrink-0"
            >
              {addComment.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RespondDialog({
  propertyId,
  cardKey,
  status,
  onClose,
}: {
  propertyId: string;
  cardKey: string;
  status: "accepted" | "declined";
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const respond = useRespondClientInboxCard();
  const [note, setNote] = useState("");

  const submit = () => {
    respond.mutate(
      { propertyId, cardKey, data: { status, note: note.trim() || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardInboxQueryKey(propertyId) });
          toast({ title: `Request ${status}` });
          onClose();
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message || "Failed to respond", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm p-6 sm:rounded-3xl">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-xl font-display font-bold">
            {status === "accepted" ? "Accept Request" : "Decline Request"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Optional Note
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`Tell the client why it was ${status}...`}
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[#B4FF44]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 font-bold text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={respond.isPending}
              className={`px-5 py-2 rounded-xl font-bold text-sm flex items-center gap-2 transition-opacity ${
                status === "accepted" ? "bg-[#B4FF44] text-[#041029]" : "bg-red-600 text-white"
              }`}
            >
              {respond.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {status === "accepted" ? "Accept" : "Decline"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type DraftLink = { label: string; url: string };

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
            />
          </div>

          {hasSourceModule && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border">
              <Switch
                id="refresh-module"
                checked={refreshModule}
                onCheckedChange={setRefreshModule}
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Links (optional)
              </label>
              <button
                onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}
                className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
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
                    />
                    <input
                      value={l.url}
                      onChange={(e) =>
                        setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                      }
                      placeholder="https://…"
                      className={inputCls}
                    />
                    <button
                      onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-red-600 shrink-0 transition-colors"
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
            className="w-full py-3 bg-[#B4FF44] text-[#041029] text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {update.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            Save changes
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type PushTemplate = {
  id: string;
  kind: string;
  label: string;
  desc: string;
  icon: typeof FileText;
  gradient: string;
  textColor: string;
  quick?: "invoices" | "trackers" | "summaries" | "photos" | "bids";
  money?: boolean;
  due?: boolean;
  titlePrefill?: string;
  bodyPlaceholder?: string;
  linkLabel?: string;
  multiSelect?: boolean;
  requireUrl?: boolean;
};

const TEMPLATES: PushTemplate[] = [
  {
    id: "live_crew_map",
    kind: "crewmap",
    label: "Live Crew Map",
    desc: "Map of current crews",
    icon: MapPin,
    gradient: "bg-gradient-to-br from-emerald-400 to-emerald-500",
    textColor: "text-white",
    titlePrefill: "Live crew on your site",
  },
  {
    id: "invoice_batch",
    kind: "invoice_batch",
    label: "Invoice Batch",
    desc: "Multiple invoices",
    icon: FileText,
    gradient: "bg-gradient-to-br from-amber-400 to-amber-500",
    textColor: "text-white",
    quick: "invoices",
    multiSelect: true,
    titlePrefill: "Invoices — ",
    linkLabel: "Pay invoices",
  },
  {
    id: "bid",
    kind: "bid",
    label: "Bid / Proposal",
    desc: "Send a proposal",
    icon: Briefcase,
    gradient: "bg-gradient-to-br from-indigo-400 to-indigo-500",
    textColor: "text-white",
    quick: "bids",
    titlePrefill: "Proposal ",
    linkLabel: "View proposal",
  },
  {
    id: "document",
    kind: "document",
    label: "Document / PDF",
    desc: "Share a file link",
    icon: Link2,
    gradient: "bg-gradient-to-br from-slate-400 to-slate-500",
    textColor: "text-white",
    requireUrl: true,
    linkLabel: "View document",
  },
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
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        // Manual /api URLs must stay root-absolute in the desktop app.
        const r = await fetch("/api/storage/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
        });
        if (!r.ok) throw new Error("Could not start the upload");
        const { uploadURL, objectPath } = await r.json();
        const put = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!put.ok) throw new Error(`Upload failed for ${file.name}`);
        setAttachments((prev) => [...prev, { name: file.name, url: `/api/storage${objectPath}` }]);
      }
    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

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
    setSourceIds([]);
    setAttachments([]);
  };

  useEffect(() => {
    if (open) {
      setTargetId(propertyId);
      setTemplate(null);
      resetFields();
    }
  }, [open, propertyId]);

  const handleTemplate = (t: PushTemplate) => {
    setTemplate(t);
    resetFields();
    setTitle(t.titlePrefill ?? "");
    setLinkLabel(t.linkLabel ?? "Open");
  };

  const submit = () => {
    const data = {
      kind: template!.kind,
      title: title.trim(),
      body: body.trim() || null,
      amount: amount ? Number(amount) : null,
      dueDate: dueDate || null,
      linkUrl: linkUrl.trim() || null,
      linkLabel: linkUrl.trim() ? linkLabel.trim() : null,
      sourceType: source?.type || null,
      sourceId: source?.id || null,
      sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
      jobId: source?.jobId || null,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    push.mutate(
      { propertyId: targetId, data },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(targetId) });
          toast({
            title: "Card pushed",
            description: res.notified ? "Instant email sent to client." : "Added silently to the board.",
          });
          onOpenChange(false);
        },
        onError: (err: Error) =>
          toast({ title: "Failed to push", description: err.message, variant: "destructive" }),
      }
    );
  };

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[#B4FF44] transition-shadow";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-background flex flex-col sm:rounded-3xl h-[85vh] sm:h-auto">
        <div className="p-6 border-b border-border bg-card shrink-0">
          <DialogTitle className="text-xl font-display font-bold">Push a new card</DialogTitle>
          <div className="text-sm font-medium text-muted-foreground mt-1">
            Send an interactive module to the client's board immediately.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/50">
          {!template ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {TEMPLATES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleTemplate(t)}
                    className="flex flex-col items-center text-center p-4 rounded-2xl border border-border bg-card hover:border-[#B4FF44] hover:shadow-sm transition-all group"
                  >
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-sm ${t.gradient} group-hover:scale-105 transition-transform`}>
                      <Icon className={`w-6 h-6 ${t.textColor}`} />
                    </div>
                    <div className="text-sm font-bold text-foreground mb-1">{t.label}</div>
                    <div className="text-[11px] font-medium text-muted-foreground">{t.desc}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="max-w-xl mx-auto space-y-6">
              <div className="flex items-center justify-between bg-card p-3 rounded-2xl border border-border">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${template.gradient}`}>
                    <template.icon className={`w-5 h-5 ${template.textColor}`} />
                  </div>
                  <div>
                    <div className="text-sm font-bold">{template.label}</div>
                    <div className="text-xs text-muted-foreground font-medium">Configure payload</div>
                  </div>
                </div>
                <button
                  onClick={() => setTemplate(null)}
                  className="px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted rounded-lg transition-colors"
                >
                  Change type
                </button>
              </div>

              {accounts && accounts.length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Target account</label>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className={inputCls}
                  >
                    {accounts.map((a) => (
                      <option key={a.propertyId} value={a.propertyId}>
                        {a.propertyName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {template.quick && quickPicks && (
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Quick pick from {template.quick}</label>
                  {template.quick === "invoices" && quickPicks.invoices.length === 0 && (
                    <div className="text-sm text-muted-foreground italic">No open invoices to pick from.</div>
                  )}
                  {template.quick === "invoices" && template.multiSelect && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {quickPicks.invoices.map((inv) => {
                          const isSelected = sourceIds.includes(inv.id);
                          return (
                            <button
                              key={inv.id}
                              onClick={() => {
                                const newIds = isSelected 
                                  ? sourceIds.filter(id => id !== inv.id) 
                                  : [...sourceIds, inv.id];
                                setSourceIds(newIds);
                                
                                const total = quickPicks.invoices
                                  .filter(i => newIds.includes(i.id))
                                  .reduce((sum, i) => sum + i.amount, 0);
                                  
                                setAmount(total > 0 ? total.toString() : "");
                                
                                const monthName = new Date().toLocaleString('en-US', { month: 'long' });
                                setTitle(`Invoices — ${monthName}`);
                              }}
                              className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                                isSelected ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-[#041029] border-[#041029]' : 'border-border'}`}>
                                  {isSelected && <CheckCircle2 className="w-3 h-3 text-[#B4FF44]" />}
                                </div>
                                <div>
                                  <div className="text-sm font-bold">Inv {inv.invoiceNo}</div>
                                  <div className="text-xs text-muted-foreground">
                                    ${inv.amount.toFixed(2)} {inv.dueDate && ` • Due ${inv.dueDate}`}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {sourceIds.length > 0 && (
                        <div className="text-sm font-medium text-amber-600 bg-amber-50 p-2 rounded-lg inline-block">
                          {sourceIds.length} invoice{sourceIds.length === 1 ? "" : "s"} selected
                        </div>
                      )}
                    </div>
                  )}
                  {template.quick === "invoices" && !template.multiSelect && (
                    <div className="flex flex-wrap gap-2">
                      {quickPicks.invoices.map((inv) => (
                        <button
                          key={inv.id}
                          onClick={() => {
                            setSource({ type: "invoice", id: inv.id });
                            setTitle(`Invoice ${inv.invoiceNo}`);
                            setAmount(inv.amount.toString());
                            setDueDate(inv.dueDate ?? "");
                            if (inv.payUrl) setLinkUrl(inv.payUrl);
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                            source?.id === inv.id ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="text-sm font-bold">Inv {inv.invoiceNo}</div>
                          <div className="text-xs text-muted-foreground">
                            ${inv.amount.toFixed(2)} {inv.dueDate && ` • Due ${inv.dueDate}`}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {template.quick === "bids" && quickPicks.bids?.length === 0 && (
                    <div className="text-sm text-muted-foreground italic">No active proposals to pick from.</div>
                  )}
                  {template.quick === "bids" && quickPicks.bids && (
                    <div className="flex flex-wrap gap-2">
                      {quickPicks.bids.map((bid: any) => (
                        <button
                          key={bid.id}
                          onClick={() => {
                            setSource({ type: "bid", id: bid.id });
                            setTitle(`Proposal ${bid.bidNo}`);
                            setAmount(bid.amount.toString());
                            if (bid.scope) setBody(bid.scope);
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                            source?.id === bid.id ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="text-sm font-bold">Proposal {bid.bidNo} {bid.unitNo && ` • Unit ${bid.unitNo}`}</div>
                          <div className="text-xs text-muted-foreground">
                            ${bid.amount.toFixed(2)} • {bid.status}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {template.quick === "trackers" && quickPicks.trackers.length === 0 && (
                    <div className="text-sm text-muted-foreground italic">No active trackers today.</div>
                  )}
                  {template.quick === "trackers" && (
                    <div className="flex flex-wrap gap-2">
                      {quickPicks.trackers.map((tr) => (
                        <button
                          key={tr.jobId}
                          onClick={() => {
                            setSource({ type: "tracker", id: tr.jobId, jobId: tr.jobId });
                            setTitle(`Job ${tr.jobNo}`);
                            if (tr.description) setBody(tr.description);
                            setLinkUrl(tr.trackerUrl);
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                            source?.id === tr.jobId ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="text-sm font-bold">Job {tr.jobNo} {tr.unitNo && ` • Unit ${tr.unitNo}`}</div>
                        </button>
                      ))}
                    </div>
                  )}

                  {template.quick === "summaries" && quickPicks.summaries.length === 0 && (
                    <div className="text-sm text-muted-foreground italic">No recent summaries available.</div>
                  )}
                  {template.quick === "summaries" && (
                    <div className="flex flex-wrap gap-2">
                      {quickPicks.summaries.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            setSource({ type: "summary", id: s.id });
                            setTitle(s.title);
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                            source?.id === s.id ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="text-sm font-bold">{s.title}</div>
                          <div className="text-xs text-muted-foreground">{s.serviceDate} • {s.status}</div>
                        </button>
                      ))}
                    </div>
                  )}

                  {template.quick === "photos" && quickPicks.photoJobs.length === 0 && (
                    <div className="text-sm text-muted-foreground italic">No recent photos.</div>
                  )}
                  {template.quick === "photos" && (
                    <div className="flex flex-wrap gap-2">
                      {quickPicks.photoJobs.map((p) => (
                        <button
                          key={p.jobId}
                          onClick={() => {
                            setSource({ type: "photos", id: p.jobId, jobId: p.jobId });
                            setTitle(`Photos: Job ${p.jobNo}`);
                            if (p.description) setBody(p.description);
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                            source?.id === p.jobId ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="text-sm font-bold">Job {p.jobNo} {p.unitNo && ` • Unit ${p.unitNo}`}</div>
                          <div className="text-xs text-muted-foreground">{p.photoCount} photos</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short and punchy"
                  className={inputCls}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Message</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={template.bodyPlaceholder ?? "Optional details..."}
                  rows={3}
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {(template.money || amount !== "") && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-muted-foreground text-sm font-medium">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          setSource(null);
                          setSourceIds([]);
                        }}
                        placeholder="0.00"
                        className={`${inputCls} pl-7`}
                      />
                    </div>
                  </div>
                )}
                {(template.due || template.money || dueDate !== "") && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Due date</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Link {template.requireUrl ? "" : "(optional)"}
                </label>
                <div className="flex gap-2">
                  <input
                    value={linkLabel}
                    onChange={(e) => {
                      setLinkLabel(e.target.value);
                      if (template?.kind !== "document") {
                        setSource(null);
                        setSourceIds([]);
                      }
                    }}
                    placeholder="Label"
                    className={`${inputCls} max-w-[120px]`}
                  />
                  <input
                    value={linkUrl}
                    onChange={(e) => {
                      setLinkUrl(e.target.value);
                      if (template?.kind !== "document") {
                        setSource(null);
                        setSourceIds([]);
                      }
                    }}
                    placeholder="https://"
                    className={inputCls}
                    required={template.requireUrl}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Attachments (PDF, documents, images)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {attachments.map((a, i) => (
                    <span
                      key={`${a.url}-${i}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-xl text-sm font-medium max-w-[240px]"
                      data-testid={`chip-attachment-${i}`}
                    >
                      <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{a.name}</span>
                      <button
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${a.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-dashed border-border bg-background text-sm font-bold cursor-pointer hover:bg-muted transition-colors">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {uploading ? "Uploading…" : "Attach file"}
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.txt"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        void uploadFiles(e.target.files);
                        e.target.value = "";
                      }}
                      data-testid="input-card-attachments"
                    />
                  </label>
                </div>
                <div className="text-xs text-muted-foreground">
                  Files open right from the card on the client's board.
                </div>
              </div>
            </div>
          )}
        </div>

        {template && (
          <div className="p-6 bg-card border-t border-border shrink-0 flex items-center justify-between">
            <div className="text-sm font-medium text-muted-foreground">
              Client will receive an instant email if notifications are on.
            </div>
            <button
              onClick={submit}
              disabled={
                push.isPending || 
                !title.trim() || 
                !targetId || 
                uploading ||
                (template.requireUrl ? !linkUrl.trim() && attachments.length === 0 : false) || 
                (template.multiSelect ? sourceIds.length === 0 : false)
              }
              className="px-6 py-2.5 bg-[#B4FF44] text-[#041029] text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {push.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              Push to board
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ClientBoardOffice() {
  const { propertyId } = useParams();
  const [view, setView] = useState<"board" | "inbox">("board");
  const [showPush, setShowPush] = useState(false);
  const [editCard, setEditCard] = useState<ClientBoardFeedCard | null>(null);

  const [commentTarget, setCommentTarget] = useState<{ cardKey: string; title: string } | null>(null);
  const [respondTarget, setRespondTarget] = useState<{ cardKey: string; status: "accepted" | "declined" } | null>(null);

  const { data: boardFull, isLoading: boardLoading } = useGetOfficeBoardFull(propertyId!, {
    query: {
      queryKey: getGetOfficeBoardFullQueryKey(propertyId!),
      enabled: view === "board" && !!propertyId,
      // Live sync is pushed over SSE (see the EventSource effect below);
      // this slow poll is only a fallback if the stream drops.
      refetchInterval: 30000,
    },
  });

  const { data: inbox, isLoading: inboxLoading } = useGetClientBoardInbox(propertyId!, {
    query: {
      queryKey: getGetClientBoardInboxQueryKey(propertyId!),
      enabled: !!propertyId,
      // SSE pings refresh this too; slow poll is only a fallback.
      refetchInterval: 30000,
    },
  });

  const del = useDeleteOfficeClientBoardCard();
  const dispatchAction = useDispatchOfficeBoardAction();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Drag a card between lanes as the office — same "card.moved" action the
  // client uses, so guards (e.g. invoices auto-move on payment) still apply.
  const handleCardMove = (cardKey: string, laneKey: string, dropIndex?: number) => {
    const cards = boardFull?.board?.cards ?? [];
    const card = cards.find((c: any) => c.cardKey === cardKey);
    if (!card || !propertyId) return;

    const targetLaneKeys = cards
      .filter((c: any) => c.lane === laneKey && c.cardKey !== cardKey)
      .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
      .map((c: any) => c.cardKey);
    const insertAt = Math.max(0, Math.min(dropIndex ?? 0, targetLaneKeys.length));
    if (card.lane === laneKey) {
      const currentOrder = cards
        .filter((c: any) => c.lane === laneKey)
        .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
        .map((c: any) => c.cardKey);
      if (currentOrder.indexOf(cardKey) === insertAt) return;
    }
    const orderedCardKeys = [...targetLaneKeys];
    orderedCardKeys.splice(insertAt, 0, cardKey);

    const qKey = getGetOfficeBoardFullQueryKey(propertyId);
    // Optimistic: reflect the drop immediately, server confirms via invalidate.
    queryClient.setQueryData(qKey, (old: any) => {
      if (!old?.board?.cards) return old;
      return {
        ...old,
        board: {
          ...old.board,
          cards: old.board.cards.map((c: any) =>
            c.cardKey === cardKey
              ? { ...c, lane: laneKey, position: insertAt }
              : c,
          ),
        },
      };
    });
    dispatchAction.mutate(
      {
        propertyId,
        data: { action: "card.moved", cardKey, payload: { lane: laneKey, position: insertAt, orderedCardKeys } },
      },
      {
        onSettled: () => queryClient.invalidateQueries({ queryKey: qKey }),
        onError: (e: any) =>
          toast({ title: "Move failed", description: e?.data?.error ?? e?.message, variant: "destructive" }),
        onSuccess: (r: any) => {
          if (r?.blocked || r?.ok === false) {
            toast({ title: "Card can't move there", description: r?.reason ?? r?.message ?? undefined });
          }
        },
      },
    );
  };

  // Live push: the API pings this stream whenever the client's board changes
  // (client drags a card, a send raises a card, ...) so the office mirror
  // updates within ~1s instead of waiting for the fallback poll.
  useEffect(() => {
    if (!propertyId) return;
    // Manual /api URLs must be absolute — never BASE_URL-prefixed.
    const es = new EventSource(`/api/admin/accounts/${propertyId}/board/events`);
    const refetch = () => {
      queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(propertyId!) });
      queryClient.invalidateQueries({ queryKey: getGetOfficeBoardFullQueryKey(propertyId!) });
      queryClient.invalidateQueries({ queryKey: getGetClientBoardInboxQueryKey(propertyId!) });
    };
    es.addEventListener("board", refetch);
    // On reconnect after a drop, catch up on anything missed.
    es.onopen = refetch;
    return () => es.close();
  }, [propertyId, queryClient]);

  const handleRemove = (cardId: string) => {
    if (!confirm("Remove this card from the client's board?")) return;
    del.mutate(
      { propertyId: propertyId!, cardId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(propertyId!) });
          toast({ title: "Card removed", description: "The card was removed from the board." });
        },
      }
    );
  };

  const pendingCount = inbox?.cards.filter((c) => c.status === "pending").length || 0;

  return (
    <div className="h-full flex flex-col bg-[#F1F5F9] min-h-0">
      <div className="flex-none p-6 pb-0 border-b border-border bg-card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link
              href={`/admin/${propertyId}`}
              className="p-2 -ml-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground">
                {boardFull?.propertyName || "Client Collaboration"}
              </h1>
              <p className="text-sm font-medium text-muted-foreground mt-0.5">
                What the client sees and sends
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex p-1.5 bg-muted rounded-xl">
              <button
                onClick={() => setView("board")}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                  view === "board"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Board View
              </button>
              <button
                onClick={() => setView("inbox")}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${
                  view === "inbox"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Client Inbox
                {pendingCount > 0 && (
                  <span className="bg-[#B4FF44] text-[#041029] px-2 py-0.5 rounded-full text-[10px] min-w-[22px] flex items-center justify-center shadow-sm">
                    {pendingCount}
                  </span>
                )}
              </button>
            </div>

            {view === "board" && (
              <button
                onClick={() => setShowPush(true)}
                className="px-4 py-2 bg-[#041029] text-[#B4FF44] text-sm font-bold rounded-xl hover:opacity-90 transition-opacity flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Push card
              </button>
            )}
          </div>
        </div>
      </div>

      {view === "inbox" ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-4 pb-10">
            {inboxLoading && !inbox ? (
              <div className="space-y-4">
                <Skeleton className="h-[200px] w-full rounded-2xl" />
                <Skeleton className="h-[200px] w-full rounded-2xl" />
              </div>
            ) : inbox?.cards.length === 0 ? (
              <div className="text-center py-32 text-muted-foreground">
                <Inbox className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p className="font-bold text-lg text-foreground">Inbox is empty</p>
                <p className="text-sm mt-1">Cards sent by the client will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {inbox?.cards.map((card) => (
                  <InboxCardView
                    key={card.cardKey}
                    card={card}
                    onRespond={(status) => setRespondTarget({ cardKey: card.cardKey, status })}
                    onComment={() => setCommentTarget({ cardKey: card.cardKey, title: card.title })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col mt-0 border-t border-border overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col">
            <AppleBoard
              board={boardFull?.board as any}
              isLoading={boardLoading}
              viewer={{ readOnly: false, authenticated: true, permissions: [] }}
              boardKey={undefined}
              onLoginRequired={() => {}}
              onCardClick={() => {}}
              onCardMove={handleCardMove}
              showToast={toast}
            />
          </div>
        </div>
      )}

      {showPush && (
        <PushCardDialog
          propertyId={propertyId!}
          open={showPush}
          onOpenChange={setShowPush}
        />
      )}

      {editCard && (
        <EditCardDialog
          propertyId={propertyId!}
          card={editCard}
          onClose={() => setEditCard(null)}
        />
      )}

      {commentTarget && (
        <CommentsDialog
          propertyId={propertyId!}
          cardKey={commentTarget.cardKey}
          title={commentTarget.title}
          onClose={() => setCommentTarget(null)}
        />
      )}

      {respondTarget && (
        <RespondDialog
          propertyId={propertyId!}
          cardKey={respondTarget.cardKey}
          status={respondTarget.status}
          onClose={() => setRespondTarget(null)}
        />
      )}
    </div>
  );
}
