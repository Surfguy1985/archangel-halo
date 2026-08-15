import { useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetPropertyTurnBoard,
  useGetTurnDetail,
  approveTurnScope,
  approveTurnVariance,
  requestTurnWork,
  getStreamPropertyTurnBoardUrl,
  getGetPropertyTurnBoardQueryKey,
  getGetTurnDetailQueryKey,
  type TurnBoardGroupBy,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TurnBoard, idempotencyHeaders } from "@workspace/board-ui";

export default function PropertyTurnBoardPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [groupBy, setGroupBy] = useState<TurnBoardGroupBy>("stage");
  const [turnId, setTurnId] = useState<string | null>(null);
  const query = groupBy === "stage" ? undefined : { groupBy };

  const board = useGetPropertyTurnBoard(id || "pending", query, {
    query: { enabled: Boolean(id), queryKey: getGetPropertyTurnBoardQueryKey(id || "pending", query) },
  });
  const detail = useGetTurnDetail(turnId || "pending", {
    query: { enabled: Boolean(turnId), queryKey: getGetTurnDetailQueryKey(turnId || "pending") },
  });

  const refetch = () => {
    if (!id) return;
    void queryClient.invalidateQueries({ queryKey: getGetPropertyTurnBoardQueryKey(id) });
    if (turnId) void queryClient.invalidateQueries({ queryKey: getGetTurnDetailQueryKey(turnId) });
  };

  return (
    <TurnBoard
      board={board.data}
      detail={turnId ? detail.data : undefined}
      streamUrl={id ? getStreamPropertyTurnBoardUrl(id) : null}
      onRefetch={refetch}
      onGroupBy={setGroupBy}
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
      isLoading={board.isLoading}
      errorMessage={(board.error as { error?: string } | undefined)?.error}
      homeHref={{ label: "Portfolio", onClick: () => navigate("/portfolio") }}
    />
  );
}
