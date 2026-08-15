import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useListClientPortfolios,
  useGetPortfolioCostToServe,
  getGetPortfolioCostToServeQueryKey,
  type WorkSourceFilter,
} from "@workspace/api-client-react";
import { CostToServe } from "@workspace/board-ui";

export default function CostToServePage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const list = useListClientPortfolios();
  const qsId = new URLSearchParams(search).get("id");
  const portfolios = list.data?.portfolios ?? [];
  const id =
    (qsId && portfolios.some((p) => p.id === qsId) ? qsId : null) ??
    portfolios.find((p) => /north/i.test(p.name))?.id ??
    portfolios[0]?.id ??
    "";
  const [workSource, setWorkSource] = useState<WorkSourceFilter>("all");
  const params = workSource === "all" ? undefined : { workSource };
  const doc = useGetPortfolioCostToServe(id || "pending", params, {
    query: {
      enabled: Boolean(id),
      queryKey: getGetPortfolioCostToServeQueryKey(id || "pending", params),
    },
  });

  return (
    <CostToServe
      doc={doc.data}
      loading={doc.isLoading || list.isLoading}
      errorMessage={(doc.error as { error?: string } | undefined)?.error}
      workSource={workSource}
      onWorkSource={setWorkSource}
      homeHref={{
        label: "Portfolio",
        onClick: () => navigate(id ? `/portfolio?id=${id}` : "/portfolio"),
      }}
    />
  );
}
