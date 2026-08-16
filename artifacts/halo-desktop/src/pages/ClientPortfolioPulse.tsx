import { useLocation, useSearch } from "wouter";
import {
  useListClientPortfolios,
  useGetPortfolioPulse,
  useGetPortfolioAttention,
  putPortfolioSavedView,
  getStreamPortfolioPulseUrl,
  getGetPortfolioPulseQueryKey,
  getGetPortfolioAttentionQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PortfolioPulse,
  usePulseViewQuery,
  pulseViewPersistBody,
  idempotencyHeaders,
} from "@workspace/board-ui";

export default function ClientPortfolioPulse() {
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

  const view = usePulseViewQuery();
  const attentionParams = view.params?.workSource
    ? { workSource: view.params.workSource }
    : undefined;
  const pulse = useGetPortfolioPulse(id || "pending", view.params, {
    query: {
      enabled: Boolean(id),
      queryKey: getGetPortfolioPulseQueryKey(id || "pending", view.params),
    },
  });
  const attention = useGetPortfolioAttention(id || "pending", attentionParams, {
    query: {
      enabled: Boolean(id),
      queryKey: getGetPortfolioAttentionQueryKey(id || "pending", attentionParams),
    },
  });

  const refetch = () => {
    if (!id) return;
    void queryClient.invalidateQueries({ queryKey: getGetPortfolioPulseQueryKey(id) });
    void queryClient.invalidateQueries({ queryKey: getGetPortfolioAttentionQueryKey(id) });
  };

  const persist = (next: ReturnType<typeof pulseViewPersistBody>) => {
    if (!id) return;
    void putPortfolioSavedView(id, next, { headers: idempotencyHeaders() });
  };

  return (
    <PortfolioPulse
      theme="light"
      pulse={pulse.data}
      attention={attention.data}
      streamUrl={id ? getStreamPortfolioPulseUrl(id) : null}
      onRefetch={refetch}
      isLoading={pulse.isLoading || list.isLoading}
      errorMessage={
        (list.error as { error?: string } | undefined)?.error ??
        (pulse.error as { error?: string } | undefined)?.error
      }
      onTileClick={(propertyId) => navigate(`/properties/${propertyId}/turns`)}
      onAttentionClick={(href) => navigate(href)}
      onKanban={(propertyId) => propertyId && navigate(`/properties/${propertyId}/board`)}
      askUrl={id ? `/api/v1/portfolios/${id}/ask` : null}
      onRangeChange={(next, f, t) => {
        const committed = view.commitRange(next, f, t, pulse.data?.sort ?? "vacancy_cost");
        persist(pulseViewPersistBody(committed, pulse.data));
      }}
      onSortChange={(next) => {
        const committed = view.commitSort(next, {
          range: view.params?.range ?? pulse.data?.range ?? "this_month",
          sort: next,
          from: view.params?.from ?? pulse.data?.from,
          to: view.params?.to ?? pulse.data?.to,
        });
        persist(pulseViewPersistBody(committed, pulse.data));
      }}
      homeHref={{ label: "HALO", onClick: () => navigate("/") }}
      importHref={{ label: "Entrata CSV", onClick: () => navigate("/imports") }}
      costHref={{
        label: "How work gets done",
        onClick: () => navigate(id ? `/how-work?id=${id}` : "/how-work"),
      }}
      pipelineHref={{
        label: "Pipeline",
        onClick: () => navigate(id ? `/board/pipeline?id=${id}` : "/board/pipeline"),
      }}
      auditHref={{
        label: "Audit log",
        onClick: () => navigate(id ? `/audit?id=${id}` : "/audit"),
      }}
      workSource={view.params?.workSource ?? "all"}
      onWorkSourceChange={(next) => {
        view.commitWorkSource(next, {
          range: view.params?.range ?? pulse.data?.range ?? "this_month",
          sort: view.params?.sort ?? pulse.data?.sort ?? "vacancy_cost",
          from: view.params?.from ?? pulse.data?.from,
          to: view.params?.to ?? pulse.data?.to,
          workSource: next,
        });
      }}
      portfolios={portfolios}
      selectedPortfolioId={id}
      onPortfolioChange={(next) => navigate(`/portfolio?id=${next}`)}
    />
  );
}
