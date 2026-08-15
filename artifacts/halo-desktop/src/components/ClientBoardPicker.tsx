/**
 * ClientBoardPicker — "which client's board?" chooser.
 *
 * Client boards are per-property, so a link from the main page has to answer
 * that question before it can go anywhere. When only one property has a client
 * account there is nothing to ask, so we skip straight to the board.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LayoutGrid, ChevronRight, Loader2 } from "lucide-react";
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

  // One account: don't make them pick from a list of one.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] bg-[#0C1828] border-white/10 text-white p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-3">
          <DialogTitle className="text-[17px] font-display font-bold text-white/90">Client board</DialogTitle>
          <p className="text-[12.5px] text-white/40 mt-1">Open what the client sees</p>
        </div>

        <div className="px-4 pb-6 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="py-12 grid place-items-center text-white/30">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : list.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-white/35">
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
                  className="w-full flex items-center gap-3 rounded-[13px] bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] px-4 py-3.5 text-left transition-colors"
                >
                  <div className="w-9 h-9 rounded-full bg-[var(--gold-light)] grid place-items-center shrink-0 overflow-hidden">
                    {a.logoPath ? (
                      <img src={`/api/storage${a.logoPath}`} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <LayoutGrid className="w-4 h-4 text-black" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-white/85 truncate">{a.propertyName}</div>
                    <div className="text-[12px] text-white/35 truncate">
                      {[a.pmcName, a.city].filter(Boolean).join(" · ") || "Client board"}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/25 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
