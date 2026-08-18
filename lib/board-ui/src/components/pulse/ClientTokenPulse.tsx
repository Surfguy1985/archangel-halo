import { useState } from "react";
import {
  useGetClientPortfolioPulse,
  useGetClientPortfolioAttention,
  useListClientPortfolioAvailableProperties,
  putClientPortfolioSavedView,
  addClientPortfolioProperty,
  getStreamClientPortfolioPulseUrl,
  getGetClientPortfolioPulseQueryKey,
  getGetClientPortfolioAttentionQueryKey,
  getListClientPortfolioAvailablePropertiesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PortfolioPulse } from "./PortfolioPulse";
import { usePulseViewQuery, pulseViewPersistBody, idempotencyHeaders } from "../../hooks/usePulseViewQuery";
import { useClientBoardSession } from "../../hooks/useClientBoardSession";

export type ClientTokenPulseProps = {
  token: string;
  onNavigate: (path: string) => void;
  homeHref?: { label: string; onClick: () => void };
};

export function ClientTokenPulse(props: ClientTokenPulseProps) {
  const { token } = props;
  useClientBoardSession(token);
  const queryClient = useQueryClient();
  const view = usePulseViewQuery();
  const [addError, setAddError] = useState<string | undefined>();
  const [addBusy, setAddBusy] = useState(false);
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
  const available = useListClientPortfolioAvailableProperties(token || "pending", {
    query: {
      enabled: Boolean(token && pulse.data?.canAddProperties),
      queryKey: getListClientPortfolioAvailablePropertiesQueryKey(token || "pending"),
    },
  });

  const refetch = () => {
    if (!token) return;
    void queryClient.invalidateQueries({ queryKey: getGetClientPortfolioPulseQueryKey(token) });
    void queryClient.invalidateQueries({ queryKey: getGetClientPortfolioAttentionQueryKey(token) });
    void queryClient.invalidateQueries({
      queryKey: getListClientPortfolioAvailablePropertiesQueryKey(token),
    });
  };

  const persist = (next: ReturnType<typeof pulseViewPersistBody>) => {
    if (!token) return;
    void putClientPortfolioSavedView(token, next, { headers: idempotencyHeaders() });
  };

  const propertyOnly = pulse.data?.viewKind === "property";

  return (
    <PortfolioPulse
      storyLevel={propertyOnly ? "pulse" : "portfolio"}
      deskLocked
      pulse={pulse.data}
      attention={attention.data}
      streamUrl={token ? getStreamClientPortfolioPulseUrl(token) : null}
      onRefetch={refetch}
      isLoading={pulse.isLoading}
      errorMessage={(pulse.error as { error?: string } | undefined)?.error}
      onTileClick={(propertyId) => props.onNavigate(`/${token}/property/${propertyId}`)}
      onAttentionClick={(href) => props.onNavigate(href.startsWith("/") ? href : `/${token}`)}
      onKanban={(propertyId) =>
        props.onNavigate(propertyId ? `/${token}/board?property=${propertyId}` : `/${token}/board`)
      }
      askUrl={token ? `/api/client/${token}/portfolio/ask` : null}
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
      homeHref={props.homeHref}
      importHref={
        propertyOnly
          ? undefined
          : { label: "Entrata CSV", onClick: () => props.onNavigate(`/${token}/imports`) }
      }
      costHref={
        propertyOnly
          ? undefined
          : {
              label: "How work gets done",
              onClick: () => props.onNavigate(`/${token}/how-work`),
            }
      }
      pipelineHref={
        propertyOnly
          ? undefined
          : { label: "Pipeline", onClick: () => props.onNavigate(`/${token}/pipeline`) }
      }
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
      addProperty={
        pulse.data?.canAddProperties
          ? {
              available: available.data?.properties ?? [],
              busy: addBusy,
              error: addError,
              onAttach: async (propertyId) => {
                setAddBusy(true);
                setAddError(undefined);
                try {
                  await addClientPortfolioProperty(
                    token,
                    { propertyId },
                    { headers: idempotencyHeaders() },
                  );
                  refetch();
                } catch (err) {
                  setAddError((err as { error?: string } | undefined)?.error ?? "Could not add property");
                } finally {
                  setAddBusy(false);
                }
              },
              onCreate: async (input) => {
                setAddBusy(true);
                setAddError(undefined);
                try {
                  await addClientPortfolioProperty(token, input, { headers: idempotencyHeaders() });
                  refetch();
                } catch (err) {
                  setAddError((err as { error?: string } | undefined)?.error ?? "Could not add property");
                } finally {
                  setAddBusy(false);
                }
              },
            }
          : undefined
      }
    />
  );
}
