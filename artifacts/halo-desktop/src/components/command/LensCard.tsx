/**
 * LensCard — generative operations canvas (desktop variant).
 *
 * Six contextual lenses HALO renders inline in the conversation.
 * Desktop variant: NetworkLens routes to /integrations for Falkon Network.
 * Otherwise identical to the mobile LensCard.
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
  getGetMoneySummaryQueryKey,
  getListJobsQueryKey,
  getListCrewsQueryKey,
  getListPropertiesQueryKey,
  getListInvoicesQueryKey,
  getListVendorsQueryKey,
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

const LENS_META: Record<LensType, { label: string; icon: typeof DollarSign; color: string; deepLink: string; deepLinkLabel: string }> = {
  money:     { label: "Money",     icon: DollarSign, color: "#B4FF44", deepLink: "/money",        deepLinkLabel: "Open Money hub" },
  timeline:  { label: "Timeline",  icon: Clock,      color: "#6366F1", deepLink: "/jobboard",     deepLinkLabel: "Open Job Board" },
  evidence:  { label: "Evidence",  icon: Camera,     color: "#F59E0B", deepLink: "/crews",        deepLinkLabel: "Open Crew command" },
  network:   { label: "Network",   icon: Users,      color: "#3B82F6", deepLink: "/integrations", deepLinkLabel: "Open Falkon Network" },
  portfolio: { label: "Portfolio", icon: BarChart3,  color: "#8B5CF6", deepLink: "/properties",   deepLinkLabel: "Open Properties" },
  map:       { label: "Map",       icon: MapPin,     color: "#22C55E", deepLink: "/crews",        deepLinkLabel: "Open Crew map" },
};

// ─── Shared primitives ────────────────────────────────────────────────────────

function KpiCell({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-background/60 rounded-[11px] px-3 py-2.5 flex flex-col gap-1 border border-border/50">
      <div className="text-[9.5px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70">{label}</div>
      <div className="text-[18px] font-bold leading-none tabular-nums" style={{ color: accent }}>{value}</div>
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
      className="flex items-center gap-3 bg-accent/20 hover:bg-accent/35 rounded-[11px] px-3 py-2.5 cursor-pointer transition-colors active:scale-[0.98]"
    >
      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accentColor }} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/85 font-medium truncate">
          {job.description ?? job.jobNo ?? "—"}
        </div>
        {job.jobNo && (
          <div className="text-[11.5px] text-muted-foreground">{job.jobNo} · {job.scheduledOn ?? "Unscheduled"}</div>
        )}
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
    </div>
  );
}

function LensLoading() {
  return (
    <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground/50">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-[12.5px]">Loading…</span>
    </div>
  );
}

function LensEmpty({ icon: Icon, message }: { icon: typeof Camera; message: string }) {
  return (
    <div className="flex items-center gap-3 bg-accent/15 rounded-[12px] px-3 py-4">
      <Icon className="w-[15px] h-[15px] text-muted-foreground/40 shrink-0" />
      <span className="text-[13px] text-muted-foreground/60 leading-snug">{message}</span>
    </div>
  );
}

// ─── Sub-lens components ──────────────────────────────────────────────────────

function MoneyLens({ query: _query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: money, isLoading } = useGetMoneySummary({ query: { queryKey: getGetMoneySummaryQueryKey() } });
  const { data: invoicesData, isLoading: iLoading } = useListInvoices({ query: { queryKey: getListInvoicesQueryKey() } });

  if (isLoading || iLoading) return <LensLoading />;

  const invoices = invoicesData ?? [];
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
        <KpiCell label="MTD Revenue"  value={`$${(mtd / 1000).toFixed(1)}k`}          accent="#B4FF44" />
        <KpiCell label="Outstanding"  value={`$${(outstanding / 1000).toFixed(1)}k`}  accent="#F59E0B" />
        <KpiCell label="Overdue"      value={String(overdue.length)}                  accent={overdue.length > 0 ? "#E11D48" : "#22C55E"} />
      </div>

      {unpaid.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[9.5px] font-bold tracking-[0.15em] uppercase text-muted-foreground/60 px-0.5">Outstanding invoices</div>
          {unpaid.slice(0, 4).map(inv => {
            const isOD = overdue.includes(inv);
            return (
              <div
                key={inv.id}
                onClick={() => navigate(`/invoices/${inv.id}`)}
                className="flex items-center gap-3 bg-accent/20 hover:bg-accent/35 rounded-[11px] px-3 py-2.5 cursor-pointer transition-colors active:scale-[0.98]"
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOD ? "bg-destructive" : "bg-[#F59E0B]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-foreground/85 font-medium truncate">
                    {(inv as { propertyName?: string }).propertyName ?? "—"}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground">{isOD ? "Overdue" : "Sent"} · #{inv.invoiceNo}</div>
                </div>
                <div className="text-[13px] font-bold text-foreground/75 tabular-nums shrink-0">
                  ${(inv.total ?? 0).toLocaleString()}
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              </div>
            );
          })}
          {unpaid.length > 4 && (
            <button
              onClick={() => navigate("/money")}
              className="w-full text-center text-[11.5px] text-muted-foreground/60 hover:text-muted-foreground py-1.5 transition-colors"
            >
              +{unpaid.length - 4} more — view all
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2.5 bg-[#22C55E]/8 rounded-[12px] px-3 py-3">
          <CheckCircle2 className="w-[14px] h-[14px] text-[#22C55E] shrink-0" />
          <span className="text-[13px] text-[#22C55E]/85">All invoices are current.</span>
        </div>
      )}

      {paymentReady.length > 0 && (
        <div className="flex items-center gap-2.5 bg-primary/7 border border-primary/18 rounded-[12px] px-3 py-3">
          <CheckCircle2 className="w-[14px] h-[14px] text-primary shrink-0" />
          <span className="text-[13px] text-primary/85">
            {paymentReady.length} invoice{paymentReady.length > 1 ? "s" : ""} ready to collect
          </span>
        </div>
      )}
    </div>
  );
}

function TimelineLens({ query: _query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: jobs, isLoading } = useListJobs({ query: { queryKey: getListJobsQueryKey() } });

  if (isLoading) return <LensLoading />;

  const active = (jobs ?? []).filter(j => j.status !== "complete" && j.status !== "paid" && j.status !== "cancelled");
  const now = new Date();
  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);

  const scheduled = active.filter(j => j.scheduledOn).sort((a, b) => a.scheduledOn! < b.scheduledOn! ? -1 : 1);
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
        <KpiCell label="Active"    value={String(active.length)}      accent="#B4FF44" />
        <KpiCell label="This week" value={String(dueThisWeek.length)} accent="#6366F1" />
        <KpiCell label="Overdue"   value={String(overdue.length)}     accent={overdue.length > 0 ? "#E11D48" : "#22C55E"} />
      </div>

      {overdue.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9.5px] font-bold tracking-[0.15em] uppercase text-destructive/75 px-0.5">Overdue</div>
          {overdue.slice(0, 3).map(j => <JobRow key={j.id} job={j} accentColor="#E11D48" onClick={() => navigate(`/jobs/${j.id}`)} />)}
        </div>
      )}

      {dueThisWeek.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9.5px] font-bold tracking-[0.15em] uppercase text-muted-foreground/60 px-0.5">Due this week</div>
          {dueThisWeek.slice(0, 4).map(j => <JobRow key={j.id} job={j} accentColor="#6366F1" onClick={() => navigate(`/jobs/${j.id}`)} />)}
        </div>
      )}

      {unscheduled.length > 0 && (
        <div className="flex items-center gap-2.5 bg-[#F59E0B]/8 rounded-[12px] px-3 py-3">
          <AlertCircle className="w-[14px] h-[14px] text-[#F59E0B] shrink-0" />
          <span className="text-[13px] text-[#F59E0B]/85">
            {unscheduled.length} job{unscheduled.length > 1 ? "s" : ""} without a scheduled date
          </span>
        </div>
      )}

      {active.length === 0 && <LensEmpty icon={Clock} message="No active jobs at the moment." />}
    </div>
  );
}

function NetworkLens({ query: _query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: crews, isLoading: cLoading } = useListCrews({ query: { queryKey: getListCrewsQueryKey() } });
  const { data: vendors, isLoading: vLoading } = useListVendors({ query: { queryKey: getListVendorsQueryKey() } });

  if (cLoading || vLoading) return <LensLoading />;

  const crewList = crews ?? [];
  const vendorList = vendors ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <KpiCell label="Crew"    value={String(crewList.length)}   accent="#3B82F6" />
        <KpiCell label="Vendors" value={String(vendorList.length)} accent="#8B5CF6" />
      </div>

      {crewList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9.5px] font-bold tracking-[0.15em] uppercase text-muted-foreground/60 px-0.5">Crew</div>
          {crewList.slice(0, 4).map(c => (
            <div key={c.id} className="flex items-center gap-3 bg-accent/20 rounded-[11px] px-3 py-2.5">
              <div className="w-7 h-7 rounded-full bg-[#3B82F6]/15 border border-[#3B82F6]/25 grid place-items-center shrink-0">
                <Users className="w-3 h-3 text-[#3B82F6]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-foreground/85 font-medium truncate">{c.name}</div>
                <div className="text-[11.5px] text-muted-foreground">{c.trade ?? "General"}</div>
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" title="Available" />
            </div>
          ))}
          {crewList.length > 4 && (
            <div className="text-center text-[11.5px] text-muted-foreground/55 py-1">+{crewList.length - 4} more crew</div>
          )}
        </div>
      )}

      {/* Falkon network teaser — routes to /integrations on desktop */}
      <button
        onClick={() => navigate("/integrations")}
        className="w-full flex items-center gap-2.5 bg-primary/7 border border-primary/18 rounded-[12px] px-3 py-3 text-left hover:bg-primary/10 transition-colors active:scale-[0.98]"
      >
        <div className="w-5 h-5 rounded-full bg-primary/15 grid place-items-center shrink-0">
          <TrendingUp className="w-2.5 h-2.5 text-primary" />
        </div>
        <span className="text-[12.5px] text-primary/75 flex-1 leading-snug">
          View Falkon Network — vendor COI, peers &amp; capacity
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-primary/45 shrink-0" />
      </button>
    </div>
  );
}

