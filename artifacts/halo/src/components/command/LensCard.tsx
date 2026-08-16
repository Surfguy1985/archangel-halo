/**
 * LensCard — the inline contextual answer surface.
 *
 * Each lens fetches its own data and renders a polished, actionable card
 * DIRECTLY inside the conversation. The user never gets routed into the
 * legacy CRM unless they explicitly tap a secondary "full view" link.
 *
 * Primary CTAs are always white / black (matching the Apple-hardware
 * minimalism standard set by the new HaloCommand seed design).
 * Secondary / quiet actions are ghost/muted.
 *
 * Lenses: money | timeline | evidence | network | portfolio | map
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { LiveMapCard as LiveMapCardInline } from "@/components/command/LiveMapCard";
import {
  useGetMoneySummary,
  useListJobs,
  useListCrews,
  useListProperties,
  useListInvoices,
  useListVendors,
} from "@workspace/api-client-react";
import {
  DollarSign,
  Clock,
  Camera,
  Users,
  BarChart3,
  MapPin,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Building2,
  FileText,
  ArrowUpRight,
  Activity,
  Zap,
  TrendingUp,
  Radio,
  Package,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LensType =
  | "money" | "timeline" | "evidence" | "network" | "portfolio" | "map"
  | "property_status" | "turn_timeline" | "budget_breakdown" | "crew_map"
  | "invoice_detail" | "vendor_profile" | "photo_evidence" | "inspection_checklist";

interface LensCardProps {
  lensType: LensType;
  query?: string;
  onDeepLink?: (path: string) => void;
  onHandleSubmit?: (text: string) => void;
}

// ─── Lens metadata ────────────────────────────────────────────────────────────

const LENS_META: Record<LensType, {
  label: string;
  icon: typeof DollarSign;
  accent: string;
  deepLink: string;
  expandLabel: string;
}> = {
  money:               { label: "Money",         icon: DollarSign,  accent: "#B4FF44", deepLink: "/money",      expandLabel: "Open Money Hub" },
  timeline:            { label: "Timeline",      icon: Clock,       accent: "#6366F1", deepLink: "/jobboard",   expandLabel: "Open Job Board" },
  evidence:            { label: "Evidence",      icon: Camera,      accent: "#F59E0B", deepLink: "/jobboard",   expandLabel: "Browse Gallery" },
  network:             { label: "Network",       icon: Users,       accent: "#3B82F6", deepLink: "/crews",      expandLabel: "View Crew" },
  portfolio:           { label: "Portfolio",     icon: BarChart3,   accent: "#8B5CF6", deepLink: "/properties", expandLabel: "All Properties" },
  map:                 { label: "Live Map",      icon: MapPin,      accent: "#22C55E", deepLink: "/map",        expandLabel: "Open Live GPS Map" },
  // ── Entity-scoped lenses ──────────────────────────────────────────────────
  property_status:     { label: "Property",      icon: Building2,   accent: "#8B5CF6", deepLink: "/properties", expandLabel: "Open Property" },
  turn_timeline:       { label: "Job",           icon: Activity,    accent: "#6366F1", deepLink: "/jobboard",   expandLabel: "Open Job Board" },
  budget_breakdown:    { label: "Budget",        icon: TrendingUp,  accent: "#F59E0B", deepLink: "/money",      expandLabel: "Open Money Hub" },
  crew_map:            { label: "Crew Map",      icon: MapPin,      accent: "#22C55E", deepLink: "/crews",      expandLabel: "Open Live GPS Map" },
  invoice_detail:      { label: "Invoice",       icon: FileText,    accent: "#B4FF44", deepLink: "/money",      expandLabel: "Open Money Hub" },
  vendor_profile:      { label: "Vendor",        icon: Package,     accent: "#3B82F6", deepLink: "/crews",      expandLabel: "View Vendors" },
  photo_evidence:      { label: "Photos",        icon: Camera,      accent: "#F59E0B", deepLink: "/crews",      expandLabel: "Browse Gallery" },
  inspection_checklist:{ label: "Checklist",     icon: CheckCircle2,accent: "#22C55E", deepLink: "/jobboard",   expandLabel: "Open Job Board" },
};

// ─── Shared primitives ────────────────────────────────────────────────────────

function KpiCell({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-white/[0.044] rounded-[12px] px-3 py-3 flex flex-col gap-1 border border-white/[0.05]">
      <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/28">{label}</div>
      <div className="text-[19px] font-bold leading-none tabular-nums" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function LensLoading() {
  return (
    <div className="flex items-center justify-center py-10 gap-2.5">
      <Loader2 className="w-4 h-4 animate-spin text-white/25" />
      <span className="text-[12px] text-white/25">Loading…</span>
    </div>
  );
}

function LensEmpty({ icon: Icon, message }: { icon: typeof Camera; message: string }) {
  return (
    <div className="flex items-center gap-3 bg-white/[0.025] rounded-[13px] px-4 py-4 border border-white/[0.04]">
      <Icon className="w-4 h-4 text-white/20 shrink-0" />
      <span className="text-[12.5px] text-white/40 leading-snug">{message}</span>
    </div>
  );
}

/** White/black primary expand CTA — the main action on every lens */
function PrimaryCTA({ label, icon: Icon = ArrowUpRight, onClick }: {
  label: string;
  icon?: typeof ArrowUpRight;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-center gap-2 bg-white text-[#0A0F1A] font-bold text-[13px] py-[11px] rounded-[13px] hover:bg-white/92 active:scale-[0.97] transition-all shadow-[0_2px_12px_rgba(255,255,255,0.10)] focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
    >
      {label}
      <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
    </button>
  );
}

/** Secondary quiet action */
function SecondaryCTA({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-white/32 py-2 hover:text-white/55 transition-colors active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-white/40 outline-none rounded-md"
    >
      {label}
      <ExternalLink className="w-3 h-3" />
    </button>
  );
}

// ─── Job row ──────────────────────────────────────────────────────────────────

function JobRow({
  job,
  accentColor,
  onClick,
}: {
  job: { id: string; jobNo?: string | null; description?: string | null; scheduledOn?: string | null; status?: string | null };
  accentColor: string;
  onClick: () => void;
}) {
  const statusLabels: Record<string, string> = {
    active: "Active", in_progress: "In Progress", pending: "Pending",
    complete: "Complete", paid: "Paid", cancelled: "Cancelled",
  };
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-white/[0.038] hover:bg-white/[0.065] rounded-[12px] px-3.5 py-3 transition-colors active:scale-[0.98] text-left"
    >
      <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: accentColor }} />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-white/82 font-medium truncate">
          {job.description ?? job.jobNo ?? "Unnamed job"}
        </div>
        <div className="text-[11px] text-white/35 mt-0.5">
          {job.jobNo ? `#${job.jobNo}` : ""}
          {job.jobNo && job.scheduledOn ? " · " : ""}
          {job.scheduledOn ?? (job.status ? statusLabels[job.status] ?? job.status : "Unscheduled")}
        </div>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-white/18 shrink-0" />
    </button>
  );
}

