/**
 * FalkonControlCenter — admin-only overlay in HaloCommand.
 *
 * Provides a 6-section control plane accessible by clicking the Falkon mode
 * badge in the HaloCommand header. All office-app users are treated as
 * admins (access to the office app is controlled by holding its URL).
 *
 * Sections:
 *   1. Connection Health — 7-gate status grid + Run Verify
 *   2. Mode & Eligibility — current mode, promotion checklist
 *   3. Capability Coverage — 22 caps grid
 *   4. Twin Sync Status — properties / units / vendors
 *   5. Active & Failed Jobs — recent executions
 *   6. Inbound Events — recent falkon_inbound_events
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, RefreshCw, Loader2, CheckCircle2, XCircle, Minus, Shield,
  Zap, Link2, ArrowUpRight, RotateCcw, ChevronRight, AlertTriangle,
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
  stub?: boolean;
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

// ─── Sub-components ───────────────────────────────────────────────────────────

const STUB_TOOLTIP = "No live gateway configured. Set eventIngestUrl in the Falkon connection to enable full round-trip verification.";

function GateRow({ gate, running }: { gate: GateStatus; running: boolean }) {
  const isStub = gate.passed && gate.stub;

  return (
    <div className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
      <div className={`w-5 h-5 rounded-full grid place-items-center shrink-0 text-[9px] font-bold ${
        isStub ? "bg-amber-500/20 text-amber-400" :
        gate.passed ? "bg-[#22C55E]/20 text-[#22C55E]" :
        gate.ts ? "bg-[#E11D48]/20 text-[#E11D48]" :
        "bg-white/8 text-white/30"
      }`}>
        {gate.gate}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-white/85 truncate">{gate.name}</div>
        {(gate.detail || gate.error) && (
          <div className={`text-[10.5px] truncate mt-0.5 ${gate.error ? "text-[#E11D48]/70" : "text-white/40"}`}>
            {gate.error ?? gate.detail}
          </div>
        )}
      </div>
      {running ? (
        <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
      ) : isStub ? (
        <div className="relative group/stub shrink-0">
          <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold tracking-wide uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30 cursor-default select-none">
            stub
          </span>
          {/* Tooltip */}
          <div className="pointer-events-none absolute right-0 bottom-full mb-2 w-56 rounded-[10px] bg-[#0E1A2D] border border-amber-500/25 shadow-xl px-3 py-2 opacity-0 group-hover/stub:opacity-100 transition-opacity duration-150 z-50">
            <div className="text-[10px] font-semibold text-amber-400 mb-1">Stub mode active</div>
            <div className="text-[10px] text-white/55 leading-relaxed">{STUB_TOOLTIP}</div>
            {/* Arrow */}
            <div className="absolute right-3 top-full -mt-px w-2 h-2 rotate-45 border-b border-r border-amber-500/25 bg-[#0E1A2D]" />
          </div>
        </div>
      ) : gate.passed ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E] shrink-0" />
      ) : gate.ts ? (
        <XCircle className="w-3.5 h-3.5 text-[#E11D48] shrink-0" />
      ) : (
        <Minus className="w-3.5 h-3.5 text-white/25 shrink-0" />
      )}
    </div>
  );
}

const MODE_COLORS: Record<string, string> = {
  OFF: "bg-white/10 text-white/40",
  SHADOW: "bg-amber-500/15 text-amber-400",
  ASSISTED: "bg-blue-500/15 text-blue-400",
  LIVE: "bg-[#22C55E]/15 text-[#22C55E]",
};

const TABS = ["Health", "Mode", "Capabilities", "Sync", "Jobs", "Events"] as const;
type Tab = typeof TABS[number];

