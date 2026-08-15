import { useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetPropertyTurnBoard,
  useGetTurnDetail,
  useGetTurnEvidence,
  useVerifyTurn,
  useGetTurnScope,
  approveTurnScope,
  approveTurnVariance,
  requestTurnWork,
  createTurnRecord,
  addScopeLine,
  createScopeInvoice,
  createVarianceRequest,
  approveVarianceRequest,
  rejectVarianceRequest,
  getStreamPropertyTurnBoardUrl,
  getGetPropertyTurnBoardQueryKey,
  getGetTurnDetailQueryKey,
  getGetTurnEvidenceQueryKey,
  getVerifyTurnQueryKey,
  getGetTurnScopeQueryKey,
  getExportTurnInvoiceUrl,
  createScopeBidRequest,
  type TurnBoardGroupBy,
  type WorkSourceFilter,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TurnBoard, idempotencyHeaders } from "@workspace/board-ui";

export default function PropertyTurnBoardPage() {
  const params = useParams<{ id?: string; propertyId?: string }>();
  const id = params.id ?? params.propertyId ?? "";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [groupBy, setGroupBy] = useState<TurnBoardGroupBy>("stage");
  const [workSource, setWorkSource] = useState<WorkSourceFilter>("all");
  const [turnId, setTurnId] = useState<string | null>(null);
  const query =
    groupBy === "stage" && workSource === "all"
      ? undefined
      : {
          ...(groupBy !== "stage" ? { groupBy } : {}),
          ...(workSource !== "all" ? { workSource } : {}),
        };

  const board = useGetPropertyTurnBoard(id || "pending", query, {
    query: { enabled: Boolean(id), queryKey: getGetPropertyTurnBoardQueryKey(id || "pending", query) },
  });
  const detail = useGetTurnDetail(turnId || "pending", {
    query: { enabled: Boolean(turnId), queryKey: getGetTurnDetailQueryKey(turnId || "pending") },
  });
  const evidence = useGetTurnEvidence(turnId || "pending", {
    query: { enabled: Boolean(turnId), queryKey: getGetTurnEvidenceQueryKey(turnId || "pending") },
  });
  const verify = useVerifyTurn(turnId || "pending", {
    query: { enabled: Boolean(turnId), queryKey: getVerifyTurnQueryKey(turnId || "pending") },
  });
  const scope = useGetTurnScope(turnId || "pending", {
    query: { enabled: Boolean(turnId), queryKey: getGetTurnScopeQueryKey(turnId || "pending") },
  });

  const refetch = () => {
    if (!id) return;
    void queryClient.invalidateQueries({ queryKey: getGetPropertyTurnBoardQueryKey(id) });
    if (turnId) {
      void queryClient.invalidateQueries({ queryKey: getGetTurnDetailQueryKey(turnId) });
      void queryClient.invalidateQueries({ queryKey: getGetTurnScopeQueryKey(turnId) });
    }
  };

  return (
    <TurnBoard
      board={board.data}
      detail={turnId ? detail.data : undefined}
      streamUrl={id ? getStreamPropertyTurnBoardUrl(id) : null}
      onRefetch={refetch}
      onGroupBy={setGroupBy}
      workSource={workSource}
      onWorkSourceChange={setWorkSource}
      onOpenTurn={setTurnId}
      onCloseDetail={() => setTurnId(null)}
      onAction={async (action) => {
        if (!turnId) throw new Error("No turn selected");
        const headers = idempotencyHeaders();
        if (action === "approve_scope") await approveTurnScope(turnId, { headers });
        else if (action === "approve_variance") await approveTurnVariance(turnId, { headers });
        else await requestTurnWork(turnId, { headers });
        refetch();
      }}
      evidence={turnId ? evidence.data : undefined}
      verify={turnId ? verify.data : undefined}
      evidenceLoading={Boolean(turnId) && evidence.isLoading}
      onVerify={() => {
        if (turnId) void queryClient.invalidateQueries({ queryKey: getVerifyTurnQueryKey(turnId) });
      }}
      onDownloadRecord={async (variant) => {
        if (!turnId) throw new Error("No turn selected");
        const rec = await createTurnRecord(turnId, { variant }, { headers: idempotencyHeaders() });
        if (rec.url) window.open(rec.url, "_blank", "noopener,noreferrer");
        else throw new Error(rec.error ?? "Record is not ready");
      }}
      scope={turnId ? scope.data : undefined}
      scopeLoading={Boolean(turnId) && scope.isLoading}
      onAddScopeLine={async (input) => {
        const scopeId = scope.data?.scopeId;
        if (!scopeId) throw new Error("No scope on this turn yet.");
        await addScopeLine(scopeId, input, { headers: idempotencyHeaders() });
        refetch();
      }}
      onCreateInvoice={async () => {
        const scopeId = scope.data?.scopeId;
        if (!scopeId) throw new Error("No scope on this turn yet.");
        await createScopeInvoice(scopeId, {}, { headers: idempotencyHeaders() });
        refetch();
      }}
      onVarianceRequest={async (scopeLineId, reason) => {
        const scopeId = scope.data?.scopeId;
        if (!scopeId) throw new Error("No scope on this turn yet.");
        await createVarianceRequest(scopeId, { scopeLineId, reason }, { headers: idempotencyHeaders() });
        refetch();
      }}
      onVarianceDecide={async (varianceId, decision) => {
        const headers = idempotencyHeaders();
        if (decision === "approved") await approveVarianceRequest(varianceId, { headers });
        else await rejectVarianceRequest(varianceId, { headers });
        refetch();
      }}
      onExportInvoice={(format) => {
        const invoiceId = scope.data?.invoice?.id;
        if (!invoiceId) return;
        window.open(getExportTurnInvoiceUrl(invoiceId, { format }), "_blank", "noopener,noreferrer");
      }}
      onCreateBidRequest={async () => {
        const scopeId = scope.data?.scopeId;
        if (!scopeId) throw new Error("No scope on this turn yet.");
        const dueAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
        const rec = await createScopeBidRequest(scopeId, { dueAt }, { headers: idempotencyHeaders() });
        refetch();
        navigate(`/bid-requests/${rec.id}`);
      }}
      onOpenBidBoard={() => {
        const bidId = scope.data?.bidRequestId;
        if (bidId) navigate(`/bid-requests/${bidId}`);
      }}
      isLoading={board.isLoading}
      errorMessage={(board.error as { error?: string } | undefined)?.error}
      homeHref={{ label: "Portfolio", onClick: () => navigate("/portfolio") }}
    />
  );
}
