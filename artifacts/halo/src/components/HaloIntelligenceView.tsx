/**
 * HALO Intelligence View — alternate chat-screen layout.
 *
 * Shows an AI-generated predictive briefing (Claude Opus-5) plus live
 * operational cards: metrics, attention items, active jobs, open invoices.
 * The composer at the bottom submits to the same conversation thread.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Zap, TrendingUp, AlertTriangle, Info, Users,
  Briefcase, DollarSign, Clock, ChevronRight, RefreshCw,
} from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Metrics {
  activeJobs: number;
  pendingRevenue: number;
  crewOnSite: number;
  urgentCount: number;
  overdueInvoices: number;
}

interface AttentionItem {
  id: string;
  text: string;
  severity: "urgent" | "warning" | "info";
  category: string;
}

interface JobCard {
  id: string;
  title: string;
  status: string;
  propertyName: string;
  scheduledOn: string | null;
  crewName: string | null;
  marginPct: number | null;
}

interface InvoiceCard {
  id: string;
  invoiceNo: string;
  amount: number | null;
  status: string;
  propertyName: string;
  dueAt: string | null;
}

interface IntelPayload {
  briefing: string;
  metrics: Metrics;
  attention: AttentionItem[];
  jobs: JobCard[];
  invoices: InvoiceCard[];
}

interface Props {
  onAsk: (text: string) => void;
  input: string;
  onInputChange: (v: string) => void;
  busy: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function severityDot(s: AttentionItem["severity"]) {
  if (s === "urgent") return "#E11D48";
  if (s === "warning") return "#F59E0B";
  return "#B4FF44";
}

function statusColor(status: string) {
  switch (status) {
    case "overdue": return "#E11D48";
    case "sent": return "#F59E0B";
    case "in_progress": return "#B4FF44";
    case "active": return "#B4FF44";
    default: return "rgba(255,255,255,0.35)";
  }
}

function statusLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricPill({ icon, label, value, highlight }: {
  icon: React.ReactNode; label: string; value: string | number; highlight?: boolean;
}) {
  return (
    <div style={{
      flex: 1,
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${highlight ? "rgba(225,29,72,0.4)" : "rgba(255,255,255,0.07)"}`,
      borderRadius: 14,
      padding: "12px 10px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 4,
      minWidth: 0,
    }}>
      <div style={{ color: highlight ? "#E11D48" : "#B4FF44", opacity: 0.8 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? "#E11D48" : "#fff", letterSpacing: "-0.02em" }}>
        {value}
      </div>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
        {label}
      </div>
    </div>
  );
}

function JobRow({ job }: { job: JobCard }) {
  const isOverdue = job.scheduledOn && job.scheduledOn < new Date().toISOString().slice(0, 10);
  return (
    <div style={{
      padding: "10px 12px",
      background: "rgba(255,255,255,0.03)",
      borderRadius: 10,
      borderLeft: `2px solid ${isOverdue ? "#E11D48" : "#B4FF44"}`,
      marginBottom: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {job.title}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {job.propertyName}{job.crewName ? ` · ${job.crewName}` : " · No crew"}
          </div>
        </div>
        <div style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em",
          color: statusColor(job.status), textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}>
          {statusLabel(job.status)}
        </div>
      </div>
    </div>
  );
}

function InvRow({ inv }: { inv: InvoiceCard }) {
  return (
    <div style={{
      padding: "10px 12px",
      background: "rgba(255,255,255,0.03)",
      borderRadius: 10,
      borderLeft: `2px solid ${statusColor(inv.status)}`,
      marginBottom: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
            {inv.invoiceNo}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {inv.propertyName}{inv.dueAt ? ` · Due ${inv.dueAt}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: inv.amount ? "#fff" : "rgba(255,255,255,0.3)" }}>
            {inv.amount != null ? fmt$(inv.amount) : "—"}
          </div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: statusColor(inv.status), textTransform: "uppercase" }}>
            {statusLabel(inv.status)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export function HaloIntelligenceView({ onAsk, input, onInputChange, busy }: Props) {
  const [data, setData] = useState<IntelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [briefingDots, setBriefingDots] = useState(0);

  const load = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const payload = await apiFetch("/api/command/intelligence");
      setData(payload);
    } catch { /* non-fatal */ }
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Animated dots while AI briefing is generating
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setBriefingDots((d) => (d + 1) % 4), 400);
    return () => clearInterval(id);
  }, [loading]);

  const handleQuickAsk = (text: string) => {
    onInputChange(text);
    onAsk(text);
  };

  const QUICK_ASKS = [
    "What needs my attention right now?",
    "Show overdue invoices",
    "Which jobs are behind schedule?",
    "Crew status today",
  ];

  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      minHeight: 0,
    }}>
      {/* ── Scrollable content ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "none", padding: "4px 20px 12px" }}>

        {/* ── AI Briefing card ──────────────────────────────────────────────── */}
        <div style={{
          background: "rgba(180,255,68,0.05)",
          border: "1px solid rgba(180,255,68,0.15)",
          borderRadius: 16,
          padding: "14px 16px",
          marginBottom: 14,
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Subtle glow */}
          <div style={{
            position: "absolute", top: -20, right: -20, width: 120, height: 120,
            background: "radial-gradient(circle, rgba(180,255,68,0.08) 0%, transparent 70%)",
            pointerEvents: "none",
          }} />

          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <Zap style={{ width: 13, height: 13, color: "#B4FF44", flexShrink: 0 }} strokeWidth={2.2} />
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "#B4FF44" }}>
              Predictive Briefing
            </span>
            {/* Live pulse dot */}
            <div style={{
              width: 5, height: 5, borderRadius: "50%", background: "#B4FF44", marginLeft: "auto",
              animation: "hcPulse 2s ease-in-out infinite",
            }} />
          </div>

          {loading ? (
            <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, fontStyle: "italic" }}>
              {"Analyzing operations" + ".".repeat(briefingDots)}
            </div>
          ) : (
            <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.82)", lineHeight: 1.72, margin: 0 }}>
              {data?.briefing ?? "No briefing available."}
            </p>
          )}

          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            style={{
              marginTop: 10, display: "flex", alignItems: "center", gap: 5,
              fontSize: 10, color: "rgba(180,255,68,0.5)", background: "none",
              border: "none", cursor: "pointer", padding: 0,
            }}
          >
            <RefreshCw
              style={{ width: 10, height: 10, animation: refreshing ? "spin 1s linear infinite" : "none" }}
              strokeWidth={2}
            />
            Refresh analysis
          </button>
        </div>

        {/* ── Metrics row ───────────────────────────────────────────────────── */}
        {data && (
          <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
            <MetricPill icon={<Briefcase style={{ width: 14, height: 14 }} />} label="Active Jobs" value={data.metrics.activeJobs} />
            <MetricPill icon={<DollarSign style={{ width: 14, height: 14 }} />} label="Pending $" value={fmt$(data.metrics.pendingRevenue)} />
            <MetricPill icon={<Users style={{ width: 14, height: 14 }} />} label="On Site" value={data.metrics.crewOnSite} />
            <MetricPill icon={<AlertTriangle style={{ width: 14, height: 14 }} />} label="Urgent" value={data.metrics.urgentCount} highlight={data.metrics.urgentCount > 0} />
          </div>
        )}

        {/* ── Attention items ───────────────────────────────────────────────── */}
        {data && data.attention.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", marginBottom: 8 }}>
              Attention Required
            </div>
            {data.attention.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "8px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: severityDot(item.severity),
                  flexShrink: 0, marginTop: 5,
                  boxShadow: item.severity === "urgent" ? "0 0 6px rgba(225,29,72,0.6)" : "none",
                }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.5 }}>
                    {item.text}
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginLeft: 6 }}>
                    {item.category}
                  </span>
                </div>
                {item.severity !== "info" && (
                  <button
                    type="button"
                    onClick={() => handleQuickAsk(`Tell me more about: ${item.text}`)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.2)", flexShrink: 0, padding: "2px 0" }}
                  >
                    <ChevronRight style={{ width: 13, height: 13 }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Active Jobs ───────────────────────────────────────────────────── */}
        {data && data.jobs.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", marginBottom: 8 }}>
              Active Jobs
            </div>
            {data.jobs.slice(0, 5).map((j) => <JobRow key={j.id} job={j} />)}
          </div>
        )}

        {/* ── Open Invoices ─────────────────────────────────────────────────── */}
        {data && data.invoices.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", marginBottom: 8 }}>
              Open Invoices
            </div>
            {data.invoices.slice(0, 5).map((i) => <InvRow key={i.id} inv={i} />)}
          </div>
        )}

        {/* ── Quick-ask chips ───────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", marginBottom: 8 }}>
            Quick Actions
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {QUICK_ASKS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleQuickAsk(q)}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 20,
                  padding: "6px 12px",
                  fontSize: 11.5,
                  color: "rgba(255,255,255,0.6)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* ── Pinned composer ────────────────────────────────────────────────── */}
      <div style={{
        padding: "10px 20px",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        background: "linear-gradient(to top, #080D17 70%, transparent)",
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 26,
          padding: "10px 14px",
        }}>
          <input
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                e.preventDefault();
                onAsk(input.trim());
              }
            }}
            placeholder="Ask HALO anything…"
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              fontSize: 14,
              color: "#fff",
              minWidth: 0,
            }}
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => { if (input.trim()) onAsk(input.trim()); }}
            disabled={!input.trim() || busy}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: input.trim() && !busy ? "#B4FF44" : "rgba(255,255,255,0.08)",
              border: "none",
              cursor: input.trim() && !busy ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 0.15s",
            }}
            aria-label="Send"
          >
            {busy ? (
              <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(0,0,0,0.3)", borderTopColor: "#000", animation: "spin 0.8s linear infinite" }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? "#000" : "rgba(255,255,255,0.3)"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes hcPulse { 0%,100% { opacity:0.5; } 50% { opacity:1; } }
      `}</style>
    </div>
  );
}
