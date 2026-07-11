import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link } from "wouter";
import { CalendarDays, GitBranch, Package, ShieldCheck, FileUp, ChevronRight, ClipboardList } from "lucide-react";

const items = [
  { href: "/jobboard", label: "Job Board", sub: "Dispatch and fill open jobs", Icon: ClipboardList },
  { href: "/calendar", label: "Calendar", sub: "Day, week & month schedule", Icon: CalendarDays },
  { href: "/pipeline", label: "Pipeline", sub: "Leads & bids", Icon: GitBranch },
  { href: "/supply", label: "Supply", sub: "Inventory & purchase orders", Icon: Package },
  { href: "/vendors", label: "Vendors", sub: "COI compliance", Icon: ShieldCheck },
  { href: "/import", label: "Import", sub: "Upload a file, we file it", Icon: FileUp },
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
          <div className="flex flex-col gap-[10px]">
            {items.map(({ href, label, sub, Icon }) => (
              <Link key={href} href={href} onClick={() => onOpenChange(false)}>
                <div className="flex items-center gap-[13px] bg-card border border-border rounded-[14px] p-[13px_14px] shadow-[var(--shadow)] transition-transform active:scale-[0.98]">
                  <div className="w-[38px] h-[38px] rounded-full grid place-items-center bg-[var(--paper)] border border-border shrink-0">
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
      </SheetContent>
    </Sheet>
  );
}
