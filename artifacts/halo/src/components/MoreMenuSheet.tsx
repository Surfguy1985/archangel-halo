import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link } from "wouter";
import { CalendarDays, GitBranch, Package, ShieldCheck, FileUp, BookOpen, ChevronRight, ClipboardList, Settings, Feather, Presentation, ExternalLink, Loader2, Network } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPresentationDemo,
  useActivatePresentationDemo,
  useDeactivatePresentationDemo,
  getGetPresentationDemoQueryKey,
} from "@workspace/api-client-react";

// Presentation Mode: seeds a clearly-marked mock property (mock crews, jobs,
// invoices, live crew pings) and opens the real client board in a narrated,
// spotlight-guided walkthrough. Turning it off removes every demo row.
function PresentationModeRow() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: state } = useGetPresentationDemo({
    query: { queryKey: getGetPresentationDemoQueryKey() },
  });
  const activate = useActivatePresentationDemo();
  const deactivate = useDeactivatePresentationDemo();
  const busy = activate.isPending || deactivate.isPending;
  const active = state?.active ?? false;
  const demoUrl = state?.dashboardToken
    ? `${window.location.origin}/board/${state.dashboardToken}?present=1`
    : null;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetPresentationDemoQueryKey() });

  const onToggle = (next: boolean) => {
    if (busy) return;
    if (next) {
      activate.mutate(undefined, {
        onSuccess: (s) => {
          refresh();
          toast({ title: "Presentation Mode is on", description: "Demo property seeded. Opening the guided demo board…" });
          if (s?.dashboardToken) {
            window.open(`${window.location.origin}/board/${s.dashboardToken}?present=1`, "_blank");
          }
        },
        onError: () => toast({ title: "Couldn't start Presentation Mode", variant: "destructive" }),
      });
    } else {
      deactivate.mutate(undefined, {
        onSuccess: () => {
          refresh();
          toast({ title: "Presentation Mode is off", description: "All demo data removed." });
        },
        onError: () => toast({ title: "Couldn't remove demo data", variant: "destructive" }),
      });
    }
  };

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-center gap-[13px] bg-card border border-[var(--hairline)] rounded-[14px] p-[13px_14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <div className="w-[38px] h-[38px] rounded-full grid place-items-center bg-[var(--paper)] border border-[var(--hairline)] shrink-0">
          {busy ? (
            <Loader2 className="w-[19px] h-[19px] text-[var(--gold-dark)] animate-spin" strokeWidth={1.9} />
          ) : (
            <Presentation className="w-[19px] h-[19px] text-[var(--gold-dark)]" strokeWidth={1.9} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[15px]">Presentation Mode</div>
          <div className="text-[12.5px] text-muted-foreground">
            {active
              ? "Demo property is live — mock crews, jobs & invoices"
              : "Seed a mock demo board with a guided voice walkthrough"}
          </div>
        </div>
        <Switch checked={active} disabled={busy} onCheckedChange={onToggle} data-testid="switch-presentation-mode" />
      </div>
      {active && demoUrl && (
        <a href={demoUrl} target="_blank" rel="noreferrer" data-testid="link-presentation-demo">
          <div className="flex items-center gap-[13px] bg-card border border-[var(--hairline)] rounded-[14px] p-[13px_14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-transform active:scale-[0.98]">
            <div className="w-[38px] h-[38px] rounded-full grid place-items-center bg-[var(--paper)] border border-[var(--hairline)] shrink-0">
              <ExternalLink className="w-[19px] h-[19px] text-[var(--gold-dark)]" strokeWidth={1.9} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-bold text-[15px]">Board Demo — client side</div>
              <div className="text-[12.5px] text-muted-foreground">Narrated walkthrough of the live client board</div>
            </div>
            <ChevronRight className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
          </div>
        </a>
      )}
      {active && state?.propertyId && (
        <Link
          href={`/properties/${state.propertyId}/board?present=1`}
          data-testid="link-office-board-demo"
        >
          <div className="flex items-center gap-[13px] bg-card border border-[var(--hairline)] rounded-[14px] p-[13px_14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-transform active:scale-[0.98]">
            <div className="w-[38px] h-[38px] rounded-full grid place-items-center bg-[var(--paper)] border border-[var(--hairline)] shrink-0">
              <Presentation className="w-[19px] h-[19px] text-[var(--gold-dark)]" strokeWidth={1.9} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-bold text-[15px]">Board Demo — office side</div>
              <div className="text-[12.5px] text-muted-foreground">Narrated walkthrough of the office board</div>
            </div>
            <ChevronRight className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
          </div>
        </Link>
      )}
    </div>
  );
}

const groups = [
  {
    label: "Work",
    items: [
      { href: "/jobboard", label: "Job Board", sub: "Dispatch and fill open jobs", Icon: ClipboardList },
      { href: "/calendar", label: "Calendar", sub: "Day, week & month schedule", Icon: CalendarDays },
      { href: "/pipeline", label: "Pipeline", sub: "Leads & bids", Icon: GitBranch },
      { href: "/wings", label: "Founding Wings", sub: "Crew scores, overrides & AI reviews", Icon: Feather },
      { href: "/wings?guide=1", label: "Wings Program Guide", sub: "How scores, overrides & the reserve work", Icon: BookOpen },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/catalog", label: "Price Book", sub: "Master list of services & prices", Icon: BookOpen },
      { href: "/supply", label: "Supply", sub: "Inventory & purchase orders", Icon: Package },
      { href: "/vendors", label: "Vendors", sub: "COI compliance", Icon: ShieldCheck },
    ],
  },
  {
    label: "Network",
    items: [
      { href: "/falkon-network", label: "Falkon Network", sub: "Connected businesses, requests & phases", Icon: Network },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/import", label: "Import", sub: "Upload a file, we file it", Icon: FileUp },
      { href: "/settings", label: "Settings", sub: "Start fresh & workspace options", Icon: Settings },
    ],
  },
];

export function MoreMenuSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">More</SheetTitle>
            <div className="text-[13px] text-muted-foreground">The back office — quiet until it matters.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[18px]">
            <div>
              <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70 mb-[8px] px-[4px]">
                Showcase
              </div>
              <PresentationModeRow />
            </div>
            {groups.map((group) => (
              <div key={group.label}>
                <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70 mb-[8px] px-[4px]">
                  {group.label}
                </div>
                <div className="flex flex-col gap-[10px]">
                  {group.items.map(({ href, label, sub, Icon }) => (
                    <Link key={href} href={href} onClick={() => onOpenChange(false)}>
                      <div className="flex items-center gap-[13px] bg-card border border-[var(--hairline)] rounded-[14px] p-[13px_14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-transform active:scale-[0.98]">
                        <div className="w-[38px] h-[38px] rounded-full grid place-items-center bg-[var(--paper)] border border-[var(--hairline)] shrink-0">
                          <Icon className="w-[19px] h-[19px] text-[var(--gold-dark)]" strokeWidth={1.9} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-display font-bold text-[15px]">{label}</div>
                          <div className="text-[12.5px] text-muted-foreground">{sub}</div>
                        </div>
                        <ChevronRight className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