// ─── Main Component ───────────────────────────────────────────────────────────

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

  const runAllGates = async () => {
    setVerifying(true);
    // Poll /health every 600ms so gate rows update one-by-one while /verify/all runs
    // server-side (that endpoint writes verificationSteps after each gate, so polling
    // /health shows live gate-by-gate progress without bypassing its DB finalization).
    const poll = setInterval(() => void loadHealth(), 600);
    try {
      const result = await apiFetch<{ gates: Array<{ gate: number; passed: boolean }>; fullyConnected: boolean }>(
        "/falkon/admin/verify/all", { method: "POST" }
      );
      clearInterval(poll);
      await loadHealth(); // final authoritative refresh
      if (result.fullyConnected) window.dispatchEvent(new Event("falkon:verified"));
    } catch { /* ignore */ }
    finally { clearInterval(poll); setVerifying(false); setRunningGate(null); }
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

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-[#060D1A]" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-amber-400/70 mb-0.5">HALO × Falkon</div>
          <div className="text-[14px] font-bold text-white/90">Control Center</div>
        </div>
        {health && (
          <div className="flex items-center gap-2">
            <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-[0.15em] uppercase ${MODE_COLORS[health.mode] ?? MODE_COLORS.OFF}`}>
              {health.mode}
            </div>
            <div className={`flex items-center gap-1 text-[10px] font-medium ${health.fullyConnected ? "text-[#22C55E]" : "text-white/40"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${health.fullyConnected ? "bg-[#22C55E] animate-pulse" : "bg-white/25"}`} />
              {health.fullyConnected ? "Verified" : health.status}
            </div>
          </div>
        )}
        <button onClick={onClose} className="w-8 h-8 rounded-full grid place-items-center bg-white/6 hover:bg-white/10 transition-colors">
          <X className="w-4 h-4 text-white/60" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 px-3 py-2 border-b border-white/6 shrink-0 overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all ${
              tab === t ? "bg-amber-500/15 text-amber-300" : "text-white/40 hover:text-white/65"
            }`}
          >
            {t}
            {t === "Jobs" && health && health.failedJobCount > 0 && (
              <span className="ml-1 px-1 py-0.5 rounded-full bg-[#E11D48]/20 text-[#E11D48] text-[8px]">{health.failedJobCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Health ── */}
        {tab === "Health" && (
          <div className="p-4 space-y-4">
            {loadingHealth ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-amber-400 animate-spin" /></div>
            ) : health ? (
              <>
                {/* Fully connected status */}
                {health.fullyConnected ? (
                  <div className="rounded-[14px] p-3.5 bg-[#22C55E]/8 border border-[#22C55E]/20 text-center">
                    <CheckCircle2 className="w-5 h-5 text-[#22C55E] mx-auto mb-1.5" />
                    <div className="text-[13px] font-bold text-[#22C55E]">Fully Connected — SHADOW verified</div>
                    <div className="text-[11px] text-white/45 mt-0.5">
                      Mode: {health.mode} · {health.capabilities.total}/22 capabilities · Last: {fmt(health.verifiedAt)}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[14px] p-3 bg-amber-500/6 border border-amber-500/20">
                    <div className="text-[12px] font-semibold text-amber-400 mb-0.5">Not fully verified</div>
                    <div className="text-[11px] text-white/40">Complete all 7 gates to establish a verified connection.</div>
                  </div>
                )}

                {/* 7-gate grid */}
                <div className="rounded-[14px] bg-white/[0.035] border border-white/6 px-3">
                  {health.gates.map(g => (
                    <div key={g.gate} className="flex items-center group">
                      <div className="flex-1">
                        <GateRow gate={g} running={runningGate === g.gate} />
                      </div>
                      <button
                        onClick={() => runSingleGate(g.gate)}
                        disabled={verifying || runningGate !== null}
                        className="ml-2 w-6 h-6 rounded-full grid place-items-center opacity-0 group-hover:opacity-100 bg-white/8 text-white/50 hover:text-white/80 transition-all disabled:opacity-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={runAllGates}
                    disabled={verifying || runningGate !== null}
                    className="flex-1 flex items-center justify-center gap-2 rounded-[12px] bg-amber-500/15 text-amber-300 border border-amber-500/25 py-2.5 text-[12.5px] font-semibold hover:bg-amber-500/20 active:scale-[0.97] transition-all disabled:opacity-50"
                  >
                    {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    {verifying ? "Verifying…" : "Run All 7 Gates"}
                  </button>
                  <button
                    onClick={loadHealth}
                    className="w-10 h-10 grid place-items-center rounded-[12px] bg-white/5 border border-white/8 text-white/50 hover:text-white/70 active:scale-[0.97] transition-all"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* URLs */}
                <div className="space-y-1.5 text-[10.5px] text-white/35">
                  <div className="flex items-center gap-1.5 truncate"><Link2 className="w-3 h-3 shrink-0" />{health.trustDocUrl}</div>
                  <div className="flex items-center gap-1.5 truncate"><ArrowUpRight className="w-3 h-3 shrink-0" />{health.webhookUrl}</div>
                  {health.partnerClientId && <div className="flex items-center gap-1.5"><Shield className="w-3 h-3 shrink-0" />Partner: {health.partnerClientId}</div>}
                </div>
              </>
            ) : (
              <div className="text-[13px] text-white/30 text-center py-8">Could not load health data.</div>
            )}
          </div>
        )}

        {/* ── Mode & Eligibility ── */}
        {tab === "Mode" && (
          <div className="p-4 space-y-4">
            {health && (
              <>
                <div className="rounded-[14px] bg-white/[0.035] border border-white/6 p-4">
                  <div className="text-[10px] text-white/40 tracking-widest uppercase mb-2">Current Mode</div>
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-bold ${MODE_COLORS[health.mode] ?? MODE_COLORS.OFF}`}>
                    <div className={`w-2 h-2 rounded-full ${health.mode !== "OFF" && health.mode !== "SHADOW" ? "animate-pulse" : ""} bg-current`} />
                    {health.mode}
                  </div>
                </div>

                {health.mode === "SHADOW" && (
                  <div className="rounded-[14px] bg-white/[0.035] border border-white/6 p-4 space-y-2.5">
                    <div className="text-[10px] text-white/40 tracking-widest uppercase">SHADOW → ASSISTED eligibility</div>
                    {[
                      { label: "All 7 gates pass", pass: health.fullyConnected },
                      { label: "Capabilities registered", pass: !!health.capabilities.registeredAt },
                      { label: "Gateway health OK", pass: health.gatewayHealth.ok },
                      { label: "At least 1 property synced", pass: health.twinSync.properties > 0 },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <div className={`w-4 h-4 rounded-full border grid place-items-center shrink-0 ${item.pass ? "bg-[#22C55E]/15 border-[#22C55E]/40" : "bg-white/5 border-white/15"}`}>
                          {item.pass && <CheckCircle2 className="w-2.5 h-2.5 text-[#22C55E]" strokeWidth={2.5} />}
                        </div>
                        <span className={`text-[12px] ${item.pass ? "text-white/75" : "text-white/40"}`}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-[14px] bg-white/[0.025] border border-white/5 p-4">
                  <div className="text-[10px] text-white/35 tracking-widest uppercase mb-2">ASSISTED → LIVE</div>
                  <div className="text-[12px] text-white/40">Requires out-of-band partnership enablement by Falkon. Cannot be self-promoted from this UI.</div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Capabilities ── */}
        {tab === "Capabilities" && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] text-white/40">{health?.capabilities.total ?? 22} capabilities</div>
              {health?.capabilities.registeredAt && (
                <div className="text-[10px] text-[#22C55E]/70">Registered {fmt(health.capabilities.registeredAt)}</div>
              )}
            </div>
            <div className="rounded-[14px] bg-white/[0.035] border border-white/6 divide-y divide-white/5">
              {[
                "make_ready.start","make_ready.phase_advance","make_ready.phase_rollback","make_ready.complete",
                "unit.status_changed","unit.create","unit.update",
                "job.walk_approved","job.invoice_created","job.crew_paid","job.create","job.update","job.complete",
                "invoice.create","invoice.paid","invoice.overdue",
                "crew.create","crew.assign","crew.check_in","crew.check_out",
                "property.sync","vendor.sync",
              ].map((cap, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E] shrink-0" />
                  <div className="text-[11.5px] text-white/75 font-mono flex-1 truncate">{cap}</div>
                  <div className="text-[10px] text-[#22C55E]/60">registered</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Twin Sync ── */}
        {tab === "Sync" && (
          <div className="p-4 space-y-3">
            {health && [
              { label: "Properties", count: health.twinSync.properties, total: 11, type: "properties" },
              { label: "Units", count: health.twinSync.units, total: 48, type: "units/all" },
              { label: "Vendors / Crews", count: health.twinSync.vendors, total: null, type: "vendors" },
            ].map(item => (
              <div key={item.type} className="rounded-[14px] bg-white/[0.035] border border-white/6 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-[13px] font-semibold text-white/85">{item.label}</div>
                    <div className="text-[11px] text-white/40">{item.count}{item.total ? `/${item.total}` : ""} synced</div>
                  </div>
                  <button
                    onClick={() => syncTwins(item.type)}
                    disabled={syncing !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] bg-white/6 border border-white/10 text-[11px] text-white/60 hover:text-white/80 transition-all disabled:opacity-50"
                  >
                    {syncing === item.type ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Force Sync
                  </button>
                </div>
                {item.total && (
                  <div className="h-1 rounded-full bg-white/8 overflow-hidden">
                    <div className="h-full rounded-full bg-[#22C55E] transition-all" style={{ width: `${Math.min(100, (item.count / item.total) * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Jobs ── */}
        {tab === "Jobs" && (
          <div className="p-4">
            {executions.length === 0 ? (
              <div className="text-[13px] text-white/30 text-center py-8">No executions yet.</div>
            ) : (
              <div className="rounded-[14px] bg-white/[0.035] border border-white/6 divide-y divide-white/5">
                {executions.map(ex => (
                  <div key={ex.id} className={`px-3 py-3 ${ex.status === "failed" ? "bg-[#E11D48]/5" : ""}`}>
                    <div className="flex items-start gap-2">
                      <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                        ex.status === "active" ? "bg-blue-400 animate-pulse" :
                        ex.status === "failed" ? "bg-[#E11D48]" :
                        ex.status === "completed" ? "bg-[#22C55E]" : "bg-white/30"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <div className="text-[12px] font-semibold text-white/85 truncate">
                            {ex.property_name ?? "—"} · {ex.unit_label}
                          </div>
                          {ex.mode_at_start === "SHADOW" && (
                            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25">SHADOW</span>
                          )}
                        </div>
                        <div className="text-[10.5px] text-white/40">
                          {ex.phase} · {fmt(ex.started_at)} {ex.duration_ms ? `· ${Math.round(ex.duration_ms / 1000)}s` : ""}
                        </div>
                        {ex.error && <div className="text-[10px] text-[#E11D48]/70 mt-0.5 truncate">{ex.error}</div>}
                      </div>
                      {ex.status === "failed" && (
                        <button
                          onClick={() => retryExecution(ex.id)}
                          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-[8px] bg-white/6 border border-white/10 text-[10px] text-white/50 hover:text-white/75 transition-all"
                        >
                          <RotateCcw className="w-3 h-3" /> Retry
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Inbound Events ── */}
        {tab === "Events" && (
          <div className="p-4">
            {inbound.length === 0 ? (
              <div className="text-[13px] text-white/30 text-center py-8">No inbound events yet.</div>
            ) : (
              <div className="rounded-[14px] bg-white/[0.035] border border-white/6 divide-y divide-white/5">
                {inbound.map(ev => (
                  <div key={ev.id} className={`px-3 py-3 ${ev.status === "failed" ? "bg-[#E11D48]/5" : ""}`}>
                    <div className="flex items-start gap-2">
                      <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                        ev.status === "processed" ? "bg-[#22C55E]" :
                        ev.status === "failed" ? "bg-[#E11D48]" : "bg-amber-400 animate-pulse"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-white/85 truncate">{ev.event_type}</div>
                        <div className="text-[10.5px] text-white/40">{fmt(ev.created_at)} · {ev.status}</div>
                        {ev.error && <div className="text-[10px] text-[#E11D48]/70 mt-0.5 truncate">{ev.error}</div>}
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
