import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCatalogItems,
  useImportPriceItems,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Check, Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function ImportFromCatalogSheet({
  open,
  onOpenChange,
  propertyId,
  existingServices,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  existingServices: string[];
}) {
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useListCatalogItems();
  const importMut = useImportPriceItems();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const existing = new Set(existingServices.map((s) => s.trim().toLowerCase()));
  const q = search.trim().toLowerCase();
  const filtered = (items ?? []).filter(
    (i) =>
      !q ||
      i.service.toLowerCase().includes(q) ||
      (i.detail ?? "").toLowerCase().includes(q) ||
      (i.category ?? "").toLowerCase().includes(q),
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    if (selected.size === 0) return;
    importMut.mutate(
      { id: propertyId, data: { catalogItemIds: Array.from(selected) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          setSelected(new Set());
          setSearch("");
          onOpenChange(false);
        },
      },
    );
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setSelected(new Set());
      setSearch("");
    }
    onOpenChange(o);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto flex flex-col min-h-0">
          <SheetHeader className="text-left mb-[12px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Add from Price Book</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Pick services — the standard rates come with them.</div>
          </SheetHeader>

          <div className="relative mb-[10px]">
            <Search className="w-[16px] h-[16px] absolute left-[13px] top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[10px] pl-[38px] pr-[14px] text-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
              placeholder="Search services…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="bg-card rounded-[16px] border border-[var(--hairline)] divide-y divide-border overflow-y-auto max-h-[42vh]">
            {isLoading && <div className="p-[16px] text-[13px] text-muted-foreground">Loading…</div>}
            {!isLoading && filtered.length === 0 && (
              <div className="p-[22px] text-center text-[13px] text-muted-foreground">
                {q ? (
                  "No services match your search."
                ) : (
                  <>
                    Your Price Book is empty.{" "}
                    <Link href="/catalog" className="text-[var(--gold-dark)] font-semibold underline" onClick={() => onOpenChange(false)}>
                      Add services
                    </Link>{" "}
                    first.
                  </>
                )}
              </div>
            )}
            {filtered.map((item) => {
              const already = existing.has(item.service.trim().toLowerCase());
              const checked = selected.has(item.id);
              return (
                <button
                  key={item.id}
                  disabled={already}
                  onClick={() => toggle(item.id)}
                  className={`w-full flex items-center gap-[12px] p-[13px] text-left ${already ? "opacity-45" : "active:bg-black/[0.03]"}`}
                >
                  <div
                    className={`w-[22px] h-[22px] rounded-[7px] border shrink-0 grid place-items-center transition-colors ${checked ? "bg-[var(--gold-light)] border-[var(--gold)]" : "border-[var(--hairline)] bg-background"}`}
                  >
                    {checked && <Check className="w-[15px] h-[15px] text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[14px]">{item.service}</div>
                    <div className="text-[12px] text-muted-foreground truncate">
                      {already ? "Already on this property" : item.detail || item.category || ""}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-[13.5px] shrink-0">
                    {item.rate != null ? `$${item.rate}` : "—"}
                    {item.unit && <span className="text-[11px] text-muted-foreground font-sans font-normal"> /{item.unit}</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {importMut.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't add those services. Try again.</div>
          )}

          <button
            className="w-full mt-[14px] rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={selected.size === 0 || importMut.isPending}
          >
            {importMut.isPending ? "Adding…" : selected.size > 0 ? `Add ${selected.size} selected` : "Select services to add"}
          </button>
          <Link
            href="/catalog"
            onClick={() => onOpenChange(false)}
            className="text-center text-[13px] font-semibold text-[var(--gold-dark)] mt-[12px]"
          >
            Manage Price Book
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
