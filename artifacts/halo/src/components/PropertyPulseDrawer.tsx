/**
 * Portfolio property sheet — parity with unit drawer.
 * Property-safe only. No money.
 */
import { Building2, X } from "lucide-react";

export type PropertyDrawerData = {
  propertyId: string;
  name: string;
  city: string | null;
  healthLabel: string;
  health: "good" | "watch" | "attention";
  turning: number;
  waiting: number;
  done: number;
  blocked: number;
};

const healthColor = {
  attention: "text-[#FF453A]",
  watch: "text-[#0A84FF]",
  good: "text-[#30D158]",
};

export function PropertyPulseDrawer({
  property,
  onClose,
  onOpenPulse,
}: {
  property: PropertyDrawerData | null;
  onClose: () => void;
  onOpenPulse: (propertyId: string) => void;
}) {
  if (!property) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-lg rounded-t-[20px] border border-white/10 bg-[#1c1c1e] sm:rounded-[20px]"
      >
        <div className="flex items-start justify-between px-5 pb-2 pt-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-white/10">
              <Building2 className="h-5 w-5 text-white/50" />
            </div>
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight text-white">{property.name}</h2>
              {property.city && (
                <p className="mt-0.5 text-[13px] text-white/40">{property.city}</p>
              )}
              <p className={`mt-1 text-[15px] font-medium ${healthColor[property.health]}`}>
                {property.healthLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 text-white/70"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 px-5 py-4">
          <Mini label="Attention" value={property.blocked} tone="attention" />
          <Mini label="Turning" value={property.turning} tone="watch" />
          <Mini label="Waiting" value={property.waiting} tone="watch" />
          <Mini label="Ready" value={property.done} tone="good" />
        </div>

        <div className="px-5 pb-8">
          <button
            type="button"
            onClick={() => onOpenPulse(property.propertyId)}
            className="flex w-full items-center justify-center rounded-[14px] bg-white py-[14px] text-[16px] font-semibold text-black transition active:scale-[0.99]"
          >
            Open in Pulse
          </button>
          <p className="mt-3 text-center text-[11px] text-white/25">Property view · No invoicing</p>
        </div>
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "attention" | "watch" | "good";
}) {
  return (
    <div className="rounded-[12px] border border-white/10 bg-white/[0.04] px-2 py-2.5 text-center">
      <div className={`text-[18px] font-semibold tabular-nums ${healthColor[tone]}`}>{value}</div>
      <div className="text-[10px] text-white/40">{label}</div>
    </div>
  );
}

export default PropertyPulseDrawer;
