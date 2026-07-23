import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetWingsOverview,
  useListWingsMembers,
  useUpdateWingsMember,
  useDecideWingsMembership,
  useRecalculateWingsScore,
  useListWingsQuality,
  useRunWingsQualityReview,
  useDecideWingsQuality,
  useListWingsOverrides,
  useGetWingsReserve,
  useListWingsIncidents,
  useCreateWingsIncident,
  useResolveWingsIncident,
  useRunWingsAutomationNow,
  useListWingsAutomationRuns,
  useListWingsAudit,
  WingsIncidentInputType,
  WingsQualityDecisionInputStatus,
  type WingsMember,
  type WingsQualityItem,
  type WingsAuditEntry,
} from "@workspace/api-client-react";
import {
  Feather,
  BookOpen,
  RefreshCw,
  Loader2,
  Users,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Plus,
  Wallet,
  UserCheck,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { WingsGuideDialog } from "@/components/WingsGuideDialog";

const money = (n: number) =>
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const money2 = (n: number) =>
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function relTime(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(s);
}

const TIER_STYLES: Record<string, string> = {
  TRAINING: "bg-slate-100 text-slate-700 border-slate-300",
  BRONZE: "bg-orange-100 text-orange-800 border-orange-300",
  SILVER: "bg-zinc-100 text-zinc-700 border-zinc-300",
  GOLD: "bg-amber-100 text-amber-800 border-amber-300",
  PLATINUM: "bg-violet-100 text-violet-800 border-violet-300",
};

function TierBadge({ tier }: { tier: string }) {
  const cls = TIER_STYLES[tier] || "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${cls}`}>
      {tier}
    </span>
  );
}

const MEMBERSHIP_STYLES: Record<string, { cls: string; label: string }> = {
  PENDING_APPROVAL: { cls: "bg-amber-100 text-amber-800 border-amber-300", label: "Pending approval" },
  ACTIVE: { cls: "bg-green-100 text-green-700 border-green-300", label: "Active" },
  SUSPENDED: { cls: "bg-red-100 text-red-700 border-red-300", label: "Suspended" },
};

function MembershipBadge({ status }: { status?: string }) {
  const s = MEMBERSHIP_STYLES[status ?? ""] || { cls: "bg-muted text-muted-foreground border-border", label: status || "—" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${s.cls}`}>
      {s.label}
    </span>
  );
}

const TABS = ["Overview", "Crews", "Quality", "Overrides & Reserve", "Incidents", "Activity"] as const;
type WingsTab = (typeof TABS)[number];

const card = "bg-card border border-border rounded-md shadow-sm";

export default function Wings() {
  const [tab, setTab] = useState<WingsTab>("Overview");
  const [guideOpen, setGuideOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const runSweep = useRunWingsAutomationNow();

  const handleSweep = () => {
    runSweep.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast({ title: "AI sweep complete", description: "Founding Wings program updated." });
      },
      onError: (e: any) =>
        toast({ title: "Sweep failed", description: e?.message ?? "Try again", variant: "destructive" }),
    });
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] flex items-center justify-center">
            <Feather className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight uppercase">Founding Wings</h1>
            <p className="text-muted-foreground text-sm">Crew scores, overrides & AI quality reviews</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGuideOpen(true)}
            data-testid="button-wings-guide"
            className="flex items-center gap-2 border border-border bg-card px-4 py-2 rounded-md font-medium text-sm hover:border-[var(--primary)] transition-colors"
          >
            <BookOpen className="w-4 h-4" /> Program guide
          </button>
          <button
            onClick={handleSweep}
            disabled={runSweep.isPending}
            data-testid="button-run-sweep"
            className="flex items-center gap-2 bg-[var(--primary)] text-[var(--primary-foreground)] px-4 py-2 rounded-md font-display font-bold uppercase tracking-wider text-sm hover:bg-[var(--gold-light)] transition-colors disabled:opacity-60"
          >
            {runSweep.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {runSweep.isPending ? "Running…" : "Run AI sweep now"}
          </button>
        </div>
      </header>

      {runSweep.isPending && (
        <div className="text-sm text-muted-foreground flex items-center gap-2 bg-[var(--muted)] rounded-md px-4 py-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          The AI sweep is running — this can take about 30 seconds. Reviewing photos, accruing overrides, settling the reserve…
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-testid={`tab-${t.replace(/\W+/g, "-").toLowerCase()}`}
            className={`whitespace-nowrap px-4 py-2.5 text-sm font-display font-bold uppercase tracking-wide border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-[var(--primary)] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab />}
      {tab === "Crews" && <CrewsTab />}
      {tab === "Quality" && <QualityTab />}
      {tab === "Overrides & Reserve" && <OverridesTab />}
      {tab === "Incidents" && <IncidentsTab />}
      {tab === "Activity" && <ActivityTab />}

      <WingsGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}

