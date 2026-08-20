/**
 * Demo / default landing — pick a portal in 3 seconds.
 * Property views vs vendor back office. Invoicing = Base44.
 */
import { Building2, HardHat, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function PortalLaunch() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a] px-6 text-white">
      <p className="text-[13px] font-medium tracking-wide text-white/40">Archangel Halo</p>
      <h1 className="mt-2 text-center text-[34px] font-semibold tracking-tight">Where to?</h1>
      <p className="mt-2 max-w-sm text-center text-[15px] text-white/45">
        Property views on Halo. Invoicing on Base44.
      </p>

      <div className="mt-10 w-full max-w-sm space-y-3">
        <LaunchCard
          icon={<Building2 className="h-5 w-5" />}
          title="Portfolio"
          subtitle="Corporate · all properties"
          onClick={() => setLocation("/portfolio")}
        />
        <LaunchCard
          icon={<Home className="h-5 w-5" />}
          title="Pulse"
          subtitle="Property · turns & proof"
          onClick={() => setLocation("/pulse")}
        />
        <LaunchCard
          icon={<HardHat className="h-5 w-5" />}
          title="Punchlist"
          subtitle="Vendor · dispatch & money tools"
          onClick={() => setLocation("/punchlist")}
        />
      </div>

      <p className="mt-12 text-center text-[12px] text-white/25">
        30-second demo: Portfolio → property → Open in Pulse → unit
      </p>
    </div>
  );
}

function LaunchCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-4 text-left transition active:scale-[0.99]"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-white/10 text-white/70">
        {icon}
      </div>
      <div>
        <div className="text-[17px] font-semibold tracking-tight">{title}</div>
        <div className="mt-0.5 text-[13px] text-white/40">{subtitle}</div>
      </div>
    </button>
  );
}
