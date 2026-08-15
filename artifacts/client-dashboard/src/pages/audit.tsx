import { useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetClientPortfolioAudit,
  getGetClientPortfolioAuditQueryKey,
  getExportClientPortfolioAuditUrl,
} from "@workspace/api-client-react";
import { AuditLog } from "@workspace/board-ui";
import { useSessionExchange } from "@/hooks/useSessionExchange";

export default function ClientAuditLogPage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  useSessionExchange(token);
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
  const doc = useGetClientPortfolioAudit(token || "pending", queryParams, {
    query: {
      enabled: Boolean(token),
      queryKey: getGetClientPortfolioAuditQueryKey(token || "pending", queryParams),
    },
  });

  return (
    <AuditLog
      doc={doc.data}
      loading={doc.isLoading}
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
        if (!token) return;
        window.open(getExportClientPortfolioAuditUrl(token, queryParams), "_blank", "noopener,noreferrer");
      }}
      homeHref={{
        label: "Portfolio",
        onClick: () => setLocation(`/${token}`),
      }}
    />
  );
}