function PortfolioLens({ query: _query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: properties, isLoading: pLoading } = useListProperties({ query: { queryKey: getListPropertiesQueryKey() } });
  const { data: jobs, isLoading: jLoading } = useListJobs({ query: { queryKey: getListJobsQueryKey() } });
  const { data: money, isLoading: mLoading } = useGetMoneySummary({ query: { queryKey: getGetMoneySummaryQueryKey() } });

  if (pLoading || jLoading || mLoading) return <LensLoading />;

  const propList = properties ?? [];
  const jobList = jobs ?? [];
  const activeJobs = jobList.filter(j => j.status !== "complete" && j.status !== "paid" && j.status !== "cancelled");
  const completedThisMonth = jobList.filter(j => j.status === "complete" || j.status === "paid");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <KpiCell label="Properties"  value={String(propList.length)}            accent="#8B5CF6" />
        <KpiCell label="Active Jobs" value={String(activeJobs.length)}          accent="#B4FF44" />
        <KpiCell label="Completed"   value={String(completedThisMonth.length)}  accent="#22C55E" />
        <KpiCell label="MTD Rev"     value={`$${((money?.mtd ?? 0) / 1000).toFixed(1)}k`} accent="#F59E0B" />
      </div>

      {propList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9.5px] font-bold tracking-[0.15em] uppercase text-muted-foreground/60 px-0.5">Properties</div>
          {propList.slice(0, 5).map(p => {
            const propJobs = activeJobs.filter(j => (j as { propertyId?: string }).propertyId === p.id);
            return (
              <div
                key={p.id}
                onClick={() => navigate(`/properties/${p.id}`)}
                className="flex items-center gap-3 bg-accent/20 hover:bg-accent/35 rounded-[11px] px-3 py-2.5 cursor-pointer transition-colors active:scale-[0.98]"
              >
                <div className="w-7 h-7 rounded-[8px] bg-[#8B5CF6]/15 border border-[#8B5CF6]/25 grid place-items-center shrink-0">
                  <Building2 className="w-3 h-3 text-[#8B5CF6]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-foreground/85 font-medium truncate">{p.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">{p.units ?? 0} units · {p.city ?? "—"}</div>
                </div>
                {propJobs.length > 0 && (
                  <span className="text-[10.5px] bg-primary/14 text-primary rounded-full px-2 py-0.5 font-bold shrink-0">
                    {propJobs.length} active
                  </span>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              </div>
            );
          })}
          {propList.length > 5 && (
            <div className="text-center text-[11.5px] text-muted-foreground/55 py-1">+{propList.length - 5} more properties</div>
          )}
        </div>
      )}

      {propList.length === 0 && <LensEmpty icon={Building2} message="No properties yet. Add one to get started." />}
    </div>
  );
}

