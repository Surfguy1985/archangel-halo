/**
 * FalkonStatusTimeline — live animated status timeline for a cross-business request.
 *
 * Polls GET /falkon/network/requests/:id every 10 s and animates stage transitions.
 * Can be shown inline (inside AskFalkonSheet after send) or standalone.
 */

import { Check, Clock, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useFalkonRequest,
  stateLabel,
  type FalkonRequest,
} from "@/lib/falkonNetwork";

// ---------------------------------------------------------------------------
// Stage derivation
// ---------------------------------------------------------------------------

type StageStatus = "done" | "active" | "upcoming" | "failed";

interface Stage {
  id: string;
  label: string;
  sublabel: string;
  status: StageStatus;
  ts?: string | null;
}

function deriveStages(req: FalkonRequest): Stage[] {
  const s = req.approval_state;
  const failed = ["delivery_failed", "rejected", "cancelled"].includes(s);
  const fulfilled = s === "fulfilled";

  const done = (label: string, sub: string, ts?: string | null): Stage => ({
    id: label,
    label,
    sublabel: sub,
    status: "done",
    ts,
  });
  const active = (label: string, sub: string): Stage => ({
    id: label,
    label,
    sublabel: sub,
    status: "active",
  });
  const upcoming = (label: string, sub: string): Stage => ({
    id: label,
    label,
    sublabel: sub,
    status: "upcoming",
  });

  if (req.direction === "outbound") {
    const stages: Stage[] = [];

    // Stage 1: Sent
    if (["sent", "approved", "fulfilled"].includes(s) || failed) {
      const sentEvent = req.request_events?.find((e) => e.event === "delivered");
      stages.push(done("Sent", "Delivered to peer", sentEvent?.ts ? new Date(sentEvent.ts).toISOString() : req.created_at));
    } else {
      stages.push(active("Sending", "Signing and transmitting…"));
    }

    // Stage 2: Awaiting peer
    if (s === "sent" && !failed) {
      stages.push(active("Awaiting Peer", "Waiting for peer to process request"));
      stages.push(upcoming("In Progress", "Peer is working on your request"));
      stages.push(upcoming("Complete", "Request fulfilled"));
    } else if (["approved", "fulfilled"].includes(s)) {
      stages.push(done("Awaiting Peer", "Peer received request"));
      if (s === "fulfilled") {
        stages.push(done("In Progress", "Peer processed request"));
        stages.push(done("Complete", "Request fulfilled", req.updated_at));
      } else {
        stages.push(active("In Progress", "Peer is working on your request"));
        stages.push(upcoming("Complete", "Request fulfilled"));
      }
    } else if (failed) {
      stages.push({
        id: "failed",
        label: stateLabel(s),
        sublabel: req.last_error ?? "Check request details for more info",
        status: "failed",
      });
    }

    return stages;
  }

  // Inbound
  const stages: Stage[] = [];
  if (s === "awaiting_approval") {
    stages.push(done("Received", "Inbound request received", req.created_at));
    stages.push(active("Awaiting Approval", "Review and approve or reject"));
    stages.push(upcoming("Complete", "Request processed"));
  } else if (s === "approved") {
    stages.push(done("Received", "Inbound request received", req.created_at));
    stages.push(done("Approved", "Approved by office", req.updated_at));
    stages.push(active("Complete", "Request is being processed"));
  } else if (s === "fulfilled") {
    stages.push(done("Received", "Inbound request received", req.created_at));
    stages.push(done("Approved", "Approved by office"));
    stages.push(done("Complete", "Request fulfilled", req.updated_at));
  } else if (["rejected", "cancelled"].includes(s)) {
    stages.push(done("Received", "Inbound request received", req.created_at));
    stages.push({ id: "declined", label: stateLabel(s), sublabel: "Request closed", status: "failed" });
  }

  return stages;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function StageRow({ stage, isLast }: { stage: Stage; isLast: boolean }) {
  const dotClass = {
    done: "bg-[var(--gold-light)] text-[#07101E]",
    active: "bg-[#07101E] text-[var(--gold-light)] ring-4 ring-[rgba(180,255,68,0.2)]",
    upcoming: "bg-card border-2 border-[var(--hairline)] text-[var(--faint)]",
    failed: "bg-[#E11D48] text-white",
  }[stage.status];

  const labelClass = {
    done: "text-[var(--ink)] font-semibold",
    active: "text-[var(--ink)] font-bold",
    upcoming: "text-[var(--muted)]",
    failed: "text-[#E11D48] font-semibold",
  }[stage.status];

  const lineClass =
    stage.status === "done" ? "bg-[var(--gold-light)]" : "bg-[var(--hairline)]";

  return (
    <div className="flex gap-[14px]">
      {/* Left column: dot + connector */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0 transition-all",
            dotClass,
          )}
        >
          {stage.status === "done" && <Check className="w-[13px] h-[13px]" strokeWidth={3} />}
          {stage.status === "active" && (
            <Loader2 className="w-[13px] h-[13px] animate-spin" strokeWidth={2.5} />
          )}
          {stage.status === "upcoming" && (
            <Clock className="w-[11px] h-[11px]" strokeWidth={2} />
          )}
          {stage.status === "failed" && (
            <XCircle className="w-[13px] h-[13px]" strokeWidth={2.5} />
          )}
        </div>
        {!isLast && (
          <div className={cn("w-[2px] flex-1 min-h-[20px] mt-[4px] rounded-full transition-colors", lineClass)} />
        )}
      </div>

      {/* Right column: text */}
      <div className="pb-[16px] pt-[2px]">
        <div className={cn("text-[13px] leading-tight", labelClass)}>{stage.label}</div>
        <div className="text-[11px] text-[var(--muted)] mt-[2px]">{stage.sublabel}</div>
        {stage.ts && (
          <div className="text-[10px] text-[var(--faint)] mt-[2px]">
            {new Date(stage.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
    </div>
  );
}

interface FalkonStatusTimelineProps {
  requestId: string;
  className?: string;
}

export function FalkonStatusTimeline({
  requestId,
  className,
}: FalkonStatusTimelineProps) {
  const { data: req, isLoading } = useFalkonRequest(requestId);

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-[8px] text-[var(--muted)] py-4", className)}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-[13px]">Loading status…</span>
      </div>
    );
  }

  if (!req) return null;

  const stages = deriveStages(req);

  return (
    <div className={cn("", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-[16px]">
        <div className="text-[11px] font-bold tracking-[0.08em] uppercase text-[var(--muted)]">
          Request Status
        </div>
        <div className="text-[11px] text-[var(--faint)]">
          {req.peer_name ?? "Peer"}
          {" · "}
          {req.capability_name ?? req.capability_id}
        </div>
      </div>

      {/* Stages */}
      {stages.map((stage, i) => (
        <StageRow key={stage.id} stage={stage} isLast={i === stages.length - 1} />
      ))}

      {/* Correlation ID footer */}
      <div className="mt-[4px] text-[10px] text-[var(--faint)] font-mono">
        Ref: {req.correlation_id.slice(0, 8)}…
      </div>
    </div>
  );
}
