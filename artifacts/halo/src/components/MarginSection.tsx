import { useState } from "react";
import { Pencil, ShieldCheck, ShieldAlert, Target } from "lucide-react";

const DEFAULT_MIN = 0.25;

const inputCls =
  "w-full bg-card border border-border rounded-[12px] py-[9px] px-[12px] text-[14px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)] tabular-nums";

export type MarginStatus = "below" | "between" | "target" | "none";

export function marginStatus(
  currentPct: number | null | undefined,
  minFrac: number | null | undefined,
  targetFrac: number | null | undefined,
): MarginStatus {
  if (currentPct == null) return "none";
  const min = (minFrac ?? DEFAULT_MIN) * 100;
  const target = targetFrac != null ? targetFrac * 100 : null;
  if (currentPct < min) return "below";
  if (target != null && currentPct >= target) return "target";
  if (target == null) return "target";
  return "between";
}

const STATUS_META: Record<
  MarginStatus,
  { label: string; color: string; bar: string }
> = {
  below: {
    label: "Below minimum",
    color: "text-[#B23B3B]",
    bar: "linear-gradient(90deg,#D96A6A,#B23B3B)",
  },
  between: {
    label: "Above minimum",
    color: "text-[var(--gold-dark)]",
    bar: "linear-gradient(90deg,var(--gold-light),var(--gold-dark))",
  },
  target: {
    label: "Hitting target",
    color: "text-[#2E7D4F]",
    bar: "linear-gradient(90deg,#5DBA85,#2E7D4F)",
  },
  none: {
    label: "No margin data yet",
    color: "text-muted-foreground",
    bar: "linear-gradient(90deg,#C9CBD1,#AEB1B8)",
  },
};

