import { useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetClientPropertyTurnBoard,
  useGetClientTurnDetail,
  approveClientTurnScope,
  approveClientTurnVariance,
  requestClientTurnWork,
  getStreamClientPropertyTurnBoardUrl,
  getGetClientPropertyTurnBoardQueryKey,
  getGetClientTurnDetailQueryKey,
  type TurnBoardGroupBy,
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
  const [turnId, setTurnId] = useState<string | null>(null);
  const query = groupBy === "stage" ? undefined : { groupBy };

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

  const refetch = () => {
    if (!token || !propertyId) return;
    void queryClient.invalidateQueries({
      queryKey: getGetClientPropertyTurnBoardQueryKey(token, propertyId),
    });
    if (turnId) {
      void queryClient.invalidateQueries({
        queryKey: getGetClientTurnDetailQueryKey(token, turnId),
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
      isLoading={board.isLoading}
      errorMessage={(board.error as { error?: string } | undefined)?.error}
      homeHref={{ label: "Pulse", onClick: () => setLocation(`/${token}`) }}
    />
  );
}
