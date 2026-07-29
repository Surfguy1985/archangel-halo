import { useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import { Minus, Plus, X} from "lucide-react";
import {
  useAddJobLineItem,
  useUpdateJobLineItem,
  useDeleteJobLineItem,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";

type LineItem = {
  id: string;
  service: string;
  unit?: string | null;
  rate: number;
  qty: number;
  amount: number;
};

type PriceItemOption = {
  id: string;
  service: string;
  rate: number;
  unit?: string | null;
};

export function JobLineItemsPanel({
  jobId,
  propertyId,
  lineItems,
  priceItems,
}: {
  jobId: string;
  propertyId: string;
  lineItems: LineItem[];
  priceItems: PriceItemOption[];
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const add = useAddJobLineItem();
  const update = useUpdateJobLineItem();
  const del = useDeleteJobLineItem();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId)});

  const total = lineItems.reduce((s, li) => s + li.amount, 0);
  const busy = add.isPending || update.isPending || del.isPending;

  return (
    <div className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2.5">
      {lineItems.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-2">
          {lineItems.map((li) => (
            <div key={li.id} className="flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{li.service}</div>
                <div className="text-xs text-muted-foreground">
                  ${li.rate.toLocaleString()}{li.unit ?`/${li.unit}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  aria-label="Decrease quantity"
                  disabled={busy || li.qty <= 1}
                  onClick={() =>
                    update.mutate({ id: li.id, data: { qty: li.qty - 1}}, { onSuccess: refresh})
                 }
                  className="w-6 h-6 rounded-full bg-card border border-border grid place-items-center text-muted-foreground disabled:opacity-40 hover:bg-black/[0.04]"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="w-6 text-center font-semibold tabular-nums">{li.qty}</span>
                <button
                  aria-label="Increase quantity"
                  disabled={busy}
                  onClick={() =>
                    update.mutate({ id: li.id, data: { qty: li.qty + 1}}, { onSuccess: refresh})
                 }
                  className="w-6 h-6 rounded-full bg-card border border-border grid place-items-center text-muted-foreground disabled:opacity-40 hover:bg-black/[0.04]"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <div className="w-20 text-right font-mono font-semibold tabular-nums shrink-0">
                ${li.amount.toLocaleString()}
              </div>
              <button
                aria-label="Remove line item"
                disabled={busy}
                onClick={() => del.mutate({ id: li.id}, { onSuccess: refresh})}
                className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-muted-foreground/70 hover:text-foreground hover:bg-black/[0.05]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {priceItems.length > 0 ? (
        <div className="flex items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="flex-1 min-w-0 bg-white border border-border rounded-[11px] py-1.5 px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
          >
            <option value="">Add from price list…</option>
            {priceItems.map((p) => (
              <option key={p.id} value={p.id}>
                {p.service} — ${p.rate.toLocaleString()}{p.unit ?`/${p.unit}` : ""}
              </option>
            ))}
          </select>
          <button
            disabled={!selectedId || busy}
            onClick={() =>
              add.mutate(
                { id: jobId, data: { priceItemId: selectedId, qty: 1}},
                {
                  onSuccess: () => {
                    setSelectedId("");
                    refresh();
                 },
               },
              )
           }
            className="shrink-0 rounded-md px-3 py-1.5 text-sm font-semibold text-[var(--ink)] bg-[var(--primary)] disabled:opacity-50 hover:brightness-105"
          >
            Add
          </button>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          Add items to the price list first, then attach them to this job.
        </div>
      )}

      {lineItems.length > 0 && (
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border text-sm">
          <span className="font-semibold text-muted-foreground">Job total</span>
          <span className="font-mono font-bold tabular-nums">${total.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