function MapLens({ query: _query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: properties, isLoading: pLoading } = useListProperties({ query: { queryKey: getListPropertiesQueryKey() } });
  const { data: crews, isLoading: cLoading } = useListCrews({ query: { queryKey: getListCrewsQueryKey() } });

  if (pLoading || cLoading) return <LensLoading />;

  const propList = properties ?? [];
  const crewList = crews ?? [];

  return (
    <div className="space-y-3">
      <div
        onClick={() => navigate("/crews")}
        className="flex items-center gap-2.5 bg-[#22C55E]/7 border border-[#22C55E]/18 rounded-[12px] px-3 py-3 cursor-pointer hover:bg-[#22C55E]/10 transition-colors active:scale-[0.98]"
      >
        <MapPin className="w-[14px] h-[14px] text-[#22C55E] shrink-0" />
        <span className="text-[13px] text-[#22C55E]/80 flex-1">Live GPS map available in Crew Command Center</span>
        <ChevronRight className="w-3.5 h-3.5 text-[#22C55E]/45 shrink-0" />
      </div>

      {propList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9.5px] font-bold tracking-[0.15em] uppercase text-muted-foreground/60 px-0.5">Property locations</div>
          {propList.slice(0, 5).map(p => (
            <div key={p.id} className="flex items-center gap-3 bg-accent/20 rounded-[11px] px-3 py-2.5">
              <div className="w-6 h-6 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/25 grid place-items-center shrink-0">
                <MapPin className="w-2.5 h-2.5 text-[#22C55E]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-foreground/85 font-medium truncate">{p.name}</div>
                <div className="text-[11.5px] text-muted-foreground">{p.city ?? "Location not set"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {crewList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9.5px] font-bold tracking-[0.15em] uppercase text-muted-foreground/60 px-0.5">Crew status</div>
          {crewList.slice(0, 4).map(c => (
            <div key={c.id} className="flex items-center gap-3 bg-accent/20 rounded-[11px] px-3 py-2.5">
              <div className="w-2 h-2 rounded-full bg-[#22C55E] shrink-0" />
              <div className="text-[13px] text-foreground/85">{c.name}</div>
              <div className="ml-auto text-[11.5px] text-muted-foreground">{c.trade ?? "General"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceLens({ query: _query }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: jobs, isLoading } = useListJobs({ query: { queryKey: getListJobsQueryKey() } });

  if (isLoading) return <LensLoading />;

  const jobsWithPhotos = (jobs ?? []).filter(j => (j as { photoCount?: number }).photoCount && (j as { photoCount?: number }).photoCount! > 0);
  const recent = jobsWithPhotos.slice(0, 6);

  return (
    <div className="space-y-3">
      {recent.length > 0 ? (
        <>
          <div className="text-[9.5px] font-bold tracking-[0.15em] uppercase text-muted-foreground/60 px-0.5">Recent photo evidence</div>
          <div className="grid grid-cols-4 gap-2">
            {recent.map(j => (
              <div
                key={j.id}
                onClick={() => navigate(`/jobs/${j.id}`)}
                className="aspect-square bg-accent/25 rounded-[10px] border border-border grid place-items-center cursor-pointer hover:bg-accent/40 transition-colors relative overflow-hidden"
              >
                <Camera className="w-5 h-5 text-muted-foreground/40" />
                <div className="absolute bottom-1 right-1 text-[9px] bg-background/70 text-muted-foreground rounded-full px-1.5 py-0.5 tabular-nums">
                  {(j as { photoCount?: number }).photoCount ?? "—"}
                </div>
              </div>
            ))}
          </div>
          <div className="text-center text-[11.5px] text-muted-foreground/55">
            {jobsWithPhotos.length} jobs with evidence — click to view
          </div>
        </>
      ) : (
        <LensEmpty icon={Camera} message="No job photos yet. Start a Walk to capture evidence." />
      )}
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
      className="w-full rounded-[16px] overflow-hidden mb-3 shadow-[0_4px_20px_rgba(0,0,0,0.12)]"
      style={{ border: `1px solid ${meta.color}1E` }}
    >
      {/* Lens header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-accent/20 transition-colors"
      >
        <div
          className="w-7 h-7 rounded-[8px] grid place-items-center shrink-0"
          style={{ background: `${meta.color}12`, border: `1px solid ${meta.color}28` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} strokeWidth={2} />
        </div>
        <div className="flex-1 text-left">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: meta.color }}>
            {meta.label} Lens
          </div>
          {query && (
            <div className="text-[11px] text-muted-foreground/60 truncate mt-0.5">"{query}"</div>
          )}
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground/40 shrink-0" />
        }
      </button>

      {/* Lens content */}
      {expanded && (
        <div className="bg-background/50 px-4 py-3.5">
          {lensType === "money"     && <MoneyLens query={query} />}
          {lensType === "timeline"  && <TimelineLens query={query} />}
          {lensType === "network"   && <NetworkLens query={query} />}
          {lensType === "portfolio" && <PortfolioLens query={query} />}
          {lensType === "map"       && <MapLens query={query} />}
          {lensType === "evidence"  && <EvidenceLens query={query} />}

          {/* Deep link CTA */}
          <button
            onClick={handleDeepLink}
            className="mt-4 w-full flex items-center justify-center gap-2 text-[11px] font-bold tracking-[0.1em] uppercase py-2.5 rounded-[10px] border border-border text-muted-foreground/50 hover:text-muted-foreground hover:border-border/80 hover:bg-accent/15 transition-all active:scale-[0.98]"
          >
            {meta.deepLinkLabel}
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
