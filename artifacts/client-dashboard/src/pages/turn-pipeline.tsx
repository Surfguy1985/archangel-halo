import { useLocation, useParams } from "wouter";
import {
  useGetClientPortfolioPipeline,
  holdClientTurnCapacity,
  confirmClientCapacityHold,
  getGetClientPortfolioPipelineQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TurnPipeline, idempotencyHeaders } from "@workspace/board-ui";
import { useSessionExchange } from "@/hooks/useSessionExchange";

export default function ClientTurnPipelinePage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  useSessionExchange(token);
  const queryClient = useQueryClient();
  const doc = useGetClientPortfolioPipeline(token || "pending", {
    query: {
      enabled: Boolean(token),
      queryKey: getGetClientPortfolioPipelineQueryKey(token || "pending"),
    },
  });

  const refetch = () => {
    if (!token) return;
    void queryClient.invalidateQueries({ queryKey: getGetClientPortfolioPipelineQueryKey(token) });
  };

  return (
    <TurnPipeline
      doc={doc.data}
      loading={doc.isLoading}
      errorMessage={(doc.error as { error?: string } | undefined)?.error}
      onHold={async (turnId) => {
        if (!token) return;
        await holdClientTurnCapacity(token, turnId, { headers: idempotencyHeaders() });
        refetch();
      }}
      onConfirm={async (bundleId) => {
        if (!token) return;
        await confirmClientCapacityHold(token, bundleId, { headers: idempotencyHeaders() });
        refetch();
      }}
      homeHref={{
        label: "Portfolio",
        onClick: () => setLocation(`/${token}`),
      }}
    />
  );
}
