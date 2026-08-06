import { useMemo, useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import { Minus, Plus, X} from "lucide-react";
import {
  useAddJobLineItem,
  useUpdateJobLineItem,
  useDeleteJobLineItem,
  useSwapJobLineItem,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";
import { useToast} from "@/hooks/use-toast";

type LineItem = {
  id: string;
  priceItemId?: string | null;
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
  const { toast} = useToast();
  const [selectedId, setSelectedId] = useState("");
  const add = useAddJobLineItem();
  const update = useUpdateJobLineItem();
  const del = useDeleteJobLineItem();
  const swap = useSwapJobLineItem();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId)});
  const onError = (err: Error) =>
    toast({ title: "Couldn't update line items", description: err.message, variant: "destructive"});

  const total = lineItems.reduce((s, li) => s + li.amount, 0);
  const busy = add.isPending || update.isPending || del.isPending || swap.isPending;

  // Master price list organized into containers — same grouping as Quick Job:
  // "1/2/3 Bedroom" submenus (service names stripped of their BR suffix) plus
  // an "Other services" group, each sorted alphabetically.
  const serviceGroups = useMemo(() => {
    const strip = (s: string) => s.replace(/\s*[—–-]\s*\d\s*BR\s*$/i, "").trim();
    const sizeOf = (pi: PriceItemOption): number | null => {
      const m = /(\d)\s*BR\s*$/i.exec(pi.service) ?? /^(\d)\s*BR$/i.exec(pi.unit ?? "");
      return m ? Number(m[1]) : null;
    };
    const bySize = new Map<number, PriceItemOption[]>();
    const other: PriceItemOption[] = [];
    for (const pi of priceItems) {
      const n = sizeOf(pi);
      if (n == null) other.push(pi);
      else bySize.set(n, [...(bySize.get(n) ?? []), pi]);
    }
    const groups = [...bySize.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, items]) => ({
        label: `${n} Bedroom`,
        items: items
          .map((pi) => ({ pi, name: strip(pi.service) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
    if (other.length > 0)
      groups.push({
        label: "Other services",
        items: other
          .map((pi) => ({ pi, name: pi.service }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    return groups;
  }, [priceItems]);

  // Bedroom-size families: base service name → sorted size variants. Line
  // items whose service has sibling BR sizes swap variant via the stepper
  // (the +/- picks the bedroom count, not a quantity).
  const brFamilies = useMemo(() => {
    const strip = (s: string) => s.replace(/\s*[—–-]\s*\d\s*BR\s*$/i, "").trim();
    const map = new Map<string, { size: number; pi: PriceItemOption }[]>();
    for (const pi of priceItems) {
      const m = /(\d)\s*BR\s*$/i.exec(pi.service) ?? /^(\d)\s*BR$/i.exec(pi.unit ?? "");
      if (!m) continue;
      const base = strip(pi.service);
      map.set(base, [...(map.get(base) ?? []), { size: Number(m[1]), pi }]);
    }
    for (const [k, v] of map) {
      v.sort((a, b) => a.size - b.size);
      if (v.length < 2) map.delete(k);
    }
    return map;
  }, [priceItems]);

  const stripBr = (s: string) => s.replace(/\s*[—–-]\s*\d\s*BR\s*$/i, "").trim();
  const sizeOfService = (s: string): number | null => {
    const m = /(\d)\s*BR\s*$/i.exec(s);
    return m ? Number(m[1]) : null;
  };

  /** Swap a line item to the adjacent bedroom-size variant. One atomic
   *  server call: retargets the row in place, or folds its qty into an
   *  existing row for the target size — never a partial add/delete. */
  const swapBrSize = (li: LineItem, target: PriceItemOption) => {
    swap.mutate(
      { id: li.id, data: { priceItemId: target.id } },
      { onSuccess: refresh, onError },
    );
  };

  return (
    <div className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2.5">
      {lineItems.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-2">
          {lineItems.map((li) => {
            // BR-sized services: the stepper walks bedroom sizes (1 BR ↔ 2 BR ↔ 3 BR)
            // instead of quantity — "Basic Carpet Clean · BR − 2 +".
            const base = stripBr(li.service);
            const size = sizeOfService(li.service);
            const family = size != null ? brFamilies.get(base) : undefined;
            const idx = family ? family.findIndex((v) => v.size === size) : -1;
            const smaller = family && idx > 0 ? family[idx - 1] : undefined;
            const larger = family && idx >= 0 && idx < family.length - 1 ? family[idx + 1] : undefined;
            const isBr = !!family && idx >= 0;
            return (
            <div key={li.id} className="flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{isBr ? base : li.service}</div>
                <div className="text-xs text-muted-foreground">
                  ${li.rate.toLocaleString()}{li.unit ?`/${li.unit}` : ""}
                </div>
              </div>
              {isBr ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">BR</span>
                  <button
                    aria-label="Smaller bedroom size"
                    disabled={busy || !smaller}
                    onClick={() => smaller && swapBrSize(li, smaller.pi)}
                    className="w-6 h-6 rounded-full bg-card border border-border grid place-items-center text-muted-foreground disabled:opacity-40 hover:bg-black/[0.04]"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-6 text-center font-semibold tabular-nums">{size}</span>
                  <button
                    aria-label="Larger bedroom size"
                    disabled={busy || !larger}
                    onClick={() => larger && swapBrSize(li, larger.pi)}
                    className="w-6 h-6 rounded-full bg-card border border-border grid place-items-center text-muted-foreground disabled:opacity-40 hover:bg-black/[0.04]"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              ) : (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  aria-label="Decrease quantity"
                  disabled={busy || li.qty <= 1}
                  onClick={() =>
                    update.mutate({ id: li.id, data: { qty: li.qty - 1}}, { onSuccess: refresh, onError})
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
                    update.mutate({ id: li.id, data: { qty: li.qty + 1}}, { onSuccess: refresh, onError})
                 }
                  className="w-6 h-6 rounded-full bg-card border border-border grid place-items-center text-muted-foreground disabled:opacity-40 hover:bg-black/[0.04]"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              )}
              <div className="w-20 text-right font-mono font-semibold tabular-nums shrink-0">
                ${li.amount.toLocaleString()}
              </div>
              <button
                aria-label="Remove line item"
                disabled={busy}
                onClick={() => del.mutate({ id: li.id}, { onSuccess: refresh, onError})}
                className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-muted-foreground/70 hover:text-foreground hover:bg-black/[0.05]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            );
          })}
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
            {serviceGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map(({ pi, name }) => (
                  <option key={pi.id} value={pi.id}>
                    {name} — ${pi.rate.toLocaleString()}{pi.unit ? `/${pi.unit}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            disabled={!selectedId || busy}
            onClick={() => {
              // If this price item is already on the job, bump its quantity
              // instead of creating a duplicate row.
              const existing = lineItems.find((li) => li.priceItemId === selectedId);
              if (existing) {
                update.mutate(
                  { id: existing.id, data: { qty: existing.qty + 1}},
                  { onSuccess: () => { setSelectedId(""); refresh();}, onError},
                );
                return;
             }
              add.mutate(
                { id: jobId, data: { priceItemId: selectedId, qty: 1}},
                {
                  onSuccess: () => {
                    setSelectedId("");
                    refresh();
                 },
                  onError,
               },
              );
           }}
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
