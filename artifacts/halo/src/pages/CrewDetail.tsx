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
  type CrewPhoto,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import {
  ChevronLeft,
  Link2,
  Copy,
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadW9Pdf } from "@/lib/w9pdf";

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
        <div className="min-w-0">
          <div className="font-display font-bold text-[20px] tracking-[-0.01em] truncate">
            {crew.name}
          </div>
          <div className="text-[12.5px] text-muted-foreground truncate">
            {[crew.trade || "General", crew.phone].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

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
  const [sharingDay, setSharingDay] = useState<string | null>(null);

  const sectionTitle =
    "font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[12px] flex items-center gap-[6px]";
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const groups = useMemo(() => {
    const map = new Map<string, CrewPhoto[]>();
    for (const p of photos ?? []) {
      const arr = map.get(p.takenOn) ?? [];
      arr.push(p);
      map.set(p.takenOn, arr);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
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

  return (
    <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[12px]">
      <div className={sectionTitle}>
        <Camera className="w-[13px] h-[13px]" /> Daily activity
      </div>
      {groups.length === 0 ? (
        <div className="text-[12.5px] text-muted-foreground py-[6px] text-center">
          No photos yet. Photos the crew sends from their portal show up here.
        </div>
      ) : (
        <div className="flex flex-col gap-[16px]">
          {groups.map(([day, dayPhotos]) => (
            <div key={day}>
              <div className="flex items-center justify-between mb-[8px] gap-[8px]">
                <div className="text-[13px] font-semibold min-w-0">
                  {formatDayLabel(day)}
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {dayPhotos.length} photo{dayPhotos.length === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  onClick={() => onShare(day)}
                  disabled={sharingDay === day}
                  className="flex items-center gap-[5px] text-[11px] font-bold rounded-full border border-border px-[10px] py-[6px] shrink-0 transition-transform active:scale-[0.96] disabled:opacity-60"
                >
                  <Share2 className="w-[12px] h-[12px]" />
                  {sharingDay === day ? "Preparing…" : "Share link"}
                </button>
              </div>
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
      )}
    </div>
  );
}
