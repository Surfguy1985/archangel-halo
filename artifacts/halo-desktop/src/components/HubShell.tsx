import { useLocation } from "wouter";

/**
 * HubShell — slim workspace tab bar that groups related screens into one hub
 * (Ramp/monday-style). Pages keep their own content; this bar is the single
 * switcher, styled like the client board pills: navy track, lime active pill.
 *
 * Tabs navigate to the pages' real routes, so every legacy deep link, tour
 * target, and testid keeps working unchanged.
 */
export type HubTab = { label: string; href: string; testId?: string };

export function HubShell({
  title,
  tabs,
  children,
}: {
  title: string;
  tabs: HubTab[];
  children: React.ReactNode;
}) {
  const [location, navigate] = useLocation();

  const isActive = (href: string) => {
    // Exact match wins; otherwise the longest matching prefix is active so
    // /money doesn't light up when /money/payments is open.
    const exact = tabs.find((t) => t.href === location);
    if (exact) return exact.href === href;
    const matches = tabs.filter((t) => location.startsWith(t.href));
    if (!matches.length) return false;
    const best = matches.reduce((a, b) => (b.href.length > a.href.length ? b : a));
    return best.href === href;
  };

  return (
    <div className="min-h-full flex flex-col">
      <div className="sticky top-[88px] z-20 bg-background/95 backdrop-blur-md border-b border-[var(--hairline)]">
        <div className="px-8 py-3 flex items-center gap-5">
          <span className="font-display font-bold text-xs tracking-[0.18em] uppercase text-muted-foreground shrink-0 w-24">
            {title}
          </span>
          <div
            className="flex items-center gap-1 rounded-full bg-[var(--secondary)] p-1 shadow-sm"
            data-testid={`hub-tabs-${title.toLowerCase()}`}
          >
            {tabs.map((t) => (
              <button
                key={t.href}
                type="button"
                onClick={() => navigate(t.href)}
                data-testid={t.testId ?? `hub-tab-${t.href.replace(/\W+/g, "-")}`}
                className={`px-4 h-8 rounded-full text-xs font-display font-bold transition-all ${
                  isActive(t.href)
                    ? "bg-[var(--gold-light)] text-black shadow-sm"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export const WORK_TABS: HubTab[] = [
  { label: "Work", href: "/work" },
  { label: "Board", href: "/jobboard" },
  { label: "Dispatch", href: "/dispatch" },
  { label: "Calendar", href: "/calendar" },
];

export const CLIENT_TABS: HubTab[] = [
  { label: "Properties", href: "/properties" },
  { label: "Pipeline", href: "/pipeline" },
  { label: "Accounts", href: "/admin" },
];

export const MONEY_TABS: HubTab[] = [
  { label: "Overview", href: "/money" },
  { label: "Payments", href: "/money/payments" },
];

export const PURCHASING_TABS: HubTab[] = [
  { label: "Price Book", href: "/catalog" },
  { label: "Supply", href: "/supply" },
  { label: "Vendors", href: "/vendors" },
];
