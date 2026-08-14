/**
 * HALO Intelligence View — Desktop alternate layout.
 *
 * Shows AI predictive briefing (Claude Opus-5) + live metrics, attention
 * items, active jobs, and open invoices in a two-column layout.
 * The composer at the bottom submits to the main chat thread.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Zap, AlertTriangle, Users, Briefcase, DollarSign,
  ChevronRight, RefreshCw,
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
  id: string; text: string; severity: "urgent" | "warning" | "info"; category: string;
}
interface JobCard {
  id: string; title: string; status: string;
  propertyName: string; scheduledOn: string | null;
  crewName: string | null; marginPct: number | null;
}
interface InvoiceCard {
  id: string; invoiceNo: string; amount: number | null;
  status: string; propertyName: string; dueAt: string | null;
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

function statusColor(s: string) {
  if (s === "overdue") return "#E11D48";
  if (s === "sent") return "#F59E0B";
  if (s === "in_progress" || s === "active") return "#B4FF44";
  return "rgba(255,255,255,0.35)";
}

function statusLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const QUICK_ASKS = [
  "What needs my attention right now?",
  "Show overdue invoices",
  "Which jobs are behind schedule?",
  "Crew status today",
  "Weekly revenue summary",
  "Dispatch an emergency crew",
];

// ─── Component ────────────────────────────────────────────────────────────────
export function HaloIntelligenceView({ onAsk, input, onInputChange, busy }: Props) {
  const [data, setData] = useState<IntelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dots, setDots] = useState(0);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const payload = await apiFetch("/api/command/intelligence");
      setData(payload);
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setDots((d) => (d + 1) % 4), 400);
    return () => clearInterval(id);
  }, [loading]);

  const handleQuick = (text: string) => { onInputChange(text); onAsk(text); };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      {/* ── Scrollable area ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 16px", maxWidth: 1280, width: "100%", margin: "0 auto" }}>

        {/* ── AI Briefing ──────────────────────────────────────────────────── */}
        <div style={{
          background: "rgba(180,255,68,0.05)",
          border: "1px solid rgba(180,255,68,0.15)",
          borderRadius: 18,
          padding: "20px 24px",
          marginBottom: 20,
          position: "relative",
          overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: -40, right: -40, width: 200, height: 200,
            background: "radial-gradient(circle, rgba(180,255,68,0.07) 0%, transparent 70%)",
            pointerEvents: "none",
          }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Zap style={{ width: 14, height: 14, color: "#B4FF44" }} strokeWidth={2.2} />
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.2em", textTransform: "uppercase", color: "#B4FF44" }}>
              Predictive Briefing — Claude Opus
            </span>
            <div style={{
              width: 6, height: 6, borderRadius: "50%", background: "#B4FF44",
              marginLeft: "auto", animation: "intelPulse 2s ease-in-out infinite",
            }} />
          </div>
          {loading ? (
            <p style={{ fontSize: 14.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.75, fontStyle: "italic", margin: 0 }}>
              {"Analyzing operations across all properties" + ".".repeat(dots)}
            </p>
          ) : (
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.85)", lineHeight: 1.75, margin: 0, maxWidth: 900 }}>
              {data?.briefing ?? "No briefing available."}
            </p>
          )}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            style={{
              marginTop: 12, display: "inline-flex", alignItems: "center", gap: 5,
              fontSize: 11, color: "rgba(180,255,68,0.5)", background: "none", border: "none", cursor: "pointer", padding: 0,
            }}
          >
            <RefreshCw
              style={{ width: 11, height: 11, animation: refreshing ? "spin 1s linear infinite" : "none" }}
              strokeWidth={2}
            />
            Refresh analysis
          </button>
        </div>

        {/* ── Metrics row ───────────────────────────────────────────────────── */}
        {data && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 20 }}>
            {[
              { icon: <Briefcase style={{ width: 16, height: 16 }} />, label: "Active Jobs", value: data.metrics.activeJobs, hi: false },
              { icon: <DollarSign style={{ width: 16, height: 16 }} />, label: "Pending Revenue", value: fmt$(data.metrics.pendingRevenue), hi: false },
              { icon: <Users style={{ width: 16, height: 16 }} />, label: "Crew On Site", value: data.metrics.crewOnSite, hi: false },
              { icon: <AlertTriangle style={{ width: 16, height: 16 }} />, label: "Urgent Items", value: data.metrics.urgentCount, hi: data.metrics.urgentCount > 0 },
              { icon: <DollarSign style={{ width: 16, height: 16 }} />, label: "Overdue Invoices", value: data.metrics.overdueInvoices, hi: data.metrics.overdueInvoices > 0 },
            ].map(({ icon, label, value, hi }) => (
              <div key={label} style={{
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${hi ? "rgba(225,29,72,0.3)" : "rgba(255,255,255,0.07)"}`,
                borderRadius: 14,
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}>
                <div style={{ color: hi ? "#E11D48" : "#B4FF44", opacity: 0.8 }}>{icon}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: hi ? "#E11D48" : "#fff", letterSpacing: "-0.03em" }}>{value}</div>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)" }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Two-column grid: Attention + Jobs/Invoices ────────────────────── */}
        {data && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

            {/* Attention + Quick Actions */}
            <div>
              {data.attention.length > 0 && (
                <>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: 10 }}>
                    Attention Required
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    {data.attention.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: 10,
                          padding: "10px 14px",
                          background: "rgba(255,255,255,0.03)",
                          borderRadius: 10,
                          borderLeft: `2px solid ${severityDot(item.severity)}`,
                          marginBottom: 6,
                        }}
                      >
                        <div style={{
                          width: 6, height: 6, borderRadius: "50%",
                          background: severityDot(item.severity),
                          flexShrink: 0, marginTop: 5,
                          boxShadow: item.severity === "urgent" ? "0 0 8px rgba(225,29,72,0.5)" : "none",
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>{item.text}</div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>{item.category}</div>
                        </div>
                        {item.severity !== "info" && (
                          <button type="button" onClick={() => handleQuick(`Tell me more about: ${item.text}`)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.2)", padding: 0 }}>
                            <ChevronRight style={{ width: 14, height: 14 }} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: 10 }}>
                Quick Actions
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {QUICK_ASKS.map((q) => (
                  <button key={q} type="button" onClick={() => handleQuick(q)} style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 20,
                    padding: "7px 14px",
                    fontSize: 12,
                    color: "rgba(255,255,255,0.55)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Jobs + Invoices */}
            <div>
              {data.jobs.length > 0 && (
                <>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: 10 }}>
                    Active Jobs
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    {data.jobs.slice(0, 5).map((j) => {
                      const isOverdue = j.scheduledOn && j.scheduledOn < new Date().toISOString().slice(0, 10);
                      return (
                        <div key={j.id} style={{
                          padding: "10px 14px",
                          background: "rgba(255,255,255,0.03)",
                          borderRadius: 10,
                          borderLeft: `2px solid ${isOverdue ? "#E11D48" : "#B4FF44"}`,
                          marginBottom: 6,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 12,
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title}</div>
                            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.38)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {j.propertyName}{j.crewName ? ` · ${j.crewName}` : " · No crew"}
                            </div>
                          </div>
                          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", color: statusColor(j.status), textTransform: "uppercase", flexShrink: 0 }}>
                            {statusLabel(j.status)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {data.invoices.length > 0 && (
                <>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: 10 }}>
                    Open Invoices
                  </div>
                  {data.invoices.slice(0, 5).map((i) => (
                    <div key={i.id} style={{
                      padding: "10px 14px",
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 10,
                      borderLeft: `2px solid ${statusColor(i.status)}`,
                      marginBottom: 6,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#fff" }}>{i.invoiceNo}</div>
                        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.38)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {i.propertyName}{i.dueAt ? ` · Due ${i.dueAt}` : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: i.amount ? "#fff" : "rgba(255,255,255,0.3)" }}>
                          {i.amount != null ? fmt$(i.amount) : "—"}
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: statusColor(i.status), textTransform: "uppercase" }}>
                          {statusLabel(i.status)}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Pinned composer ────────────────────────────────────────────────── */}
      <div style={{
        padding: "12px 28px 16px",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        flexShrink: 0,
      }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 28,
            padding: "11px 16px",
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
                flex: 1, background: "none", border: "none", outline: "none",
                fontSize: 14.5, color: "#fff", minWidth: 0,
              }}
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => { if (input.trim()) onAsk(input.trim()); }}
              disabled={!input.trim() || busy}
              style={{
                width: 36, height: 36, borderRadius: "50%",
                background: input.trim() && !busy ? "#B4FF44" : "rgba(255,255,255,0.07)",
                border: "none",
                cursor: input.trim() && !busy ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, transition: "background 0.15s",
              }}
              aria-label="Send"
            >
              {busy ? (
                <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(0,0,0,0.3)", borderTopColor: "#000", animation: "spin 0.8s linear infinite" }} />
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? "#000" : "rgba(255,255,255,0.3)"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes intelPulse { 0%,100% { opacity:0.45; } 50% { opacity:1; } }
      `}</style>
    </div>
  );
}
