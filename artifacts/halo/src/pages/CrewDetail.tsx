import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCrewDetail,
  useGenerateCrewPortalLink,
  useListCrewMessages,
  useSendCrewMessage,
  useListCrewCheckins,
  useListCrewDocuments,
  useSendCrewDocument,
  useListPacketTemplates,
  useListCrewPackets,
  useSendCrewPacket,
  getGetCrewDetailQueryKey,
  getListCrewMessagesQueryKey,
  getListCrewCheckinsQueryKey,
  getListCrewDocumentsQueryKey,
  getListCrewPacketsQueryKey,
  useListCrewPhotos,
  getListCrewPhotosQueryKey,
  useCreatePhotoShare,
  useUpdatePhotoShareNotes,
  useListCrewInvoices,
  getListCrewInvoicesQueryKey,
  type CrewPhoto,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import {
  ChevronLeft,
  FileDown,
  Link2,
  Copy,
  BookOpen,
  Check,
  Send,
  MapPin,
  FileUp,
  FileText,
  Wallet,
  ClipboardCheck,
  Download,
  MessageSquare,
  PackageCheck,
  Send as SendIcon,
  Camera,
  Share2,
  Receipt,
  Pencil,
} from "lucide-react";
import { EditCrewSheet } from "@/components/EditCrewSheet";
import { useToast } from "@/hooks/use-toast";
import { downloadW9Pdf } from "@/lib/w9pdf";

function paymentTermsLabel(v?: string | null): string {
  switch (v) {
    case "due_on_receipt": return "Due on receipt";
    case "net15": return "Net 15";
    case "net30": return "Net 30";
    case "net45": return "Net 45";
    default: return "Not set";
  }
}

