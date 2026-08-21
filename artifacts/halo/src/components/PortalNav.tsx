/**
 * Max 5 primary nav items per portal. Property portals never show invoicing.
 */
import { useLocation } from "wouter";

type Item = { label: string; href: string };

const NAV: Record<"portfolio" | "pulse" | "punchlist", Item[]> = {
  portfolio: [
    { label: "Twin", href: "/site-twin" },
    { label: "Portfolio", href: "/portfolio" },
    { label: "Pulse", href: "/pulse" },
  ],
  pulse: [
    { label: "Twin", href: "/site-twin" },
    { label: "Pulse", href: "/pulse" },
    { label: "Portfolio", href: "/portfolio" },
  ],
  punchlist: [
    { label: "Home", href: "/punchlist" },
    { label: "Drafts", href: "/invoice-drafts" },
    { label: "Pulse", href: "/pulse" },
    { label: "Portfolio", href: "/portfolio" },
  ],
};

export function PortalNav({ portal }: { portal: "portfolio" | "pulse" | "punchlist" }) {
  const [loc, setLocation] = useLocation();
  const items = NAV[portal].slice(0, 5);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0a0a0a]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-2xl justify-around px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
        {items.map((item) => {
          const active =
            loc === item.href ||
            loc.startsWith(item.href + "?") ||
            (item.href === "/portfolio" && loc.startsWith("/property-portfolio"));
          return (
            <button
              key={item.href + item.label}
              type="button"
              onClick={() => setLocation(item.href)}
              className={`min-w-[64px] rounded-lg px-2 py-2 text-[11px] font-semibold ${
                active ? "text-white" : "text-white/35"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default PortalNav;
