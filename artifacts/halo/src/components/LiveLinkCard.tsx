/**
 * LiveLinkCard — shown in the HaloCommand thread after a PM live link or
 * crew check-in link is generated. Has a single primary action: copy the
 * pre-formatted SMS text to clipboard.
 */
import { useState } from "react";
import { Copy, Check, ExternalLink, X, MapPin, Users } from "lucide-react";

export interface LiveLinkData {
  kind: "pm_link" | "crew_checkin";
  propertyName?: string;
  crewName?: string;
  url: string;
  token: string;
  smsText: string;
  expiresAt: string;
}

export function LiveLinkCard({
  data,
  onRevoke,
}: {
  data: LiveLinkData;
  onRevoke?: (token: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.smsText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback: select the text in the pre
      const el = document.getElementById(`sms-${data.token}`);
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  };

  const revoke = async () => {
    if (!onRevoke) return;
    onRevoke(data.token);
    setRevoked(true);
  };

  const expiresLabel = (() => {
    const d = new Date(data.expiresAt);
    const now = new Date();
    const diffH = Math.round((d.getTime() - now.getTime()) / 3_600_000);
    if (diffH <= 0) return "Expired";
    if (diffH < 2) return `Expires in ${diffH}h`;
    return `Expires ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} today`;
  })();

  if (revoked) {
    return (
      <div className="rounded-[14px] bg-white/[0.03] border border-white/[0.07] px-4 py-3 mb-3 text-[12px] text-white/30">
        Link revoked — it will no longer work for the recipient.
      </div>
    );
  }

  return (
    <div
      className="rounded-[16px] border border-[#22C55E]/20 mb-3"
      style={{ background: "rgba(34,197,94,0.05)", animation: "hcIn 0.2s ease-out both" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5 border-b border-white/[0.05]">
        <div className="w-7 h-7 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/25 grid place-items-center shrink-0">
          {data.kind === "pm_link" ? (
            <MapPin className="w-3.5 h-3.5 text-[#22C55E]" />
          ) : (
            <Users className="w-3.5 h-3.5 text-[#22C55E]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white/85">
            {data.kind === "pm_link"
              ? `Live link — ${data.propertyName}`
              : `Check-in link — ${data.crewName}`}
          </div>
          <div className="text-[10.5px] text-white/35">{expiresLabel}</div>
        </div>
        <a
          href={data.url}
          target="_blank"
          rel="noreferrer"
          className="w-7 h-7 rounded-full bg-white/[0.06] grid place-items-center text-white/35 hover:text-white/65 transition-colors shrink-0"
          title="Preview as recipient"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* SMS text preview */}
      <div className="px-4 py-3">
        <div className="text-[9.5px] font-bold tracking-[0.16em] uppercase text-white/25 mb-2">
          Ready to text
        </div>
        <pre
          id={`sms-${data.token}`}
          className="text-[12px] text-white/60 whitespace-pre-wrap leading-relaxed font-[inherit] bg-white/[0.03] border border-white/[0.07] rounded-[10px] px-3 py-2.5 select-all"
        >
          {data.smsText}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 pb-3.5">
        <button
          onClick={copy}
          className="flex-1 h-9 rounded-[10px] flex items-center justify-center gap-2 font-semibold text-[12.5px] transition-all active:scale-[0.97]"
          style={{
            background: copied ? "rgba(34,197,94,0.18)" : "#B4FF44",
            color: copied ? "#22C55E" : "#07101E",
          }}
        >
          {copied ? (
            <><Check className="w-3.5 h-3.5" /> Copied!</>
          ) : (
            <><Copy className="w-3.5 h-3.5" /> Copy for texting</>
          )}
        </button>
        {onRevoke && (
          <button
            onClick={revoke}
            className="h-9 px-3 rounded-[10px] bg-white/[0.04] border border-white/[0.07] text-[11.5px] text-white/35 hover:text-[#E11D48]/70 hover:border-[#E11D48]/25 transition-all active:scale-[0.97]"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
