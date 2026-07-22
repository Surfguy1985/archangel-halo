import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCatalogItems,
  useCreateCatalogItem,
  useUpdateCatalogItem,
  useDeleteCatalogItem,
  getListCatalogItemsQueryKey,
  type CatalogItem,
} from "@workspace/api-client-react";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const fieldCls =
  "w-full bg-background border border-border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

const SERVICE_CATEGORIES = [
  "Make Ready",
  "Paint",
  "Resurfacing",
  "Roof Repair/Replacement",
  "Electrical",
  "Plumbing",
  "Landscaping",
  "Cleaning",
  "Firewatch",
  "A/C Repairs",
  "General Handyman",
] as const;

const OTHER_SERVICE = "__other__";

function CatalogItemDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: CatalogItem | null;
}) {
  const queryClient = useQueryClient();
  const [serviceChoice, setServiceChoice] = useState(
    item?.service
      ? (SERVICE_CATEGORIES as readonly string[]).includes(item.service)
        ? item.service
        : OTHER_SERVICE
      : "",
  );
  const [customService, setCustomService] = useState(
    item?.service && !(SERVICE_CATEGORIES as readonly string[]).includes(item.service)
      ? item.service
      : "",
  );
  const service = serviceChoice === OTHER_SERVICE ? customService : serviceChoice;
  const [detail, setDetail] = useState(item?.detail ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "each");
  const [rate, setRate] = useState(item && item.rate != null ? String(item.rate) : "");
  const [category, setCategory] = useState(item?.category ?? "");
  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem();
  const pending = create.isPending || update.isPending;

  const submit = () => {
    const rateNum = rate.trim() === "" ? null : parseFloat(rate);
    if (!service.trim() || (rateNum !== null && isNaN(rateNum))) return;
    const onSuccess = () => {
      queryClient.invalidateQueries({ queryKey: getListCatalogItemsQueryKey() });
      onOpenChange(false);
    };
    if (item) {
      update.mutate(
        {
          id: item.id,
          data: {
            service: service.trim(),
            detail: detail.trim() || null,
            unit: unit.trim() || null,
            rate: rateNum,
            category: category.trim() || null,
          },
        },
        { onSuccess },
      );
    } else {
      create.mutate(
        {
          data: {
            service: service.trim(),
            detail: detail.trim() || undefined,
            unit: unit.trim() || undefined,
            rate: rateNum ?? undefined,
            category: category.trim() || undefined,
          },
        },
        { onSuccess },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {item ? "Edit service" : "Add service to master list"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Service</label>
            <select className={fieldCls} value={serviceChoice} onChange={(e) => setServiceChoice(e.target.value)} autoFocus>
              <option value="">Select a service…</option>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={OTHER_SERVICE}>Other…</option>
            </select>
          </div>
          {serviceChoice === OTHER_SERVICE && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Service name</label>
              <input className={fieldCls} placeholder="Type the service name" value={customService} onChange={(e) => setCustomService(e.target.value)} />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Detail (optional)</label>
            <input className={fieldCls} placeholder="What's included" value={detail} onChange={(e) => setDetail(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Rate (optional)</label>
              <input className={fieldCls} placeholder="0.00" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Unit</label>
              <input className={fieldCls} placeholder="each" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Category</label>
              <input className={fieldCls} placeholder="optional" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          </div>
          {(create.isError || update.isError) && (
            <div className="text-xs text-destructive">Couldn't save. Check the fields and try again.</div>
          )}
        </div>
        <DialogFooter>
          <button
            onClick={submit}
            disabled={!service.trim() || pending}
            className="bg-[var(--gold)] text-white px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm disabled:opacity-50"
          >
            {pending ? "Saving…" : item ? "Save changes" : "Add service"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Catalog() {
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useListCatalogItems();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<CatalogItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<CatalogItem | null>(null);
  const del = useDeleteCatalogItem();

  const q = search.trim().toLowerCase();
  const filtered = (items ?? []).filter(
    (i) =>
      !q ||
      i.service.toLowerCase().includes(q) ||
      (i.detail ?? "").toLowerCase().includes(q) ||
      (i.category ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Master Price List</h1>
          <p className="text-muted-foreground">Your services and standard prices — every property can pull from here.</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 bg-[var(--gold)] text-white px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Service
        </button>
      </header>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className="w-full bg-card border border-border rounded-md py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
          placeholder="Search services…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--paper)] border-b border-border">
              <tr>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Service</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Category</th>
                <th className="px-6 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs text-right">Rate</th>
                <th className="px-6 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-black/[0.02] transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-[var(--ink)]">{item.service}</div>
                    {item.detail && <div className="text-muted-foreground text-xs mt-0.5">{item.detail}</div>}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">{item.category || "—"}</td>
                  <td className="px-6 py-4 text-right font-mono font-bold">
                    {item.rate != null ? `$${item.rate}` : "—"}
                    {item.unit && <span className="text-xs text-muted-foreground font-sans font-normal"> /{item.unit}</span>}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        aria-label="Edit service"
                        onClick={() => setEditItem(item)}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-black/[0.05] transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        aria-label="Delete service"
                        onClick={() => setDeleteItem(item)}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">
                    {q ? "No services match your search." : "No services yet. Add your standard services and prices here once — then pull them into any property's price list."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && <CatalogItemDialog open onOpenChange={setAddOpen} item={null} />}
      {editItem && (
        <CatalogItemDialog open onOpenChange={(o) => !o && setEditItem(null)} item={editItem} />
      )}

      <Dialog open={!!deleteItem} onOpenChange={(o) => !o && setDeleteItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Remove "{deleteItem?.service}"?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes it from the master list only. Prices already added to properties stay unchanged.
          </p>
          <DialogFooter>
            <button
              onClick={() => setDeleteItem(null)}
              className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-black/[0.03] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!deleteItem) return;
                del.mutate(
                  { id: deleteItem.id },
                  {
                    onSuccess: () => {
                      queryClient.invalidateQueries({ queryKey: getListCatalogItemsQueryKey() });
                      setDeleteItem(null);
                    },
                  },
                );
              }}
              disabled={del.isPending}
              className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {del.isPending ? "Removing…" : "Remove"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