export function MarginSection({
  title = "Margin",
  currentPct,
  minFrac,
  targetFrac,
  currentEditable = false,
  saving = false,
  onSave,
  helperText,
}: {
  title?: string;
  /** Current margin as a PERCENT number (e.g. 27.5) or null. */
  currentPct: number | null;
  /** Minimum threshold as a FRACTION (0.25) or null (falls back to 25%). */
  minFrac: number | null | undefined;
  /** Target as a FRACTION (0.35) or null. */
  targetFrac: number | null | undefined;
  /** Allow editing the current margin too (job pages). */
  currentEditable?: boolean;
  saving?: boolean;
  onSave: (v: {
    minFrac: number | null;
    targetFrac: number | null;
    currentFrac?: number | null;
  }) => void;
  helperText?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [minStr, setMinStr] = useState("");
  const [targetStr, setTargetStr] = useState("");
  const [currentStr, setCurrentStr] = useState("");

  const status = marginStatus(currentPct, minFrac, targetFrac);
  const meta = STATUS_META[status];
  const minPct = (minFrac ?? DEFAULT_MIN) * 100;
  const targetPct = targetFrac != null ? targetFrac * 100 : null;

  const scaleMax = Math.max(
    50,
    Math.ceil(((currentPct ?? 0) + 5) / 10) * 10,
    Math.ceil((minPct + 5) / 10) * 10,
    targetPct != null ? Math.ceil((targetPct + 5) / 10) * 10 : 0,
  );
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;

  const startEdit = () => {
    setMinStr(minFrac != null ? String(Math.round(minFrac * 1000) / 10) : "");
    setTargetStr(targetFrac != null ? String(Math.round(targetFrac * 1000) / 10) : "");
    setCurrentStr(currentPct != null ? String(Math.round(currentPct * 10) / 10) : "");
    setEditing(true);
  };

  const parsePct = (s: string): { ok: boolean; value: number | null } => {
    const t = s.trim();
    if (!t) return { ok: true, value: null };
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, value: null };
    return { ok: true, value: Math.round(n * 10) / 1000 };
  };

  const minVal = parsePct(minStr);
  const targetVal = parsePct(targetStr);
  const currentVal = parsePct(currentStr);
  const invalid =
    !minVal.ok ||
    !targetVal.ok ||
    (currentEditable && !currentVal.ok) ||
    (minVal.value != null && targetVal.value != null && targetVal.value < minVal.value);

  const save = () => {
    if (invalid) return;
    onSave({
      minFrac: minVal.value,
      targetFrac: targetVal.value,
      ...(currentEditable ? { currentFrac: currentVal.value } : {}),
    });
    setEditing(false);
  };

  const StatusIcon = status === "below" ? ShieldAlert : status === "target" ? ShieldCheck : Target;

  return (
    <div className="mb-[18px]">
      <div className="flex items-center justify-between mb-[8px] mx-[2px]">
        <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground">
          {title}
        </div>
        {!editing && (
          <button
            onClick={startEdit}
            className="flex items-center gap-[4px] text-[12px] font-display font-bold text-[var(--gold-dark)] transition-transform active:scale-[0.95]"
          >
            <Pencil className="w-[12px] h-[12px]" /> Set thresholds
          </button>
        )}
      </div>

      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px_15px]">
        <div className="flex items-center justify-between mb-[10px]">
          <div>
            <div className="font-display font-bold text-[26px] tabular-nums leading-none">
              {currentPct != null ? `${currentPct}%` : "—"}
            </div>
            <div className={`flex items-center gap-[5px] mt-[5px] text-[12.5px] font-semibold ${meta.color}`}>
              <StatusIcon className="w-[14px] h-[14px]" />
              {meta.label}
            </div>
          </div>
          <div className="text-right text-[12px] text-muted-foreground leading-[1.7]">
            <div>
              Min <b className="text-foreground tabular-nums">{Math.round(minPct * 10) / 10}%</b>
              {minFrac == null && <span className="opacity-60"> (default)</span>}
            </div>
            <div>
              Target{" "}
              <b className="text-foreground tabular-nums">
                {targetPct != null ? `${Math.round(targetPct * 10) / 10}%` : "—"}
              </b>
            </div>
          </div>
        </div>

        <div className="relative h-[10px] rounded-full bg-[rgba(23,24,28,0.07)] overflow-visible mt-[16px] mb-[6px]">
          {currentPct != null && (
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{ width: pos(currentPct), background: meta.bar }}
            />
          )}
          <div
            className="absolute top-[-4px] bottom-[-4px] w-[2.5px] rounded-full bg-[#B23B3B]"
            style={{ left: pos(minPct) }}
            title={`Minimum ${minPct}%`}
          />
          {targetPct != null && (
            <div
              className="absolute top-[-4px] bottom-[-4px] w-[2.5px] rounded-full bg-[#2E7D4F]"
              style={{ left: pos(targetPct) }}
              title={`Target ${targetPct}%`}
            />
          )}
        </div>
        <div className="flex justify-between text-[10.5px] text-muted-foreground tabular-nums mb-[2px]">
          <span>0%</span>
          <span>{scaleMax}%</span>
        </div>

        {helperText && !editing && (
          <div className="text-[12px] text-muted-foreground mt-[8px]">{helperText}</div>
        )}

        {editing && (
          <div className="mt-[12px] pt-[12px] border-t border-border">
            <div className={`grid ${currentEditable ? "grid-cols-3" : "grid-cols-2"} gap-[8px]`}>
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-[4px]">
                  Minimum %
                </span>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="25"
                  value={minStr}
                  onChange={(e) => setMinStr(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-[4px]">
                  Target %
                </span>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="35"
                  value={targetStr}
                  onChange={(e) => setTargetStr(e.target.value)}
                />
              </label>
              {currentEditable && (
                <label className="block">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-[4px]">
                    Current %
                  </span>
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    placeholder="27"
                    value={currentStr}
                    onChange={(e) => setCurrentStr(e.target.value)}
                  />
                </label>
              )}
            </div>
            {invalid && (
              <div className="text-[12px] text-destructive mt-[8px]">
                Use numbers 0–100, and keep the target at or above the minimum.
              </div>
            )}
            <div className="flex gap-[8px] mt-[10px]">
              <button
                onClick={save}
                disabled={invalid || saving}
                className="flex-1 rounded-[12px] py-[10px] font-display font-bold text-[13.5px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] disabled:opacity-50 transition-transform active:scale-[0.98]"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="flex-1 rounded-[12px] py-[10px] font-semibold text-[13.5px] bg-card border border-border text-muted-foreground transition-transform active:scale-[0.98]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
