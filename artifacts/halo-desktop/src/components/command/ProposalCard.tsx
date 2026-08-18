/**
 * ProposalCard — a prediction HALO volunteered, phrased as a decision.
 *
 * The row already exists as a PENDING autopilot action by the time this
 * renders. Nothing here executes on render: Approve POSTs to the existing
 * approval endpoint, and the server's atomic pending→executing claim is what
 * makes double-approval impossible. Dismiss resolves the row so the same
 * suggestion does not immediately re-fire for that entity.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useApproveAutopilotAction,
  useDismissAutopilotAction,
  getListAutopilotActionsQueryKey,
  getGetTodayQueryKey,
  getListJobsQueryKey,
  getListJobBoardQueryKey,
  getListInvoicesQueryKey,
} from "@workspace/api-client-react";
import { ArrowUpToLine, Check, Loader2, Megaphone, Receipt, Sparkles, X, type LucideIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface CommandProposal {
  id: string;
  kind: string;
  decision: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
}

const KIND_META: Record<string, { Icon: LucideIcon; color: string; verb: string }> = {
  prioritize_job: { Icon: ArrowUpToLine, color: "#B4FF44", verb: "Move to top" },
  rebroadcast_job: { Icon: Megaphone, color: "#3B82F6", verb: "Send offer" },
  send_invoice_reminder: { Icon: Receipt, color: "#F59E0B", verb: "Send reminder" },
};

export function ProposalCard({
  proposal,
  onResolved,
}: {
  proposal: CommandProposal;
  onResolved?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const approve = useApproveAutopilotAction();
  const dismiss = useDismissAutopilotAction();
  const [state, setState] = useState<"idle" | "working" | "approved" | "dismissed">("idle");

  const meta = KIND_META[proposal.kind] ?? { Icon: Sparkles, color: "#B4FF44", verb: "Approve" };
  const { Icon } = meta;

  // Approving re-orders the board / sends work out — refresh everything that
  // shows the result so the operator can actually see the change land.
  const refresh = () => {
    for (const key of [
      getListAutopilotActionsQueryKey(),
      getGetTodayQueryKey(),
      getListJobsQueryKey(),
      getListJobBoardQueryKey(),
      getListInvoicesQueryKey(),
    ]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  const onApprove = async () => {
    if (state !== "idle") return;
    setState("working");
    try {
      const res = await approve.mutateAsync({ id: proposal.id });
      setState("approved");
      refresh();
      onResolved?.(proposal.id);
      toast({ title: meta.verb, description: (res as { result?: string })?.result ?? proposal.title });
    } catch (err) {
      setState("idle");
      toast({
        title: "Couldn't apply that",
        description: (err as { data?: { error?: string } })?.data?.error ?? "Please try again.",
        variant: "destructive",
      });
    }
  };

  const onDismiss = async () => {
    if (state !== "idle") return;
    setState("working");
    try {
      await dismiss.mutateAsync({ id: proposal.id });
      setState("dismissed");
      refresh();
      onResolved?.(proposal.id);
    } catch {
      setState("idle");
    }
  };

  if (state === "approved" || state === "dismissed") {
    return (
      <div
        className="mt-2 ml-[34px] flex items-center gap-2 text-[11.5px]"
        style={{ color: state === "approved" ? "rgba(180,255,68,0.75)" : "rgba(255,255,255,0.3)" }}
      >
        {state === "approved" ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
        <span>{state === "approved" ? `${meta.verb} — done.` : "Dismissed."}</span>
      </div>
    );
  }

  const busy = state === "working";

  return (
    <div
      className="mt-2 ml-[34px] max-w-[80%] rounded-[12px] p-3 bg-[#0C1B30]"
      style={{ border: `1px solid ${meta.color}22` }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="w-[22px] h-[22px] rounded-[7px] grid place-items-center shrink-0 mt-[1px]"
          style={{ background: `${meta.color}1A` }}
        >
          <Icon className="w-[12px] h-[12px]" style={{ color: meta.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-[1.5] text-white/85">{proposal.decision}</p>
          <p className="text-[11px] leading-[1.45] mt-[3px] text-white/40">{proposal.body}</p>
        </div>
      </div>

      <div className="flex gap-2 mt-2.5">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold py-[7px] rounded-[8px] transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: meta.color, color: "#0A1220" }}
        >
          {busy ? <Loader2 className="w-[12px] h-[12px] animate-spin" /> : <Check className="w-[12px] h-[12px]" />}
          {meta.verb}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="px-3.5 text-[12px] font-medium py-[7px] rounded-[8px] text-white/45 bg-white/[0.05] border border-white/[0.07] hover:text-white/70 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
