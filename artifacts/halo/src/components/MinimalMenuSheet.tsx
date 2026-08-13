/**
 * MinimalMenuSheet — stripped-down 4-item settings drawer.
 * Replaces the old MoreMenuSheet with a lean, intentional list.
 */
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Link } from "wouter";
import {
  Settings,
  Network,
  FileUp,
  Presentation,
  ExternalLink,
  Loader2,
  ChevronRight,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPresentationDemo,
  useActivatePresentationDemo,
  useDeactivatePresentationDemo,
  getGetPresentationDemoQueryKey,
} from "@workspace/api-client-react";

export function MinimalMenuSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: demoState } = useGetPresentationDemo({
    query: { queryKey: getGetPresentationDemoQueryKey(), enabled: open },
  });
  const activate = useActivatePresentationDemo();
  const deactivate = useDeactivatePresentationDemo();
  const busy = activate.isPending || deactivate.isPending;
  const demoActive = demoState?.active ?? false;
  const demoUrl = demoState?.dashboardToken
    ? `${window.location.origin}/board/${demoState.dashboardToken}?present=1`
    : null;

  const toggleDemo = (next: boolean) => {
    if (busy) return;
    if (next) {
      activate.mutate(undefined, {
        onSuccess: (s) => {
          qc.invalidateQueries({ queryKey: getGetPresentationDemoQueryKey() });
          toast({ title: "Presentation Mode on" });
          if (s?.dashboardToken) {
            window.open(`${window.location.origin}/board/${s.dashboardToken}?present=1`, "_blank");
          }
        },
        onError: () => toast({ title: "Couldn't start demo", variant: "destructive" }),
      });
    } else {
      deactivate.mutate(undefined, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetPresentationDemoQueryKey() });
          toast({ title: "Presentation Mode off" });
        },
        onError: () => toast({ title: "Couldn't stop demo", variant: "destructive" }),
      });
    }
  };

  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[20px] border-none flex flex-col"
        style={{
          background: "#0C1828",
          boxShadow: "0 -1px 0 rgba(255,255,255,0.07)",
          maxHeight: "70vh",
          padding: 0,
        }}
      >
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-white/[0.12] mx-auto mt-3 mb-2 shrink-0" />

        <div className="px-4 pb-8 overflow-y-auto">
          {/* Title row */}
          <div className="flex items-center justify-between py-3 mb-1">
            <span className="text-[15px] font-semibold text-white/85">Menu</span>
            <button onClick={close} className="w-7 h-7 rounded-full bg-white/[0.06] grid place-items-center text-white/40 hover:text-white/70">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2">
            {/* Presentation Mode */}
            <div className="flex items-center gap-3 rounded-[13px] bg-white/[0.04] border border-white/[0.07] px-4 py-3.5">
              <div className="w-8 h-8 rounded-full bg-white/[0.06] grid place-items-center shrink-0">
                {busy ? <Loader2 className="w-4 h-4 text-[#B4FF44] animate-spin" /> : <Presentation className="w-4 h-4 text-[#B4FF44]" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium text-white/80">Presentation Mode</div>
                <div className="text-[11.5px] text-white/35">Demo board with guided walkthrough</div>
              </div>
              <Switch checked={demoActive} disabled={busy} onCheckedChange={toggleDemo} />
            </div>

            {demoActive && demoUrl && (
              <a href={demoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-[13px] bg-white/[0.04] border border-white/[0.07] px-4 py-3.5">
                <div className="w-8 h-8 rounded-full bg-white/[0.06] grid place-items-center shrink-0">
                  <ExternalLink className="w-4 h-4 text-white/40" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-medium text-white/80">Open Demo Board</div>
                  <div className="text-[11.5px] text-white/35">Client view with narrated walkthrough</div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/25 shrink-0" />
              </a>
            )}

            {/* Falkon Network */}
            <Link href="/falkon-network" onClick={close}>
              <div className="flex items-center gap-3 rounded-[13px] bg-white/[0.04] border border-white/[0.07] px-4 py-3.5">
                <div className="w-8 h-8 rounded-full bg-white/[0.06] grid place-items-center shrink-0">
                  <Network className="w-4 h-4 text-[#B4FF44]/70" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-medium text-white/80">Falkon Network</div>
                  <div className="text-[11.5px] text-white/35">Peers, gates & business twin</div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/25 shrink-0" />
              </div>
            </Link>

            {/* Import */}
            <Link href="/import" onClick={close}>
              <div className="flex items-center gap-3 rounded-[13px] bg-white/[0.04] border border-white/[0.07] px-4 py-3.5">
                <div className="w-8 h-8 rounded-full bg-white/[0.06] grid place-items-center shrink-0">
                  <FileUp className="w-4 h-4 text-white/40" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-medium text-white/80">Import</div>
                  <div className="text-[11.5px] text-white/35">Upload a file, HALO files it</div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/25 shrink-0" />
              </div>
            </Link>

            {/* Settings */}
            <Link href="/settings" onClick={close}>
              <div className="flex items-center gap-3 rounded-[13px] bg-white/[0.04] border border-white/[0.07] px-4 py-3.5">
                <div className="w-8 h-8 rounded-full bg-white/[0.06] grid place-items-center shrink-0">
                  <Settings className="w-4 h-4 text-white/40" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-medium text-white/80">Settings</div>
                  <div className="text-[11.5px] text-white/35">Workspace & business options</div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/25 shrink-0" />
              </div>
            </Link>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
