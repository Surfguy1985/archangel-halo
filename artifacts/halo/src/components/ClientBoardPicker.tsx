/**
 * ClientBoardPicker — "which client's board?" chooser.
 *
 * Client boards are per-property, so a link from the main page has to answer
 * that question before it can go anywhere. When only one property has a client
 * account there is nothing to ask, so we skip straight to the board.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { LayoutGrid, ChevronRight, X, Loader2 } from "lucide-react";
import {
  useListClientAccounts,
  getListClientAccountsQueryKey,
} from "@workspace/api-client-react";

export function ClientBoardPicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const { data: accounts, isLoading } = useListClientAccounts({
    query: { queryKey: getListClientAccountsQueryKey(), enabled: open },
  });

  const list = accounts ?? [];
  const only = list.length === 1 ? list[0] : null;

  // One account: don't make them tap a list of one.
  useEffect(() => {
    if (!open || !only) return;
    onOpenChange(false);
    navigate(`/properties/${only.propertyId}/board`);
  }, [open, only, navigate, onOpenChange]);

  const go = (propertyId: string) => {
    onOpenChange(false);
    navigate(`/properties/${propertyId}/board`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[20px] border-none flex flex-col"
        style={{
          background: "#0C1828",
          boxShadow: "0 -1px 0 rgba(255,255,255,0.07)",
          maxHeight: "72vh",
          padding: 0,
        }}
      >
        <div className="w-10 h-1 rounded-full bg-white/[0.12] mx-auto mt-3 mb-2 shrink-0" />

        <div className="px-4 pb-8 overflow-y-auto">
          <div className="flex items-center justify-between py-3 mb-1">
            <div>
              <div className="text-[15px] font-semibold text-white/85">Client board</div>
              <div className="text-[11.5px] text-white/35">Open what the client sees</div>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="w-7 h-7 rounded-full bg-white/[0.06] grid place-items-center text-white/40 hover:text-white/70"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {isLoading ? (
            <div className="py-10 grid place-items-center text-white/30">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : list.length === 0 ? (
            <div className="py-10 text-center text-[12.5px] text-white/35">
              No client accounts yet — add a property first, then its board opens here.
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((a) => (
                <button
                  key={a.propertyId}
                  type="button"
                  onClick={() => go(a.propertyId)}
                  data-testid={`link-client-board-${a.propertyId}`}
                  className="w-full flex items-center gap-3 rounded-[13px] bg-white/[0.04] border border-white/[0.07] px-4 py-3.5 text-left active:scale-[0.99] transition-transform"
                >
                  <div className="w-8 h-8 rounded-full bg-[#B4FF44] grid place-items-center shrink-0 overflow-hidden">
                    {a.logoPath ? (
                      <img src={`/api/storage${a.logoPath}`} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <LayoutGrid className="w-4 h-4 text-[#07101E]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-white/80 truncate">{a.propertyName}</div>
                    <div className="text-[11.5px] text-white/35 truncate">
                      {[a.pmcName, a.city].filter(Boolean).join(" · ") || "Client board"}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/25 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