// ─── MONEY LENS ───────────────────────────────────────────────────────────────

function MoneyLens({ query: _q }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: money, isLoading: mLoading } = useGetMoneySummary();
  const { data: invoicesData, isLoading: iLoading } = useListInvoices();

  if (mLoading || iLoading) return <LensLoading />;

  const invoices = invoicesData ?? [];
  const unpaid = invoices.filter(inv =>
    inv.status === "sent" || inv.status === "partial" || inv.status === "overdue"
  );
  const now = new Date();
  const overdue = unpaid.filter(inv => {
    const due = (inv as any).dueAt ?? (inv as any).dueDate;
    if (!due) return false;
    const [y, m, d] = due.split("-").map(Number);
    return new Date(y, m - 1, d) < now;
  });

  const mtd   = (money as any)?.mtdRevenue ?? (money as any)?.mtd ?? 0;
  const owed  = (money as any)?.totalOutstanding ?? (money as any)?.outstanding ?? 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <KpiCell label="MTD Revenue"  value={`$${(mtd / 1000).toFixed(1)}k`}      accent="#B4FF44" />
        <KpiCell label="Outstanding"  value={`$${(owed / 1000).toFixed(1)}k`}     accent="#F59E0B" />
        <KpiCell label="Overdue"      value={String(overdue.length)} accent={overdue.length > 0 ? "#E11D48" : "#22C55E"} />
      </div>

      {unpaid.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/25 px-0.5 mb-1">
            Outstanding invoices
          </div>
          {unpaid.slice(0, 5).map(inv => {
            const isOD = overdue.includes(inv);
            const amount = (inv as any).amount ?? (inv as any).total ?? (inv as any).subtotal ?? 0;
            return (
              <button
                key={inv.id}
                onClick={() => navigate(`/invoices/${inv.id}`)}
                className="w-full flex items-center gap-3 bg-white/[0.038] hover:bg-white/[0.065] rounded-[12px] px-3.5 py-3 transition-colors active:scale-[0.98] text-left"
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOD ? "bg-[#E11D48]" : "bg-[#F59E0B]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white/82 font-medium truncate">
                    {(inv as any).propertyName ?? (inv as any).clientName ?? "—"}
                  </div>
                  <div className="text-[11px] text-white/35 mt-0.5">
                    {isOD ? "Overdue" : "Sent"} · #{inv.invoiceNo ?? "—"}
                  </div>
                </div>
                <div className="text-[13px] font-bold text-white/72 tabular-nums shrink-0">
                  ${Number(amount).toLocaleString()}
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-white/18 shrink-0" />
              </button>
            );
          })}
          {unpaid.length > 5 && (
            <button
              onClick={() => navigate("/money")}
              className="w-full text-center text-[11px] text-white/30 hover:text-white/50 py-1.5 transition-colors"
            >
              +{unpaid.length - 5} more invoices
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-[#22C55E]/7 border border-[#22C55E]/14 rounded-[13px] px-4 py-3.5">
          <CheckCircle2 className="w-[14px] h-[14px] text-[#22C55E] shrink-0" />
          <span className="text-[13px] text-[#22C55E]/85 font-medium">All invoices current. Nothing outstanding.</span>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => navigate("/invoices/create")}
          className="flex-1 flex items-center justify-center gap-1.5 bg-white text-[#0A0F1A] font-bold text-[12.5px] py-2.5 rounded-[12px] hover:bg-white/92 active:scale-[0.97] transition-all"
        >
          <FileText className="w-3.5 h-3.5" strokeWidth={2.5} />
          Create Invoice
        </button>
        <button
          onClick={() => navigate("/money")}
          className="flex-[0.6] flex items-center justify-center gap-1.5 bg-white/5 border border-white/8 text-white/45 text-[12.5px] font-medium py-2.5 rounded-[12px] hover:text-white/65 hover:bg-white/8 transition-all active:scale-[0.97]"
        >
          View All
        </button>
      </div>
    </div>
  );
}

// ─── TIMELINE LENS ────────────────────────────────────────────────────────────

function TimelineLens({ query: _q }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: jobs, isLoading } = useListJobs();

  if (isLoading) return <LensLoading />;

  const active = (jobs ?? []).filter(j =>
    j.status !== "complete" && j.status !== "paid" && j.status !== "cancelled"
  );
  const now = new Date();
  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);

  const overdue = active.filter(j => {
    if (!j.scheduledOn) return false;
    const [y, m, d] = j.scheduledOn.split("-").map(Number);
    return new Date(y, m - 1, d) < now;
  });
  const dueThisWeek = active.filter(j => {
    if (!j.scheduledOn) return false;
    const [y, m, d] = j.scheduledOn.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt >= now && dt <= weekEnd;
  }).sort((a, b) => (a.scheduledOn! < b.scheduledOn! ? -1 : 1));
  const unscheduled = active.filter(j => !j.scheduledOn);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <KpiCell label="Active"    value={String(active.length)}      accent="#B4FF44" />
        <KpiCell label="This week" value={String(dueThisWeek.length)} accent="#6366F1" />
        <KpiCell label="Overdue"   value={String(overdue.length)}     accent={overdue.length > 0 ? "#E11D48" : "#22C55E"} />
      </div>

      {overdue.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-[#E11D48]/65 px-0.5">Overdue</div>
          {overdue.slice(0, 3).map(j => (
            <JobRow key={j.id} job={j} accentColor="#E11D48" onClick={() => navigate(`/jobs/${j.id}`)} />
          ))}
        </div>
      )}

      {dueThisWeek.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/25 px-0.5">Due this week</div>
          {dueThisWeek.slice(0, 4).map(j => (
            <JobRow key={j.id} job={j} accentColor="#6366F1" onClick={() => navigate(`/jobs/${j.id}`)} />
          ))}
        </div>
      )}

      {unscheduled.length > 0 && (
        <div className="flex items-center gap-3 bg-[#F59E0B]/7 border border-[#F59E0B]/14 rounded-[13px] px-4 py-3">
          <AlertCircle className="w-[14px] h-[14px] text-[#F59E0B] shrink-0" />
          <span className="text-[12.5px] text-[#F59E0B]/85">
            {unscheduled.length} job{unscheduled.length > 1 ? "s" : ""} need scheduling
          </span>
        </div>
      )}

      {active.length === 0 && <LensEmpty icon={Clock} message="No active jobs at the moment." />}

      <PrimaryCTA label="Open Job Board" onClick={() => navigate("/jobboard")} />
    </div>
  );
}

