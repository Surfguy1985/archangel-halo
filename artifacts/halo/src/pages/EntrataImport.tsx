import { useLocation } from "wouter";
import {
  useListEntrataImports,
  importEntrataCsv,
  getEntrataCsvTemplate,
  getListEntrataImportsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { EntrataImport, idempotencyHeaders } from "@workspace/board-ui";

export default function EntrataImportPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const list = useListEntrataImports();

  return (
    <EntrataImport
      adapter={list.data?.adapter}
      imports={list.data?.imports}
      loading={list.isLoading}
      onImport={async (kind, filename, csv) => {
        await importEntrataCsv({ kind, filename, csv }, { headers: idempotencyHeaders() });
        void queryClient.invalidateQueries({ queryKey: getListEntrataImportsQueryKey() });
      }}
      onTemplate={async (kind) => {
        const doc = await getEntrataCsvTemplate(kind);
        const blob = new Blob([doc.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
      }}
      homeHref={{ label: "Portfolio", onClick: () => navigate("/portfolio") }}
    />
  );
}
