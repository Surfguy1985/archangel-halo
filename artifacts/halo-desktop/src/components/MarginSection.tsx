import { useState} from "react";
import { Pencil, ShieldCheck, ShieldAlert, Target} from "lucide-react";

const DEFAULT_MIN = 0.25;

const inputCls =
  "w-full bg-background border border-border rounded-md py-2 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums";

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
  { label: string; color: string; bar: string}
> = {
  below: {
    label: "Below minimum",
    color: "text-[#B23B3B]",
    bar: "linear-gradient(90deg,#D96A6A,#B23B3B)",
 },
  between: {
    label: "Above minimum",
    color: "text-[var(--gold-dark)]",
    bar: "var(--primary)",
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
  headerExtra,
  children,
}: {
  title?: string;
  /** Current margin as a PERCENT number (e.g. 27.5) or null. */
  currentPct: number | null;
  /** Minimum threshold as a FRACTION (0.25) or null (falls back to 25%). */
  minFrac: number | null | undefined;
  /** Target as a FRACTION (0.35) or null. */
  targetFrac: number | null | undefined;
  currentEditable?: boolean;
  saving?: boolean;
  onSave: (v: {
    minFrac: number | null;
    targetFrac: number | null;
    currentFrac?: number | null;
 }) => void;
  helperText?: string;
  headerExtra?: React.ReactNode;
  children?: React.ReactNode;
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
  const pos = (v: number) =>`${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;

  const startEdit = () => {
    setMinStr(minFrac != null ? String(Math.round(minFrac * 1000) / 10) : "");
    setTargetStr(targetFrac != null ? String(Math.round(targetFrac * 1000) / 10) : "");
    setCurrentStr(currentPct != null ? String(Math.round(currentPct * 10) / 10) : "");
    setEditing(true);
 };

  const parsePct = (s: string): { ok: boolean; value: number | null} => {
    const t = s.trim();
    if (!t) return { ok: true, value: null};
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, value: null};
    return { ok: true, value: Math.round(n * 10) / 1000};
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
      ...(currentEditable ? { currentFrac: currentVal.value} : {}),
   });
    setEditing(false);
 };

  const StatusIcon =
    status === "below" ? ShieldAlert : status === "target" ? ShieldCheck : Target;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-display font-bold text-[var(--ink)]">{title}</h2>
        <div className="flex items-center gap-4">
          {!editing && (
            <button
              onClick={startEdit}
              className="flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Set thresholds
            </button>
          )}
          {headerExtra}
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-3xl font-mono font-bold text-[var(--ink)] tabular-nums leading-none">
              {currentPct != null ?`${currentPct}%` : "—"}
            </div>
            <div className={`flex items-center gap-1.5 mt-2 text-sm font-semibold ${meta.color}`}>
              <StatusIcon className="w-4 h-4" />
              {meta.label}
            </div>
          </div>
          <div className="text-right text-sm text-muted-foreground leading-7">
            <div>
              Min <b className="text-foreground tabular-nums">{Math.round(minPct * 10) / 10}%</b>
              {minFrac == null && <span className="opacity-60"> (default)</span>}
            </div>
            <div>
              Target{" "}
              <b className="text-foreground tabular-nums">
                {targetPct != null ?`${Math.round(targetPct * 10) / 10}%` : "—"}
              </b>
            </div>
          </div>
        </div>

        <div className="relative h-2.5 rounded-full bg-black/[0.07] mt-5 mb-1.5">
          {currentPct != null && (
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{ width: pos(currentPct), background: meta.bar}}
            />
          )}
          <div
            className="absolute -top-1 -bottom-1 w-[2.5px] rounded-full bg-[#B23B3B]"
            style={{ left: pos(minPct)}}
            title={`Minimum ${minPct}%`}
          />
          {targetPct != null && (
            <div
              className="absolute -top-1 -bottom-1 w-[2.5px] rounded-full bg-[#2E7D4F]"
              style={{ left: pos(targetPct)}}
              title={`Target ${targetPct}%`}
            />
          )}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>0%</span>
          <span>{scaleMax}%</span>
        </div>

        {helperText && !editing && (
          <div className="text-sm text-muted-foreground mt-3">{helperText}</div>
        )}

        {editing && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className={`grid ${currentEditable ? "grid-cols-3" : "grid-cols-2"} gap-3`}>
              <label className="block">
                <span className="block text-xs font-semibold text-muted-foreground mb-1.5">
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
                <span className="block text-xs font-semibold text-muted-foreground mb-1.5">
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
                  <span className="block text-xs font-semibold text-muted-foreground mb-1.5">
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
              <div className="text-sm text-destructive mt-2">
                Use numbers 0–100, and keep the target at or above the minimum.
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={save}
                disabled={invalid || saving}
                className="px-4 py-2 rounded-md font-semibold text-sm text-[var(--ink)] bg-[var(--primary)] shadow-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 rounded-md font-medium text-sm bg-card border border-border text-muted-foreground hover:bg-black/[0.03]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {children}
      </div>
    </section>
  );
}
