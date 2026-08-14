import {
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

const BASE44_URL = "https://wakeful-ready-track-flow.base44.app";
const STATUS_URL = `${import.meta.env.BASE_URL}api/settings/sync-base44/status`;
const SYNC_URL   = `${import.meta.env.BASE_URL}api/settings/sync-base44`;

type UnplacedRow = {
  resource: string;
  base44Id: string | null;
  reason: string;
};

type SyncStatus = {
  finishedAt: string;
  totalCreated: number;
  totalUpdated: number;
  totalErrors: number;
  unplaced: number;
  unplacedDetail: UnplacedRow[];
  unplacedDetailTruncated: boolean;
} | null;

/**
 * Both sync endpoints return `{ result, health }` (POST adds `ok`). Older
 * builds returned the flat result, so accept either shape defensively.
 */
function parseSyncPayload(json: any): SyncStatus {
  const result = json?.result ?? json;
  if (!result?.finishedAt) return null;
  const health = json?.health ?? {};
  return {
    finishedAt: result.finishedAt,
    totalCreated: result.totalCreated ?? 0,
    totalUpdated: result.totalUpdated ?? 0,
    totalErrors: result.totalErrors ?? 0,
    unplaced: health.unplaced ?? result.totalSkipped ?? 0,
    unplacedDetail: Array.isArray(health.unplacedDetail) ? health.unplacedDetail : [],
    unplacedDetailTruncated: health.unplacedDetailTruncated ?? false,
  };
}

function fmtAgo(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 10)  return "just now";
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/**
 * WorkEmbed — launches the connected Base44 work-management app and shows
 * live sync status so the user can see when changes from Base44 have landed
 * in Dispatch and Calendar (and across the rest of HALO).
 *
 * Base44 sets X-Frame-Options: DENY so the app opens in its own tab.
 * Sync runs automatically every 2 minutes; the "Sync now" button forces it.
 */
export default function WorkEmbed() {
  const [status, setStatus]   = useState<SyncStatus>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [tick, setTick]       = useState(0); // force re-render for "Xm ago"
  const [showUnplaced, setShowUnplaced] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(STATUS_URL);
      if (r.ok) {
        const parsed = parseSyncPayload(await r.json());
        if (parsed) setStatus(parsed);
      }
    } catch { /* silent */ }
  }, []);

  // Poll status every 15 s so "Xm ago" stays fresh and a background auto-sync
  // shows up without a manual refresh.
  useEffect(() => {
    void fetchStatus();
    const id = setInterval(() => { void fetchStatus(); setTick(t => t + 1); }, 15_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const r = await fetch(SYNC_URL, { method: "POST" });
      if (!r.ok) throw new Error(`Sync failed (${r.status})`);
      const parsed = parseSyncPayload(await r.json());
      if (parsed) setStatus(parsed);
    } catch (e: any) {
      setError(e?.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const hasErrors   = (status?.totalErrors ?? 0) > 0;
  const changed     = (status?.totalCreated ?? 0) + (status?.totalUpdated ?? 0);
  const unplaced    = status?.unplaced ?? 0;
  const hasUnplaced = unplaced > 0;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-8">

      {/* Main launch card */}
      <div className="w-full max-w-md rounded-2xl border border-[var(--hairline)] bg-[var(--secondary)] p-8 flex flex-col items-center gap-6 shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-[var(--gold-light)] flex items-center justify-center shadow-[0_0_24px_rgba(180,255,68,0.35)]">
          <ExternalLink className="w-7 h-7 text-black" strokeWidth={2.5} />
        </div>

        <div className="text-center space-y-1">
          <p className="font-display font-bold text-lg text-white tracking-tight">
            Track Flow — Work App
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Everything you add here syncs automatically into Dispatch, Calendar,
            and the rest of HALO every 2 minutes.
          </p>
        </div>

        <a
          href={BASE44_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full h-12 rounded-xl bg-[var(--gold-light)] text-black font-display font-bold text-sm tracking-wide flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(180,255,68,0.25)] hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all"
        >
          Open Work App
          <ExternalLink className="w-4 h-4" strokeWidth={2.5} />
        </a>
      </div>

      {/* Sync status card */}
      <div className="w-full max-w-md rounded-2xl border border-[var(--hairline)] bg-[var(--secondary)] px-6 py-5 flex flex-col gap-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <span className="font-display font-bold text-xs tracking-[0.15em] uppercase text-muted-foreground">
            Sync Status
          </span>
          <button
            onClick={syncNow}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 h-7 rounded-full bg-white/10 hover:bg-white/20 text-xs font-bold font-display text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>

        {/* Status row */}
        {status ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {hasErrors ? (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              ) : hasUnplaced ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-[var(--gold-light)] shrink-0" />
              )}
              <span className="text-sm text-white font-medium">
                {hasErrors
                  ? `Last sync had ${status.totalErrors} error${status.totalErrors !== 1 ? "s" : ""}`
                  : hasUnplaced
                    ? `${unplaced} Work App record${unplaced !== 1 ? "s" : ""} not in HALO`
                    : changed > 0
                      ? `${changed} record${changed !== 1 ? "s" : ""} updated`
                      : "Up to date — no changes"}
              </span>
              <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                <Clock className="w-3 h-3" />
                {fmtAgo(status.finishedAt)}
              </span>
            </div>

            {/* Mini breakdown pills */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { label: "Created", val: status.totalCreated },
                { label: "Updated", val: status.totalUpdated },
                { label: "Errors",  val: status.totalErrors, tone: "danger" as const },
                { label: "Not in HALO", val: unplaced, tone: "warn" as const },
              ].map(({ label, val, tone }) => (
                <span
                  key={label}
                  className={`px-3 py-1 rounded-full text-[11px] font-bold font-display ${
                    tone === "danger" && val > 0
                      ? "bg-red-500/20 text-red-400"
                      : tone === "warn" && val > 0
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-white/10 text-white/70"
                  }`}
                >
                  {val} {label}
                </span>
              ))}
            </div>

            {/* Unplaced drill-in — Work App rows HALO couldn't store */}
            {hasUnplaced && (
              <div className="mt-1 rounded-xl border border-amber-500/30 bg-amber-500/10 overflow-hidden">
                <button
                  onClick={() => setShowUnplaced((v) => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-amber-500/10 transition-colors"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-xs font-bold font-display text-amber-300 flex-1">
                    {unplaced} record{unplaced !== 1 ? "s" : ""} the Work App is serving
                    {" "}that HALO couldn't place
                  </span>
                  {showUnplaced ? (
                    <ChevronUp className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                </button>
                {showUnplaced && (
                  <div className="border-t border-amber-500/20 max-h-64 overflow-y-auto">
                    {status.unplacedDetail.length === 0 ? (
                      <p className="px-3 py-2.5 text-xs text-amber-200/70">
                        Detail unavailable for this run — run "Sync now" to capture
                        the per-record breakdown.
                      </p>
                    ) : (
                      <ul className="divide-y divide-amber-500/10">
                        {status.unplacedDetail.map((row, i) => (
                          <li key={`${row.resource}-${row.base44Id ?? i}`} className="px-3 py-2 flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold font-display uppercase tracking-wide text-amber-300">
                                {row.resource}
                              </span>
                              <span className="text-[10px] font-mono text-amber-200/50 truncate">
                                {row.base44Id ?? "no id"}
                              </span>
                            </div>
                            <span className="text-xs text-amber-100/80">{row.reason}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {status.unplacedDetailTruncated && (
                      <p className="px-3 py-2 text-[11px] text-amber-200/60 border-t border-amber-500/10">
                        Showing the first {status.unplacedDetail.length} of {unplaced} — the
                        count above is exact.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {syncing ? "Running first sync…" : 'No sync run yet — click "Sync now" to pull from Base44.'}
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* What syncs */}
        <div className="border-t border-[var(--hairline)] pt-4 grid grid-cols-2 gap-x-4 gap-y-1">
          {[
            "Jobs → Dispatch",
            "Events → Calendar",
            "Properties",
            "Crews",
            "Units",
            "Invoices",
            "Price Book",
            "Owners / Contacts",
          ].map((item) => (
            <div key={item} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold-light)] shrink-0" />
              {item}
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground/50 text-center">
          Auto-syncs every 2 minutes · Next sync within {" "}
          {status
            ? `${Math.max(0, 2 - Math.floor((Date.now() - new Date(status.finishedAt).getTime()) / 60_000))}m`
            : "2m"}
        </p>
      </div>
    </div>
  );
}