// ─── NETWORK (DISPATCH) LENS ──────────────────────────────────────────────────

function NetworkLens({ query: _q, onHandleSubmit }: { query?: string; onHandleSubmit?: (s: string) => void }) {
  const { data: crews, isLoading: cLoading } = useListCrews();
  const { data: vendors, isLoading: vLoading } = useListVendors();
  const { data: jobs } = useListJobs();
  const [dispatchOpen, setDispatchOpen] = useState<string | null>(null); // crewId with picker open

  if (cLoading || vLoading) return <LensLoading />;

  const crewList = crews ?? [];
  const vendorList = vendors ?? [];
  const openJobs = (jobs ?? []).filter((j: any) =>
    ["scheduled", "in_progress", "open"].includes(j.boardStatus ?? j.status ?? "")
  ).slice(0, 5);

  const checkedIn = crewList.filter((c: any) => c.isCheckedIn || c.lastCheckinAt);
  const getInitials = (name: string) => name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();

  // Vendor COI status helper
  const coiStatus = (v: any): { label: string; color: string } => {
    if (!v.coiExpiresAt) return { label: "No COI", color: "#E11D48" };
    const daysLeft = Math.round((new Date(v.coiExpiresAt).getTime() - Date.now()) / 86400000);
    if (daysLeft < 0)  return { label: "Expired", color: "#E11D48" };
    if (daysLeft < 30) return { label: `Exp ${daysLeft}d`, color: "#F59E0B" };
    return { label: "Valid", color: "#22C55E" };
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <KpiCell label="Total Crew" value={String(crewList.length)}   accent="#3B82F6" />
        <KpiCell label="On Site"    value={String(checkedIn.length)}  accent="#22C55E" />
        <KpiCell label="Vendors"    value={String(vendorList.length)} accent="#8B5CF6" />
      </div>

      {/* Crew roster — up to 8 */}
      {crewList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/25 px-0.5">Crew Roster</div>
          {crewList.slice(0, 8).map((c: any) => {
            const isIn = c.isCheckedIn || c.lastCheckinAt;
            const isPickerOpen = dispatchOpen === c.id;
            return (
              <div key={c.id} className="rounded-[12px] overflow-hidden bg-white/[0.038]">
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <div className="w-8 h-8 rounded-full bg-[#3B82F6]/15 border border-[#3B82F6]/25 grid place-items-center shrink-0 text-[11px] font-bold text-[#3B82F6]">
                    {c.selfiePath
                      ? <img src={`/api/storage${c.selfiePath}`} alt="" className="w-full h-full object-cover rounded-full" />
                      : getInitials(c.name ?? "?")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] text-white/82 font-medium truncate">{c.name}</div>
                    <div className="text-[11px] text-white/35">{c.trade ?? c.role ?? "General"}</div>
                  </div>
                  <div
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0 ${
                      isIn ? "bg-[#22C55E]/12 text-[#22C55E]/80 border border-[#22C55E]/20"
                           : "bg-white/5 text-white/30 border border-white/[0.08]"
                    }`}
                    aria-label={isIn ? `${c.name} is on site` : `${c.name} is available`}
                  >
                    <div className={`w-1 h-1 rounded-full ${isIn ? "bg-[#22C55E]" : "bg-white/25"}`} />
                    {isIn ? "On Site" : "Available"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDispatchOpen(isPickerOpen ? null : c.id)}
                    className="ml-1 px-2.5 py-1 rounded-[8px] bg-white text-[#0A0F1A] text-[10px] font-bold hover:bg-white/90 active:scale-[0.97] transition-all shrink-0"
                  >
                    Dispatch
                  </button>
                </div>
                {/* Inline job picker */}
                {isPickerOpen && (
                  <div className="border-t border-white/[0.05] px-3.5 pb-3 pt-2 space-y-1.5">
                    <div className="text-[9px] text-white/25 tracking-widest uppercase font-bold mb-1">Select Job</div>
                    {openJobs.length === 0
                      ? <div className="text-[11px] text-white/30 py-1">No open jobs</div>
                      : openJobs.map((j: any) => (
                          <button
                            key={j.id}
                            type="button"
                            onClick={() => {
                              setDispatchOpen(null);
                              onHandleSubmit?.(`Dispatch ${c.name} to job ${j.jobNo ?? j.id}`);
                            }}
                            className="w-full text-left px-3 py-2 rounded-[9px] hover:bg-white/[0.05] transition-colors"
                            style={{ background: "rgba(255,255,255,0.024)", border: "1px solid rgba(255,255,255,0.06)" }}
                          >
                            <span className="text-[12px] text-white/70 font-medium">{j.description ?? j.jobNo ?? "Job"}</span>
                            {j.scheduledOn && <span className="text-[10px] text-white/30 ml-2">{j.scheduledOn}</span>}
                          </button>
                        ))
                    }
                  </div>
                )}
              </div>
            );
          })}
          {crewList.length > 8 && (
            <div className="text-center text-[11px] text-white/28 py-1">
              +{crewList.length - 8} more crew members
            </div>
          )}
        </div>
      )}

      {/* Vendor compliance — up to 4 */}
      {vendorList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/25 px-0.5">Vendor Compliance</div>
          {vendorList.slice(0, 4).map((v: any) => {
            const coi = coiStatus(v);
            return (
              <div key={v.id} className="flex items-center gap-3 bg-white/[0.028] rounded-[12px] px-3.5 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-white/78 font-medium truncate">{v.name}</div>
                  <div className="text-[10.5px] text-white/35">{v.trade ?? v.category ?? "Vendor"}</div>
                </div>
                <span
                  className="text-[9px] font-bold px-2 py-1 rounded-full shrink-0"
                  style={{ background: `${coi.color}18`, color: coi.color, border: `1px solid ${coi.color}30` }}
                  aria-label={`COI status: ${coi.label}`}
                >
                  {coi.label}
                </span>
                {v.coiExpiresAt && (
                  <span className="text-[10px] text-white/28 shrink-0 tabular-nums">
                    {new Date(v.coiExpiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {crewList.length === 0 && <LensEmpty icon={Users} message="No crew members yet. Add crew to dispatch them." />}
    </div>
  );
}

// ─── MAP (LIVE OPS) LENS ──────────────────────────────────────────────────────

function MapLens({ query }: { query?: string }) {
  return <LiveMapCardInline query={query} />;
}

// ─── EVIDENCE LENS ────────────────────────────────────────────────────────────

function EvidenceLens({ query: _q }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: jobs, isLoading } = useListJobs();

  if (isLoading) return <LensLoading />;

  const allJobs = jobs ?? [];
  const withPhotos = allJobs.filter(j => {
    const count = (j as any).photoCount ?? (j as any).photosCount ?? 0;
    return count > 0;
  });
  const recent = withPhotos.slice(0, 6);

  const totalPhotos = withPhotos.reduce((sum, j) => {
    return sum + ((j as any).photoCount ?? (j as any).photosCount ?? 0);
  }, 0);

  return (
    <div className="space-y-3">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCell label="Jobs with Evidence" value={String(withPhotos.length)} accent="#F59E0B" />
        <KpiCell label="Total Photos"       value={String(totalPhotos)}        accent="#B4FF44" />
      </div>

      {recent.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/25 px-0.5">Recent evidence</div>
          {recent.slice(0, 4).map(j => {
            const count = (j as any).photoCount ?? (j as any).photosCount ?? 0;
            const hasBefore = (j as any).hasBeforePhotos ?? false;
            const hasAfter = (j as any).hasAfterPhotos ?? false;
            const heroPath = (j as any).heroPhotoPath ?? (j as any).latestPhotoPath ?? null;

            return (
              <button
                key={j.id}
                onClick={() => navigate(`/jobs/${j.id}`)}
                className="w-full flex items-center gap-3 bg-white/[0.038] hover:bg-white/[0.065] rounded-[12px] px-3.5 py-3 transition-colors active:scale-[0.98] text-left"
              >
                {/* Photo thumbnail placeholder */}
                <div
                  className="w-[44px] h-[44px] rounded-[9px] bg-[#F59E0B]/12 border border-[#F59E0B]/18 grid place-items-center shrink-0 overflow-hidden"
                >
                  {heroPath ? (
                    <img
                      src={`/api/storage${heroPath}`}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <Camera className="w-4 h-4 text-[#F59E0B]/60" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white/82 font-medium truncate">
                    {j.description ?? j.jobNo ?? "Unnamed job"}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10.5px] text-white/35">
                      {j.scheduledOn ?? (j as any).completedAt?.slice(0, 10) ?? "—"}
                    </span>
                    {(hasBefore || hasAfter) && (
                      <span className="text-[9.5px] bg-[#F59E0B]/12 text-[#F59E0B]/70 rounded-full px-1.5 py-0.5 font-bold">
                        Before/After
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[11px] font-bold text-white/55 tabular-nums">{count}</span>
                  <span className="text-[9.5px] text-white/25">photos</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-white/18 shrink-0" />
              </button>
            );
          })}

          {withPhotos.length > 4 && (
            <button
              onClick={() => navigate("/jobboard")}
              className="w-full text-center text-[11px] text-white/30 hover:text-white/50 py-1.5 transition-colors"
            >
              +{withPhotos.length - 4} more jobs with evidence
            </button>
          )}
        </div>
      ) : (
        <LensEmpty icon={Camera} message="No job photos yet. Start a Walk to capture before/after evidence." />
      )}

      {/* Secondary ghost link only — primary action is the row clicks above */}
      <div className="flex justify-end pt-1">
        <button
          onClick={() => navigate("/jobboard")}
          className="text-[11px] text-white/28 hover:text-white/50 transition-colors flex items-center gap-1"
        >
          Browse all evidence
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── PORTFOLIO LENS ───────────────────────────────────────────────────────────

function PortfolioLens({ query: _q }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: properties, isLoading: pLoading } = useListProperties();
  const { data: jobs, isLoading: jLoading } = useListJobs();
  const { data: money, isLoading: mLoading } = useGetMoneySummary();

  if (pLoading || jLoading || mLoading) return <LensLoading />;

  const propList = properties ?? [];
  const jobList = jobs ?? [];
  const activeJobs = jobList.filter(j =>
    j.status !== "complete" && j.status !== "paid" && j.status !== "cancelled"
  );
  const completed = jobList.filter(j => j.status === "complete" || j.status === "paid");
  const mtd = (money as any)?.mtdRevenue ?? (money as any)?.mtd ?? 0;

  // Flag properties with overdue invoices or stalled jobs (simple heuristic)
  const urgentProps = propList.filter(p => {
    const pJobs = activeJobs.filter(j => (j as any).propertyId === p.id);
    return pJobs.some(j => j.scheduledOn && new Date(j.scheduledOn) < new Date());
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <KpiCell label="Properties"  value={String(propList.length)}    accent="#8B5CF6" />
        <KpiCell label="Active Jobs" value={String(activeJobs.length)}  accent="#B4FF44" />
        <KpiCell label="Completed"   value={String(completed.length)}   accent="#22C55E" />
        <KpiCell label="MTD Revenue" value={`$${(mtd / 1000).toFixed(1)}k`} accent="#F59E0B" />
      </div>

      {urgentProps.length > 0 && (
        <div className="flex items-center gap-3 bg-[#E11D48]/7 border border-[#E11D48]/14 rounded-[13px] px-4 py-3">
          <AlertCircle className="w-[13px] h-[13px] text-[#E11D48] shrink-0" />
          <span className="text-[12px] text-[#E11D48]/85 font-medium">
            {urgentProps.length} propert{urgentProps.length === 1 ? "y has" : "ies have"} overdue jobs
          </span>
        </div>
      )}

      {propList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/25 px-0.5">Properties</div>
          {propList.slice(0, 5).map(p => {
            const propJobs = activeJobs.filter(j => (j as any).propertyId === p.id);
            const isUrgent = urgentProps.some(u => u.id === p.id);
            return (
              <button
                key={p.id}
                onClick={() => navigate(`/properties/${p.id}`)}
                className="w-full flex items-center gap-3 bg-white/[0.038] hover:bg-white/[0.065] rounded-[12px] px-3.5 py-3 transition-colors active:scale-[0.98] text-left"
              >
                <div
                  className="w-8 h-8 rounded-[9px] grid place-items-center shrink-0"
                  style={{
                    background: isUrgent ? "rgba(225,29,72,0.12)" : "rgba(139,92,246,0.12)",
                    border: `1px solid ${isUrgent ? "rgba(225,29,72,0.22)" : "rgba(139,92,246,0.22)"}`,
                  }}
                >
                  <Building2 className="w-3.5 h-3.5" style={{ color: isUrgent ? "#E11D48" : "#8B5CF6" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white/82 font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-white/35 mt-0.5">
                    {(p as any).units ?? 0} units · {(p as any).city ?? "—"}
                  </div>
                </div>
                {propJobs.length > 0 && (
                  <span
                    className={`text-[9.5px] rounded-full px-2 py-0.5 font-bold shrink-0 ${
                      isUrgent
                        ? "bg-[#E11D48]/14 text-[#E11D48]"
                        : "bg-[#B4FF44]/12 text-[#B4FF44]"
                    }`}
                  >
                    {propJobs.length} active
                  </span>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-white/18 shrink-0" />
              </button>
            );
          })}
          {propList.length > 5 && (
            <div className="text-center text-[11px] text-white/28 py-1">
              +{propList.length - 5} more properties
            </div>
          )}
        </div>
      )}

      {propList.length === 0 && <LensEmpty icon={Building2} message="No properties yet." />}

      <PrimaryCTA label="All Properties" onClick={() => navigate("/properties")} />
    </div>
  );
}

// ─── Custom hook for entity-scoped lens data ──────────────────────────────────

function useLensData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api${path}`, { credentials: "include" })
      .then(r => r.ok ? (r.json() as Promise<T>) : Promise.resolve(null))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [path]);
  return { data, loading };
}

// ─── Property Status Lens ─────────────────────────────────────────────────────

interface PropertyStatusData {
  property: { id: string; name: string; city?: string | null };
  stats: { totalUnits: number; activeJobs: number; overdueJobs: number; totalJobs: number };
  crewOnSite: Array<{ name: string | null; checkedInAt: string }>;
  openReceivables: number;
  lastWalk: { date: string; note?: string | null } | null;
}
function PropertyStatusLens({ query, onDeepLink }: { query?: string; onDeepLink?: (p: string) => void }) {
  const [, navigate] = useLocation();
  const { data, loading } = useLensData<PropertyStatusData>(query ? `/command/lens/property-status/${query}` : null);
  if (loading) return <LensLoading />;
  if (!data) return <LensEmpty icon={Building2} message="Property not found" />;
  const { property, stats, crewOnSite, openReceivables, lastWalk } = data;
  const go = (p: string) => onDeepLink ? onDeepLink(p) : navigate(p);
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-bold text-white/90">{property.name}</div>
        {property.city && <div className="text-[11px] text-white/35 mt-0.5">{property.city}</div>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <KpiCell label="Active Jobs" value={String(stats.activeJobs)} accent="#6366F1" />
        <KpiCell label="Overdue" value={String(stats.overdueJobs)} accent={stats.overdueJobs > 0 ? "#EF4444" : "#22C55E"} />
        <KpiCell label="Total Jobs" value={String(stats.totalJobs)} accent="#8B5CF6" />
        <KpiCell label="Open A/R" value={`$${Math.round(openReceivables / 1000)}k`} accent="#B4FF44" />
      </div>
      {crewOnSite.length > 0 && (
        <div className="bg-[#22C55E]/8 border border-[#22C55E]/20 rounded-[12px] px-3.5 py-2.5 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse shrink-0" />
          <div className="text-[12px] text-[#22C55E]/90 font-medium">
            {crewOnSite.map(c => c.name ?? "Crew").join(", ")} on site
          </div>
        </div>
      )}
      {lastWalk && (
        <div className="text-[11px] text-white/35">
          Last walk: {new Date(lastWalk.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
      )}
      <PrimaryCTA label="View Property" onClick={() => go(`/properties/${query}`)} />
      <SecondaryCTA label="View Jobs" onClick={() => go("/jobboard")} />
    </div>
  );
}

// ─── Turn Timeline Lens ───────────────────────────────────────────────────────

interface TurnTimelineData {
  job: { id: string; jobNo: string; unitNo: string | null; category: string | null; status: string; boardStatus: string; scheduledOn: string | null; propertyName: string | null };
  crew: { name: string | null; checkedInAt: string | null } | null;
  budget: { quoted: number; spent: number; remaining: number };
  photos: Array<{ url: string; phase: string | null; takenAt: string | null }>;
  lastActivity: { label: string; at: string } | null;
}
function TurnTimelineLens({ query, onDeepLink }: { query?: string; onDeepLink?: (p: string) => void }) {
  const [, navigate] = useLocation();
  const { data, loading } = useLensData<TurnTimelineData>(query ? `/command/lens/turn-timeline/${query}` : null);
  if (loading) return <LensLoading />;
  if (!data) return <LensEmpty icon={Activity} message="Job not found" />;
  const { job, crew, budget, photos, lastActivity } = data;
  const go = (p: string) => onDeepLink ? onDeepLink(p) : navigate(p);
  const spentPct = budget.quoted > 0 ? Math.min(100, (budget.spent / budget.quoted) * 100) : 0;
  const overBudget = budget.spent > budget.quoted;
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-bold text-white/90">{job.unitNo ? `Unit ${job.unitNo}` : job.jobNo}</div>
        {job.propertyName && <div className="text-[11px] text-white/35">{job.propertyName}</div>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#6366F1]/12 text-[#6366F1]/90 border border-[#6366F1]/25">
          {job.boardStatus.replace(/_/g, " ")}
        </span>
        {crew && (
          <div className="flex items-center gap-1.5 text-[11px] text-[#22C55E]/80">
            <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" />
            {crew.name ?? "Crew"} on site
          </div>
        )}
      </div>
      <div>
        <div className="flex justify-between text-[11px] text-white/40 mb-1.5">
          <span>Budget</span>
          <span className={overBudget ? "text-[#EF4444]/80" : ""}>
            ${Math.round(budget.spent).toLocaleString()} / ${Math.round(budget.quoted).toLocaleString()}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${spentPct}%`, background: overBudget ? "#EF4444" : "#6366F1" }} />
        </div>
      </div>
      {photos.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {photos.slice(0, 5).map((p, i) => (
            <img key={i} src={p.url} alt={p.phase ?? "photo"} className="w-14 h-14 rounded-[10px] object-cover shrink-0 border border-white/10" />
          ))}
        </div>
      )}
      {lastActivity && (
        <div className="text-[11px] text-white/35">
          {lastActivity.label} · {new Date(lastActivity.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </div>
      )}
      <PrimaryCTA label="Open Job" onClick={() => go(`/jobs/${query}`)} />
    </div>
  );
}

// ─── Budget Breakdown Lens ────────────────────────────────────────────────────

interface BudgetData {
  jobLabel: string;
  quoted: number;
  spent: number;
  variance: number;
  variancePct: number;
  marginPct: number | null;
  categories: Array<{ label: string; quoted: number; actual: number; variance: number }>;
}
function BudgetBreakdownLens({ query, onDeepLink }: { query?: string; onDeepLink?: (p: string) => void }) {
  const [, navigate] = useLocation();
  const { data, loading } = useLensData<BudgetData>(query ? `/command/lens/budget/${query}` : null);
  if (loading) return <LensLoading />;
  if (!data) return <LensEmpty icon={TrendingUp} message="Budget data not available" />;
  const { jobLabel, quoted, spent, variance, variancePct, marginPct, categories } = data;
  const overBudget = variance > 0;
  const go = (p: string) => onDeepLink ? onDeepLink(p) : navigate(p);
  return (
    <div className="space-y-3">
      <div className="text-[13px] font-bold text-white/85">{jobLabel}</div>
      <div className="grid grid-cols-3 gap-2">
        <KpiCell label="Quoted" value={`$${Math.round(quoted).toLocaleString()}`} accent="#8B5CF6" />
        <KpiCell label="Actual" value={`$${Math.round(spent).toLocaleString()}`} accent={overBudget ? "#EF4444" : "#22C55E"} />
        <KpiCell label="Variance" value={`${overBudget ? "+" : ""}${Math.round(variancePct)}%`} accent={overBudget ? "#EF4444" : "#22C55E"} />
      </div>
      <div className="space-y-1.5">
        {categories.slice(0, 5).map(cat => {
          const catOver = cat.variance > 0;
          return (
            <div key={cat.label} className="flex items-center gap-2">
              <div className="text-[12px] text-white/50 flex-1 truncate">{cat.label}</div>
              <div className="text-[11px] text-white/35 w-14 text-right tabular-nums">${Math.round(cat.quoted).toLocaleString()}</div>
              <div className="text-[11px] font-medium w-14 text-right tabular-nums" style={{ color: catOver ? "#EF4444" : "#22C55E" }}>
                ${Math.round(cat.actual).toLocaleString()}
              </div>
              <div className="text-[10px] w-8 text-right tabular-nums" style={{ color: catOver ? "#EF4444" : "#22C55E" }}>
                {catOver ? "+" : ""}{Math.round(cat.variance)}
              </div>
            </div>
          );
        })}
      </div>
      {marginPct !== null && (
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-white/40">Margin</span>
          <span className="font-bold" style={{ color: marginPct < 25 ? "#EF4444" : "#22C55E" }}>{Math.round(marginPct)}%</span>
        </div>
      )}
      <PrimaryCTA label="View Invoices" onClick={() => go("/money")} />
    </div>
  );
}

// ─── Crew Map Lens ────────────────────────────────────────────────────────────

function CrewMapLens({ query: _query }: { query?: string }) {
  const { data: crews, isLoading } = useListCrews();
  const [, navigate] = useLocation();
  if (isLoading) return <LensLoading />;
  const crewList = (crews ?? []) as unknown as Array<Record<string, unknown>>;
  const onSite = crewList.filter(c => c.checkedIn || c.activeCheckin);
  const available = crewList.filter(c => !c.checkedIn && !c.activeCheckin);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <KpiCell label="On Site" value={String(onSite.length)} accent="#22C55E" />
        <KpiCell label="Available" value={String(available.length)} accent="#3B82F6" />
      </div>
      {onSite.slice(0, 4).map(c => (
        <div key={c.id as string} className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse shrink-0" />
          <div className="text-[12.5px] text-white/80 font-medium">{c.name as string}</div>
          {c.currentUnit != null ? <div className="text-[10.5px] text-white/35 ml-auto">Unit {String(c.currentUnit)}</div> : null}
        </div>
      ))}
      {onSite.length === 0 && <LensEmpty icon={MapPin} message="No crews currently on site" />}
      <PrimaryCTA label="Open Crew Map" onClick={() => navigate("/crews")} />
    </div>
  );
}

// ─── Invoice Detail Lens ──────────────────────────────────────────────────────

interface InvoiceDetailData {
  invoice: { id: string; invoiceNo: string | null; status: string; amount: number; taxAmount: number; dueAt: string | null; sentAt: string | null; paidAt: string | null; propertyName: string | null; overdayDays: number | null };
}
function InvoiceDetailLens({ query, onDeepLink }: { query?: string; onDeepLink?: (p: string) => void }) {
  const [, navigate] = useLocation();
  const { data, loading } = useLensData<InvoiceDetailData>(query ? `/command/lens/invoice-detail/${query}` : null);
  if (loading) return <LensLoading />;
  if (!data) return <LensEmpty icon={FileText} message="Invoice not found" />;
  const { invoice } = data;
  const go = (p: string) => onDeepLink ? onDeepLink(p) : navigate(p);
  const STATUS_COLOR: Record<string, string> = { paid: "#22C55E", sent: "#F59E0B", draft: "#6366F1" };
  const statusColor = invoice.overdayDays && invoice.overdayDays > 0 ? "#EF4444" : (STATUS_COLOR[invoice.status] ?? "#8B5CF6");
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-bold text-white/90">
            {invoice.invoiceNo ? `Invoice #${invoice.invoiceNo}` : "Invoice"}
          </div>
          {invoice.propertyName && <div className="text-[11px] text-white/35">{invoice.propertyName}</div>}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border shrink-0"
          style={{ color: statusColor, background: `${statusColor}12`, borderColor: `${statusColor}28` }}>
          {invoice.overdayDays && invoice.overdayDays > 0 ? `${invoice.overdayDays}d overdue` : invoice.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <KpiCell label="Amount" value={`$${Math.round(invoice.amount).toLocaleString()}`} accent="#B4FF44" />
        <KpiCell label="Tax" value={`$${Math.round(invoice.taxAmount ?? 0).toLocaleString()}`} accent="#8B5CF6" />
      </div>
      {invoice.dueAt && (
        <div className="text-[11px] text-white/35">
          Due: {new Date(invoice.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </div>
      )}
      <PrimaryCTA label="Open Invoice" onClick={() => go("/money")} />
    </div>
  );
}

// ─── Vendor Profile Lens ──────────────────────────────────────────────────────

interface VendorProfileData {
  vendor: { id: string; name: string; trade: string | null; email: string | null; phone: string | null; coiExpiresOn: string | null; compliant: boolean };
}
function VendorProfileLens({ query, onDeepLink }: { query?: string; onDeepLink?: (p: string) => void }) {
  const [, navigate] = useLocation();
  const { data, loading } = useLensData<VendorProfileData>(query ? `/command/lens/vendor/${query}` : null);
  if (loading) return <LensLoading />;
  if (!data) return <LensEmpty icon={Package} message="Vendor not found" />;
  const { vendor } = data;
  const go = (p: string) => onDeepLink ? onDeepLink(p) : navigate(p);
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-bold text-white/90">{vendor.name}</div>
        {vendor.trade && <div className="text-[11px] text-white/35">{vendor.trade}</div>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border"
          style={vendor.compliant
            ? { color: "#22C55E", background: "#22C55E12", borderColor: "#22C55E28" }
            : { color: "#EF4444", background: "#EF444412", borderColor: "#EF444428" }}>
          {vendor.compliant ? "COI ✓ Valid" : "COI Expired"}
        </span>
        {vendor.coiExpiresOn && (
          <span className="text-[11px] text-white/35">
            thru {new Date(vendor.coiExpiresOn).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
          </span>
        )}
      </div>
      {vendor.phone && <div className="text-[12px] text-white/50">{vendor.phone}</div>}
      {vendor.email && <div className="text-[12px] text-white/50">{vendor.email}</div>}
      <PrimaryCTA label="View Vendors" onClick={() => go("/crews")} />
    </div>
  );
}

// ─── Photo Evidence Lens ──────────────────────────────────────────────────────

interface UnitPhotosData {
  job: { id: string; jobNo: string; unitNo: string | null; propertyName: string | null } | null;
  photos: Array<{ url: string; phase: string | null; takenAt: string | null }>;
}

function PhotoEvidenceLens({ query, onDeepLink }: { query?: string; onDeepLink?: (p: string) => void }) {
  const [, navigate] = useLocation();
  // `query` here is the raw request text (e.g. "before and after for unit 204").
  // The endpoint resolves property → unit → job and returns before/after photos.
  const { data, loading } = useLensData<UnitPhotosData>(
    query ? `/command/lens/unit-photos?q=${encodeURIComponent(query)}` : null,
  );
  if (loading) return <LensLoading />;
  if (!data || !data.job || data.photos.length === 0) {
    return <LensEmpty icon={Camera} message="No before/after photos found for that unit yet" />;
  }
  const go = (p: string) => onDeepLink ? onDeepLink(p) : navigate(p);
  const before = data.photos.filter(p => p.phase === "before");
  const after = data.photos.filter(p => p.phase === "after");
  const rest = data.photos.filter(p => p.phase !== "before" && p.phase !== "after");
  const heading = data.job.unitNo ? `Unit ${data.job.unitNo}` : data.job.jobNo;
  return (
    <div className="space-y-3">
      <div className="text-[12.5px] font-bold text-white/85">
        {heading}{data.job.propertyName ? ` · ${data.job.propertyName}` : ""} — {data.photos.length} photo{data.photos.length !== 1 ? "s" : ""}
      </div>
      {before.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/28 mb-1.5">Before</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {before.slice(0, 6).map((p, i) => <img key={i} src={p.url} alt="before" className="w-16 h-16 rounded-[10px] object-cover shrink-0 border border-white/10" />)}
          </div>
        </div>
      )}
      {after.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#22C55E]/60 mb-1.5">After</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {after.slice(0, 6).map((p, i) => <img key={i} src={p.url} alt="after" className="w-16 h-16 rounded-[10px] object-cover shrink-0 border border-[#22C55E]/20" />)}
          </div>
        </div>
      )}
      {rest.length > 0 && (
        <div>
          {(before.length > 0 || after.length > 0) && (
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/28 mb-1.5">More</div>
          )}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {rest.slice(0, 6).map((p, i) => <img key={i} src={p.url} alt="photo" className="w-16 h-16 rounded-[10px] object-cover shrink-0 border border-white/10" />)}
          </div>
        </div>
      )}
      <PrimaryCTA label="Open Job" onClick={() => go(`/jobs/${data.job!.id}`)} />
    </div>
  );
}

// ─── Inspection Checklist Lens ────────────────────────────────────────────────

interface ChecklistData {
  jobId: string;
  checklists: Array<{ type: string; checkedCount: number; totalCount: number; signedOff: boolean; agreedAt: string | null }>;
  summary: { totalItems: number; checkedItems: number; allSignedOff: boolean; hasChecklists: boolean };
}
function InspectionChecklistLens({ query, onDeepLink }: { query?: string; onDeepLink?: (p: string) => void }) {
  const [, navigate] = useLocation();
  const { data, loading } = useLensData<ChecklistData>(query ? `/command/lens/job-checklist/${query}` : null);
  if (loading) return <LensLoading />;
  if (!data || !data.summary.hasChecklists) return <LensEmpty icon={CheckCircle2} message="No checklists assigned to this job yet" />;
  const go = (p: string) => onDeepLink ? onDeepLink(p) : navigate(p);
  const { summary, checklists } = data;
  const pct = summary.totalItems > 0 ? Math.round((summary.checkedItems / summary.totalItems) * 100) : 0;
  const TYPE_LABELS: Record<string, string> = {
    cleaning: "Cleaning (31-point)",
    carpet: "Carpet",
    make_ready: "Make-Ready",
    painting: "Painting",
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[12.5px] font-bold text-white/85">{summary.checkedItems}/{summary.totalItems} items complete</div>
        <span className="text-[11px] font-bold" style={{ color: summary.allSignedOff ? "#22C55E" : pct > 60 ? "#F59E0B" : "#EF4444" }}>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: summary.allSignedOff ? "#22C55E" : "#F59E0B" }} />
      </div>
      <div className="space-y-2">
        {checklists.map((c, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-3.5 h-3.5 rounded-full border grid place-items-center shrink-0 ${c.signedOff ? "bg-[#22C55E]/15 border-[#22C55E]/40" : "bg-white/5 border-white/15"}`}>
                {c.signedOff && <CheckCircle2 className="w-2 h-2 text-[#22C55E]" strokeWidth={3} />}
              </div>
              <div className="text-[12px] text-white/75">{TYPE_LABELS[c.type] ?? c.type}</div>
            </div>
            <div className="text-[11px] text-white/40">{c.checkedCount}/{c.totalCount}</div>
          </div>
        ))}
      </div>
      {summary.allSignedOff && (
        <div className="text-[11px] text-[#22C55E] font-medium text-center py-1">✓ All checklists signed off</div>
      )}
      <PrimaryCTA label="Open Job" onClick={() => go(`/jobs/${query}`)} />
    </div>
  );
}

// ─── Main LensCard ────────────────────────────────────────────────────────────

export function LensCard({ lensType, query, onDeepLink, onHandleSubmit }: LensCardProps) {
  const [, navigate] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const meta = LENS_META[lensType];
  const { icon: Icon } = meta;

  const doDeepLink = () => {
    if (onDeepLink) onDeepLink(meta.deepLink);
    else navigate(meta.deepLink);
  };

  return (
    <div
      className="w-full rounded-[20px] overflow-hidden mb-3"
      style={{
        background: "linear-gradient(160deg, #07111F 0%, #060E1A 100%)",
        border: "1px solid rgba(255,255,255,0.055)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.025] transition-colors"
      >
        <div
          className="w-7 h-7 rounded-[8px] grid place-items-center shrink-0"
          style={{
            background: `${meta.accent}12`,
            border: `1px solid ${meta.accent}28`,
          }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: meta.accent }} strokeWidth={2} />
        </div>

        <div className="flex-1 text-left min-w-0">
          <div
            className="text-[10px] font-bold tracking-[0.20em] uppercase"
            style={{ color: meta.accent }}
          >
            {meta.label}
          </div>
          {query && (
            <div className="text-[10.5px] text-white/28 truncate mt-0.5">"{query}"</div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Live indicator for map/network */}
          {(lensType === "map" || lensType === "network" || lensType === "crew_map") && (
            <div className="flex items-center gap-1 text-[9px] font-bold text-[#22C55E]/70">
              <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" />
              LIVE
            </div>
          )}
          {collapsed
            ? <ChevronDown className="w-4 h-4 text-white/22 shrink-0" />
            : <ChevronUp   className="w-4 h-4 text-white/22 shrink-0" />
          }
        </div>
      </button>

      {/* Subtle accent divider */}
      {!collapsed && (
        <div className="h-px mx-4" style={{ background: `${meta.accent}15` }} />
      )}

      {/* ── Content ────────────────────────────────────────────────────── */}
      {!collapsed && (
        <div className="px-4 py-4">
          {lensType === "money"               && <MoneyLens               query={query} />}
          {lensType === "timeline"            && <TimelineLens            query={query} />}
          {lensType === "network"             && <NetworkLens             query={query} onHandleSubmit={onHandleSubmit} />}
          {lensType === "portfolio"           && <PortfolioLens           query={query} />}
          {lensType === "map"                 && <MapLens                 query={query} />}
          {lensType === "evidence"            && <EvidenceLens            query={query} />}
          {lensType === "property_status"     && <PropertyStatusLens      query={query} onDeepLink={onDeepLink} />}
          {lensType === "turn_timeline"       && <TurnTimelineLens        query={query} onDeepLink={onDeepLink} />}
          {lensType === "budget_breakdown"    && <BudgetBreakdownLens     query={query} onDeepLink={onDeepLink} />}
          {lensType === "crew_map"            && <CrewMapLens             query={query} />}
          {lensType === "invoice_detail"      && <InvoiceDetailLens       query={query} onDeepLink={onDeepLink} />}
          {lensType === "vendor_profile"      && <VendorProfileLens       query={query} onDeepLink={onDeepLink} />}
          {lensType === "photo_evidence"      && <PhotoEvidenceLens       query={query} onDeepLink={onDeepLink} />}
          {lensType === "inspection_checklist"&& <InspectionChecklistLens query={query} onDeepLink={onDeepLink} />}
        </div>
      )}

      {/* ── Collapsed mini-CTA ─────────────────────────────────────────── */}
      {collapsed && (
        <button
          onClick={doDeepLink}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-bold text-white/35 hover:text-white/60 transition-colors"
        >
          {meta.expandLabel}
          <ArrowUpRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
