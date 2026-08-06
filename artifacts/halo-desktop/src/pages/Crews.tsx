import { useListCrews} from "@workspace/api-client-react";
import { Skeleton} from "@/components/ui/skeleton";
import { Link} from "wouter";
import { Users, Plus, Search, Pencil, Navigation, ShieldCheck, ChevronRight} from "lucide-react";
import { useState} from "react";
import { AddCrewDialog, EditCrewDialog, type EditableCrew} from "@/components/CrewDialogs";
import { CrewCommandCenter } from "@/components/CrewCommandCenter";
import { CrewDayPlanDialog } from "@/components/CrewDayPlanDialog";
import { CrewAccessDialog } from "@/components/CrewAccessDialog";
import { Route } from "lucide-react";

export default function Crews() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [editing, setEditing] = useState<EditableCrew | null>(null);
  const [planCrew, setPlanCrew] = useState<{ id: string; name: string } | null>(null);
  const [accessCrew, setAccessCrew] = useState<NonNullable<typeof crews>[number] | null>(null);
  const { data: crews, isLoading } = useListCrews();

  const filtered = crews?.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    (c.trade && c.trade.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  // Group crews into teams: each foreman with their members, independents last.
  const all = crews ?? [];
  const filteredIds = new Set(filtered.map((c) => c.id));
  const leaders = all.filter(
    (c) => c.isLeader || all.some((m) => m.leaderId === c.id),
  );
  const teams = leaders
    .map((l) => ({
      leader: l,
      members: all.filter((m) => m.leaderId === l.id && m.id !== l.id),
    }))
    .map((t) => ({
      ...t,
      visible: [t.leader, ...t.members].filter((c) => filteredIds.has(c.id)),
    }))
    .filter((t) => t.visible.length > 0);
  const groupedIds = new Set(
    leaders.flatMap((l) => [l.id, ...all.filter((m) => m.leaderId === l.id).map((m) => m.id)]),
  );
  const independents = filtered.filter((c) => !groupedIds.has(c.id));

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)]">Crews</h1>
          <p className="text-muted-foreground mt-1 text-sm">{crews?.length || 0} active crews</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMapOpen(true)}
            className="flex items-center gap-2 bg-[var(--ink)] text-white px-5 py-2.5 rounded-full font-bold shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:opacity-90 transition-opacity"
          >
            <Navigation className="w-4 h-4 text-[var(--gold-light)]" /> Command Center
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="btn-gold px-5 py-2.5 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add Crew
          </button>
        </div>
      </header>

      {mapOpen && <CrewCommandCenter onClose={() => setMapOpen(false)} />}

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input 
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search crews by name or trade…"
          className="w-full max-w-md pl-12 pr-4 py-3 rounded-full border border-[var(--hairline)] bg-card text-sm shadow-[0_2px_8px_rgba(0,0,0,0.04)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-[var(--ink)] focus-visible:ring-1 focus-visible:ring-[var(--ink)]"
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full max-w-2xl rounded-[20px]" />
      ) : (
        /* One organized directory list below the search — type to filter or
           scroll; click a name to open their profile. */
        <div className="max-w-2xl bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--hairline)] bg-black/[0.03] text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {filtered.length} crew{filtered.length === 1 ? "" : "s"} — click a name to open their profile
          </div>
          <div className="max-h-[60dvh] overflow-y-auto divide-y divide-[var(--hairline)]" data-testid="crew-directory">
            {teams.map((t) => (
              <div key={t.leader.id}>
                <div className="px-5 pt-3 pb-1 flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--gold-dark)] px-2 py-0.5 rounded-full bg-[var(--gold-tint)]">
                    {t.leader.name}'s team
                  </span>
                </div>
                {t.visible.map((crew) => renderRow(crew))}
              </div>
            ))}
            {independents.length > 0 && (
              <div>
                {teams.length > 0 && (
                  <div className="px-5 pt-3 pb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-0.5 rounded-full bg-black/[0.05]">
                      Independent
                    </span>
                  </div>
                )}
                {independents.map((crew) => renderRow(crew))}
              </div>
            )}
            {filtered.length === 0 && (
              <div className="p-12 text-center text-muted-foreground">No crews found.</div>
            )}
          </div>
        </div>
      )}

      {accessCrew && (
        <CrewAccessDialog crew={accessCrew} onClose={() => setAccessCrew(null)} />
      )}
      {planCrew && (
        <CrewDayPlanDialog
          crewId={planCrew.id}
          crewName={planCrew.name}
          onClose={() => setPlanCrew(null)}
        />
      )}
      <AddCrewDialog open={addOpen} onOpenChange={setAddOpen} />
      {editing && (
        <EditCrewDialog
          open={!!editing}
          onOpenChange={(o) => { if (!o) setEditing(null); }}
          crew={editing}
        />
      )}
    </div>
  );

  function renderRow(crew: NonNullable<typeof crews>[number]) {
    return (
      <Link
        key={crew.id}
        href={`/crews/${crew.id}`}
        className="group flex items-center gap-3 px-5 py-3 hover:bg-black/[0.04] transition-colors"
        data-testid={`crew-row-${crew.id}`}
      >
        <div className="w-9 h-9 rounded-full bg-[var(--ink)] flex items-center justify-center text-[var(--gold-light)] overflow-hidden shrink-0">
          {crew.selfiePath ? (
            <img src={`/api/storage${crew.selfiePath}`} alt={crew.name} className="w-full h-full object-cover" />
          ) : (
            <Users className="w-4 h-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-[var(--ink)] truncate">{crew.name}</span>
            {crew.isLeader && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--gold-dark)] px-1.5 py-px rounded-full bg-[var(--gold-tint)]">Leader</span>
            )}
          </div>
          <span className="block text-xs text-muted-foreground truncate">
            {crew.trade || "General"}
            {crew.todayStatus === "site" && ` · At ${crew.todayProperty}`}
            {crew.todayStatus === "route" && ` · En route to ${crew.todayProperty}`}
            {crew.todayStatus === "done" && " · Finished for today"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPlanCrew({ id: crew.id, name: crew.name }); }}
            aria-label={`Plan ${crew.name}'s day`} title="Day route"
            className="p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-black/5 hover:text-foreground transition-all"
          >
            <Route className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAccessCrew(crew); }}
            aria-label={`Office access for ${crew.name}`} title="Office access"
            className={`p-1.5 rounded-md transition-all ${crew.access && crew.access.features.length > 0 ? "text-[var(--gold-dark)] opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100"} hover:bg-black/5 hover:text-foreground`}
          >
            <ShieldCheck className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(crew); }}
            aria-label={`Edit ${crew.name}`}
            className="p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-black/5 hover:text-foreground transition-all"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-[var(--gold-dark)]" />
        </div>
      </Link>
    );
  }

}
