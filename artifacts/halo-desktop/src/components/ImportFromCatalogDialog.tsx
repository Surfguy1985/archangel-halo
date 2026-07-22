import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCatalogItems,
  useImportPriceItems,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";
import { Search, BookOpen, Check } from "lucide-react";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export function ImportFromCatalogDialog({
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Add from master price list</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full bg-background border border-border rounded-md py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
            placeholder="Search services…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-[320px] overflow-y-auto border border-border rounded-lg divide-y divide-border">
          {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {q ? (
                "No services match your search."
              ) : (
                <>
                  Your master list is empty.{" "}
                  <Link href="/catalog" className="text-[var(--gold-dark)] font-semibold hover:underline" onClick={() => onOpenChange(false)}>
                    Add services here
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
                className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${already ? "opacity-45 cursor-not-allowed" : "hover:bg-black/[0.02]"}`}
              >
                <div
                  className={`w-5 h-5 rounded border shrink-0 grid place-items-center transition-colors ${checked ? "bg-[var(--gold)] border-[var(--gold)]" : "border-border bg-background"}`}
                >
                  {checked && <Check className="w-3.5 h-3.5 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[var(--ink)]">{item.service}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {already ? "Already on this property" : item.detail || item.category || ""}
                  </div>
                </div>
                <div className="font-mono font-bold text-sm shrink-0">
                  {item.rate != null ? `$${item.rate}` : "—"}
                  {item.unit && <span className="text-xs text-muted-foreground font-sans font-normal"> /{item.unit}</span>}
                </div>
              </button>
            );
          })}
        </div>
        {importMut.isError && (
          <div className="text-xs text-destructive">Couldn't add those services. Try again.</div>
        )}
        <DialogFooter className="items-center gap-3">
          <Link
            href="/catalog"
            onClick={() => onOpenChange(false)}
            className="mr-auto flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
          >
            <BookOpen className="w-4 h-4" /> Manage master list
          </Link>
          <button
            onClick={submit}
            disabled={selected.size === 0 || importMut.isPending}
            className="bg-[var(--gold)] text-white px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm disabled:opacity-50"
          >
            {importMut.isPending ? "Adding…" : `Add ${selected.size || ""} selected`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
