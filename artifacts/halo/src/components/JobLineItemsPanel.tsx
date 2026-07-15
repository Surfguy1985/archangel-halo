import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, X } from "lucide-react";
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
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });

  const total = lineItems.reduce((s, li) => s + li.amount, 0);
  const busy = add.isPending || update.isPending || del.isPending;

  return (
    <div className="mt-[8px] mb-[4px] rounded-[12px] bg-[rgba(23,24,28,0.03)] p-[10px_12px]">
      {lineItems.length > 0 && (
        <div className="flex flex-col gap-[6px] mb-[8px]">
          {lineItems.map((li) => (
            <div key={li.id} className="flex items-center gap-[8px] text-[13px]">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{li.service}</div>
                <div className="text-[11.5px] text-muted-foreground">
                  ${li.rate.toLocaleString()}{li.unit ? `/${li.unit}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-[6px] shrink-0">
                <button
                  aria-label="Decrease quantity"
                  disabled={busy || li.qty <= 1}
                  onClick={() =>
                    update.mutate({ id: li.id, data: { qty: li.qty - 1 } }, { onSuccess: refresh })
                  }
                  className="w-[24px] h-[24px] rounded-full bg-card border border-border grid place-items-center text-muted-foreground disabled:opacity-40 active:scale-[0.92]"
                >
                  <Minus className="w-[12px] h-[12px]" />
                </button>
                <span className="w-[22px] text-center font-semibold tabular-nums">{li.qty}</span>
                <button
                  aria-label="Increase quantity"
                  disabled={busy}
                  onClick={() =>
                    update.mutate({ id: li.id, data: { qty: li.qty + 1 } }, { onSuccess: refresh })
                  }
                  className="w-[24px] h-[24px] rounded-full bg-card border border-border grid place-items-center text-muted-foreground disabled:opacity-40 active:scale-[0.92]"
                >
                  <Plus className="w-[12px] h-[12px]" />
                </button>
              </div>
              <div className="w-[64px] text-right font-display font-semibold tabular-nums shrink-0">
                ${li.amount.toLocaleString()}
              </div>
              <button
                aria-label="Remove line item"
                disabled={busy}
                onClick={() => del.mutate({ id: li.id }, { onSuccess: refresh })}
                className="shrink-0 w-[22px] h-[22px] rounded-full grid place-items-center text-muted-foreground/70 active:scale-[0.9]"
              >
                <X className="w-[13px] h-[13px]" />
              </button>
            </div>
          ))}
        </div>
      )}

      {priceItems.length > 0 ? (
        <div className="flex items-center gap-[8px]">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="flex-1 min-w-0 bg-card border border-border rounded-[10px] py-[8px] px-[10px] text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
          >
            <option value="">Add from price list…</option>
            {priceItems.map((p) => (
              <option key={p.id} value={p.id}>
                {p.service} — ${p.rate.toLocaleString()}{p.unit ? `/${p.unit}` : ""}
              </option>
            ))}
          </select>
          <button
            disabled={!selectedId || busy}
            onClick={() =>
              add.mutate(
                { id: jobId, data: { priceItemId: selectedId, qty: 1 } },
                {
                  onSuccess: () => {
                    setSelectedId("");
                    refresh();
                  },
                },
              )
            }
            className="shrink-0 rounded-[10px] px-[12px] py-[8px] text-[13px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] disabled:opacity-50 active:scale-[0.96]"
          >
            Add
          </button>
        </div>
      ) : (
        <div className="text-[12px] text-muted-foreground">
          Add items to the price list first, then attach them to this job.
        </div>
      )}

      {lineItems.length > 0 && (
        <div className="flex items-center justify-between mt-[8px] pt-[8px] border-t border-border text-[13px]">
          <span className="font-semibold text-muted-foreground">Job total</span>
          <span className="font-display font-bold tabular-nums">${total.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
