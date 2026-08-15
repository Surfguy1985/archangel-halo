import { useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetClientPortfolioCostToServe,
  getGetClientPortfolioCostToServeQueryKey,
  type WorkSourceFilter,
} from "@workspace/api-client-react";
import { CostToServe } from "@workspace/board-ui";
import { useSessionExchange } from "@/hooks/useSessionExchange";

export default function ClientHowWorkPage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  useSessionExchange(token);
  const [workSource, setWorkSource] = useState<WorkSourceFilter>("all");
  const params = workSource === "all" ? undefined : { workSource };
  const doc = useGetClientPortfolioCostToServe(token || "pending", params, {
    query: {
      enabled: Boolean(token),
      queryKey: getGetClientPortfolioCostToServeQueryKey(token || "pending", params),
    },
  });

  return (
    <CostToServe
      doc={doc.data}
      loading={doc.isLoading}
      errorMessage={(doc.error as { error?: string } | undefined)?.error}
      workSource={workSource}
      onWorkSource={setWorkSource}
      homeHref={{ label: "Pulse", onClick: () => setLocation(`/${token}`) }}
    />
  );
}