function StatCard({ label, value, icon: Icon, highlight }: { label: string; value: React.ReactNode; icon: any; highlight?: boolean }) {
  return (
    <div className={`${highlight ? "bg-amber-50 border border-amber-300 rounded-md shadow-sm" : card} p-4`}>
      <div className={`flex items-center gap-2 text-xs font-display font-bold uppercase tracking-wider ${highlight ? "text-amber-700" : "text-muted-foreground"}`}>
        <Icon className="w-4 h-4" /> {label}
      </div>
      <div className={`text-2xl font-display font-bold mt-1.5 ${highlight ? "text-amber-800" : "text-[var(--ink)]"}`}>{value}</div>
    </div>
  );
}

function OverviewTab() {
  const { data: overview, isLoading } = useGetWingsOverview();
  const { data: runs } = useListWingsAutomationRuns();

  const brief = runs?.find((r) => (r.result as any)?.operatorBrief)?.result as any;
  const ob = brief?.operatorBrief;

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Members" value={overview?.members ?? 0} icon={Users} />
        <StatCard label="Pending approval" value={overview?.pendingMembers ?? 0} icon={UserCheck} highlight={(overview?.pendingMembers ?? 0) > 0} />
        <StatCard label="Pending reviews" value={overview?.pendingReviews ?? 0} icon={Sparkles} />
        <StatCard label="Needs human review" value={overview?.needsHumanReview ?? 0} icon={AlertTriangle} />
        <StatCard label="Held reserve" value={money(overview?.heldReserve ?? 0)} icon={ShieldCheck} />
        <StatCard label="Ready overrides" value={overview?.readyOverrides ?? 0} icon={Wallet} />
        <StatCard label="Open incidents" value={overview?.openIncidents ?? 0} icon={AlertTriangle} />
      </div>

      <div className={`${card} p-5`}>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-[var(--primary)]" />
          <h2 className="font-display font-bold uppercase tracking-wide text-lg">Latest operator brief</h2>
        </div>
        {!ob ? (
          <p className="text-sm text-muted-foreground">
            No operator brief yet. Run an AI sweep to generate the daily brief.
          </p>
        ) : (
          <div className="space-y-5">
            {ob.executiveSummary && (
              <p className="text-sm leading-relaxed">{ob.executiveSummary}</p>
            )}
            {Array.isArray(ob.risks) && ob.risks.length > 0 && (
              <div>
                <h3 className="text-xs font-display font-bold uppercase tracking-wider text-muted-foreground mb-2">Risks</h3>
                <div className="space-y-2">
                  {ob.risks.map((r: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        (r.severity ?? 0) >= 4 ? "bg-red-100 text-red-700" : (r.severity ?? 0) >= 2 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"
                      }`}>
                        Sev {r.severity ?? "?"}
                      </span>
                      <div>
                        <span className="font-semibold">{r.title}</span>
                        {r.detail ? <span className="text-muted-foreground"> — {r.detail}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(ob.recommendedActions) && ob.recommendedActions.length > 0 && (
              <div>
                <h3 className="text-xs font-display font-bold uppercase tracking-wider text-muted-foreground mb-2">Recommended actions</h3>
                <ol className="space-y-2 list-decimal list-inside">
                  {ob.recommendedActions.map((a: any, i: number) => (
                    <li key={i} className="text-sm">
                      <span className="font-semibold">{a.action}</span>
                      {a.reason ? <span className="text-muted-foreground"> — {a.reason}</span> : null}
                      {a.priority ? <span className="text-[10px] uppercase font-bold text-muted-foreground ml-1">({a.priority})</span> : null}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {Array.isArray(ob.celebration) && ob.celebration.length > 0 && (
              <div>
                <h3 className="text-xs font-display font-bold uppercase tracking-wider text-muted-foreground mb-2">Celebrate 🎉</h3>
                <ul className="space-y-1">
                  {ob.celebration.map((c: string, i: number) => (
                    <li key={i} className="text-sm text-[var(--green,#2e7d32)] flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CrewsTab() {
  const { data: members, isLoading } = useListWingsMembers();
  const update = useUpdateWingsMember();
  const decideMembership = useDecideWingsMembership();
  const recalc = useRecalculateWingsScore();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries();
  const errMsg = (e: any) => e?.data?.message ?? e?.data?.error ?? e?.message;

  const decide = (m: WingsMember, approve: boolean) => {
    decideMembership.mutate(
      { crewId: m.crewId, data: { approve } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/wings/members"] });
          queryClient.invalidateQueries({ queryKey: ["/api/wings/overview"] });
          toast({ title: approve ? "Member approved" : "Member suspended", description: m.crewName });
        },
        onError: (e: any) => toast({ title: approve ? "Approval failed" : "Suspend failed", description: errMsg(e), variant: "destructive" }),
      }
    );
  };

  const toggleAvailable = (m: WingsMember) => {
    update.mutate(
      { crewId: m.crewId, data: { isAvailable: !m.isAvailable } },
      { onSuccess: invalidate, onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }) }
    );
  };

  const setSponsor = (m: WingsMember, sponsorCrewId: string) => {
    update.mutate(
      { crewId: m.crewId, data: { sponsorCrewId: sponsorCrewId === "none" ? null : sponsorCrewId } },
      { onSuccess: invalidate, onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }) }
    );
  };

  const doRecalc = (m: WingsMember) => {
    recalc.mutate(
      { crewId: m.crewId },
      { onSuccess: () => { invalidate(); toast({ title: "Score recalculated", description: m.crewName }); }, onError: (e: any) => toast({ title: "Recalc failed", description: e?.message, variant: "destructive" }) }
    );
  };

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;

  if (!members || members.length === 0) {
    return <div className={`${card} p-10 text-center text-muted-foreground`}>No crew members enrolled yet. Run an AI sweep to enroll crews.</div>;
  }

  return (
    <div className={`${card} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-display font-bold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3">Crew</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Halo</th>
            <th className="px-4 py-3">Tier</th>
            <th className="px-4 py-3">Founder</th>
            <th className="px-4 py-3">Sponsor</th>
            <th className="px-4 py-3">Confidence</th>
            <th className="px-4 py-3">Available</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <>
              <tr key={m.crewId} className="border-b border-border/60 hover:bg-[var(--muted)]/40" data-testid={`row-member-${m.crewId}`}>
                <td className="px-4 py-3 font-semibold">
                  <button className="flex items-center gap-1.5 hover:text-[var(--primary)]" onClick={() => setExpanded(expanded === m.crewId ? null : m.crewId)}>
                    <ChevronDown className={`w-4 h-4 transition-transform ${expanded === m.crewId ? "rotate-180" : ""}`} />
                    {m.crewName}
                  </button>
                </td>
                <td className="px-4 py-3"><MembershipBadge status={m.membershipStatus} /></td>
                <td className="px-4 py-3">
                  <span className="text-2xl font-display font-bold text-[var(--ink)]">{Math.round(m.haloScore)}</span>
                </td>
                <td className="px-4 py-3"><TierBadge tier={m.tier} /></td>
                <td className="px-4 py-3 text-xs">{m.founderStatus && m.founderStatus !== "NONE" ? `${m.founderStatus}${m.founderNumber ? ` #${m.founderNumber}` : ""}` : "—"}</td>
                <td className="px-4 py-3 min-w-[160px]">
                  <Select value={m.sponsorCrewId ?? "none"} onValueChange={(v) => setSponsor(m, v)}>
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-sponsor-${m.crewId}`}>
                      <SelectValue placeholder="No sponsor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No sponsor</SelectItem>
                      {members.filter((o) => o.crewId !== m.crewId).map((o) => (
                        <SelectItem key={o.crewId} value={o.crewId}>{o.crewName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{Math.round((m.scoreConfidence ?? 0) * 100)}%</td>
                <td className="px-4 py-3">
                  <Switch checked={m.isAvailable} onCheckedChange={() => toggleAvailable(m)} data-testid={`switch-available-${m.crewId}`} />
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => doRecalc(m)}
                    disabled={recalc.isPending}
                    data-testid={`button-recalc-${m.crewId}`}
                    className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-md px-2.5 py-1.5 hover:border-[var(--primary)] disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${recalc.isPending ? "animate-spin" : ""}`} /> Recalculate
                  </button>
                </td>
              </tr>
              {m.membershipStatus === "PENDING_APPROVAL" && (
                <tr className="border-b border-border/60 bg-amber-50/60">
                  <td colSpan={9} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-4 text-xs">
                        <span className="font-bold uppercase tracking-wider text-amber-700">Readiness</span>
                        <span className="text-muted-foreground">Completed jobs: <span className="font-semibold text-[var(--ink)]">{m.readiness?.completedJobs ?? 0}</span></span>
                        <span className="text-muted-foreground">W-9 on file: <span className={`font-semibold ${m.readiness?.w9OnFile ? "text-green-700" : "text-red-600"}`}>{m.readiness?.w9OnFile ? "Yes" : "No"}</span></span>
                        <span className="text-muted-foreground">Open incidents: <span className={`font-semibold ${(m.readiness?.openIncidents ?? 0) > 0 ? "text-red-600" : "text-[var(--ink)]"}`}>{m.readiness?.openIncidents ?? 0}</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => decide(m, true)}
                          disabled={decideMembership.isPending}
                          data-testid={`button-approve-member-${m.crewId}`}
                          className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider bg-green-600 text-white rounded-md px-3 py-1.5 hover:bg-green-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => decide(m, false)}
                          disabled={decideMembership.isPending}
                          data-testid={`button-decline-member-${m.crewId}`}
                          className="flex items-center gap-1.5 text-xs font-medium border border-red-300 text-red-700 rounded-md px-2.5 py-1.5 hover:bg-red-50 disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Decline
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {expanded === m.crewId && (
                <tr className="border-b border-border/60 bg-[var(--muted)]/30">
                  <td colSpan={9} className="px-4 py-3">
                    <div className="text-xs text-muted-foreground">
                      <span className="font-bold uppercase tracking-wider">Score reasons: </span>
                      {m.scoreReasons && m.scoreReasons.length > 0 ? m.scoreReasons.join(" · ") : "No reasons recorded yet."}
                      {m.scoreUpdatedAt ? <span className="ml-2">Updated {relTime(m.scoreUpdatedAt)}</span> : null}
                    </div>
                    {m.membershipStatus === "ACTIVE" && (
                      <div className="mt-3">
                        <button
                          onClick={() => decide(m, false)}
                          disabled={decideMembership.isPending}
                          data-testid={`button-suspend-member-${m.crewId}`}
                          className="flex items-center gap-1.5 text-xs font-medium border border-red-300 text-red-700 rounded-md px-2.5 py-1.5 hover:bg-red-50 disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Suspend member
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  NEEDS_REVIEW: "bg-amber-100 text-amber-800",
  PASS: "bg-green-100 text-green-700",
  FAIL: "bg-red-100 text-red-700",
};

function QualityTab() {
  const { data: items, isLoading } = useListWingsQuality();
  const runReview = useRunWingsQualityReview();
  const decide = useDecideWingsQuality();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [decision, setDecision] = useState<{ item: WingsQualityItem; status: "PASS" | "FAIL" } | null>(null);
  const [reason, setReason] = useState("");

  const invalidate = () => queryClient.invalidateQueries();

  const doReview = (item: WingsQualityItem) => {
    runReview.mutate(
      { id: item.id },
      { onSuccess: () => { invalidate(); toast({ title: "AI review complete", description: item.jobNo ?? "" }); }, onError: (e: any) => toast({ title: "Review failed", description: e?.message, variant: "destructive" }) }
    );
  };

  const submitDecision = () => {
    if (!decision) return;
    decide.mutate(
      {
        id: decision.item.id,
        data: {
          status: decision.status === "PASS" ? WingsQualityDecisionInputStatus.PASS : WingsQualityDecisionInputStatus.FAIL,
          reason: reason.trim() || (decision.status === "PASS" ? "Approved by admin" : "Failed by admin"),
        },
      },
      {
        onSuccess: () => { invalidate(); setDecision(null); setReason(""); toast({ title: "Decision saved" }); },
        onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
      }
    );
  };

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;

  if (!items || items.length === 0) {
    return <div className={`${card} p-10 text-center text-muted-foreground`}>No quality submissions yet.</div>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className={`${card} p-4`} data-testid={`quality-${item.id}`}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="font-display font-bold text-[var(--ink)]">
                {item.jobNo || "Job"} {item.crewName ? <span className="text-muted-foreground font-normal">· {item.crewName}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {item.propertyName ? `${item.propertyName} · ` : ""}{item.beforeCount} before / {item.afterCount} after photos · submitted {relTime(item.submittedAt)}
              </div>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[item.reviewStatus] || "bg-muted text-muted-foreground"}`}>
              {item.reviewStatus}
            </span>
          </div>

          {item.review && (
            <div className="mt-3 bg-[var(--muted)]/40 rounded-md p-3 text-sm">
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mb-1">
                <span className="font-bold text-[var(--ink)]">Score {item.review.finalScore}</span>
                <span>· Confidence {Math.round((item.review.confidence ?? 0) * 100)}%</span>
                <span>· Decided by {item.review.decidedBy}</span>
                {item.review.criticalConcern ? <span className="text-red-600 font-bold">· Critical concern</span> : null}
              </div>
              {item.review.summary && <p className="leading-relaxed">{item.review.summary}</p>}
              {item.review.concerns && item.review.concerns.length > 0 && (
                <ul className="mt-1 list-disc list-inside text-xs text-muted-foreground">
                  {item.review.concerns.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mt-3">
            {(item.beforeCount > 0 || item.afterCount > 0) && (
              <button
                onClick={() => doReview(item)}
                disabled={runReview.isPending}
                data-testid={`button-run-review-${item.id}`}
                className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-md px-3 py-1.5 hover:border-[var(--primary)] disabled:opacity-50"
              >
                {runReview.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Run AI review
              </button>
            )}
            <button
              onClick={() => { setDecision({ item, status: "PASS" }); setReason(""); }}
              data-testid={`button-approve-${item.id}`}
              className="flex items-center gap-1.5 text-xs font-medium border border-green-300 text-green-700 rounded-md px-3 py-1.5 hover:bg-green-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Approve
            </button>
            <button
              onClick={() => { setDecision({ item, status: "FAIL" }); setReason(""); }}
              data-testid={`button-fail-${item.id}`}
              className="flex items-center gap-1.5 text-xs font-medium border border-red-300 text-red-700 rounded-md px-3 py-1.5 hover:bg-red-50"
            >
              <XCircle className="w-3.5 h-3.5" /> Fail
            </button>
          </div>
        </div>
      ))}

      <Dialog open={!!decision} onOpenChange={(o) => { if (!o) setDecision(null); }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wide">
              {decision?.status === "PASS" ? "Approve submission" : "Fail submission"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this a pass or fail?" data-testid="input-decision-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button onClick={submitDecision} disabled={decide.isPending} data-testid="button-submit-decision">
              {decide.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {decision?.status === "PASS" ? "Approve" : "Fail"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OverridesTab() {
  const { data: overrides, isLoading } = useListWingsOverrides();
  const { data: reserve } = useGetWingsReserve();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-bold uppercase tracking-wide text-lg mb-3">Wingline overrides</h2>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !overrides || overrides.length === 0 ? (
          <div className={`${card} p-10 text-center text-muted-foreground`}>No overrides accrued yet.</div>
        ) : (
          <div className={`${card} overflow-hidden`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-display font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Job</th>
                  <th className="px-4 py-3">Sponsor → Recruit</th>
                  <th className="px-4 py-3">Gross override</th>
                  <th className="px-4 py-3">Immediate 80%</th>
                  <th className="px-4 py-3">Reserve 20%</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Window ends</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id} className="border-b border-border/60" data-testid={`override-${o.id}`}>
                    <td className="px-4 py-3 font-semibold">{o.jobNo || "—"}</td>
                    <td className="px-4 py-3 text-xs">{o.sponsorName || "?"} → {o.recruitName || "?"}</td>
                    <td className="px-4 py-3 font-semibold">{money2(o.grossOverride)}</td>
                    <td className="px-4 py-3">{money2(o.immediateAmount)}</td>
                    <td className="px-4 py-3">{money2(o.reserveAmount)}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--muted)]">{o.status}</span>
                      {o.immediateStatus ? <span className="block text-[10px] text-muted-foreground mt-0.5">imm: {o.immediateStatus}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(o.qualityWindowEndsAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="font-display font-bold uppercase tracking-wide text-lg mb-3">Guardian Reserve</h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <StatCard label="Held" value={money(reserve?.totals.held ?? 0)} icon={ShieldCheck} />
          <StatCard label="Released" value={money(reserve?.totals.released ?? 0)} icon={CheckCircle2} />
          <StatCard label="Debited" value={money(reserve?.totals.debited ?? 0)} icon={XCircle} />
        </div>

        {reserve && reserve.accounts.length > 0 && (
          <div className={`${card} overflow-hidden mb-4`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-display font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Crew</th>
                  <th className="px-4 py-3">Held</th>
                  <th className="px-4 py-3">Released</th>
                  <th className="px-4 py-3">Debited</th>
                </tr>
              </thead>
              <tbody>
                {reserve.accounts.map((a) => (
                  <tr key={a.id} className="border-b border-border/60">
                    <td className="px-4 py-3 font-semibold">{a.crewName || "—"}</td>
                    <td className="px-4 py-3">{money2(a.heldBalance)}</td>
                    <td className="px-4 py-3">{money2(a.releasedBalance)}</td>
                    <td className="px-4 py-3">{money2(a.debitedBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {reserve && reserve.transactions.length > 0 && (
          <div className={`${card} p-4`}>
            <h3 className="text-xs font-display font-bold uppercase tracking-wider text-muted-foreground mb-2">Recent transactions</h3>
            <div className="space-y-2">
              {reserve.transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-sm border-b border-border/40 pb-2 last:border-0">
                  <div>
                    <span className="font-medium">{t.crewName || "—"}</span>
                    <span className="text-muted-foreground text-xs ml-2">{t.type}{t.note ? ` · ${t.note}` : ""}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{money2(t.amount)}</div>
                    <div className="text-[10px] text-muted-foreground">{relTime(t.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IncidentsTab() {
  const { data: incidents, isLoading } = useListWingsIncidents();
  const { data: members } = useListWingsMembers();
  const create = useCreateWingsIncident();
  const resolve = useResolveWingsIncident();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>(WingsIncidentInputType.CALLBACK);
  const [severity, setSeverity] = useState("3");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [crewId, setCrewId] = useState("none");

  const invalidate = () => queryClient.invalidateQueries();

  const submit = () => {
    if (!description.trim()) { toast({ title: "Description required", variant: "destructive" }); return; }
    create.mutate(
      {
        data: {
          type: type as any,
          severity: Number(severity),
          description: description.trim(),
          cost: cost ? Number(cost) : null,
          crewId: crewId === "none" ? null : crewId,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          setDescription(""); setCost(""); setCrewId("none"); setSeverity("3"); setType(WingsIncidentInputType.CALLBACK);
          toast({ title: "Incident logged" });
        },
        onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
      }
    );
  };

  const doResolve = (id: string) => {
    resolve.mutate({ id }, { onSuccess: () => { invalidate(); toast({ title: "Incident resolved" }); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setOpen(true)}
          data-testid="button-log-incident"
          className="flex items-center gap-2 bg-[var(--primary)] text-[var(--primary-foreground)] px-4 py-2 rounded-md font-display font-bold uppercase tracking-wider text-sm hover:bg-[var(--gold-light)] transition-colors"
        >
          <Plus className="w-4 h-4" /> Log incident
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : !incidents || incidents.length === 0 ? (
        <div className={`${card} p-10 text-center text-muted-foreground`}>No incidents logged.</div>
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => (
            <div key={inc.id} className={`${card} p-4 flex items-start justify-between gap-4`} data-testid={`incident-${inc.id}`}>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display font-bold text-[var(--ink)]">{inc.type}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${inc.severity >= 4 ? "bg-red-100 text-red-700" : inc.severity >= 3 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>Sev {inc.severity}</span>
                  {inc.crewName ? <span className="text-xs text-muted-foreground">{inc.crewName}</span> : null}
                  {inc.jobNo ? <span className="text-xs text-muted-foreground">· {inc.jobNo}</span> : null}
                  {inc.cost != null ? <span className="text-xs text-muted-foreground">· {money2(inc.cost)}</span> : null}
                </div>
                <p className="text-sm mt-1">{inc.description}</p>
                <div className="text-[10px] text-muted-foreground mt-1">{relTime(inc.occurredAt)}{inc.resolvedAt ? ` · resolved ${relTime(inc.resolvedAt)}` : ""}</div>
              </div>
              {!inc.resolvedAt && (
                <button
                  onClick={() => doResolve(inc.id)}
                  disabled={resolve.isPending}
                  data-testid={`button-resolve-${inc.id}`}
                  className="shrink-0 text-xs font-medium border border-border rounded-md px-3 py-1.5 hover:border-[var(--primary)] disabled:opacity-50"
                >
                  Resolve
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wide">Log incident</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="select-incident-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(WingsIncidentInputType).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Severity (1–5)</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger data-testid="select-incident-severity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-incident-description" />
            </div>
            <div className="space-y-1.5">
              <Label>Cost (optional)</Label>
              <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} data-testid="input-incident-cost" />
            </div>
            <div className="space-y-1.5">
              <Label>Crew (optional)</Label>
              <Select value={crewId} onValueChange={setCrewId}>
                <SelectTrigger data-testid="select-incident-crew"><SelectValue placeholder="No crew" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No crew</SelectItem>
                  {members?.map((m) => <SelectItem key={m.crewId} value={m.crewId}>{m.crewName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending} data-testid="button-submit-incident">
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Log incident
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ACTOR_STYLES: Record<string, string> = {
  AI: "bg-violet-100 text-violet-800",
  ADMIN: "bg-blue-100 text-blue-800",
  SYSTEM: "bg-slate-100 text-slate-700",
};

function ActivityTab() {
  const { data: entries, isLoading } = useListWingsAudit({ limit: 100 });

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;

  if (!entries || entries.length === 0) {
    return <div className={`${card} p-10 text-center text-muted-foreground`}>No activity yet.</div>;
  }

  return (
    <div className={`${card} divide-y divide-border/60`}>
      {entries.map((e: WingsAuditEntry) => (
        <div key={e.id} className="px-4 py-3 flex items-start justify-between gap-4" data-testid={`audit-${e.id}`}>
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${ACTOR_STYLES[e.actorType] || "bg-muted text-muted-foreground"}`}>{e.actorType}</span>
              <span className="font-medium text-sm">{e.action}</span>
            </div>
            {e.reason ? <p className="text-xs text-muted-foreground mt-1">{e.reason}</p> : null}
          </div>
          <div className="text-[10px] text-muted-foreground shrink-0">{relTime(e.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}
