import { useLocation, useParams } from "wouter";
import {
  useGetClientPortfolioPulse,
  useGetClientPortfolioAttention,
  putClientPortfolioSavedView,
  getStreamClientPortfolioPulseUrl,
  getGetClientPortfolioPulseQueryKey,
  getGetClientPortfolioAttentionQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PortfolioPulse,
  usePulseViewQuery,
  pulseViewPersistBody,
  idempotencyHeaders,
} from "@workspace/board-ui";
import { useSessionExchange } from "@/hooks/useSessionExchange";

export default function ClientPortfolioPulsePage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  useSessionExchange(token);
  const queryClient = useQueryClient();
  const view = usePulseViewQuery();
  const attentionParams = view.params?.workSource
    ? { workSource: view.params.workSource }
    : undefined;

  const pulse = useGetClientPortfolioPulse(token || "pending", view.params, {
    query: {
      enabled: Boolean(token),
      queryKey: getGetClientPortfolioPulseQueryKey(token || "pending", view.params),
    },
  });
  const attention = useGetClientPortfolioAttention(token || "pending", attentionParams, {
    query: {
      enabled: Boolean(token),
      queryKey: getGetClientPortfolioAttentionQueryKey(token || "pending", attentionParams),
    },
  });

  const refetch = () => {
    if (!token) return;
    void queryClient.invalidateQueries({
      queryKey: getGetClientPortfolioPulseQueryKey(token),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetClientPortfolioAttentionQueryKey(token),
    });
  };

  const persist = (next: ReturnType<typeof pulseViewPersistBody>) => {
    if (!token) return;
    void putClientPortfolioSavedView(token, next, { headers: idempotencyHeaders() });
  };

  return (
    <PortfolioPulse
      pulse={pulse.data}
      attention={attention.data}
      streamUrl={token ? getStreamClientPortfolioPulseUrl(token) : null}
      onRefetch={refetch}
      isLoading={pulse.isLoading}
      errorMessage={(pulse.error as { error?: string } | undefined)?.error}
      onTileClick={(propertyId) => setLocation(`/${token}/property/${propertyId}`)}
      onAttentionClick={(href) => setLocation(href.startsWith("/") ? href : `/${token}/board`)}
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
      homeHref={{ label: "Halo One", onClick: () => setLocation(`/${token}/halo-one`) }}
      importHref={{ label: "Entrata CSV", onClick: () => setLocation(`/${token}/imports`) }}
      costHref={{
        label: "How work gets done",
        onClick: () => setLocation(`/${token}/how-work`),
      }}
      pipelineHref={{
        label: "Pipeline",
        onClick: () => setLocation(`/${token}/pipeline`),
      }}
      auditHref={{
        label: "Audit log",
        onClick: () => setLocation(`/${token}/audit`),
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
    />
  );
}
