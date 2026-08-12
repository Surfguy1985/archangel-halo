/**
 * AskFalkonSheet — 3-step cross-business request creation.
 *
 * Step 1: Describe the request (pre-filled for formation intent)
 * Step 2: Data-sharing disclosure (read-only — user must acknowledge)
 * Step 3: Confirm & Send (calls POST /falkon/network/requests/outbound)
 *
 * After sending, switches to an inline FalkonStatusTimeline.
 */

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronLeft,
  Eye,
  Globe,
  Loader2,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateOutboundRequest,
  useFalkonPeers,
  useFalkonIdentity,
  SHARED_DATA_FIELDS,
  UR_FOUNDERS_CAPS,
  type FalkonPeer,
} from "@/lib/falkonNetwork";
import { FalkonStatusTimeline } from "./FalkonStatusTimeline";
import falkonLogo from "@/assets/falkon-logo.png";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface AskFalkonSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the description field (from JARVIS formation intent). */
  initialText?: string;
  /** Pre-select a peer (for "Ask UR Founders" flow). */
  peerId?: string;
}

const UR_FOUNDERS_DOMAIN = "urfounders.com";
const UR_FOUNDERS_NAME = "UR Founders";

// ---------------------------------------------------------------------------
// Step 1: Describe
// ---------------------------------------------------------------------------

