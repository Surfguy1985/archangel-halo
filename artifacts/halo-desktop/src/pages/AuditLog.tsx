import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useListClientPortfolios,
  useGetPortfolioAudit,
  getGetPortfolioAuditQueryKey,
  getExportPortfolioAuditUrl,
} from "@workspace/api-client-react";
import { AuditLog } from "@workspace/board-ui";

export default function AuditLogPage() {
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
  const [entityType, setEntityType] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = {
    ...(entityType ? { entityType } : {}),
    ...(actorId ? { actorId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const queryParams = Object.keys(params).length > 0 ? params : undefined;
  const doc = useGetPortfolioAudit(id || "pending", queryParams, {
    query: {
      enabled: Boolean(id),
      queryKey: getGetPortfolioAuditQueryKey(id || "pending", queryParams),
    },
  });

  return (
    <AuditLog
      doc={doc.data}
      loading={doc.isLoading || list.isLoading}
      errorMessage={(doc.error as { error?: string } | undefined)?.error}
      entityType={entityType}
      actorId={actorId}
      from={from}
      to={to}
      onEntityType={setEntityType}
      onActorId={setActorId}
      onFrom={setFrom}
      onTo={setTo}
      onExport={() => {
        if (!id) return;
        window.open(getExportPortfolioAuditUrl(id, queryParams), "_blank", "noopener,noreferrer");
      }}
      homeHref={{
        label: "Portfolio",
        onClick: () => navigate(id ? `/portfolio?id=${id}` : "/portfolio"),
      }}
    />
  );
}
