import { ExternalLink } from "lucide-react";

const BASE44_URL = "https://wakeful-ready-track-flow.base44.app";

/**
 * WorkEmbed — launches the connected Base44 work-management app.
 * Base44 sets X-Frame-Options: DENY so iframe embedding is blocked by the
 * browser. Instead we open it in a dedicated tab with one tap.
 */
export default function WorkEmbed() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8 px-8">
      {/* Card */}
      <div className="w-full max-w-md rounded-2xl border border-[var(--hairline)] bg-[var(--secondary)] p-8 flex flex-col items-center gap-6 shadow-xl">
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-[var(--gold-light)] flex items-center justify-center shadow-[0_0_24px_rgba(180,255,68,0.35)]">
          <ExternalLink className="w-7 h-7 text-black" strokeWidth={2.5} />
        </div>

        {/* Copy */}
        <div className="text-center space-y-2">
          <p className="font-display font-bold text-lg text-white tracking-tight">
            Track Flow — Work App
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your connected Base44 app opens in its own tab so you get the full
            experience without any limitations.
          </p>
        </div>

        {/* Launch button */}
        <a
          href={BASE44_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full h-12 rounded-xl bg-[var(--gold-light)] text-black font-display font-bold text-sm tracking-wide flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(180,255,68,0.25)] hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all"
        >
          Open Work App
          <ExternalLink className="w-4 h-4" strokeWidth={2.5} />
        </a>

        {/* URL hint */}
        <p className="text-[11px] text-muted-foreground/50 font-mono break-all text-center">
          {BASE44_URL}
        </p>
      </div>

      <p className="text-xs text-muted-foreground/40 text-center max-w-xs">
        The app's security policy prevents embedding — opening in a new tab
        gives you the full interface.
      </p>
    </div>
  );
}