function StepDescribe({
  text,
  onChange,
  peer,
  onPeerClear,
  onNext,
}: {
  text: string;
  onChange: (v: string) => void;
  peer: FalkonPeer | null;
  onPeerClear: () => void;
  onNext: () => void;
}) {
  const fieldCls =
    "w-full bg-[var(--paper)] border border-[var(--hairline)] rounded-[12px] px-[14px] py-[13px] text-[14px] text-[var(--ink)] placeholder:text-[var(--faint)] focus:outline-none focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold)] transition-all";

  const isURFounders = peer?.domain === UR_FOUNDERS_DOMAIN;

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Matched peer */}
      {peer ? (
        <div className="bg-[rgba(180,255,68,0.06)] border border-[rgba(180,255,68,0.2)] rounded-[14px] p-[14px] flex items-center gap-[12px]">
          <div className="w-[40px] h-[40px] rounded-[10px] bg-[rgba(180,255,68,0.12)] border border-[rgba(180,255,68,0.25)] grid place-items-center shrink-0">
            {isURFounders ? (
              <img src={falkonLogo} alt="UR Founders" className="w-[28px] h-[28px] object-contain brightness-0" />
            ) : (
              <Globe className="w-[18px] h-[18px] text-[var(--gold)]" strokeWidth={1.8} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-[var(--ink)] truncate">{peer.name}</div>
            {isURFounders && (
              <div className="flex gap-[6px] flex-wrap mt-[4px]">
                {UR_FOUNDERS_CAPS.slice(0, 3).map((c) => (
                  <span
                    key={c.id}
                    className="text-[10px] font-medium bg-[rgba(109,155,18,0.1)] text-[var(--gold)] px-[7px] py-[2px] rounded-full"
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onPeerClear}
            className="shrink-0 w-[28px] h-[28px] rounded-full bg-[var(--hairline)] grid place-items-center text-[var(--muted)] hover:bg-[var(--hairline2)] transition-colors"
          >
            <X className="w-[12px] h-[12px]" />
          </button>
        </div>
      ) : (
        <div className="bg-card border border-[var(--hairline)] rounded-[14px] p-[14px] text-[13px] text-[var(--muted)]">
          No peer selected. Describe your request and we'll match it to a connected business.
        </div>
      )}

      {/* Description */}
      <div>
        <label className="text-[11px] font-bold tracking-[0.07em] uppercase text-[var(--muted)] mb-[8px] block">
          What do you need?
        </label>
        <textarea
          className={`${fieldCls} resize-none min-h-[100px]`}
          placeholder="Describe what you're looking for, e.g. 'Form a new LLC in Delaware for our property management entity'"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
      </div>

      {isURFounders && (
        <div className="bg-[rgba(37,99,235,0.06)] border border-[rgba(37,99,235,0.15)] rounded-[12px] p-[13px] flex gap-[10px]">
          <ShieldCheck className="w-[16px] h-[16px] text-[#2563EB] shrink-0 mt-[1px]" strokeWidth={1.8} />
          <div className="text-[12px] text-[var(--muted)] leading-[1.5]">
            <strong className="text-[var(--ink)]">UR Founders partner benefit:</strong> As a Falkon Network member,
            HALO users receive priority processing and a network member rate for entity formation services.
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={!text.trim() || !peer}
        className="w-full h-[48px] rounded-[14px] bg-[var(--gold-light)] text-black font-bold text-[14px] flex items-center justify-center gap-[8px] disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99] transition-transform shadow-[0_0_20px_rgba(180,255,68,0.25)]"
      >
        Review Data Sharing
        <ArrowRight className="w-[15px] h-[15px]" strokeWidth={2.5} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Data disclosure
// ---------------------------------------------------------------------------

function StepDisclosure({
  identity,
  onBack,
  onNext,
}: {
  identity: { businessName: string; partnerId: string; trustDocUrl: string } | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const sharedValues: Record<string, string> = {
    businessName: identity?.businessName ?? "Your business name",
    partnerId: identity?.partnerId ?? "archangel-halo",
    contactEmail: "(office contact — not stored in the request)",
    trustDocUrl: identity?.trustDocUrl ?? "/.well-known/falkon-trust.json",
  };

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="bg-[rgba(37,99,235,0.05)] border border-[rgba(37,99,235,0.12)] rounded-[14px] p-[14px] flex gap-[10px]">
        <Eye className="w-[16px] h-[16px] text-[#2563EB] shrink-0 mt-[1px]" strokeWidth={1.8} />
        <div className="text-[12px] text-[var(--muted)] leading-[1.6]">
          The following information will be shared with the peer business as part of this request.
          No financial data, invoices, crew records, or private business data will be shared.
        </div>
      </div>

      <div className="flex flex-col gap-[8px]">
        {SHARED_DATA_FIELDS.map((field) => (
          <div
            key={field.key}
            className="bg-card border border-[var(--hairline)] rounded-[12px] px-[14px] py-[12px] flex items-start gap-[12px]"
          >
            <Check className="w-[15px] h-[15px] text-[var(--gold)] shrink-0 mt-[1px]" strokeWidth={2.5} />
            <div>
              <div className="text-[12px] font-semibold text-[var(--ink)]">{field.label}</div>
              <div className="text-[11px] text-[var(--muted)] mt-[1px]">{field.note}</div>
              <div className="text-[11px] text-[var(--faint)] font-mono mt-[3px] truncate max-w-[240px]">
                {sharedValues[field.key]}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="text-[11px] text-[var(--faint)] text-center px-[10px] leading-[1.5]">
        This request is signed with HALO's Ed25519 identity key. The peer will verify the signature before processing.
      </div>

      <div className="flex gap-[10px]">
        <button
          type="button"
          onClick={onBack}
          className="h-[48px] px-[20px] rounded-[14px] bg-card border border-[var(--hairline)] text-[var(--ink)] font-semibold text-[14px] flex items-center gap-[6px] hover:bg-[var(--paper)] transition-colors"
        >
          <ChevronLeft className="w-[15px] h-[15px]" />
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex-1 h-[48px] rounded-[14px] bg-[var(--gold-light)] text-black font-bold text-[14px] flex items-center justify-center gap-[8px] hover:scale-[1.01] active:scale-[0.99] transition-transform shadow-[0_0_20px_rgba(180,255,68,0.25)]"
        >
          Approve & Send
          <Send className="w-[13px] h-[13px]" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Confirm (loading) → Timeline
// ---------------------------------------------------------------------------

function StepConfirm({
  sending,
  requestId,
  peerName,
  onClose,
}: {
  sending: boolean;
  requestId: string | null;
  peerName: string;
  onClose: () => void;
}) {
  if (sending) {
    return (
      <div className="flex flex-col items-center gap-[16px] py-[40px]">
        <div className="w-[56px] h-[56px] rounded-full bg-[rgba(180,255,68,0.1)] border border-[rgba(180,255,68,0.3)] grid place-items-center">
          <Loader2 className="w-[24px] h-[24px] text-[var(--gold)] animate-spin" strokeWidth={2} />
        </div>
        <div className="text-center">
          <div className="text-[15px] font-bold text-[var(--ink)]">Sending to {peerName}…</div>
          <div className="text-[13px] text-[var(--muted)] mt-[6px]">Signing with HALO identity</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Success indicator */}
      <div className="flex items-center gap-[12px] bg-[rgba(180,255,68,0.06)] border border-[rgba(180,255,68,0.2)] rounded-[14px] p-[14px]">
        <div className="w-[36px] h-[36px] rounded-full bg-[var(--gold-light)] grid place-items-center shrink-0">
          <Check className="w-[16px] h-[16px] text-black" strokeWidth={3} />
        </div>
        <div>
          <div className="text-[13px] font-bold text-[var(--ink)]">Request sent to {peerName}</div>
          <div className="text-[11px] text-[var(--muted)] mt-[2px]">
            Tracking live status below
          </div>
        </div>
      </div>

      {/* Live status timeline */}
      {requestId && (
        <div className="bg-card border border-[var(--hairline)] rounded-[14px] p-[14px]">
          <FalkonStatusTimeline requestId={requestId} />
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full h-[48px] rounded-[14px] bg-card border border-[var(--hairline)] text-[var(--ink)] font-semibold text-[14px] hover:bg-[var(--paper)] transition-colors"
      >
        Done
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main sheet
// ---------------------------------------------------------------------------

export function AskFalkonSheet({
  open,
  onOpenChange,
  initialText = "",
  peerId,
}: AskFalkonSheetProps) {
  const { toast } = useToast();
  const { data: peersData } = useFalkonPeers();
  const { data: identity } = useFalkonIdentity();
  const createRequest = useCreateOutboundRequest();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [text, setText] = useState(initialText);
  const [createdRequestId, setCreatedRequestId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Resolve the selected peer
  const peers = peersData?.peers ?? [];
  const urFounders = peers.find((p) => p.domain === UR_FOUNDERS_DOMAIN);

  // If a specific peerId was passed, use that; otherwise default to UR Founders
  const resolvedPeer = peerId
    ? (peers.find((p) => p.id === peerId) ?? urFounders ?? null)
    : urFounders ?? null;

  const [selectedPeer, setSelectedPeer] = useState<FalkonPeer | null>(null);
  // Use resolved peer on first open
  const activePeer = selectedPeer ?? resolvedPeer;

  // Reset on open
  const handleOpenChange = (o: boolean) => {
    if (!o) {
      // Small delay so the close animation plays first
      setTimeout(() => {
        setStep(1);
        setText(initialText);
        setCreatedRequestId(null);
        setSending(false);
        setSelectedPeer(null);
      }, 300);
    }
    onOpenChange(o);
  };

  const handleSend = async () => {
    if (!activePeer || !text.trim()) return;
    setSending(true);
    setStep(3);
    try {
      const sharedData = {
        businessName: identity?.businessName,
        partnerId: identity?.partnerId,
        trustDocUrl: identity?.trustDocUrl,
        requestedAt: new Date().toISOString(),
      };

      const result = await createRequest.mutateAsync({
        peerId: activePeer.id,
        capabilityId: "entity-formation",
        summary: text.trim(),
        sharedData,
      });

      setCreatedRequestId(result.request.id);
    } catch (err: any) {
      toast({
        title: "Couldn't send request",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
      setStep(2);
    } finally {
      setSending(false);
    }
  };

  const stepLabels = ["Describe", "Review", "Sent"];

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[88dvh] rounded-t-[24px] overflow-y-auto"
      >
        <SheetHeader className="pb-[8px]">
          <div className="flex items-center gap-[12px] mb-[6px]">
            <div className="w-[34px] h-[34px] rounded-[9px] bg-[rgba(180,255,68,0.1)] border border-[rgba(180,255,68,0.25)] grid place-items-center shrink-0">
              <Building2 className="w-[16px] h-[16px] text-[var(--gold)]" strokeWidth={1.8} />
            </div>
            <SheetTitle className="text-[16px]">Ask Falkon</SheetTitle>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-[6px]">
            {stepLabels.map((label, i) => {
              const sn = (i + 1) as 1 | 2 | 3;
              const isDone = step > sn;
              const isActive = step === sn;
              return (
                <div key={label} className="flex items-center gap-[6px]">
                  <div
                    className={`flex items-center gap-[5px] px-[10px] py-[4px] rounded-full text-[11px] font-semibold transition-all ${
                      isDone
                        ? "bg-[rgba(180,255,68,0.15)] text-[var(--gold)]"
                        : isActive
                        ? "bg-[var(--ink)] text-white"
                        : "bg-[var(--paper)] text-[var(--faint)]"
                    }`}
                  >
                    {isDone ? (
                      <Check className="w-[10px] h-[10px]" strokeWidth={3} />
                    ) : (
                      <span className="text-[10px]">{sn}</span>
                    )}
                    {label}
                  </div>
                  {i < stepLabels.length - 1 && (
                    <div
                      className={`w-[16px] h-[1.5px] rounded-full ${
                        step > sn
                          ? "bg-[var(--gold-light)]"
                          : "bg-[var(--hairline)]"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </SheetHeader>

        <div className="mt-[16px]">
          {step === 1 && (
            <StepDescribe
              text={text}
              onChange={setText}
              peer={activePeer}
              onPeerClear={() => setSelectedPeer(null)}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <StepDisclosure
              identity={identity ?? null}
              onBack={() => setStep(1)}
              onNext={handleSend}
            />
          )}
          {step === 3 && (
            <StepConfirm
              sending={sending}
              requestId={createdRequestId}
              peerName={activePeer?.name ?? UR_FOUNDERS_NAME}
              onClose={() => handleOpenChange(false)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
