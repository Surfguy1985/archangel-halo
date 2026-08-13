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

import { useState } from "react";
import { useLocation } from "wouter";
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

export type LensType = "money" | "timeline" | "evidence" | "network" | "portfolio" | "map";

interface LensCardProps {
  lensType: LensType;
  query?: string;
  onDeepLink?: (path: string) => void;
}

// ─── Lens metadata ────────────────────────────────────────────────────────────

const LENS_META: Record<LensType, {
  label: string;
  icon: typeof DollarSign;
  accent: string;
  deepLink: string;
  expandLabel: string;
}> = {
  money:     { label: "Money",     icon: DollarSign, accent: "#B4FF44", deepLink: "/money",      expandLabel: "Open Money Hub" },
  timeline:  { label: "Timeline",  icon: Clock,      accent: "#6366F1", deepLink: "/jobboard",   expandLabel: "Open Job Board" },
  evidence:  { label: "Evidence",  icon: Camera,     accent: "#F59E0B", deepLink: "/crews",      expandLabel: "Browse Gallery" },
  network:   { label: "Network",   icon: Users,      accent: "#3B82F6", deepLink: "/crews",      expandLabel: "Crew & Dispatch" },
  portfolio: { label: "Portfolio", icon: BarChart3,  accent: "#8B5CF6", deepLink: "/properties", expandLabel: "All Properties" },
  map:       { label: "Live Map",  icon: MapPin,     accent: "#22C55E", deepLink: "/crews",      expandLabel: "Open Live GPS Map" },
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
      onClick={onClick}
      className="w-full flex items-center justify-center gap-2 bg-white text-[#0A0F1A] font-bold text-[13px] py-[11px] rounded-[13px] hover:bg-white/92 active:scale-[0.97] transition-all shadow-[0_2px_12px_rgba(255,255,255,0.10)]"
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
      onClick={onClick}
      className="w-full flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-white/32 py-2 hover:text-white/55 transition-colors active:scale-[0.97]"
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

function NetworkLens({ query: _q }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: crews, isLoading: cLoading } = useListCrews();
  const { data: vendors, isLoading: vLoading } = useListVendors();

  if (cLoading || vLoading) return <LensLoading />;

  const crewList = crews ?? [];
  const vendorList = vendors ?? [];

  // Simulate checked-in vs available based on available data fields
  const checkedIn = crewList.filter(c => (c as any).isCheckedIn || (c as any).lastCheckinAt);
  const available = crewList.filter(c => !(c as any).isCheckedIn && !(c as any).lastCheckinAt);

  const getCrewInitials = (name: string) => name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <KpiCell label="Total Crew"    value={String(crewList.length)}   accent="#3B82F6" />
        <KpiCell label="On Site"       value={String(checkedIn.length)}  accent="#22C55E" />
        <KpiCell label="Vendors"       value={String(vendorList.length)} accent="#8B5CF6" />
      </div>

      {crewList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/25 px-0.5">Crew Roster</div>
          {crewList.slice(0, 5).map(c => {
            const isIn = (c as any).isCheckedIn || (c as any).lastCheckinAt;
            return (
              <div
                key={c.id}
                className="flex items-center gap-3 bg-white/[0.038] rounded-[12px] px-3.5 py-3"
              >
                <div className="w-8 h-8 rounded-full bg-[#3B82F6]/15 border border-[#3B82F6]/25 grid place-items-center shrink-0 text-[11px] font-bold text-[#3B82F6]">
                  {getCrewInitials(c.name ?? "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white/82 font-medium truncate">{c.name}</div>
                  <div className="text-[11px] text-white/35">{(c as any).trade ?? (c as any).role ?? "General"}</div>
                </div>
                <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[9.5px] font-bold ${
                  isIn
                    ? "bg-[#22C55E]/12 text-[#22C55E]/80 border border-[#22C55E]/20"
                    : "bg-white/5 text-white/30 border border-white/8"
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isIn ? "bg-[#22C55E]" : "bg-white/25"}`} />
                  {isIn ? "On Site" : "Available"}
                </div>
              </div>
            );
          })}
          {crewList.length > 5 && (
            <div className="text-center text-[11px] text-white/28 py-1">
              +{crewList.length - 5} more crew members
            </div>
          )}
        </div>
      )}

      {crewList.length === 0 && <LensEmpty icon={Users} message="No crew members yet. Add crew to dispatch them." />}

      <div className="flex gap-2 pt-1">
        <PrimaryCTA label="Dispatch & Crew →" onClick={() => navigate("/crews")} />
      </div>
    </div>
  );
}

// ─── MAP (LIVE OPS) LENS ──────────────────────────────────────────────────────

function MapLens({ query: _q }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: crews, isLoading: cLoading } = useListCrews();
  const { data: properties, isLoading: pLoading } = useListProperties();

  if (cLoading || pLoading) return <LensLoading />;

  const crewList = crews ?? [];
  const propList = properties ?? [];

  const checkedIn = crewList.filter(c => (c as any).isCheckedIn || (c as any).checkedInAt || (c as any).lastCheckinAt);
  const getInitials = (name: string) => name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-3">
      {/* Live ops summary bar */}
      <div className="flex items-center gap-3 bg-[#22C55E]/7 border border-[#22C55E]/14 rounded-[14px] px-4 py-3.5">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse" />
          <span className="text-[12px] font-bold text-[#22C55E]/85">Live Ops</span>
        </div>
        <div className="flex-1" />
        <span className="text-[12px] text-white/55">
          <span className="font-bold text-white/80">{checkedIn.length}</span> on site
          {propList.length > 0 && (
            <> · <span className="font-bold text-white/80">{propList.length}</span> propert{propList.length === 1 ? "y" : "ies"}</>
          )}
        </span>
      </div>

      {/* Crew grid */}
      {crewList.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/25 px-0.5">Active Crew</div>
          <div className="grid grid-cols-2 gap-2">
            {crewList.slice(0, 6).map(c => {
              const isIn = (c as any).isCheckedIn || (c as any).checkedInAt || (c as any).lastCheckinAt;
              const location = (c as any).checkedInLocation ?? (c as any).currentProperty ?? null;
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2.5 bg-white/[0.038] rounded-[12px] px-3 py-2.5"
                >
                  <div
                    className="w-8 h-8 rounded-full grid place-items-center shrink-0 text-[11px] font-bold"
                    style={{
                      background: isIn ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)",
                      border: isIn ? "1px solid rgba(34,197,94,0.25)" : "1px solid rgba(255,255,255,0.08)",
                      color: isIn ? "#22C55E" : "rgba(255,255,255,0.38)",
                    }}
                  >
                    {getInitials(c.name ?? "?")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-white/80 font-medium truncate">{c.name}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${isIn ? "bg-[#22C55E]" : "bg-white/20"}`} />
                      <span className="text-[10px] text-white/32">
                        {isIn ? (location ?? "Checked in") : "Available"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {crewList.length > 6 && (
            <div className="text-center text-[11px] text-white/28 py-1">
              +{crewList.length - 6} more crew members
            </div>
          )}
        </div>
      ) : (
        <LensEmpty icon={MapPin} message="No crew members yet." />
      )}

      {/* Property list (compact) */}
      {propList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/25 px-0.5">Properties</div>
          {propList.slice(0, 3).map(p => (
            <div key={p.id} className="flex items-center gap-2.5 bg-white/[0.028] rounded-[11px] px-3.5 py-2.5">
              <MapPin className="w-3 h-3 text-[#22C55E]/60 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-white/70 font-medium truncate">{p.name}</div>
                <div className="text-[10.5px] text-white/30">{(p as any).city ?? (p as any).address ?? "—"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <PrimaryCTA label="Open Live GPS Map" icon={Radio} onClick={() => navigate("/crews")} />
    </div>
  );
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
              onClick={() => navigate("/crews")}
              className="w-full text-center text-[11px] text-white/30 hover:text-white/50 py-1.5 transition-colors"
            >
              +{withPhotos.length - 4} more jobs with evidence
            </button>
          )}
        </div>
      ) : (
        <LensEmpty icon={Camera} message="No job photos yet. Start a Walk to capture before/after evidence." />
      )}

      <PrimaryCTA label="Browse Evidence Gallery" onClick={() => navigate("/crews")} />
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

// ─── Main LensCard ────────────────────────────────────────────────────────────

export function LensCard({ lensType, query, onDeepLink }: LensCardProps) {
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
          {(lensType === "map" || lensType === "network") && (
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
          {lensType === "money"     && <MoneyLens     query={query} />}
          {lensType === "timeline"  && <TimelineLens  query={query} />}
          {lensType === "network"   && <NetworkLens   query={query} />}
          {lensType === "portfolio" && <PortfolioLens query={query} />}
          {lensType === "map"       && <MapLens        query={query} />}
          {lensType === "evidence"  && <EvidenceLens  query={query} />}
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
