import { useLocation, useParams } from "wouter";
import {
  useListClientEntrataImports,
  importClientEntrataCsv,
  getClientEntrataCsvTemplate,
  getListClientEntrataImportsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { EntrataImport, idempotencyHeaders } from "@workspace/board-ui";
import { useSessionExchange } from "@/hooks/useSessionExchange";

export default function ClientEntrataImportPage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  useSessionExchange(token);
  const queryClient = useQueryClient();
  const list = useListClientEntrataImports(token || "pending", {
    query: { enabled: Boolean(token), queryKey: getListClientEntrataImportsQueryKey(token || "pending") },
  });

  return (
    <EntrataImport
      adapter={list.data?.adapter}
      imports={list.data?.imports}
      loading={list.isLoading}
      onImport={async (kind, filename, csv) => {
        if (!token) throw new Error("No session");
        await importClientEntrataCsv(token, { kind, filename, csv }, { headers: idempotencyHeaders() });
        void queryClient.invalidateQueries({ queryKey: getListClientEntrataImportsQueryKey(token) });
      }}
      onTemplate={async (kind) => {
        if (!token) return;
        const doc = await getClientEntrataCsvTemplate(token, kind);
        const blob = new Blob([doc.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
      }}
      homeHref={{ label: "Pulse", onClick: () => setLocation(`/${token}`) }}
    />
  );
}
