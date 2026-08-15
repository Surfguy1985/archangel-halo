import { useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetClientPropertyTurnBoard,
  useGetClientTurnDetail,
  useGetClientTurnEvidence,
  useVerifyClientTurn,
  useGetClientTurnScope,
  approveClientTurnScope,
  approveClientTurnVariance,
  requestClientTurnWork,
  createClientTurnRecord,
  addClientScopeLine,
  createClientScopeInvoice,
  createClientVarianceRequest,
  approveClientVarianceRequest,
  rejectClientVarianceRequest,
  getStreamClientPropertyTurnBoardUrl,
  getGetClientPropertyTurnBoardQueryKey,
  getGetClientTurnDetailQueryKey,
  getGetClientTurnEvidenceQueryKey,
  getVerifyClientTurnQueryKey,
  getGetClientTurnScopeQueryKey,
  getExportClientTurnInvoiceUrl,
  createClientScopeBidRequest,
  type TurnBoardGroupBy,
  type WorkSourceFilter,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TurnBoard, idempotencyHeaders } from "@workspace/board-ui";
import { useSessionExchange } from "@/hooks/useSessionExchange";

export default function ClientPropertyTurnBoardPage() {
  const { token, propertyId } = useParams<{ token: string; propertyId: string }>();
  const [, setLocation] = useLocation();
  useSessionExchange(token);
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

  const board = useGetClientPropertyTurnBoard(token || "pending", propertyId || "pending", query, {
    query: {
      enabled: Boolean(token && propertyId),
      queryKey: getGetClientPropertyTurnBoardQueryKey(token || "pending", propertyId || "pending", query),
    },
  });
  const detail = useGetClientTurnDetail(token || "pending", turnId || "pending", {
    query: {
      enabled: Boolean(token && turnId),
      queryKey: getGetClientTurnDetailQueryKey(token || "pending", turnId || "pending"),
    },
  });
  const evidence = useGetClientTurnEvidence(token || "pending", turnId || "pending", {
    query: {
      enabled: Boolean(token && turnId),
      queryKey: getGetClientTurnEvidenceQueryKey(token || "pending", turnId || "pending"),
    },
  });
  const verify = useVerifyClientTurn(token || "pending", turnId || "pending", {
    query: {
      enabled: Boolean(token && turnId),
      queryKey: getVerifyClientTurnQueryKey(token || "pending", turnId || "pending"),
    },
  });
  const scope = useGetClientTurnScope(token || "pending", turnId || "pending", {
    query: {
      enabled: Boolean(token && turnId),
      queryKey: getGetClientTurnScopeQueryKey(token || "pending", turnId || "pending"),
    },
  });

  const refetch = () => {
    if (!token || !propertyId) return;
    void queryClient.invalidateQueries({
      queryKey: getGetClientPropertyTurnBoardQueryKey(token, propertyId),
    });
    if (turnId) {
      void queryClient.invalidateQueries({
        queryKey: getGetClientTurnDetailQueryKey(token, turnId),
      });
      void queryClient.invalidateQueries({
        queryKey: getGetClientTurnScopeQueryKey(token, turnId),
      });
    }
  };

  return (
    <TurnBoard
      board={board.data}
      detail={turnId ? detail.data : undefined}
      streamUrl={token && propertyId ? getStreamClientPropertyTurnBoardUrl(token, propertyId) : null}
      onRefetch={refetch}
      onGroupBy={setGroupBy}
      workSource={workSource}
      onWorkSourceChange={setWorkSource}
      onOpenTurn={setTurnId}
      onCloseDetail={() => setTurnId(null)}
      onAction={async (action) => {
        if (!token || !turnId) throw new Error("No turn selected");
        const headers = idempotencyHeaders();
        if (action === "approve_scope") await approveClientTurnScope(token, turnId, { headers });
        else if (action === "approve_variance") await approveClientTurnVariance(token, turnId, { headers });
        else await requestClientTurnWork(token, turnId, { headers });
        refetch();
      }}
      evidence={turnId ? evidence.data : undefined}
      verify={turnId ? verify.data : undefined}
      evidenceLoading={Boolean(token && turnId) && evidence.isLoading}
      onVerify={() => {
        if (token && turnId) {
          void queryClient.invalidateQueries({ queryKey: getVerifyClientTurnQueryKey(token, turnId) });
        }
      }}
      onDownloadRecord={async (variant) => {
        if (!token || !turnId) throw new Error("No turn selected");
        const rec = await createClientTurnRecord(token, turnId, { variant }, { headers: idempotencyHeaders() });
        if (rec.url) window.open(rec.url, "_blank", "noopener,noreferrer");
        else throw new Error(rec.error ?? "Record is not ready");
      }}
      scope={token && turnId ? scope.data : undefined}
      scopeLoading={Boolean(token && turnId) && scope.isLoading}
      onAddScopeLine={async (input) => {
        const scopeId = scope.data?.scopeId;
        if (!token || !scopeId) throw new Error("No scope on this turn yet.");
        await addClientScopeLine(token, scopeId, input, { headers: idempotencyHeaders() });
        refetch();
      }}
      onCreateInvoice={async () => {
        const scopeId = scope.data?.scopeId;
        if (!token || !scopeId) throw new Error("No scope on this turn yet.");
        await createClientScopeInvoice(token, scopeId, {}, { headers: idempotencyHeaders() });
        refetch();
      }}
      onVarianceRequest={async (scopeLineId, reason) => {
        const scopeId = scope.data?.scopeId;
        if (!token || !scopeId) throw new Error("No scope on this turn yet.");
        await createClientVarianceRequest(token, scopeId, { scopeLineId, reason }, { headers: idempotencyHeaders() });
        refetch();
      }}
      onVarianceDecide={async (varianceId, decision) => {
        if (!token) throw new Error("No session");
        const headers = idempotencyHeaders();
        if (decision === "approved") await approveClientVarianceRequest(token, varianceId, { headers });
        else await rejectClientVarianceRequest(token, varianceId, { headers });
        refetch();
      }}
      onExportInvoice={(format) => {
        const invoiceId = scope.data?.invoice?.id;
        if (!token || !invoiceId) return;
        window.open(getExportClientTurnInvoiceUrl(token, invoiceId, { format }), "_blank", "noopener,noreferrer");
      }}
      onCreateBidRequest={async () => {
        const scopeId = scope.data?.scopeId;
        if (!token || !scopeId) throw new Error("No scope on this turn yet.");
        const dueAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
        const rec = await createClientScopeBidRequest(token, scopeId, { dueAt }, { headers: idempotencyHeaders() });
        refetch();
        setLocation(`/${token}/bid-requests/${rec.id}`);
      }}
      onOpenBidBoard={() => {
        const bidId = scope.data?.bidRequestId;
        if (token && bidId) setLocation(`/${token}/bid-requests/${bidId}`);
      }}
      isLoading={board.isLoading}
      errorMessage={(board.error as { error?: string } | undefined)?.error}
      homeHref={{ label: "Pulse", onClick: () => setLocation(`/${token}`) }}
    />
  );
}
