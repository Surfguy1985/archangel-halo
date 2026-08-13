/**
 * FalkonControlCenter (Desktop) — admin-only overlay in the desktop HaloCommand.
 *
 * Renders as a wide full-screen overlay with the same 6 sections as the mobile
 * version, laid out in a 2-column grid for desktop ergonomics.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, RefreshCw, Loader2, CheckCircle2, XCircle, Minus, Shield,
  Zap, Link2, ArrowUpRight, RotateCcw,
} from "lucide-react";

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL as string;
const api = (p: string) => `${BASE}api${p}`;

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(api(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const json = await r.json();
  if (!r.ok) throw new Error((json as any)?.error ?? `HTTP ${r.status}`);
  return json as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GateStatus {
  gate: number;
  name: string;
  passed: boolean;
  detail?: string;
  error?: string;
  ts: string | null;
}

interface HealthData {
  mode: string;
  status: string;
  gatewayHealth: { ok: boolean; status?: string };
  verifiedAt: string | null;
  fullyConnected: boolean;
  gates: GateStatus[];
  capabilities: { total: number; registeredAt: string | null };
  twinSync: { properties: number; units: number; vendors: number };
  failedJobCount: number;
  recentInboundCount: number;
  webhookUrl: string;
  trustDocUrl: string;
  clientId: string;
  partnerClientId: string | null;
}

interface Execution {
  id: string;
  unit_label: string;
  phase: string;
  status: string;
  mode_at_start: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  property_name: string | null;
  duration_ms: number | null;
}

interface InboundEvent {
  id: string;
  falkon_event_id: string | null;
  event_type: string;
  status: string;
  processed_at: string | null;
  error: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MODE_COLORS: Record<string, string> = {
  OFF: "bg-white/10 text-white/40",
  SHADOW: "bg-amber-500/15 text-amber-400",
  ASSISTED: "bg-blue-500/15 text-blue-400",
  LIVE: "bg-[#22C55E]/15 text-[#22C55E]",
};

const GATE_CAPABILITY_LIST = [
  "make_ready.start","make_ready.phase_advance","make_ready.phase_rollback","make_ready.complete",
  "unit.status_changed","unit.create","unit.update",
  "job.walk_approved","job.invoice_created","job.crew_paid","job.create","job.update","job.complete",
  "invoice.create","invoice.paid","invoice.overdue",
  "crew.create","crew.assign","crew.check_in","crew.check_out",
  "property.sync","vendor.sync",
];

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";
}

function GateRow({ gate, running, onRerun }: { gate: GateStatus; running: boolean; onRerun: () => void }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0 group">
      <div className={`w-6 h-6 rounded-full grid place-items-center shrink-0 text-[9px] font-bold ${
        gate.passed ? "bg-[#22C55E]/20 text-[#22C55E]" :
        gate.ts ? "bg-[#E11D48]/20 text-[#E11D48]" :
        "bg-white/8 text-white/30"
      }`}>{gate.gate}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-white/85">{gate.name}</div>
        {(gate.detail || gate.error) && (
          <div className={`text-[11px] mt-0.5 ${gate.error ? "text-[#E11D48]/70" : "text-white/40"}`}>
            {gate.error ?? gate.detail}
          </div>
        )}
      </div>
      {running ? (
        <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
      ) : gate.passed ? (
        <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
      ) : gate.ts ? (
        <XCircle className="w-4 h-4 text-[#E11D48] shrink-0" />
      ) : (
        <Minus className="w-4 h-4 text-white/25 shrink-0" />
      )}
      <button
        onClick={onRerun}
        className="w-7 h-7 rounded-full grid place-items-center opacity-0 group-hover:opacity-100 bg-white/8 text-white/40 hover:text-white/70 transition-all"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const TABS = ["Health", "Mode", "Capabilities", "Sync", "Jobs", "Events"] as const;
type Tab = typeof TABS[number];

interface FalkonControlCenterProps {
  onClose: () => void;
}

export function FalkonControlCenter({ onClose }: FalkonControlCenterProps) {
  const [tab, setTab] = useState<Tab>("Health");
  const [health, setHealth] = useState<HealthData | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [inbound, setInbound] = useState<InboundEvent[]>([]);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [runningGate, setRunningGate] = useState<number | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const data = await apiFetch<HealthData>("/falkon/admin/health");
      setHealth(data);
    } catch { /* ignore */ }
    finally { setLoadingHealth(false); }
  }, []);

  const loadExecutions = useCallback(async () => {
    try {
      const data = await apiFetch<{ executions: Execution[] }>("/falkon/admin/executions?limit=20");
      setExecutions(data.executions);
    } catch { /* ignore */ }
  }, []);

  const loadInbound = useCallback(async () => {
    try {
      const data = await apiFetch<{ events: InboundEvent[] }>("/falkon/admin/inbound?limit=30");
      setInbound(data.events);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadHealth();
    void loadExecutions();
    void loadInbound();
  }, [loadHealth, loadExecutions, loadInbound]);

  // Keyboard close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const runAllGates = async () => {
    setVerifying(true);
    try {
      const result = await apiFetch<{ fullyConnected: boolean }>(
        "/falkon/admin/verify/all", { method: "POST" }
      );
      await loadHealth();
      if (result.fullyConnected) window.dispatchEvent(new Event("falkon:verified"));
    } catch { /* ignore */ }
    finally { setVerifying(false); }
  };

  const runSingleGate = async (gateNum: number) => {
    setRunningGate(gateNum);
    try {
      await apiFetch(`/falkon/admin/verify/gate/${gateNum}`, { method: "POST" });
      await loadHealth();
    } catch { /* ignore */ }
    finally { setRunningGate(null); }
  };

  const retryExecution = async (id: string) => {
    try {
      await apiFetch(`/falkon/admin/executions/${id}/retry`, { method: "POST" });
      await loadExecutions();
    } catch { /* ignore */ }
  };

  const syncTwins = async (type: string) => {
    setSyncing(type);
    try {
      await apiFetch(`/falkon/admin/sync/${type}`, { method: "POST" });
      await loadHealth();
    } catch { /* ignore */ }
    finally { setSyncing(null); }
  };

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-[#050B16]/96 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-white/8 shrink-0">
        <div>
          <div className="text-[10px] font-bold tracking-[0.22em] uppercase text-amber-400/70 mb-0.5">HALO × Falkon</div>
          <div className="text-[17px] font-bold text-white/90">Control Center</div>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          {health && (
            <>
              <div className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-[0.15em] uppercase ${MODE_COLORS[health.mode] ?? MODE_COLORS.OFF}`}>
                {health.mode}
              </div>
              <div className={`flex items-center gap-1.5 text-[11px] font-medium ${health.fullyConnected ? "text-[#22C55E]" : "text-white/40"}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${health.fullyConnected ? "bg-[#22C55E] animate-pulse" : "bg-white/25"}`} />
                {health.fullyConnected ? "Fully Connected — SHADOW verified" : health.status}
              </div>
              {health.verifiedAt && (
                <div className="text-[10px] text-white/30">Last verified: {fmt(health.verifiedAt)}</div>
              )}
            </>
          )}
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-full grid place-items-center bg-white/6 hover:bg-white/10 transition-colors ml-2">
          <X className="w-4 h-4 text-white/60" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-white/6 shrink-0">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-all ${
              tab === t ? "bg-amber-500/15 text-amber-300" : "text-white/40 hover:text-white/65 hover:bg-white/4"
            }`}
          >
            {t}
            {t === "Jobs" && health && health.failedJobCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#E11D48]/20 text-[#E11D48] text-[9px]">{health.failedJobCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">

        {/* ── Health ── */}
        {tab === "Health" && (
          <div className="max-w-4xl mx-auto">
            {loadingHealth ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-amber-400 animate-spin" /></div>
            ) : health ? (
              <div className="grid grid-cols-2 gap-6">
                {/* Left: status + gates */}
                <div className="space-y-4">
                  {health.fullyConnected ? (
                    <div className="rounded-[16px] p-4 bg-[#22C55E]/8 border border-[#22C55E]/20 text-center">
                      <CheckCircle2 className="w-6 h-6 text-[#22C55E] mx-auto mb-2" />
                      <div className="text-[14px] font-bold text-[#22C55E]">Fully Connected — SHADOW verified</div>
                      <div className="text-[11.5px] text-white/45 mt-1">
                        Mode: {health.mode} · Partner: Falkon Ops · {health.capabilities.total}/22 capabilities
                      </div>
                      {health.verifiedAt && <div className="text-[10.5px] text-white/30 mt-0.5">Last verified: {fmt(health.verifiedAt)}</div>}
                    </div>
                  ) : (
                    <div className="rounded-[16px] p-4 bg-amber-500/6 border border-amber-500/20">
                      <div className="text-[13px] font-semibold text-amber-400 mb-1">Not fully verified</div>
                      <div className="text-[12px] text-white/40">Complete all 7 gates to establish a verified connection.</div>
                    </div>
                  )}

                  {/* 7-gate status */}
                  <div className="rounded-[16px] bg-white/[0.03] border border-white/6 px-4">
                    {health.gates.map(g => (
                      <GateRow key={g.gate} gate={g} running={runningGate === g.gate} onRerun={() => runSingleGate(g.gate)} />
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <button
                      onClick={runAllGates}
                      disabled={verifying || runningGate !== null}
                      className="flex-1 flex items-center justify-center gap-2 rounded-[12px] bg-amber-500/15 text-amber-300 border border-amber-500/25 py-3 text-[13px] font-semibold hover:bg-amber-500/22 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      {verifying ? "Verifying…" : "Run Verify"}
                    </button>
                    <button onClick={loadHealth} className="px-4 flex items-center gap-2 rounded-[12px] bg-white/5 border border-white/8 text-[12px] text-white/50 hover:text-white/70 transition-all">
                      <RefreshCw className="w-4 h-4" /> Refresh
                    </button>
                  </div>
                </div>

                {/* Right: connection details */}
                <div className="space-y-4">
                  <div className="rounded-[16px] bg-white/[0.03] border border-white/6 p-4 space-y-3">
                    <div className="text-[10.5px] text-white/35 tracking-widest uppercase mb-1">Connection Details</div>
                    <div className="space-y-2 text-[12px]">
                      <div className="flex items-center gap-2 text-white/50"><Link2 className="w-3.5 h-3.5 shrink-0" /><span className="truncate font-mono text-[11px]">{health.trustDocUrl}</span></div>
                      <div className="flex items-center gap-2 text-white/50"><ArrowUpRight className="w-3.5 h-3.5 shrink-0" /><span className="truncate font-mono text-[11px]">{health.webhookUrl}</span></div>
                      <div className="flex items-center gap-2 text-white/50"><Shield className="w-3.5 h-3.5 shrink-0" /><span>Client: <span className="font-mono text-[11px]">{health.clientId}</span></span></div>
                      {health.partnerClientId && <div className="flex items-center gap-2 text-white/50"><Shield className="w-3.5 h-3.5 shrink-0" /><span>Partner: <span className="font-mono text-[11px]">{health.partnerClientId}</span></span></div>}
                    </div>
                  </div>
                  <div className="rounded-[16px] bg-white/[0.03] border border-white/6 p-4">
                    <div className="text-[10.5px] text-white/35 tracking-widest uppercase mb-3">Gateway Health</div>
                    <div className={`text-[13px] font-semibold ${health.gatewayHealth.ok ? "text-[#22C55E]" : "text-[#E11D48]"}`}>
                      {health.gatewayHealth.ok ? "● Connected" : "● Unreachable"}
                    </div>
                    <div className="text-[11px] text-white/30 mt-0.5">{health.gatewayHealth.status ?? "—"}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[14px] text-white/30 text-center py-16">Could not load health data.</div>
            )}
          </div>
        )}

        {/* ── Mode ── */}
        {tab === "Mode" && (
          <div className="max-w-2xl mx-auto space-y-4">
            {health && (
              <>
                <div className="rounded-[16px] bg-white/[0.03] border border-white/6 p-5">
                  <div className="text-[11px] text-white/35 tracking-widest uppercase mb-3">Current Mode</div>
                  <div className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-[13px] font-bold ${MODE_COLORS[health.mode] ?? MODE_COLORS.OFF}`}>
                    <div className="w-2 h-2 rounded-full bg-current" />
                    {health.mode}
                  </div>
                </div>

                {health.mode === "SHADOW" && (
                  <div className="rounded-[16px] bg-white/[0.03] border border-white/6 p-5">
                    <div className="text-[11px] text-white/35 tracking-widest uppercase mb-4">SHADOW → ASSISTED eligibility</div>
                    <div className="space-y-3">
                      {[
                        { label: "All 7 verification gates pass", pass: health.fullyConnected },
                        { label: "22 capabilities registered with gateway", pass: !!health.capabilities.registeredAt },
                        { label: "Gateway health check OK", pass: health.gatewayHealth.ok },
                        { label: "At least 1 property twin synced", pass: health.twinSync.properties > 0 },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border grid place-items-center shrink-0 ${item.pass ? "bg-[#22C55E]/15 border-[#22C55E]/40" : "bg-white/5 border-white/15"}`}>
                            {item.pass && <CheckCircle2 className="w-3 h-3 text-[#22C55E]" strokeWidth={2.5} />}
                          </div>
                          <span className={`text-[13px] ${item.pass ? "text-white/80" : "text-white/40"}`}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-[16px] bg-white/[0.02] border border-white/5 p-5">
                  <div className="text-[11px] text-white/30 tracking-widest uppercase mb-2">ASSISTED → LIVE</div>
                  <div className="text-[13px] text-white/35">Requires out-of-band partnership enablement by Falkon. Cannot be self-promoted from this UI — contact your Falkon account manager.</div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Capabilities ── */}
        {tab === "Capabilities" && (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[13px] text-white/50">{health?.capabilities.total ?? 22} capabilities registered</div>
              {health?.capabilities.registeredAt && (
                <div className="text-[11px] text-[#22C55E]/70">Last registered {fmt(health.capabilities.registeredAt)}</div>
              )}
            </div>
            <div className="rounded-[16px] bg-white/[0.03] border border-white/6 divide-y divide-white/4">
              {GATE_CAPABILITY_LIST.map((cap, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E] shrink-0" />
                  <div className="text-[12.5px] text-white/75 font-mono flex-1">{cap}</div>
                  <div className="text-[11px] text-[#22C55E]/60">registered</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Sync ── */}
        {tab === "Sync" && (
          <div className="max-w-2xl mx-auto space-y-4">
            {health && [
              { label: "Properties", count: health.twinSync.properties, total: 11, type: "properties" },
              { label: "Units", count: health.twinSync.units, total: 48, type: "units/all" },
              { label: "Vendors / Crews", count: health.twinSync.vendors, total: null, type: "vendors" },
            ].map(item => (
              <div key={item.type} className="rounded-[16px] bg-white/[0.03] border border-white/6 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[14px] font-semibold text-white/85">{item.label}</div>
                    <div className="text-[12px] text-white/40">{item.count}{item.total ? `/${item.total}` : ""} synced</div>
                  </div>
                  <button
                    onClick={() => syncTwins(item.type)}
                    disabled={syncing !== null}
                    className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-white/6 border border-white/10 text-[12px] text-white/60 hover:text-white/80 transition-all disabled:opacity-50"
                  >
                    {syncing === item.type ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Force Sync
                  </button>
                </div>
                {item.total && (
                  <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                    <div className="h-full rounded-full bg-[#22C55E] transition-all" style={{ width: `${Math.min(100, (item.count / item.total) * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Jobs ── */}
        {tab === "Jobs" && (
          <div className="max-w-3xl mx-auto">
            {executions.length === 0 ? (
              <div className="text-[14px] text-white/30 text-center py-16">No executions yet.</div>
            ) : (
              <div className="rounded-[16px] bg-white/[0.03] border border-white/6 divide-y divide-white/4">
                {executions.map(ex => (
                  <div key={ex.id} className={`px-5 py-4 ${ex.status === "failed" ? "bg-[#E11D48]/4" : ""}`}>
                    <div className="flex items-start gap-3">
                      <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                        ex.status === "active" ? "bg-blue-400 animate-pulse" :
                        ex.status === "failed" ? "bg-[#E11D48]" :
                        ex.status === "completed" ? "bg-[#22C55E]" : "bg-white/30"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="text-[13px] font-semibold text-white/85">{ex.property_name ?? "—"} · {ex.unit_label}</div>
                          {ex.mode_at_start === "SHADOW" && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25">SHADOW</span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-white/40">
                          Phase: {ex.phase} · Started: {fmt(ex.started_at)} {ex.duration_ms ? `· ${Math.round(ex.duration_ms / 1000)}s` : ""}
                        </div>
                        {ex.error && <div className="text-[11px] text-[#E11D48]/70 mt-1">{ex.error}</div>}
                      </div>
                      {ex.status === "failed" && (
                        <button
                          onClick={() => retryExecution(ex.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] bg-white/6 border border-white/10 text-[11.5px] text-white/50 hover:text-white/75 transition-all"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Retry
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Events ── */}
        {tab === "Events" && (
          <div className="max-w-3xl mx-auto">
            {inbound.length === 0 ? (
              <div className="text-[14px] text-white/30 text-center py-16">No inbound events yet.</div>
            ) : (
              <div className="rounded-[16px] bg-white/[0.03] border border-white/6 divide-y divide-white/4">
                {inbound.map(ev => (
                  <div key={ev.id} className={`px-5 py-4 ${ev.status === "failed" ? "bg-[#E11D48]/4" : ""}`}>
                    <div className="flex items-start gap-3">
                      <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                        ev.status === "processed" ? "bg-[#22C55E]" :
                        ev.status === "failed" ? "bg-[#E11D48]" : "bg-amber-400 animate-pulse"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-white/85">{ev.event_type}</div>
                        <div className="text-[11.5px] text-white/40">{fmt(ev.created_at)} · {ev.status}</div>
                        {ev.falkon_event_id && <div className="text-[10.5px] font-mono text-white/25 mt-0.5">{ev.falkon_event_id}</div>}
                        {ev.error && <div className="text-[11px] text-[#E11D48]/70 mt-1">{ev.error}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