function formatWhen(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCheckinWhen(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

export default function CrewDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: crew, isLoading } = useGetCrewDetail(id);
  const { data: messages } = useListCrewMessages(id, {
    query: { queryKey: getListCrewMessagesQueryKey(id), refetchInterval: 8000 },
  });
  const { data: checkins } = useListCrewCheckins(id, {
    query: { queryKey: getListCrewCheckinsQueryKey(id), refetchInterval: 8000 },
  });
  const { data: documents } = useListCrewDocuments(id, {
    query: { queryKey: getListCrewDocumentsQueryKey(id), refetchInterval: 8000 },
  });

  const { data: crewInvoices } = useListCrewInvoices(id, {
    query: { queryKey: getListCrewInvoicesQueryKey(id), refetchInterval: 8000 },
  });

  const { data: packetTemplates } = useListPacketTemplates();
  const { data: packets } = useListCrewPackets(id, {
    query: { queryKey: getListCrewPacketsQueryKey(id), refetchInterval: 8000 },
  });

  const genLink = useGenerateCrewPortalLink();
  const sendMessage = useSendCrewMessage();
  const sendDocument = useSendCrewDocument();
  const sendPacket = useSendCrewPacket();

  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [templateKey, setTemplateKey] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const { uploadFile, isUploading } = useUpload({
    onSuccess: async (res) => {
      await sendDocument.mutateAsync({
        id,
        data: {
          name: res.metadata.name,
          storagePath: res.objectPath,
          contentType: res.metadata.contentType,
          size: res.metadata.size,
        },
      });
      queryClient.invalidateQueries({
        queryKey: getListCrewDocumentsQueryKey(id),
      });
      toast({ title: "Document sent to crew" });
    },
    onError: (e) => toast({ title: "Upload failed", description: e.message }),
  });

  if (isLoading || !crew) {
    return (
      <div className="animate-pulse space-y-4 pt-4">
        <div className="h-6 bg-muted rounded w-1/2" />
        <div className="h-40 bg-card rounded-[16px]" />
      </div>
    );
  }

  const portalToken = crew.portalToken;
  const portalUrl = portalToken
    ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/portal/${portalToken}`
    : null;

  const handleGenerate = () => {
    genLink.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetCrewDetailQueryKey(id),
          });
        },
      },
    );
  };

  const handleCopy = async () => {
    if (!portalUrl) return;
    await navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    toast({ title: "Live link copied", description: "Send it to the crew manually." });
    setTimeout(() => setCopied(false), 1800);
  };

  const isAppleDevice =
    typeof navigator !== "undefined" &&
    (/iP(hone|od|ad)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
      /Mac/.test(navigator.platform));
  // iOS/macOS Messages prefill the body only with an "&" separator after an
  // empty recipient; Android uses "?". The old "?&" hack fails to prefill on iOS.
  const smsSeparator = isAppleDevice ? "&" : "?";
  const smsHref = portalUrl
    ? `sms:${smsSeparator}body=${encodeURIComponent(
        `Hi ${crew.name}, here's your ArchAngel Contractors onboarding portal link — tap to open and complete your paperwork:\n${portalUrl}`,
      )}`
    : undefined;

  const handleSend = () => {
    const body = draft.trim();
    if (!body) return;
    sendMessage.mutate(
      { id, data: { body } },
      {
        onSuccess: () => {
          setDraft("");
          queryClient.invalidateQueries({
            queryKey: getListCrewMessagesQueryKey(id),
          });
        },
      },
    );
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  const handleSendPacket = () => {
    if (!templateKey) return;
    sendPacket.mutate(
      { id, data: { templateKey } },
      {
        onSuccess: () => {
          setTemplateKey("");
          queryClient.invalidateQueries({
            queryKey: getListCrewPacketsQueryKey(id),
          });
          queryClient.invalidateQueries({
            queryKey: getListCrewMessagesQueryKey(id),
          });
          toast({
            title: "Packet sent",
            description: "The crew can now complete it in their portal.",
          });
        },
        onError: (e) =>
          toast({ title: "Couldn't send packet", description: e.message }),
      },
    );
  };

  const packetLabel = (key: string) =>
    packetTemplates?.find((t) => t.key === key)?.label ?? key;

  const sectionTitle =
    "font-display font-semibold text-[12px] tracking-[0.14em] uppercase text-muted-foreground mb-[10px] flex items-center gap-[7px]";

  return (
    <div className="pt-2 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <Link
        href="/crews"
        className="inline-flex items-center gap-[4px] text-[13px] text-muted-foreground mb-[12px]"
      >
        <ChevronLeft className="w-[15px] h-[15px]" /> Crews
      </Link>

      <div className="flex items-center gap-[11px] mb-[16px]">
        <div className="w-[44px] h-[44px] rounded-full bg-[var(--ink)] text-[var(--gold-light)] font-display font-bold text-[17px] grid place-items-center shrink-0">
          {crew.name.substring(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[20px] tracking-[-0.01em] truncate">
            {crew.name}
          </div>
          <div className="text-[12.5px] text-muted-foreground truncate">
            {[crew.trade || "General", crew.phone].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button
          onClick={() => setEditOpen(true)}
          aria-label={`Edit ${crew.name}`}
          className="shrink-0 h-[34px] flex items-center gap-[6px] rounded-full px-[13px] text-[12.5px] font-display font-bold bg-[rgba(143,106,31,0.12)] text-[var(--gold-dark,#8f6a1f)] transition-transform active:scale-[0.95]"
        >
          <Pencil className="w-[13px] h-[13px]" /> Edit
        </button>
      </div>

      <EditCrewSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        crew={{
          id: crew.id,
          name: crew.name,
          trade: crew.trade,
          phone: crew.phone,
          email: crew.email,
          isLeader: crew.isLeader,
          paymentTerms: crew.paymentTerms,
          services: crew.services,
        }}
      />

      {/* Live link */}
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[12px]">
        <div className={sectionTitle}>
          <Link2 className="w-[13px] h-[13px]" /> Live portal link
        </div>
        {portalUrl ? (
          <>
            <div className="text-[12px] font-mono bg-[rgba(23,24,28,0.05)] rounded-[9px] px-[10px] py-[9px] break-all mb-[10px]">
              {portalUrl}
            </div>
            <a
              href={smsHref}
              className="w-full flex items-center justify-center gap-[7px] rounded-[11px] py-[10px] text-[13.5px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] transition-transform active:scale-[0.98]"
            >
              <MessageSquare className="w-[16px] h-[16px]" /> Text the link
            </a>
            <div className="grid grid-cols-2 gap-[8px] mt-[8px]">
              <a
                href={`sms:${smsSeparator}body=${encodeURIComponent(
                  `Hi ${crew.name}, here's a quick guide that explains how to use your ArchAngel portal — offers, schedule, check-ins, photos, and getting paid:\n${portalUrl}?guide=en`,
                )}`}
                data-testid="button-text-guide-en"
                className="flex items-center justify-center gap-[6px] rounded-[11px] py-[9px] text-[12.5px] font-display font-bold text-[var(--ink)] bg-[rgba(23,24,28,0.05)] transition-transform active:scale-[0.98]"
              >
                <BookOpen className="w-[14px] h-[14px]" /> Guide (English)
              </a>
              <a
                href={`sms:${smsSeparator}body=${encodeURIComponent(
                  `Hola ${crew.name}, aquí tiene una guía que explica cómo usar su portal de ArchAngel — ofertas, horario, registro de entrada, fotos y pagos:\n${portalUrl}?guide=es`,
                )}`}
                data-testid="button-text-guide-es"
                className="flex items-center justify-center gap-[6px] rounded-[11px] py-[9px] text-[12.5px] font-display font-bold text-[var(--ink)] bg-[rgba(23,24,28,0.05)] transition-transform active:scale-[0.98]"
              >
                <BookOpen className="w-[14px] h-[14px]" /> Guía (Español)
              </a>
            </div>
            <button
              onClick={handleCopy}
              className="w-full flex items-center justify-center gap-[7px] rounded-[11px] py-[9px] mt-[8px] text-[13px] font-display font-semibold text-muted-foreground bg-[rgba(23,24,28,0.05)] transition-transform active:scale-[0.98]"
            >
              {copied ? (
                <>
                  <Check className="w-[15px] h-[15px]" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-[15px] h-[15px]" /> Copy live link
                </>
              )}
            </button>
            <p className="text-[11.5px] text-muted-foreground mt-[8px] leading-[1.4]">
              "Text the link" opens Messages with the link ready to send. Anyone
              with the link can open their portal.
            </p>
          </>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={genLink.isPending}
            className="w-full flex items-center justify-center gap-[7px] rounded-[11px] py-[10px] text-[13.5px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] disabled:opacity-50 transition-transform active:scale-[0.98]"
          >
            <Link2 className="w-[16px] h-[16px]" /> Generate live link
          </button>
        )}
      </div>

      {/* Onboarding Welcome Kit */}
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[12px]">
        <div className={sectionTitle}>
          <PackageCheck className="w-[13px] h-[13px]" /> Onboarding Welcome Kit
        </div>
        <div className="flex flex-col gap-[8px]">
          <select
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
            className="w-full rounded-[11px] border border-border bg-background px-[12px] py-[10px] text-[13.5px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
          >
            <option value="">Choose a packet to send…</option>
            {(packetTemplates ?? []).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleSendPacket}
            disabled={!templateKey || sendPacket.isPending}
            className="w-full flex items-center justify-center gap-[7px] rounded-[11px] py-[10px] text-[13.5px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] disabled:opacity-50 transition-transform active:scale-[0.98]"
          >
            <SendIcon className="w-[16px] h-[16px]" />
            {sendPacket.isPending ? "Sending…" : "Send packet to crew"}
          </button>
        </div>

        {packets && packets.length > 0 && (
          <div className="flex flex-col mt-[12px]">
            {packets.map((p, idx) => {
              const submitted = p.status === "submitted";
              const statusLabel =
                p.status === "submitted"
                  ? "Completed"
                  : p.status === "in_progress"
                    ? "In progress"
                    : "Sent";
              const statusClass = submitted
                ? "bg-[rgba(60,122,78,0.14)] text-[var(--green,#3c7a4e)]"
                : p.status === "in_progress"
                  ? "bg-[rgba(143,106,31,0.14)] text-[var(--gold-dark)]"
                  : "bg-[rgba(23,24,28,0.06)] text-muted-foreground";
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-[10px] py-[10px] ${idx !== 0 ? "border-t border-border" : ""}`}
                >
                  <PackageCheck className="w-[17px] h-[17px] text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">
                      {packetLabel(p.templateKey)}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {submitted
                        ? `Submitted ${formatWhen(p.submittedAt)}`
                        : `Sent ${formatWhen(p.sentAt)}`}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full shrink-0 ${statusClass}`}
                  >
                    {statusLabel}
                  </span>
                  {submitted && (
                    <a
                      href={`${apiBase}/api/packets/${p.id}/pdf`}
                      download
                      className="shrink-0 w-[32px] h-[32px] grid place-items-center rounded-full bg-[var(--paper)] border border-border text-muted-foreground transition-transform active:scale-[0.94]"
                      aria-label="Download compiled packet PDF"
                    >
                      <Download className="w-[15px] h-[15px]" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Messaging */}
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[12px]">
        <div className={sectionTitle}>
          <Send className="w-[13px] h-[13px]" /> Messages
        </div>
        <div className="flex flex-col gap-[8px] max-h-[260px] overflow-y-auto mb-[10px]">
          {!messages || messages.length === 0 ? (
            <div className="text-[12.5px] text-muted-foreground py-[10px] text-center">
              No messages yet.
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[82%] rounded-[13px] px-[12px] py-[8px] text-[13px] leading-[1.4] ${
                  m.sender === "admin"
                    ? "self-end bg-[var(--ink)] text-white rounded-br-[4px]"
                    : "self-start bg-[rgba(23,24,28,0.06)] text-foreground rounded-bl-[4px]"
                }`}
              >
                <div>{m.body}</div>
                <div
                  className={`text-[10px] mt-[3px] ${m.sender === "admin" ? "text-white/60" : "text-muted-foreground"}`}
                >
                  {formatWhen(m.createdAt)}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex items-end gap-[8px]">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message the crew…"
            rows={1}
            className="flex-1 resize-none rounded-[11px] border border-border bg-background px-[12px] py-[9px] text-[13.5px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
          />
          <button
            onClick={handleSend}
            disabled={sendMessage.isPending || !draft.trim()}
            aria-label="Send message"
            className="w-[38px] h-[38px] shrink-0 rounded-full grid place-items-center bg-[var(--ink)] text-white disabled:opacity-40 transition-transform active:scale-[0.9]"
          >
            <Send className="w-[16px] h-[16px]" />
          </button>
        </div>
      </div>

      {/* Invoices from crew */}
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[12px]">
        <div className={sectionTitle}>
          <Receipt className="w-[13px] h-[13px]" /> Invoices from crew
        </div>
        {!crewInvoices || crewInvoices.length === 0 ? (
          <div className="text-[12.5px] text-muted-foreground py-[6px] text-center">
            No invoices submitted yet.
          </div>
        ) : (
          <div className="flex flex-col">
            {crewInvoices.map((inv, idx) => (
              <div
                key={inv.id}
                className={`py-[11px] ${idx !== 0 ? "border-t border-border" : ""}`}
              >
                <div className="flex items-center justify-between gap-[10px]">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">
                      {inv.invoiceNo ? `#${inv.invoiceNo} · ` : ""}
                      {inv.propertyAddress}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {inv.fromCompany} · {formatWhen(inv.createdAt)}
                      {inv.terms ? ` · ${inv.terms}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-[7px] shrink-0">
                    <span className="text-[14px] font-bold tabular-nums">
                      ${inv.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full bg-[rgba(59,111,181,0.12)] text-[var(--blue)]">
                      {inv.status}
                    </span>
                  </div>
                </div>
                <div className="mt-[7px] flex flex-col gap-[3px]">
                  {inv.items.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center justify-between text-[12px] text-muted-foreground"
                    >
                      <span className="truncate">
                        {it.dateOfWork}
                        {it.unitNo ? ` · Unit ${it.unitNo}` : ""} · {it.typeOfWork}
                      </span>
                      <span className="tabular-nums shrink-0 ml-[8px]">
                        {it.qty} × ${it.unitPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} = $
                        {it.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-[6px] text-[11.5px] text-muted-foreground italic">
                  Signed by {inv.signatureName}
                  {inv.signedAt ? ` on ${formatWhen(inv.signedAt)}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Documents */}
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[12px]">
        <div className={sectionTitle}>
          <FileText className="w-[13px] h-[13px]" /> Documents
        </div>
        <label className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[11px] py-[10px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] cursor-pointer transition-transform active:scale-[0.98]">
          <FileUp className="w-[16px] h-[16px]" />
          {isUploading ? "Uploading…" : "Send document to crew"}
          <input
            type="file"
            className="hidden"
            onChange={onFilePicked}
            disabled={isUploading}
          />
        </label>
        {!documents || documents.length === 0 ? (
          <div className="text-[12.5px] text-muted-foreground py-[6px] text-center">
            No documents yet.
          </div>
        ) : (
          <div className="flex flex-col">
            {documents.map((d, idx) => {
              const url = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/storage${d.storagePath}`;
              return (
                <div
                  key={d.id}
                  className={`flex items-center gap-[10px] py-[10px] ${idx !== 0 ? "border-t border-border" : ""}`}
                >
                  <FileText className="w-[17px] h-[17px] text-muted-foreground shrink-0" />
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 min-w-0"
                  >
                    <div className="text-[13px] font-semibold truncate">{d.name}</div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {d.direction === "from_crew" ? "From crew" : "Sent to crew"} ·{" "}
                      {formatWhen(d.createdAt)}
                    </div>
                  </a>
                  {d.direction === "from_crew" && (
                    <span className="text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full bg-[rgba(59,111,181,0.12)] text-[var(--blue)] shrink-0">
                      New
                    </span>
                  )}
                  <a
                    href={url}
                    download={d.name}
                    className="shrink-0 w-[32px] h-[32px] grid place-items-center rounded-full bg-[var(--paper)] border border-border text-muted-foreground transition-transform active:scale-[0.94]"
                    aria-label={`Download ${d.name}`}
                  >
                    <Download className="w-[15px] h-[15px]" />
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Check-ins */}
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[12px]">
        <div className={sectionTitle}>
          <MapPin className="w-[13px] h-[13px]" /> GPS check-ins
        </div>
        {!checkins || checkins.length === 0 ? (
          <div className="text-[12.5px] text-muted-foreground py-[6px] text-center">
            No check-ins yet.
          </div>
        ) : (
          <div className="flex flex-col">
            {checkins.map((c, idx) => (
              <div
                key={c.id}
                className={`flex items-center gap-[10px] py-[10px] ${idx !== 0 ? "border-t border-border" : ""}`}
              >
                <MapPin className="w-[17px] h-[17px] text-[var(--gold)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">
                    {c.label || "Check-in"}
                  </div>
                  <div className="text-[11.5px] font-medium text-foreground/80">
                    {formatCheckinWhen(c.createdAt)}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground truncate">
                    {c.lat != null && c.lng != null
                      ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
                      : "No coordinates"}
                  </div>
                </div>
                {c.lat != null && c.lng != null && (
                  <a
                    href={`https://maps.google.com/?q=${c.lat},${c.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-bold text-[var(--blue)] shrink-0"
                  >
                    Map
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Daily activity */}
      <DailyActivitySection crewId={id} crewName={crew.name} />

      {/* Terms & money */}
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[12px]">
        <div className={sectionTitle}>
          <Wallet className="w-[13px] h-[13px]" /> Terms & money
        </div>
        <div className="flex gap-[8px] mb-[12px]">
          <div className="flex-1 rounded-[12px] bg-[rgba(60,122,78,0.08)] p-[10px]">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--green,#3c7a4e)]">Paid</div>
            <div className="font-display font-bold text-[17px] tabular-nums text-[var(--green,#3c7a4e)]">
              ${(crew.paidTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="flex-1 rounded-[12px] bg-[rgba(190,120,30,0.10)] p-[10px]">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--gold-dark)]">Outstanding</div>
            <div className="font-display font-bold text-[17px] tabular-nums text-[var(--gold-dark)]">
              ${(crew.outstandingTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
        <div className="text-[13px] mb-[10px]">
          <span className="text-muted-foreground">Payment terms: </span>
          <span className="font-semibold">{paymentTermsLabel(crew.paymentTerms)}</span>
        </div>
        {crew.services && crew.services.length > 0 ? (
          <div className="rounded-[12px] bg-[var(--paper)] overflow-hidden">
            {crew.services.map((s, i) => (
              <div key={i} className={`flex items-center justify-between p-[9px_11px] text-[13px] ${i > 0 ? "border-t border-black/5" : ""}`}>
                <span className="font-semibold">{s.name}</span>
                <span className="font-mono font-semibold">{s.rate != null ? `$${s.rate.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12.5px] text-muted-foreground">No services on file. Add them from Edit.</div>
        )}
      </div>

      {/* Payment method */}
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[12px]">
        <div className={sectionTitle}>
          <Wallet className="w-[13px] h-[13px]" /> Preferred payment
        </div>
        {crew.preferredPaymentMethod ? (
          <div>
            <div className="text-[14px] font-semibold">
              {crew.preferredPaymentMethod}
            </div>
            {crew.paymentDetails && (
              <div className="text-[12.5px] text-muted-foreground mt-[2px] break-words">
                {crew.paymentDetails}
              </div>
            )}
          </div>
        ) : (
          <div className="text-[12.5px] text-muted-foreground">
            Crew hasn't set a payment method yet.
          </div>
        )}
      </div>

      {/* W-9 */}
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px]">
        <div className={sectionTitle}>
          <ClipboardCheck className="w-[13px] h-[13px]" /> IRS Form W-9
        </div>
        {crew.w9Submitted && crew.w9 ? (
          <div className="text-[13px]">
            <div className="flex items-center gap-[6px] text-[var(--green,#3c7a4e)] mb-[10px]">
              <Check className="w-[15px] h-[15px]" />
              <span className="font-semibold">
                Submitted {formatWhen(crew.w9SubmittedAt)}
              </span>
            </div>
            <W9Readout data={crew.w9 as Record<string, unknown>} />
            <button
              onClick={() =>
                downloadW9Pdf(crew.w9 as Record<string, unknown>, crew.name)
              }
              className="w-full mt-[12px] flex items-center justify-center gap-[7px] rounded-[11px] py-[10px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
            >
              <Download className="w-[15px] h-[15px]" /> Download W-9 (PDF)
            </button>
          </div>
        ) : (
          <div className="text-[12.5px] text-muted-foreground">
            Crew hasn't submitted a W-9 yet.
          </div>
        )}
      </div>
    </div>
  );
}

function W9Readout({ data }: { data: Record<string, unknown> }) {
  const rows: [string, string][] = [];
  const push = (label: string, key: string) => {
    const v = data[key];
    if (v != null && v !== "") rows.push([label, String(v)]);
  };
  push("Name", "name");
  push("Business name", "businessName");
  push("Tax classification", "taxClassification");
  push("Address", "address");
  push("City", "city");
  push("State", "state");
  push("ZIP", "zip");
  if (data.tinType === "ein") push("EIN", "ein");
  else push("SSN", "ssn");
  push("Signature", "signature");
  push("Signed", "signedDate");
  return (
    <div className="flex flex-col gap-[6px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-[8px] text-[12.5px]">
          <span className="text-muted-foreground w-[110px] shrink-0">{label}</span>
          <span className="font-medium break-words">{value}</span>
        </div>
      ))}
    </div>
  );
}

function DailyActivitySection({
  crewId,
  crewName,
}: {
  crewId: string;
  crewName: string;
}) {
  const { toast } = useToast();
  const { data: photos } = useListCrewPhotos(crewId, {
    query: {
      queryKey: getListCrewPhotosQueryKey(crewId),
      refetchInterval: 8000,
    },
  });
  const createShare = useCreatePhotoShare();
  const updateNotes = useUpdatePhotoShareNotes();
  const [sharingDay, setSharingDay] = useState<string | null>(null);
  const [reportDay, setReportDay] = useState<string | null>(null);
  const [reportToken, setReportToken] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");

  const sectionTitle =
    "font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[12px] flex items-center gap-[6px]";
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const jobGroups = useMemo(() => {
    const map = new Map<
      string,
      { label: string; days: Map<string, CrewPhoto[]> }
    >();
    for (const p of photos ?? []) {
      const key = p.jobId ?? "none";
      const g = map.get(key) ?? {
        label: p.jobLabel ?? (p.jobId ? "Job" : "General photos"),
        days: new Map<string, CrewPhoto[]>(),
      };
      const arr = g.days.get(p.takenOn) ?? [];
      arr.push(p);
      g.days.set(p.takenOn, arr);
      map.set(key, g);
    }
    return Array.from(map.entries())
      .sort((a, b) => {
        if (a[0] === "none") return 1;
        if (b[0] === "none") return -1;
        return 0;
      })
      .map(([key, g]) => ({
        key,
        label: g.label,
        count: Array.from(g.days.values()).reduce((n, arr) => n + arr.length, 0),
        days: Array.from(g.days.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1)),
      }));
  }, [photos]);

  const onShare = async (day: string) => {
    setSharingDay(day);
    try {
      const res = await createShare.mutateAsync({ id: crewId, data: { day } });
      const url = `${window.location.origin}${base}/photos/${res.token}`;
      const message = `Photos from ${crewName} — ${formatDayLabel(day)}: ${url}`;
      try {
        await navigator.clipboard.writeText(url);
        toast({
          title: "Share link copied",
          description: "Opening Messages with a prefilled text…",
        });
      } catch {
        toast({ title: "Share link ready", description: url });
      }
      window.location.href = `sms:?&body=${encodeURIComponent(message)}`;
    } catch {
      toast({ title: "Couldn't create share link", description: "Please try again." });
    } finally {
      setSharingDay(null);
    }
  };

  const onToggleReport = async (day: string) => {
    if (reportDay === day) {
      setReportDay(null);
      setReportToken(null);
      return;
    }
    try {
      const res = await createShare.mutateAsync({ id: crewId, data: { day } });
      setReportDay(day);
      setReportToken(res.token);
      setNotesDraft(res.notes ?? "");
    } catch {
      toast({ title: "Couldn't prepare the report", description: "Please try again." });
    }
  };

  const onSaveNotes = async () => {
    if (!reportDay) return;
    try {
      await updateNotes.mutateAsync({
        id: crewId,
        data: { day: reportDay, notes: notesDraft },
      });
      toast({ title: "Notes saved", description: "They'll appear in the report PDF." });
    } catch {
      toast({ title: "Couldn't save notes", description: "Please try again." });
    }
  };

  return (
    <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[12px]">
      <div className={sectionTitle}>
        <Camera className="w-[13px] h-[13px]" /> Daily activity
      </div>
      {jobGroups.length === 0 ? (
        <div className="text-[12.5px] text-muted-foreground py-[6px] text-center">
          No photos yet. Photos the crew sends from their portal show up here.
        </div>
      ) : (
        <div className="flex flex-col gap-[18px]">
          {jobGroups.map((jg) => (
            <div key={jg.key}>
              <div className="text-[13.5px] font-display font-bold mb-[9px]">
                {jg.label}
                <span className="text-muted-foreground font-normal font-sans text-[12.5px]">
                  {" "}
                  · {jg.count} photo{jg.count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex flex-col gap-[12px]">
                {jg.days.map(([day, dayPhotos]) => (
                  <div key={`${jg.key}-${day}`}>
                    <div className="flex items-center justify-between mb-[8px] gap-[8px]">
                      <div className="text-[12.5px] font-semibold min-w-0 text-muted-foreground">
                        {formatDayLabel(day)}
                      </div>
                      <div className="flex items-center gap-[6px] shrink-0">
                        <button
                          onClick={() => onShare(day)}
                          disabled={sharingDay === day}
                          className="flex items-center gap-[5px] text-[11px] font-bold rounded-full border border-border px-[10px] py-[6px] transition-transform active:scale-[0.96] disabled:opacity-60"
                        >
                          <Share2 className="w-[12px] h-[12px]" />
                          {sharingDay === day ? "Preparing…" : "Share link"}
                        </button>
                        <button
                          onClick={() => onToggleReport(day)}
                          disabled={createShare.isPending && reportDay !== day}
                          className={`flex items-center gap-[5px] text-[11px] font-bold rounded-full px-[10px] py-[6px] transition-transform active:scale-[0.96] disabled:opacity-60 ${
                            reportDay === day
                              ? "bg-[var(--ink)] text-white"
                              : "border border-border"
                          }`}
                        >
                          <FileDown className="w-[12px] h-[12px]" />
                          Full report
                        </button>
                      </div>
                    </div>
                    {reportDay === day && reportToken && (
                      <div className="mb-[10px] rounded-[12px] border border-border bg-[var(--paper)] p-[10px]">
                        <div className="text-[11px] font-display font-bold tracking-[0.1em] uppercase text-muted-foreground mb-[6px]">
                          Notes for the report
                        </div>
                        <textarea
                          value={notesDraft}
                          onChange={(e) => setNotesDraft(e.target.value)}
                          rows={3}
                          placeholder="Anything the property manager should know — scope notes, follow-ups, scheduling…"
                          className="w-full rounded-[10px] border border-border bg-card px-[10px] py-[8px] text-[13px] resize-y outline-none focus:border-[var(--gold)]"
                        />
                        <div className="flex items-center gap-[8px] mt-[8px]">
                          <button
                            onClick={onSaveNotes}
                            disabled={updateNotes.isPending}
                            className="text-[11.5px] font-bold rounded-full border border-border px-[12px] py-[7px] transition-transform active:scale-[0.96] disabled:opacity-60"
                          >
                            {updateNotes.isPending ? "Saving…" : "Save notes"}
                          </button>
                          <a
                            href={`${base}/api/photo-shares/${reportToken}/report`}
                            className="flex items-center gap-[5px] text-[11.5px] font-bold rounded-full px-[12px] py-[7px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] transition-transform active:scale-[0.96]"
                          >
                            <FileDown className="w-[12px] h-[12px]" /> Download PDF
                          </a>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-[6px]">
                      {dayPhotos.map((p) => (
                        <a
                          key={p.id}
                          href={`${base}/api/storage${p.storagePath}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block aspect-square rounded-[10px] overflow-hidden bg-[var(--paper)] border border-border"
                        >
                          <img
                            src={`${base}/api/storage${p.storagePath}`}
                            alt={p.note || "Crew photo"}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
