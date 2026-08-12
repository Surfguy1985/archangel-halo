/**
 * LensCard — generative operations canvas (desktop variant).
 *
 * Six contextual lenses that HALO renders inline in the conversation
 * when the operator's intent matches a data-exploration pattern.
 * Each lens is lazy: it fetches data only when activated.
 *
 * Desktop: Falkon network link goes to /integrations (not /falkon-network).
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
  getGetMoneySummaryQueryKey,
  getListJobsQueryKey,
  getListCrewsQueryKey,
  getListPropertiesQueryKey,
  getListInvoicesQueryKey,
} from "@workspace/api-client-react";
import {
  DollarSign,
  Clock,
  Camera,
  Users,
  BarChart3,
  MapPin,
  ChevronRight,
  ExternalLink,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Building2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LensType = "money" | "timeline" | "evidence" | "network" | "portfolio" | "map";

interface LensCardProps {
  lensType: LensType;
  query?: string;
  onDeepLink?: (path: string) => void;
}

// ─── Lens metadata ────────────────────────────────────────────────────────────

const LENS_META: Record<LensType, { label: string; icon: typeof DollarSign; color: string; deepLink: string }> = {
  money:     { label: "Money",     icon: DollarSign, color: "#B4FF44", deepLink: "/money" },
  timeline:  { label: "Timeline",  icon: Clock,      color: "#6366F1", deepLink: "/jobboard" },
  evidence:  { label: "Evidence",  icon: Camera,     color: "#F59E0B", deepLink: "/crews" },
  network:   { label: "Network",   icon: Users,      color: "#3B82F6", deepLink: "/crews" },
  portfolio: { label: "Portfolio", icon: BarChart3,  color: "#8B5CF6", deepLink: "/properties" },
  map:       { label: "Map",       icon: MapPin,     color: "#22C55E", deepLink: "/crews" },
};

// ─── Sub-lens components ──────────────────────────────────────────────────────

function MoneyLens({ query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: money, isLoading } = useGetMoneySummary({
    query: { queryKey: getGetMoneySummaryQueryKey() },
  });
  const { data: invoicesData, isLoading: iLoading } = useListInvoices({
    query: { queryKey: getListInvoicesQueryKey() },
  });

  if (isLoading || iLoading) return <LensLoading />;

  const invoices = (invoicesData ?? []);
  const unpaid = invoices.filter(inv => inv.status === "sent" || inv.status === "partial");
  const overdue = unpaid.filter(inv => {
    if (!inv.dueDate) return false;
    const [y, m, d] = inv.dueDate.split("-").map(Number);
    return new Date(y, m - 1, d) < new Date();
  });
  const paymentReady = invoices.filter(inv => inv.status === "sent" && !overdue.includes(inv));

  const mtd = money?.mtd ?? 0;
  const outstanding = money?.outstanding ?? 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <KpiCell label="MTD Revenue" value={`$${(mtd / 1000).toFixed(1)}k`} accent="#B4FF44" />
        <KpiCell label="Outstanding" value={`$${(outstanding / 1000).toFixed(1)}k`} accent="#F59E0B" />
        <KpiCell label="Overdue" value={String(overdue.length)} accent={overdue.length > 0 ? "#E11D48" : "#22C55E"} />
      </div>

      {unpaid.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/35 px-1">Outstanding invoices</div>
          {unpaid.slice(0, 4).map(inv => {
            const isOD = overdue.includes(inv);
            return (
              <div
                key={inv.id}
                onClick={() => navigate(`/invoices/${inv.id}`)}
                className="flex items-center gap-3 bg-white/5 hover:bg-white/8 rounded-[12px] px-3 py-2.5 cursor-pointer transition-colors"
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOD ? "bg-[#E11D48]" : "bg-[#F59E0B]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white/85 font-medium truncate">
                    {(inv as { propertyName?: string }).propertyName ?? "—"}
                  </div>
                  <div className="text-[11px] text-white/40">{isOD ? "Overdue" : "Sent"} · #{inv.invoiceNo}</div>
                </div>
                <div className="text-[13px] font-bold text-white/80">${(inv.total ?? 0).toLocaleString()}</div>
                <ChevronRight className="w-3.5 h-3.5 text-white/25 shrink-0" />
              </div>
            );
          })}
          {unpaid.length > 4 && (
            <button onClick={() => navigate("/money")} className="w-full text-center text-[11px] text-white/40 hover:text-white/60 py-1 transition-colors">
              +{unpaid.length - 4} more — view all
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-[#22C55E]/10 rounded-[12px] px-3 py-2.5">
          <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
          <span className="text-[12.5px] text-[#22C55E]/90">All invoices are current.</span>
        </div>
      )}

      {paymentReady.length > 0 && (
        <div className="flex items-center gap-2 bg-[#B4FF44]/8 border border-[#B4FF44]/20 rounded-[12px] px-3 py-2.5">
          <CheckCircle2 className="w-4 h-4 text-[#B4FF44]" />
          <span className="text-[12.5px] text-[#B4FF44]/90">
            {paymentReady.length} invoice{paymentReady.length > 1 ? "s" : ""} ready to collect
          </span>
        </div>
      )}
    </div>
  );
}

function TimelineLens({ query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: jobs, isLoading } = useListJobs({
    query: { queryKey: getListJobsQueryKey() },
  });

  if (isLoading) return <LensLoading />;

  const active = (jobs ?? []).filter(j => j.status !== "complete" && j.status !== "paid" && j.status !== "cancelled");
  const now = new Date();
  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);

  const scheduled = active.filter(j => j.scheduledOn).sort((a, b) => (a.scheduledOn! < b.scheduledOn! ? -1 : 1));
  const overdue = active.filter(j => {
    if (!j.scheduledOn) return false;
    const [y, m, d] = j.scheduledOn.split("-").map(Number);
    return new Date(y, m - 1, d) < now;
  });
  const dueThisWeek = scheduled.filter(j => {
    if (!j.scheduledOn) return false;
    const [y, m, d] = j.scheduledOn.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt >= now && dt <= weekEnd;
  });
  const unscheduled = active.filter(j => !j.scheduledOn);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <KpiCell label="Active" value={String(active.length)} accent="#B4FF44" />
        <KpiCell label="This week" value={String(dueThisWeek.length)} accent="#6366F1" />
        <KpiCell label="Overdue" value={String(overdue.length)} accent={overdue.length > 0 ? "#E11D48" : "#22C55E"} />
      </div>

      {overdue.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#E11D48]/80 px-1">Overdue</div>
          {overdue.slice(0, 3).map(j => (
            <JobRow key={j.id} job={j} accentColor="#E11D48" onClick={() => navigate(`/jobs/${j.id}`)} />
          ))}
        </div>
      )}

      {dueThisWeek.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/35 px-1">Due this week</div>
          {dueThisWeek.slice(0, 4).map(j => (
            <JobRow key={j.id} job={j} accentColor="#6366F1" onClick={() => navigate(`/jobs/${j.id}`)} />
          ))}
        </div>
      )}

      {unscheduled.length > 0 && (
        <div className="flex items-center gap-2 bg-[#F59E0B]/10 rounded-[12px] px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-[#F59E0B]" />
          <span className="text-[12.5px] text-[#F59E0B]/90">
            {unscheduled.length} job{unscheduled.length > 1 ? "s" : ""} without a scheduled date
          </span>
        </div>
      )}
    </div>
  );
}

function NetworkLens({ query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: crews, isLoading: cLoading } = useListCrews({
    query: { queryKey: getListCrewsQueryKey() },
  });

  if (cLoading) return <LensLoading />;

  const crewList = crews ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <KpiCell label="Crew" value={String(crewList.length)} accent="#3B82F6" />
        <KpiCell label="Vendors" value="→ Network" accent="#8B5CF6" />
      </div>

      {crewList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/35 px-1">Crew</div>
          {crewList.slice(0, 4).map(c => (
            <div key={c.id} className="flex items-center gap-3 bg-white/5 rounded-[12px] px-3 py-2.5">
              <div className="w-8 h-8 rounded-full bg-[#3B82F6]/20 border border-[#3B82F6]/30 grid place-items-center shrink-0">
                <Users className="w-3.5 h-3.5 text-[#3B82F6]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] text-white/85 font-medium truncate">{c.name}</div>
                <div className="text-[11px] text-white/40">{c.trade ?? "General"}</div>
              </div>
              <div className="w-2 h-2 rounded-full bg-[#22C55E]" title="Available" />
            </div>
          ))}
          {crewList.length > 4 && (
            <div className="text-center text-[11px] text-white/35 py-1">+{crewList.length - 4} more crew</div>
          )}
        </div>
      )}

      {/* Desktop: Falkon Network lives at /integrations */}
      <button
        onClick={() => navigate("/integrations")}
        className="w-full flex items-center gap-2 bg-[#B4FF44]/8 border border-[#B4FF44]/20 rounded-[12px] px-3 py-2.5 text-left"
      >
        <div className="w-5 h-5 rounded-full bg-[#B4FF44]/20 grid place-items-center">
          <TrendingUp className="w-3 h-3 text-[#B4FF44]" />
        </div>
        <span className="text-[12px] text-[#B4FF44]/80 flex-1">
          View Falkon Network — vendor COI, peers &amp; capacity
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-[#B4FF44]/50" />
      </button>
    </div>
  );
}

