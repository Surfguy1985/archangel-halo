/**
 * Layout — minimal dark chrome for expert detail views.
 * Tab bar and secondary command bar removed — navigation happens in HaloCommand.
 * All detail routes (/properties/:id, /jobs/:id, etc.) use this wrapper.
 */
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import haloLogo from "../assets/halo-logo.png";
import { ArrivalDetection } from "./ArrivalSheet";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  // Determine a clean back-label from the current path
  const backLabel = (() => {
    if (location.startsWith("/properties/") && location.endsWith("/board")) return "Properties";
    if (location.startsWith("/properties/")) return "Properties";
    if (location.startsWith("/jobs/")) return "Jobs";
    if (location.startsWith("/invoices/")) return "Invoices";
    if (location.startsWith("/crews/")) return "Crews";
    return "HALO";
  })();

  return (
    <div className="min-h-[100dvh] flex flex-col items-center bg-[#060C18]">
      <div className="w-full sm:w-[430px] min-h-[100dvh] bg-background sm:bg-[#080D17] overflow-x-hidden relative flex flex-col">

        {/* Minimal top bar */}
        <header
          className="flex items-center gap-3 px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-3 shrink-0 border-b"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <Link href="/">
            <button className="flex items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors active:scale-[0.96]">
              <ArrowLeft className="w-4 h-4" strokeWidth={2} />
              <span className="text-[12.5px] font-medium">{backLabel}</span>
            </button>
          </Link>

          <div className="flex-1" />

          <img
            src={haloLogo}
            alt="HALO"
            className="h-[18px] w-auto opacity-30"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto scroll-smooth">
          {children}
        </main>
      </div>

      <ArrivalDetection />
    </div>
  );
}
