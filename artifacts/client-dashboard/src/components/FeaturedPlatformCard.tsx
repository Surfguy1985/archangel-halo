import { ArrowUpRight, Headphones, Zap, BarChart2, Shield } from "lucide-react";

/**
 * Featured banner advertising the HALO platform and inviting the client to
 * take the interactive guided training tour. The visual is fully CSS-generated
 * — no image dependency — so it works everywhere without a build-time asset.
 */
export function FeaturedPlatformCard({ onStartTraining }: { onStartTraining: () => void }) {
  return (
    <div className="px-3 sm:px-5 pt-3">
      <div className="max-w-[1400px] mx-auto overflow-hidden rounded-[16px] border border-black/[0.08] shadow-sm">
        <div className="flex flex-col sm:flex-row">

          {/* ── Left: AI-generated abstract visual ─────────────────────────── */}
          <div className="relative sm:w-[300px] shrink-0 h-[130px] sm:h-auto overflow-hidden bg-[#0d1117]">
            {/* Deep-space gradient base */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#0d1117] via-[#111827] to-[#0a1628]" />

            {/* Grid overlay */}
            <div
              className="absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage:
                  "linear-gradient(#B4FF44 1px, transparent 1px), linear-gradient(90deg, #B4FF44 1px, transparent 1px)",
                backgroundSize: "28px 28px",
              }}
            />

            {/* Radial glow — lime */}
            <div
              className="absolute rounded-full blur-[50px]"
              style={{
                width: 180,
                height: 180,
                background: "radial-gradient(circle, rgba(180,255,68,0.22) 0%, transparent 70%)",
                top: -30,
                left: -20,
              }}
            />

            {/* Radial glow — indigo */}
            <div
              className="absolute rounded-full blur-[60px]"
              style={{
                width: 160,
                height: 160,
                background: "radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)",
                bottom: -20,
                right: 10,
              }}
            />

            {/* Floating metric cards */}
            <div className="absolute inset-0 flex items-center justify-center gap-3 px-4">
              {[
                { icon: Zap, label: "Live jobs", value: "On track" },
                { icon: BarChart2, label: "Margin", value: "Healthy" },
                { icon: Shield, label: "Coverage", value: "Full" },
              ].map(({ icon: Icon, label, value }) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-[3px] rounded-[10px] px-2.5 py-2 border border-white/10 backdrop-blur-sm"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <Icon className="w-3 h-3 text-[#B4FF44]" />
                  <span className="text-[8.5px] font-bold text-white/40 uppercase tracking-wide leading-none">
                    {label}
                  </span>
                  <span className="text-[10px] font-bold text-white/80 leading-none">{value}</span>
                </div>
              ))}
            </div>

            {/* Bottom wordmark */}
            <div className="absolute bottom-2 left-0 right-0 flex justify-center">
              <span className="text-[9px] font-[900] tracking-[0.35em] text-[#B4FF44]/50 uppercase">
                HALO Platform
              </span>
            </div>
          </div>

          {/* ── Right: copy + CTAs ─────────────────────────────────────────── */}
          <div className="flex-1 p-4 sm:p-5 bg-white">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-[3px] rounded-full bg-[#101C33] text-[#B4FF44]">
                <Headphones className="w-3 h-3" /> Interactive
              </span>
              <span className="text-[11px] font-semibold text-[#6e6e73] uppercase tracking-wide">
                Guided training
              </span>
            </div>

            <h3 className="mt-1.5 text-[17px] font-bold text-[#1d1d1f]">
              Know your board in 3 minutes
            </h3>

            <p className="mt-1 text-[13px] leading-[1.5] text-[#3c3c43]">
              HALO keeps every job, invoice, and crew status live on one board — no calls,
              no chasing. Take the narrated training and you'll know exactly where everything
              is and what needs your attention, every time you log in.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={onStartTraining}
                data-testid="button-start-training"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#B4FF44] text-[#101C33] text-[13px] font-bold active:scale-[0.97] transition-transform hover:bg-[#9EE622]"
              >
                <Headphones className="w-3.5 h-3.5" /> Begin training
              </button>

              <a
                href="#what-it-does"
                onClick={(e) => {
                  e.preventDefault();
                  // Scroll smoothly to the board lanes so the client can see
                  // the rails that the tour will walk through.
                  document
                    .querySelector("[data-testid='rail-needs_you']")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-[13px] font-semibold text-[#1d1d1f] bg-[#f5f5f7] active:scale-[0.97] transition-transform hover:bg-[#e8e8ed]"
              >
                Explore the board <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Proof points */}
            <div className="mt-3 flex items-center gap-4">
              {[
                "6 narrated steps",
                "Spotlight highlights",
                "Replay anytime",
              ].map((pt) => (
                <span key={pt} className="text-[11px] text-[#6e6e73] flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-[#B4FF44] inline-block" />
                  {pt}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