function PortfolioLens({ query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: properties, isLoading: pLoading } = useListProperties({
    query: { queryKey: getListPropertiesQueryKey() },
  });
  const { data: jobs, isLoading: jLoading } = useListJobs({
    query: { queryKey: getListJobsQueryKey() },
  });
  const { data: money, isLoading: mLoading } = useGetMoneySummary({
    query: { queryKey: getGetMoneySummaryQueryKey() },
  });

  if (pLoading || jLoading || mLoading) return <LensLoading />;

  const propList = properties ?? [];
  const jobList = jobs ?? [];
  const activeJobs = jobList.filter(j => j.status !== "complete" && j.status !== "paid" && j.status !== "cancelled");
  const completedThisMonth = jobList.filter(j => j.status === "complete" || j.status === "paid");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <KpiCell label="Properties" value={String(propList.length)} accent="#8B5CF6" />
        <KpiCell label="Active Jobs" value={String(activeJobs.length)} accent="#B4FF44" />
        <KpiCell label="Completed" value={String(completedThisMonth.length)} accent="#22C55E" />
        <KpiCell label="MTD Rev" value={`$${((money?.mtd ?? 0) / 1000).toFixed(1)}k`} accent="#F59E0B" />
      </div>

      {propList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/35 px-1">Properties</div>
          {propList.slice(0, 5).map(p => {
            const propJobs = activeJobs.filter(j => (j as { propertyId?: string }).propertyId === p.id);
            return (
              <div
                key={p.id}
                onClick={() => navigate(`/properties/${p.id}`)}
                className="flex items-center gap-3 bg-white/5 hover:bg-white/8 rounded-[12px] px-3 py-2.5 cursor-pointer transition-colors"
              >
                <div className="w-7 h-7 rounded-[9px] bg-[#8B5CF6]/20 border border-[#8B5CF6]/30 grid place-items-center shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-[#8B5CF6]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white/85 font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-white/40">{p.units ?? 0} units · {p.city ?? "—"}</div>
                </div>
                {propJobs.length > 0 && (
                  <span className="text-[11px] bg-[#B4FF44]/15 text-[#B4FF44] rounded-full px-2 py-0.5 font-bold shrink-0">
                    {propJobs.length} active
                  </span>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-white/25 shrink-0" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MapLens({ query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: properties, isLoading: pLoading } = useListProperties({
    query: { queryKey: getListPropertiesQueryKey() },
  });
  const { data: crews, isLoading: cLoading } = useListCrews({
    query: { queryKey: getListCrewsQueryKey() },
  });

  if (pLoading || cLoading) return <LensLoading />;

  const propList = properties ?? [];
  const crewList = crews ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 bg-white/4 rounded-[12px] px-3 py-2.5">
        <MapPin className="w-4 h-4 text-[#22C55E]" />
        <span className="text-[12.5px] text-white/70">Live GPS map available in Crew Command Center</span>
        <button onClick={() => navigate("/crews")} className="ml-auto text-[11px] text-[#22C55E] font-bold hover:underline shrink-0">
          Open ↗
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/35 px-1">Property locations</div>
        {propList.slice(0, 5).map(p => (
          <div key={p.id} className="flex items-center gap-3 bg-white/5 rounded-[12px] px-3 py-2.5">
            <div className="w-6 h-6 rounded-full bg-[#22C55E]/20 border border-[#22C55E]/30 grid place-items-center shrink-0">
              <MapPin className="w-3 h-3 text-[#22C55E]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] text-white/85 font-medium truncate">{p.name}</div>
              <div className="text-[11px] text-white/40">{p.city ?? "Location not set"}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/35 px-1">Crew status</div>
        {crewList.slice(0, 4).map(c => (
          <div key={c.id} className="flex items-center gap-3 bg-white/5 rounded-[12px] px-3 py-2.5">
            <div className="w-2 h-2 rounded-full bg-[#22C55E] shrink-0" />
            <div className="text-[12.5px] text-white/85">{c.name}</div>
            <div className="ml-auto text-[11px] text-white/35">{c.trade ?? "General"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidenceLens({ query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: jobs, isLoading } = useListJobs({
    query: { queryKey: getListJobsQueryKey() },
  });

  if (isLoading) return <LensLoading />;

  const jobsWithPhotos = (jobs ?? []).filter(j => (j as { photoCount?: number }).photoCount && (j as { photoCount?: number }).photoCount! > 0);
  const recent = jobsWithPhotos.slice(0, 6);

  return (
    <div className="space-y-3">
      {recent.length > 0 ? (
        <>
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/35 px-1">Recent photo evidence</div>
          <div className="grid grid-cols-3 gap-2">
            {recent.map(j => (
              <div
                key={j.id}
                onClick={() => navigate(`/jobs/${j.id}`)}
                className="aspect-square bg-white/8 rounded-[12px] border border-white/8 grid place-items-center cursor-pointer hover:bg-white/12 transition-colors relative overflow-hidden"
              >
                <Camera className="w-5 h-5 text-white/30" />
                <div className="absolute bottom-1 right-1 text-[9px] bg-black/60 text-white/70 rounded-full px-1.5 py-0.5">
                  {(j as { photoCount?: number }).photoCount ?? "—"}
                </div>
              </div>
            ))}
          </div>
          <div className="text-center text-[11px] text-white/35">
            Click a job to view photos · {jobsWithPhotos.length} jobs with evidence
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 bg-white/4 rounded-[12px] px-3 py-3">
          <Camera className="w-4 h-4 text-white/30" />
          <span className="text-[12.5px] text-white/50">No job photos yet. Start a Walk to capture evidence.</span>
        </div>
      )}
    </div>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function KpiCell({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-white/5 rounded-[12px] px-3 py-2.5 flex flex-col gap-1">
      <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/35">{label}</div>
      <div className="text-[18px] font-bold leading-none" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function JobRow({
  job,
  accentColor,
  onClick,
}: {
  job: { id: string; jobNo?: string | null; description?: string | null; scheduledOn?: string | null };
  accentColor: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 bg-white/5 hover:bg-white/8 rounded-[12px] px-3 py-2.5 cursor-pointer transition-colors"
    >
      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accentColor }} />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-white/85 font-medium truncate">
          {job.description ?? job.jobNo ?? "—"}
        </div>
        {job.jobNo && (
          <div className="text-[11px] text-white/40">{job.jobNo} · {job.scheduledOn ?? "Unscheduled"}</div>
        )}
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-white/25 shrink-0" />
    </div>
  );
}

function LensLoading() {
  return (
    <div className="flex items-center justify-center py-6 gap-2 text-white/30">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-[12px]">Loading…</span>
    </div>
  );
}

// ─── Main LensCard ────────────────────────────────────────────────────────────

export function LensCard({ lensType, query, onDeepLink }: LensCardProps) {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(true);
  const meta = LENS_META[lensType];
  const { icon: Icon } = meta;

  const handleDeepLink = () => {
    if (onDeepLink) onDeepLink(meta.deepLink);
    else navigate(meta.deepLink);
  };

  return (
    <div
      className="w-full rounded-[18px] overflow-hidden mb-3 shadow-[0_6px_24px_rgba(0,0,0,0.3)]"
      style={{ border: `1px solid ${meta.color}20` }}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-[#0A1628] hover:bg-[#0D1E33] transition-colors"
      >
        <div
          className="w-7 h-7 rounded-[9px] grid place-items-center shrink-0"
          style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}35` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} strokeWidth={2} />
        </div>
        <div className="flex-1 text-left">
          <div className="text-[11px] font-bold tracking-[0.15em] uppercase" style={{ color: meta.color }}>
            {meta.label} Lens
          </div>
          {query && (
            <div className="text-[11px] text-white/35 truncate mt-0.5">"{query}"</div>
          )}
        </div>
        <div className="text-[11px] text-white/30">{expanded ? "▲" : "▼"}</div>
      </button>

      {expanded && (
        <div className="bg-[#070F1E] px-4 py-3">
          {lensType === "money"     && <MoneyLens query={query} />}
          {lensType === "timeline"  && <TimelineLens query={query} />}
          {lensType === "network"   && <NetworkLens query={query} />}
          {lensType === "portfolio" && <PortfolioLens query={query} />}
          {lensType === "map"       && <MapLens query={query} />}
          {lensType === "evidence"  && <EvidenceLens query={query} />}

          <button
            onClick={handleDeepLink}
            className="mt-3 w-full flex items-center justify-center gap-1.5 text-[11px] font-bold tracking-[0.1em] uppercase py-2 rounded-[10px] border border-white/8 text-white/30 hover:text-white/60 hover:border-white/15 transition-colors"
          >
            Open full {meta.label} view
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
