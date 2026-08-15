import { useLocation, useSearch } from "wouter";
import {
  useListClientPortfolios,
  useGetPortfolioPipeline,
  holdTurnCapacity,
  confirmCapacityHold,
  getGetPortfolioPipelineQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TurnPipeline, idempotencyHeaders } from "@workspace/board-ui";

export default function TurnPipelinePage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const queryClient = useQueryClient();
  const list = useListClientPortfolios();
  const qsId = new URLSearchParams(search).get("id");
  const portfolios = list.data?.portfolios ?? [];
  const id =
    (qsId && portfolios.some((p) => p.id === qsId) ? qsId : null) ??
    portfolios.find((p) => /north/i.test(p.name))?.id ??
    portfolios[0]?.id ??
    "";
  const doc = useGetPortfolioPipeline(id || "pending", {
    query: {
      enabled: Boolean(id),
      queryKey: getGetPortfolioPipelineQueryKey(id || "pending"),
    },
  });

  const refetch = () => {
    if (!id) return;
    void queryClient.invalidateQueries({ queryKey: getGetPortfolioPipelineQueryKey(id) });
  };

  return (
    <TurnPipeline
      doc={doc.data}
      loading={doc.isLoading || list.isLoading}
      errorMessage={(doc.error as { error?: string } | undefined)?.error}
      onHold={async (turnId) => {
        await holdTurnCapacity(turnId, { headers: idempotencyHeaders() });
        refetch();
      }}
      onConfirm={async (bundleId) => {
        await confirmCapacityHold(bundleId, { headers: idempotencyHeaders() });
        refetch();
      }}
      homeHref={{
        label: "Portfolio",
        onClick: () => navigate(id ? `/portfolio?id=${id}` : "/portfolio"),
      }}
    />
  );
}
