/**
 * Traditional CRM chrome. HALO chat stays the default OS;
 * this layout is the expert fallback the operator can summon.
 */
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import haloLogo from "../assets/halo-logo.png";
import { ArrivalDetection } from "./ArrivalSheet";

const NAV = [
  { href: "/property-portfolio", label: "Portfolio" },
  { href: "/pulse", label: "Pulse" },
  { href: "/punchlist", label: "Punchlist" },
  { href: "/ops", label: "Today" },
  { href: "/properties", label: "Properties" },
  { href: "/jobboard", label: "Jobs" },
  { href: "/crews", label: "Crews" },
  { href: "/calendar", label: "Calendar" },
  { href: "/money", label: "Money" },
  { href: "/supply", label: "Supply" },
];

export function OpsLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col items-center bg-[#060C18]">
      <div className="w-full sm:w-[430px] min-h-[100dvh] bg-background overflow-x-hidden relative flex flex-col">
        <header
          className="shrink-0 border-b px-3 pt-[calc(10px+env(safe-area-inset-top))] pb-2"
          style={{ background: "#07101E", borderColor: "rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Link href="/">
              <button
                type="button"
                className="flex items-center gap-1.5 text-white/50 hover:text-[#B4FF44] transition-colors min-h-11 px-1"
              >
                <ArrowLeft className="w-4 h-4" strokeWidth={2} />
                <span className="text-[12px] font-medium tracking-wide">HALO</span>
              </button>
            </Link>
            <div className="flex-1" />
            <span className="text-[9px] font-display font-bold tracking-[0.16em] uppercase text-white/35">Records</span>
            <img
              src={haloLogo}
              alt="HALO"
              className="h-[16px] w-auto opacity-40"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1" aria-label="CRM">
            {NAV.map((item) => {
              const active = item.href === "/ops"
                ? location === "/ops" || location === "/today"
                : location === item.href || location.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href}>
                  <span
                    className="inline-flex items-center h-8 px-3 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors"
                    style={
                      active
                        ? { background: "#B4FF44", color: "#07101E" }
                        : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)" }
                    }
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="flex-1 overflow-y-auto scroll-smooth bg-background">
          {children}
        </main>
      </div>
      <ArrivalDetection />
    </div>
  );
}
