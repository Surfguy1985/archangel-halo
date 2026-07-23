import { useMemo, useState } from "react";
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
  useListCrews,
  WingsIncidentInputType,
  WingsQualityDecisionInputStatus,
  type WingsMember,
  type WingsQualityItem,
} from "@workspace/api-client-react";
import {
  Feather,
  Loader2,
  Sparkles,
  RefreshCw,
  BookOpen,
  Award,
  AlertTriangle,
  CheckCircle2,
  Users,
  ShieldCheck,
  Coins,
  ClipboardList,
  Plus,
  X,
  Camera,
  Bot,
  UserCog,
  History,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { WingsGuide, TierBadge, type WingsGuideLang } from "@/components/WingsGuide";

type Pill = "overview" | "crews" | "quality" | "money" | "log";

const money = (n?: number | null) => `$${Math.round(n ?? 0).toLocaleString()}`;

function relTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function fmtDay(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function guideRequested(): boolean {
  return new URLSearchParams(window.location.search).get("guide") === "1";
}

const card = "bg-card rounded-[16px] border border-border shadow-[var(--shadow)] p-[15px]";

export default function Wings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pill, setPill] = useState<Pill>("overview");
  const [guideOpen, setGuideOpen] = useState(() => guideRequested());
  const [guideLang, setGuideLang] = useState<WingsGuideLang>("en");

  const runSweep = useRunWingsAutomationNow();

  const invalidateAll = () => {
    queryClient.invalidateQueries();
  };

  const handleSweep = () => {
    runSweep.mutate(undefined, {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "AI sweep complete", description: "Founding Wings updated." });
      },
      onError: () => {
        toast({ title: "Sweep failed", description: "Try again in a moment." });
      },
    });
  };

  const pills: { key: Pill; label: string; Icon: any }[] = [
    { key: "overview", label: "Overview", Icon: Sparkles },
    { key: "crews", label: "Crews", Icon: Users },
    { key: "quality", label: "Quality", Icon: Camera },
    { key: "money", label: "Money", Icon: Coins },
    { key: "log", label: "Log", Icon: ClipboardList },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both pb-24">
      <div className="px-[6px] mb-[16px]">
        <div className="flex items-center justify-between mb-[8px] gap-[8px]">
          <h1 className="font-display font-bold text-[30px] tracking-[-0.02em] text-[var(--ink)] leading-none flex items-center gap-[8px]">
            <Feather className="w-[26px] h-[26px] text-[var(--gold-dark)]" /> Wings
          </h1>
          <button
            onClick={() => setGuideOpen(true)}
            aria-label="Wings program guide"
            data-testid="button-wings-guide"
            className="w-[38px] h-[38px] rounded-full grid place-items-center bg-card border border-border text-[var(--ink)] shadow-sm transition-transform active:scale-[0.9]"
          >
            <BookOpen className="w-[18px] h-[18px]" />
          </button>
        </div>
        <p className="text-[14px] text-muted-foreground ml-[2px]">
          Founding crews, Halo Scores, overrides & AI reviews.
        </p>
        <button
          onClick={handleSweep}
          disabled={runSweep.isPending}
          data-testid="button-run-sweep"
          className="mt-[12px] w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[12px] text-[14px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_16px_rgba(143,106,31,0.25)] disabled:opacity-60 transition-transform active:scale-[0.98]"
        >
          {runSweep.isPending ? (
            <>
              <Loader2 className="w-[16px] h-[16px] animate-spin" /> Running AI sweep… (~30s)
            </>
          ) : (
            <>
              <Bot className="w-[16px] h-[16px]" /> Run AI sweep
            </>
          )}
        </button>
      </div>

      <div className="sticky top-0 z-10 bg-background/85 backdrop-blur-md px-[6px] py-[8px] -mx-[2px]">
        <div className="flex gap-[6px] overflow-x-auto no-scrollbar">
          {pills.map((p) => {
            const Icon = p.Icon;
            return (
              <button
                key={p.key}
                onClick={() => setPill(p.key)}
                data-testid={`pill-${p.key}`}
                className={`flex items-center gap-[5px] whitespace-nowrap rounded-full px-[14px] py-[8px] text-[12.5px] font-display font-bold transition-all ${
                  pill === p.key
                    ? "bg-[var(--ink)] text-white shadow-sm"
                    : "bg-card border border-border text-muted-foreground"
                }`}
              >
                <Icon className="w-[13px] h-[13px]" /> {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-[6px] mt-[14px]">
        {pill === "overview" && <OverviewPill />}
        {pill === "crews" && <CrewsPill />}
        {pill === "quality" && <QualityPill />}
        {pill === "money" && <MoneyPill />}
        {pill === "log" && <LogPill />}
      </div>

      <Sheet open={guideOpen} onOpenChange={setGuideOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none"
        >
          <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
          <div className="p-[8px_18px_30px] overflow-y-auto">
            <WingsGuide lang={guideLang} onLangChange={setGuideLang} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({
  label,
  value,
  Icon,
  highlight,
}: {
  label: string;
  value: string;
  Icon: any;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-[16px] border shadow-[var(--shadow)] p-[14px] ${
        highlight ? "bg-amber-50 border-amber-300" : "bg-card border-border"
      }`}
    >
      <div
        className={`flex items-center gap-[6px] mb-[6px] ${
          highlight ? "text-amber-700" : "text-muted-foreground"
        }`}
      >
        <Icon className="w-[14px] h-[14px]" />
        <span className="text-[11.5px] font-bold uppercase tracking-[0.08em]">{label}</span>
      </div>
      <div
        className={`font-display font-bold text-[24px] leading-none ${
          highlight ? "text-amber-700" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function MembershipBadge({ status }: { status?: string }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string }> = {
    PENDING_APPROVAL: {
      label: "Pending approval",
      cls: "bg-amber-100 text-amber-700 border-amber-300",
    },
    ACTIVE: { label: "Active", cls: "bg-green-100 text-green-700 border-green-300" },
    SUSPENDED: { label: "Suspended", cls: "bg-red-100 text-red-600 border-red-300" },
  };
  const entry = map[status];
  if (!entry) return null;
  return (
    <span
      className={`inline-flex items-center px-[8px] py-[2px] rounded-full border text-[10px] font-bold uppercase tracking-[0.06em] ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
}

function OverviewPill() {
  const { data: overview, isLoading } = useGetWingsOverview();
  const { data: runs } = useListWingsAutomationRuns();

  const brief = useMemo(() => {
    const run = runs?.find((r) => {
      const res = r.result as any;
      return res && res.operatorBrief;
    });
    return (run?.result as any)?.operatorBrief as
      | {
          executiveSummary?: string;
          risks?: { severity?: number; title?: string; detail?: string }[];
          recommendedActions?: { priority?: number; action?: string; reason?: string }[];
          celebration?: string[];
        }
      | undefined;
  }, [runs]);

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-[12px]">
      <div className="grid grid-cols-2 gap-[10px]">
        <StatCard label="Members" value={String(overview?.members ?? 0)} Icon={Users} />
        <StatCard
          label="Pending approval"
          value={String(overview?.pendingMembers ?? 0)}
          Icon={UserCog}
          highlight={(overview?.pendingMembers ?? 0) > 0}
        />
        <StatCard label="Pending reviews" value={String(overview?.pendingReviews ?? 0)} Icon={Camera} />
        <StatCard label="Needs human" value={String(overview?.needsHumanReview ?? 0)} Icon={AlertTriangle} />
        <StatCard label="Held reserve" value={money(overview?.heldReserve)} Icon={ShieldCheck} />
        <StatCard label="Ready overrides" value={String(overview?.readyOverrides ?? 0)} Icon={Coins} />
        <StatCard label="Open incidents" value={String(overview?.openIncidents ?? 0)} Icon={AlertTriangle} />
      </div>

      <div className={card}>
        <div className="flex items-center gap-[8px] mb-[8px]">
          <Bot className="w-[16px] h-[16px] text-[var(--gold-dark)]" />
          <div className="font-display font-bold text-[15px]">Latest operator brief</div>
        </div>
        {brief ? (
          <div className="space-y-[12px]">
            {brief.executiveSummary && (
              <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                {brief.executiveSummary}
              </p>
            )}
            {brief.risks && brief.risks.length > 0 && (
              <div>
                <div className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-[6px]">
                  Risks
                </div>
                <div className="space-y-[6px]">
                  {brief.risks.map((r, i) => (
                    <div key={i} className="flex items-start gap-[8px]">
                      <span
                        className={`shrink-0 mt-[1px] px-[7px] py-[1px] rounded-full text-[10px] font-bold text-white ${
                          (r.severity ?? 0) >= 4
                            ? "bg-red-500"
                            : (r.severity ?? 0) >= 2
                            ? "bg-amber-500"
                            : "bg-muted-foreground"
                        }`}
                      >
                        S{r.severity ?? 1}
                      </span>
                      <div>
                        <div className="text-[13px] font-semibold text-[var(--ink)]">{r.title}</div>
                        {r.detail && (
                          <div className="text-[12.5px] text-muted-foreground">{r.detail}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {brief.recommendedActions && brief.recommendedActions.length > 0 && (
              <div>
                <div className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-[6px]">
                  Recommended actions
                </div>
                <ol className="space-y-[6px]">
                  {brief.recommendedActions.map((a, i) => (
                    <li key={i} className="flex items-start gap-[8px]">
                      <span className="shrink-0 w-[18px] h-[18px] rounded-full bg-[var(--ink)] text-white text-[10px] font-bold grid place-items-center mt-[1px]">
                        {a.priority ?? i + 1}
                      </span>
                      <div>
                        <div className="text-[13px] font-semibold text-[var(--ink)]">{a.action}</div>
                        {a.reason && (
                          <div className="text-[12.5px] text-muted-foreground">{a.reason}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {brief.celebration && brief.celebration.length > 0 && (
              <div>
                <div className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-[6px]">
                  Celebrate
                </div>
                <div className="space-y-[4px]">
                  {brief.celebration.map((c, i) => (
                    <div key={i} className="flex items-start gap-[6px] text-[13px] text-[var(--ink)]">
                      <CheckCircle2 className="w-[14px] h-[14px] text-green-600 shrink-0 mt-[2px]" /> {c}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No brief yet. Run an AI sweep to generate the daily operator brief.
          </p>
        )}
      </div>
    </div>
  );
}

function CrewsPill() {
  const { data: members, isLoading } = useListWingsMembers();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateWingsMember();
  const decide = useDecideWingsMembership();
  const recalc = useRecalculateWingsScore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries();

  const handleDecision = (m: WingsMember, approve: boolean) => {
    setDecidingId(m.crewId);
    decide.mutate(
      { crewId: m.crewId, data: { approve } },
      {
        onSuccess: () => {
          invalidate();
          setDecidingId(null);
          toast({
            title: approve ? "Member approved" : "Member suspended",
            description: m.crewName,
          });
        },
        onError: (err: any) => {
          setDecidingId(null);
          toast({
            title: approve ? "Approval failed" : "Suspend failed",
            description: err?.data?.message ?? "Try again in a moment.",
          });
        },
      },
    );
  };

  const toggleAvailable = (m: WingsMember) => {
    update.mutate(
      { crewId: m.crewId, data: { isAvailable: !m.isAvailable } },
      { onSuccess: invalidate },
    );
  };

  const setSponsor = (m: WingsMember, sponsorCrewId: string) => {
    update.mutate(
      { crewId: m.crewId, data: { sponsorCrewId: sponsorCrewId || null } },
      { onSuccess: invalidate },
    );
  };

  const handleRecalc = (m: WingsMember) => {
    recalc.mutate(
      { crewId: m.crewId },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Score recalculated", description: m.crewName });
        },
      },
    );
  };

  if (isLoading) return <Loading />;
  if (!members || members.length === 0)
    return <Empty text="No wing members yet. Run an AI sweep to enroll crews." />;

  return (
    <div className="space-y-[10px]">
      {members.map((m) => (
        <div key={m.id} className={card} data-testid={`member-${m.crewId}`}>
          <div className="flex items-start justify-between gap-[10px]">
            <div className="min-w-0">
              <div className="font-display font-bold text-[16px] text-[var(--ink)] truncate">
                {m.crewName}
              </div>
              <div className="flex items-center gap-[6px] mt-[4px] flex-wrap">
                <TierBadge tier={m.tier} />
                <MembershipBadge status={m.membershipStatus} />
                {m.founderStatus && m.founderStatus !== "NONE" && (
                  <span className="inline-flex items-center gap-[3px] px-[8px] py-[2px] rounded-full bg-[var(--ink)] text-[var(--gold-light)] text-[10px] font-bold uppercase tracking-[0.06em]">
                    <Award className="w-[10px] h-[10px]" />
                    {m.founderStatus.replace("_", " ")}
                    {m.founderNumber ? ` #${m.founderNumber}` : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-display font-bold text-[30px] leading-none text-[var(--ink)]">
                {Math.round(m.haloScore)}
              </div>
              <div className="text-[10.5px] text-muted-foreground">
                {Math.round((m.scoreConfidence ?? 0) * 100)}% conf.
              </div>
            </div>
          </div>

          {m.membershipStatus === "PENDING_APPROVAL" && (
            <div className="mt-[12px] bg-amber-50 rounded-[12px] border border-amber-200 p-[12px]">
              <div className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-amber-700 mb-[8px]">
                Approval readiness
              </div>
              <div className="grid grid-cols-3 gap-[8px] mb-[12px]">
                <div>
                  <div className="font-display font-bold text-[18px] text-[var(--ink)] leading-none">
                    {m.readiness?.completedJobs ?? 0}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground mt-[3px]">Completed jobs</div>
                </div>
                <div>
                  <div
                    className={`font-display font-bold text-[18px] leading-none ${
                      m.readiness?.w9OnFile ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {m.readiness?.w9OnFile ? "Yes" : "No"}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground mt-[3px]">W-9 on file</div>
                </div>
                <div>
                  <div
                    className={`font-display font-bold text-[18px] leading-none ${
                      (m.readiness?.openIncidents ?? 0) > 0 ? "text-red-600" : "text-[var(--ink)]"
                    }`}
                  >
                    {m.readiness?.openIncidents ?? 0}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground mt-[3px]">Open incidents</div>
                </div>
              </div>
              <div className="flex items-center gap-[8px]">
                <button
                  onClick={() => handleDecision(m, true)}
                  disabled={decidingId === m.crewId}
                  data-testid={`approve-member-${m.crewId}`}
                  className="flex-1 flex items-center justify-center gap-[6px] rounded-[10px] px-[12px] py-[8px] text-[12.5px] font-display font-bold bg-green-600 text-white disabled:opacity-60 active:scale-[0.97] transition-transform"
                >
                  {decidingId === m.crewId ? (
                    <Loader2 className="w-[13px] h-[13px] animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-[13px] h-[13px]" />
                  )}
                  Approve
                </button>
                <button
                  onClick={() => handleDecision(m, false)}
                  disabled={decidingId === m.crewId}
                  data-testid={`decline-member-${m.crewId}`}
                  className="rounded-[10px] px-[12px] py-[8px] text-[12px] font-display font-bold bg-red-50 text-red-600 border border-red-200 disabled:opacity-60 active:scale-[0.97] transition-transform"
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          <div className="mt-[12px] space-y-[10px]">
            {m.membershipStatus === "ACTIVE" && (
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-muted-foreground">Membership</span>
                <button
                  onClick={() => handleDecision(m, false)}
                  disabled={decidingId === m.crewId}
                  data-testid={`suspend-member-${m.crewId}`}
                  className="rounded-[10px] px-[10px] py-[6px] text-[11.5px] font-display font-bold bg-red-50 text-red-600 border border-red-200 disabled:opacity-60 active:scale-[0.97] transition-transform"
                >
                  Suspend
                </button>
              </div>
            )}
            {m.membershipStatus === "SUSPENDED" && (
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-muted-foreground">Membership</span>
                <button
                  onClick={() => handleDecision(m, true)}
                  disabled={decidingId === m.crewId}
                  data-testid={`reinstate-member-${m.crewId}`}
                  className="rounded-[10px] px-[10px] py-[6px] text-[11.5px] font-display font-bold bg-green-50 text-green-700 border border-green-200 disabled:opacity-60 active:scale-[0.97] transition-transform"
                >
                  Reinstate
                </button>
              </div>
            )}
            <label className="flex items-center justify-between">
              <span className="text-[12.5px] text-muted-foreground">Available for work</span>
              <button
                onClick={() => toggleAvailable(m)}
                data-testid={`toggle-available-${m.crewId}`}
                className={`relative w-[42px] h-[24px] rounded-full transition-colors ${
                  m.isAvailable ? "bg-[var(--primary)]" : "bg-muted"
                }`}
              >
                <span
                  className={`absolute top-[2px] w-[20px] h-[20px] rounded-full bg-white shadow transition-all ${
                    m.isAvailable ? "left-[20px]" : "left-[2px]"
                  }`}
                />
              </button>
            </label>

            <div className="flex items-center justify-between gap-[8px]">
              <span className="text-[12.5px] text-muted-foreground shrink-0">Sponsor</span>
              <select
                value={m.sponsorCrewId ?? ""}
                onChange={(e) => setSponsor(m, e.target.value)}
                data-testid={`sponsor-${m.crewId}`}
                className="flex-1 min-w-0 text-[12.5px] rounded-[10px] border border-border bg-[var(--paper)] px-[10px] py-[7px] text-right"
              >
                <option value="">None</option>
                {members
                  .filter((o) => o.crewId !== m.crewId)
                  .map((o) => (
                    <option key={o.crewId} value={o.crewId}>
                      {o.crewName}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-[8px]">
              <button
                onClick={() => handleRecalc(m)}
                disabled={recalc.isPending}
                data-testid={`recalc-${m.crewId}`}
                className="flex items-center gap-[6px] rounded-[10px] px-[12px] py-[7px] text-[12px] font-display font-bold bg-[var(--ink)] text-white disabled:opacity-60 active:scale-[0.97] transition-transform"
              >
                <RefreshCw className={`w-[13px] h-[13px] ${recalc.isPending ? "animate-spin" : ""}`} />
                Recalculate
              </button>
              {m.scoreReasons && m.scoreReasons.length > 0 && (
                <button
                  onClick={() => setExpanded((e) => (e === m.id ? null : m.id))}
                  className="text-[12px] text-muted-foreground underline"
                >
                  {expanded === m.id ? "Hide reasons" : "Why this score?"}
                </button>
              )}
            </div>

            {expanded === m.id && m.scoreReasons && (
              <ul className="text-[12px] text-muted-foreground space-y-[3px] pl-[4px]">
                {m.scoreReasons.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function QualityPill() {
  const { data: items, isLoading } = useListWingsQuality();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const runReview = useRunWingsQualityReview();
  const decide = useDecideWingsQuality();
  const [decision, setDecision] = useState<{
    item: WingsQualityItem;
    status: typeof WingsQualityDecisionInputStatus[keyof typeof WingsQualityDecisionInputStatus];
  } | null>(null);
  const [reason, setReason] = useState("");

  const invalidate = () => queryClient.invalidateQueries();

  const handleReview = (item: WingsQualityItem) => {
    runReview.mutate(
      { id: item.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "AI review complete", description: item.jobNo ?? "Submission" });
        },
        onError: () => toast({ title: "Review failed", description: "Try again." }),
      },
    );
  };

  const submitDecision = () => {
    if (!decision) return;
    decide.mutate(
      { id: decision.item.id, data: { status: decision.status, reason: reason || "—" } },
      {
        onSuccess: () => {
          invalidate();
          setDecision(null);
          setReason("");
          toast({ title: "Decision saved" });
        },
      },
    );
  };

  if (isLoading) return <Loading />;
  if (!items || items.length === 0)
    return <Empty text="No quality submissions yet." />;

  return (
    <div className="space-y-[10px]">
      {items.map((it) => (
        <div key={it.id} className={card} data-testid={`quality-${it.id}`}>
          <div className="flex items-start justify-between gap-[8px]">
            <div className="min-w-0">
              <div className="font-display font-bold text-[15px] text-[var(--ink)]">
                {it.jobNo ?? "Job"} {it.crewName ? `· ${it.crewName}` : ""}
              </div>
              <div className="text-[12px] text-muted-foreground mt-[2px]">
                {it.beforeCount} before · {it.afterCount} after
              </div>
            </div>
            <StatusBadge status={it.reviewStatus} />
          </div>

          {it.review && (
            <div className="mt-[10px] bg-[var(--paper)] rounded-[12px] border border-border p-[12px]">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.06em]">
                  AI review
                </div>
                <div className="font-display font-bold text-[18px] text-[var(--ink)]">
                  {Math.round(it.review.finalScore)}
                </div>
              </div>
              {it.review.summary && (
                <p className="text-[12.5px] text-muted-foreground mt-[6px] leading-relaxed">
                  {it.review.summary}
                </p>
              )}
              {it.review.concerns && it.review.concerns.length > 0 && (
                <ul className="text-[12px] text-amber-700 mt-[6px] space-y-[2px]">
                  {it.review.concerns.map((c, i) => (
                    <li key={i}>⚠ {c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center gap-[8px] mt-[12px] flex-wrap">
            {it.beforeCount + it.afterCount > 0 && (
              <button
                onClick={() => handleReview(it)}
                disabled={runReview.isPending}
                data-testid={`run-review-${it.id}`}
                className="flex items-center gap-[6px] rounded-[10px] px-[12px] py-[7px] text-[12px] font-display font-bold bg-[var(--ink)] text-white disabled:opacity-60 active:scale-[0.97] transition-transform"
              >
                <Bot className="w-[13px] h-[13px]" /> Run AI review
              </button>
            )}
            <button
              onClick={() => {
                setDecision({ item: it, status: "PASS" });
                setReason("");
              }}
              data-testid={`approve-${it.id}`}
              className="rounded-[10px] px-[12px] py-[7px] text-[12px] font-display font-bold bg-green-50 text-green-700 border border-green-200 active:scale-[0.97] transition-transform"
            >
              Approve
            </button>
            <button
              onClick={() => {
                setDecision({ item: it, status: "FAIL" });
                setReason("");
              }}
              data-testid={`fail-${it.id}`}
              className="rounded-[10px] px-[12px] py-[7px] text-[12px] font-display font-bold bg-red-50 text-red-600 border border-red-200 active:scale-[0.97] transition-transform"
            >
              Fail
            </button>
          </div>
        </div>
      ))}

      {decision && (
        <Modal onClose={() => setDecision(null)} title={`${decision.status === "PASS" ? "Approve" : "Fail"} submission`}>
          <p className="text-[13px] text-muted-foreground mb-[10px]">
            {decision.item.jobNo ?? "Job"} — {decision.item.crewName ?? "crew"}
          </p>
          <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.06em]">
            Reason
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            data-testid="input-decision-reason"
            className="mt-[6px] w-full rounded-[12px] border border-border bg-[var(--paper)] px-[12px] py-[10px] text-[13px]"
            placeholder="Add a short reason for this decision"
          />
          <button
            onClick={submitDecision}
            disabled={decide.isPending}
            data-testid="button-submit-decision"
            className="mt-[12px] w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[12px] text-[14px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] disabled:opacity-60 active:scale-[0.98] transition-transform"
          >
            {decide.isPending ? <Loader2 className="w-[16px] h-[16px] animate-spin" /> : null}
            Save decision
          </button>
        </Modal>
      )}
    </div>
  );
}

function MoneyPill() {
  const { data: overrides, isLoading } = useListWingsOverrides();
  const { data: reserve } = useGetWingsReserve();

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-[12px]">
      <div className="grid grid-cols-3 gap-[8px]">
        <StatCard label="Held" value={money(reserve?.totals?.held)} Icon={ShieldCheck} />
        <StatCard label="Released" value={money(reserve?.totals?.released)} Icon={Coins} />
        <StatCard label="Debited" value={money(reserve?.totals?.debited)} Icon={AlertTriangle} />
      </div>

      <div className={card}>
        <div className="font-display font-bold text-[15px] mb-[10px]">Wingline overrides</div>
        {!overrides || overrides.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No overrides accrued yet.</p>
        ) : (
          <div className="space-y-[10px]">
            {overrides.map((o) => (
              <div key={o.id} className="border-b border-border last:border-0 pb-[10px] last:pb-0" data-testid={`override-${o.id}`}>
                <div className="flex items-center justify-between gap-[8px]">
                  <div className="font-semibold text-[13.5px] text-[var(--ink)]">{o.jobNo ?? "Job"}</div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="text-[12px] text-muted-foreground mt-[2px]">
                  {o.sponsorName ?? "Sponsor"} → {o.recruitName ?? "Recruit"}
                </div>
                <div className="flex items-center justify-between mt-[6px] text-[12.5px]">
                  <span className="text-muted-foreground">Gross override</span>
                  <span className="font-bold text-[var(--ink)]">{money(o.grossOverride)}</span>
                </div>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-muted-foreground">Immediate 80% ({o.immediateStatus})</span>
                  <span>{money(o.immediateAmount)}</span>
                </div>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-muted-foreground">Reserve 20%</span>
                  <span>{money(o.reserveAmount)}</span>
                </div>
                <div className="text-[11.5px] text-muted-foreground mt-[2px]">
                  Window ends {fmtDay(o.qualityWindowEndsAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <div className="font-display font-bold text-[15px] mb-[10px]">Reserve accounts</div>
        {!reserve || reserve.accounts.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No reserve accounts yet.</p>
        ) : (
          <div className="space-y-[8px]">
            {reserve.accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between">
                <div className="text-[13px] text-[var(--ink)] font-semibold">{a.crewName ?? "Crew"}</div>
                <div className="text-[12.5px] text-muted-foreground">
                  Held {money(a.heldBalance)} · Released {money(a.releasedBalance)}
                </div>
              </div>
            ))}
          </div>
        )}
        {reserve && reserve.transactions.length > 0 && (
          <div className="mt-[12px] pt-[10px] border-t border-border">
            <div className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-[6px]">
              Recent transactions
            </div>
            <div className="space-y-[6px]">
              {reserve.transactions.slice(0, 8).map((t) => (
                <div key={t.id} className="flex items-center justify-between text-[12.5px]">
                  <div className="min-w-0">
                    <span className="text-[var(--ink)] font-medium">{t.type}</span>
                    <span className="text-muted-foreground"> · {t.crewName ?? "crew"}</span>
                  </div>
                  <span className={t.amount < 0 ? "text-red-600" : "text-[var(--ink)]"}>
                    {money(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LogPill() {
  return (
    <div className="space-y-[14px]">
      <IncidentsSection />
      <AuditSection />
    </div>
  );
}

function IncidentsSection() {
  const { data: incidents, isLoading } = useListWingsIncidents();
  const { data: crews } = useListCrews();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateWingsIncident();
  const resolve = useResolveWingsIncident();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    type: typeof WingsIncidentInputType[keyof typeof WingsIncidentInputType];
    severity: number;
    description: string;
    cost: string;
    crewId: string;
  }>({ type: "CALLBACK", severity: 3, description: "", cost: "", crewId: "" });

  const invalidate = () => queryClient.invalidateQueries();

  const submit = () => {
    if (!form.description.trim()) {
      toast({ title: "Add a description" });
      return;
    }
    create.mutate(
      {
        data: {
          type: form.type,
          severity: form.severity,
          description: form.description,
          cost: form.cost ? Number(form.cost) : null,
          crewId: form.crewId || null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          setForm({ type: "CALLBACK", severity: 3, description: "", cost: "", crewId: "" });
          toast({ title: "Incident logged" });
        },
      },
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-[10px] px-[2px]">
        <h3 className="font-display font-bold text-[16px] text-[var(--ink)]">Incidents</h3>
        <button
          onClick={() => setOpen(true)}
          data-testid="button-log-incident"
          className="flex items-center gap-[5px] rounded-[10px] px-[12px] py-[7px] text-[12px] font-display font-bold bg-[var(--ink)] text-white active:scale-[0.97] transition-transform"
        >
          <Plus className="w-[13px] h-[13px]" /> Log
        </button>
      </div>

      {isLoading ? (
        <Loading />
      ) : !incidents || incidents.length === 0 ? (
        <Empty text="No incidents logged." />
      ) : (
        <div className="space-y-[8px]">
          {incidents.map((inc) => (
            <div key={inc.id} className={card} data-testid={`incident-${inc.id}`}>
              <div className="flex items-start justify-between gap-[8px]">
                <div className="min-w-0">
                  <div className="flex items-center gap-[6px]">
                    <span className="font-display font-bold text-[13.5px] text-[var(--ink)]">
                      {inc.type.replace("_", " ")}
                    </span>
                    <span className="px-[6px] py-[1px] rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                      S{inc.severity}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-muted-foreground mt-[3px]">{inc.description}</p>
                  <div className="text-[11.5px] text-muted-foreground mt-[3px]">
                    {inc.crewName ? `${inc.crewName} · ` : ""}
                    {inc.cost != null ? `${money(inc.cost)} · ` : ""}
                    {relTime(inc.occurredAt)}
                  </div>
                </div>
                {inc.resolvedAt ? (
                  <span className="shrink-0 px-[8px] py-[3px] rounded-full bg-green-50 text-green-700 text-[10.5px] font-bold border border-green-200">
                    Resolved
                  </span>
                ) : (
                  <button
                    onClick={() =>
                      resolve.mutate({ id: inc.id }, { onSuccess: invalidate })
                    }
                    data-testid={`resolve-${inc.id}`}
                    className="shrink-0 rounded-[10px] px-[10px] py-[6px] text-[11.5px] font-display font-bold bg-[var(--primary)] text-[var(--ink)] active:scale-[0.97] transition-transform"
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal onClose={() => setOpen(false)} title="Log incident">
          <div className="space-y-[10px]">
            <div>
              <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.06em]">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                data-testid="select-incident-type"
                className="mt-[6px] w-full rounded-[12px] border border-border bg-[var(--paper)] px-[12px] py-[10px] text-[13px]"
              >
                {Object.values(WingsIncidentInputType).map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.06em]">
                Severity: {form.severity}
              </label>
              <input
                type="range"
                min={1}
                max={5}
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: Number(e.target.value) })}
                data-testid="input-incident-severity"
                className="mt-[6px] w-full accent-[var(--primary)]"
              />
            </div>
            <div>
              <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.06em]">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                data-testid="input-incident-description"
                className="mt-[6px] w-full rounded-[12px] border border-border bg-[var(--paper)] px-[12px] py-[10px] text-[13px]"
              />
            </div>
            <div>
              <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.06em]">Cost (optional)</label>
              <input
                type="number"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
                data-testid="input-incident-cost"
                className="mt-[6px] w-full rounded-[12px] border border-border bg-[var(--paper)] px-[12px] py-[10px] text-[13px]"
              />
            </div>
            <div>
              <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.06em]">Crew (optional)</label>
              <select
                value={form.crewId}
                onChange={(e) => setForm({ ...form, crewId: e.target.value })}
                data-testid="select-incident-crew"
                className="mt-[6px] w-full rounded-[12px] border border-border bg-[var(--paper)] px-[12px] py-[10px] text-[13px]"
              >
                <option value="">None</option>
                {crews?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={submit}
              disabled={create.isPending}
              data-testid="button-submit-incident"
              className="w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[12px] text-[14px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] disabled:opacity-60 active:scale-[0.98] transition-transform"
            >
              {create.isPending ? <Loader2 className="w-[16px] h-[16px] animate-spin" /> : null}
              Log incident
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AuditSection() {
  const { data: audit, isLoading } = useListWingsAudit({ limit: 40 });

  return (
    <div>
      <div className="flex items-center gap-[6px] mb-[10px] px-[2px]">
        <History className="w-[15px] h-[15px] text-muted-foreground" />
        <h3 className="font-display font-bold text-[16px] text-[var(--ink)]">Activity</h3>
      </div>
      {isLoading ? (
        <Loading />
      ) : !audit || audit.length === 0 ? (
        <Empty text="No activity yet." />
      ) : (
        <div className={card}>
          <div className="space-y-[10px]">
            {audit.map((a) => (
              <div key={a.id} className="flex items-start gap-[8px]" data-testid={`audit-${a.id}`}>
                <ActorBadge actor={a.actorType} />
                <div className="min-w-0">
                  <div className="text-[13px] text-[var(--ink)] font-medium">{a.action}</div>
                  {a.reason && <div className="text-[12px] text-muted-foreground">{a.reason}</div>}
                  <div className="text-[11px] text-muted-foreground">{relTime(a.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActorBadge({ actor }: { actor: string }) {
  const a = actor?.toUpperCase();
  const style =
    a === "AI"
      ? "bg-[var(--ink)] text-[var(--gold-light)]"
      : a === "ADMIN"
      ? "bg-[var(--primary)] text-[var(--ink)]"
      : "bg-muted text-muted-foreground";
  const Icon = a === "AI" ? Bot : a === "ADMIN" ? UserCog : ClipboardList;
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-[3px] px-[7px] py-[2px] rounded-full text-[10px] font-bold uppercase tracking-[0.06em] mt-[1px] ${style}`}
    >
      <Icon className="w-[10px] h-[10px]" /> {a || "SYSTEM"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status?.toUpperCase();
  const style =
    s === "PASS" || s === "RELEASED" || s === "PAID"
      ? "bg-green-50 text-green-700 border-green-200"
      : s === "FAIL"
      ? "bg-red-50 text-red-600 border-red-200"
      : s === "NEEDS_REVIEW" || s === "PENDING"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`shrink-0 px-[8px] py-[3px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.05em] border ${style}`}
    >
      {status?.replace(/_/g, " ") || "—"}
    </span>
  );
}

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-[14px]">
      <div className="bg-card border border-border rounded-[20px] w-full max-w-[440px] max-h-[86vh] overflow-y-auto p-[18px] shadow-[0_0_40px_rgba(0,0,0,0.4)]">
        <div className="flex items-center justify-between mb-[12px]">
          <div className="font-display font-bold text-[17px] text-[var(--ink)]">{title}</div>
          <button onClick={onClose} className="text-muted-foreground p-[2px]" aria-label="Close">
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="py-[40px] grid place-items-center">
      <Loader2 className="w-[22px] h-[22px] animate-spin text-[var(--gold-dark)]" />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="py-[36px] text-center text-[13.5px] text-muted-foreground">{text}</div>
  );
}
