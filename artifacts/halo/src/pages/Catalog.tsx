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
import { Link } from "wouter";
import { ChevronLeft, Plus, Pencil, Search, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

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

function CatalogItemSheet({
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem();
  const del = useDeleteCatalogItem();
  const pending = create.isPending || update.isPending;

  const done = () => {
    queryClient.invalidateQueries({ queryKey: getListCatalogItemsQueryKey() });
    onOpenChange(false);
  };

  const submit = () => {
    const rateNum = rate.trim() === "" ? null : parseFloat(rate);
    if (!service.trim() || (rateNum !== null && isNaN(rateNum))) return;
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
        { onSuccess: done },
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
        { onSuccess: done },
      );
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
              {item ? "Edit service" : "Add service"}
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              Standard price — every property can pull from this list.
            </div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <select className={fieldCls} value={serviceChoice} onChange={(e) => setServiceChoice(e.target.value)} autoFocus={!item}>
              <option value="">Select a service…</option>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={OTHER_SERVICE}>Other…</option>
            </select>
            {serviceChoice === OTHER_SERVICE && (
              <input className={fieldCls} placeholder="Type the service name" value={customService} onChange={(e) => setCustomService(e.target.value)} />
            )}
            <input className={fieldCls} placeholder="Detail (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
            <div className="flex gap-[10px]">
              <input className={`${fieldCls} flex-1`} placeholder="Rate (optional)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              <input className={`${fieldCls} w-[110px]`} placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <input className={fieldCls} placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!service.trim() || pending}
          >
            {pending ? "Saving…" : item ? "Save changes" : "Add service"}
          </button>
          {item && (
            <button
              className="w-full mt-[10px] rounded-[13px] py-[12px] font-display font-bold text-[14px] text-destructive border border-destructive/30 bg-transparent disabled:opacity-50 transition-transform active:scale-[0.98]"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                del.mutate({ id: item.id }, { onSuccess: done });
              }}
              disabled={del.isPending}
            >
              {del.isPending ? "Removing…" : confirmDelete ? "Tap again to confirm removal" : "Remove from master list"}
            </button>
          )}
          {(create.isError || update.isError || del.isError) && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Catalog() {
  const { data: items, isLoading } = useListCatalogItems();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<CatalogItem | null>(null);

  const q = search.trim().toLowerCase();
  const filtered = (items ?? []).filter(
    (i) =>
      !q ||
      i.service.toLowerCase().includes(q) ||
      (i.detail ?? "").toLowerCase().includes(q) ||
      (i.category ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="px-[18px] pb-[110px] pt-[14px] max-w-[560px] mx-auto">
      <div className="flex items-center gap-[10px] mb-[14px]">
        <Link href="/" className="w-[36px] h-[36px] rounded-full grid place-items-center bg-card border border-border shadow-[var(--shadow)]">
          <ChevronLeft className="w-[19px] h-[19px]" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-[21px] leading-tight">Price Book</h1>
          <div className="text-[12.5px] text-muted-foreground">Master list of services & prices</div>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          aria-label="Add service"
          className="w-[36px] h-[36px] rounded-full grid place-items-center text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] active:scale-[0.95] transition-transform"
        >
          <Plus className="w-[19px] h-[19px]" />
        </button>
      </div>

      <div className="relative mb-[12px]">
        <Search className="w-[16px] h-[16px] absolute left-[13px] top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className="w-full bg-card border border-border rounded-[13px] py-[10px] pl-[38px] pr-[14px] text-[14px] shadow-[var(--shadow)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
          placeholder="Search services…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-[16px]" />
      ) : (
        <div className="bg-card rounded-[16px] shadow-[var(--shadow)] border border-border divide-y divide-border">
          {filtered.map((item) => (
            <div key={item.id} className="flex items-center gap-[12px] p-[14px]">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14.5px]">{item.service}</div>
                <div className="text-[12.5px] text-muted-foreground truncate">
                  {[item.detail, item.category].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-bold text-[14.5px]">{item.rate != null ? `$${item.rate}` : "—"}</div>
                {item.unit && <div className="text-[11px] text-muted-foreground">/{item.unit}</div>}
              </div>
              <button
                aria-label="Edit service"
                onClick={() => setEditItem(item)}
                className="shrink-0 w-[32px] h-[32px] rounded-full flex items-center justify-center text-muted-foreground active:bg-black/[0.05] transition-colors"
              >
                <Pencil className="w-[14px] h-[14px]" />
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="p-[26px] text-center text-[13px] text-muted-foreground">
              {q ? "No services match your search." : "No services yet. Add your standard services and prices once — then pull them into any property."}
            </div>
          )}
        </div>
      )}

      {addOpen && <CatalogItemSheet open onOpenChange={setAddOpen} item={null} />}
      {editItem && (
        <CatalogItemSheet open onOpenChange={(o) => !o && setEditItem(null)} item={editItem} />
      )}
    </div>
  );
}
