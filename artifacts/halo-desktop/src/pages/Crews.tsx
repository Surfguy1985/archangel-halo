import { useListCrews} from "@workspace/api-client-react";
import { Skeleton} from "@/components/ui/skeleton";
import { Link} from "wouter";
import { Users, Plus, Search, MapPin, CheckCircle, Clock, Pencil, Navigation, ShieldCheck} from "lucide-react";
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="space-y-8">
          {teams.map((t) => (
            <section key={t.leader.id} className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-lg text-[var(--ink)]">
                  {t.leader.name}'s team
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--gold-dark)] px-2 py-0.5 rounded-full bg-[var(--gold-tint)]">
                  Foreman
                </span>
                <span className="text-sm text-muted-foreground">
                  {t.visible.length} {t.visible.length === 1 ? "person" : "people"}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {t.visible.map((crew) => renderCard(crew))}
              </div>
            </section>
          ))}
          {independents.length > 0 && (
            <section className="space-y-3">
              {teams.length > 0 && (
                <h2 className="font-display font-bold text-lg text-[var(--ink)]">
                  Independent
                </h2>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {independents.map((crew) => renderCard(crew))}
              </div>
            </section>
          )}
          {filtered.length === 0 && (
            <div className="p-12 text-center border border-dashed border-[var(--hairline)] rounded-[20px] text-muted-foreground bg-card">
              No crews found.
            </div>
          )}
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

  function renderCard(crew: NonNullable<typeof crews>[number]) {
    return (
      <Link key={crew.id} href={`/crews/${crew.id}`} className="block">
              <div className="bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all group h-full flex flex-col">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--ink)] flex items-center justify-center text-[var(--gold-light)] group-hover:bg-[var(--gold-light)] group-hover:text-black transition-colors overflow-hidden">
                      {crew.selfiePath ? (
                        <img
                          src={`/api/storage${crew.selfiePath}`}
                          alt={crew.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Users className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-[var(--ink)] text-lg leading-tight tracking-tight">{crew.name}</h3>
                      <p className="text-muted-foreground text-sm">{crew.trade || 'General'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {crew.isLeader && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--gold-dark)] px-2 py-0.5 rounded-full bg-[var(--gold-tint)]">
                        Leader
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPlanCrew({ id: crew.id, name: crew.name });
                      }}
                      aria-label={`Plan ${crew.name}'s day`}
                      title="Day route"
                      className="p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-black/5 hover:text-foreground transition-all"
                    >
                      <Route className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setAccessCrew(crew);
                      }}
                      aria-label={`Office access for ${crew.name}`}
                      title="Office access"
                      className={`p-1.5 rounded-md transition-all ${
                        crew.access && crew.access.features.length > 0
                          ? "text-[var(--gold-dark)] opacity-100"
                          : "text-muted-foreground opacity-0 group-hover:opacity-100"
                      } hover:bg-black/5 hover:text-foreground`}
                    >
                      <ShieldCheck className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditing(crew);
                      }}
                      aria-label={`Edit ${crew.name}`}
                      className="p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-black/5 hover:text-foreground transition-all"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-auto pt-4 border-t border-[var(--hairline)] flex items-center gap-2 text-sm">
                  {crew.todayStatus === 'site' && (
                    <>
                      <MapPin className="w-4 h-4 text-[var(--gold)]" />
                      <span className="text-[var(--ink)] font-medium truncate">At {crew.todayProperty}</span>
                    </>
                  )}
                  {crew.todayStatus === 'route' && (
                    <>
                      <Clock className="w-4 h-4 text-[var(--orange)]" />
                      <span className="text-[var(--ink)] font-medium truncate">En route to {crew.todayProperty}</span>
                    </>
                  )}
                  {crew.todayStatus === 'done' && (
                    <>
                      <CheckCircle className="w-4 h-4 text-[var(--green)]" />
                      <span className="text-muted-foreground">Finished for today</span>
                    </>
                  )}
                  {(!crew.todayStatus || crew.todayStatus === 'idle') && (
                    <span className="text-muted-foreground">Not dispatched today</span>
                  )}
                </div>
              </div>
            </Link>
    );
  }
}
