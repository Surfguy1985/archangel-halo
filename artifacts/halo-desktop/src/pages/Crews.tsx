import { useListCrews} from "@workspace/api-client-react";
import { Skeleton} from "@/components/ui/skeleton";
import { Link} from "wouter";
import { Users, Plus, Search, MapPin, CheckCircle, Clock, Pencil} from "lucide-react";
import { useState} from "react";
import { AddCrewDialog, EditCrewDialog, type EditableCrew} from "@/components/CrewDialogs";

export default function Crews() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EditableCrew | null>(null);
  const { data: crews, isLoading} = useListCrews();

  const filtered = crews?.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    (c.trade && c.trade.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--secondary)]">Crews</h1>
          <p className="text-muted-foreground">{crews?.length || 0} active crews</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 bg-[var(--primary)] text-black px-6 py-3 rounded-full font-bold hover:opacity-90 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Crew
        </button>
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input 
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search crews..."
          className="w-full max-w-md pl-12 pr-4 py-3 rounded-full border border-border bg-card text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-1 focus-visible:ring-[var(--primary)] font-mono text-foreground"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(crew => (
            <Link key={crew.id} href={`/crews/${crew.id}`} className="block">
              <div className="bg-card rounded-3xl border border-border shadow-sm p-6 hover:border-[var(--primary)] transition-colors group h-full flex flex-col">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-[var(--secondary)] group-hover:bg-[var(--primary)] group-hover:text-black transition-colors overflow-hidden shrink-0">
                      {crew.selfiePath ? (
                        <img
                          src={`/api/storage${crew.selfiePath}`}
                          alt={crew.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Users className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-[var(--secondary)] text-xl leading-tight transition-colors">{crew.name}</h3>
                      <p className="text-muted-foreground text-xs font-bold">{crew.trade || 'General'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {crew.isLeader && (
                      <span className="text-[10px] font-bold text-black px-3 py-1 rounded-full bg-[var(--primary)]">
                        Leader
                      </span>
                    )}
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

                <div className="mt-auto pt-4 border-t border-border flex items-center gap-2 text-sm">
                  {crew.todayStatus === 'site' && (
                    <>
                      <MapPin className="w-4 h-4 text-[var(--gold-dark)]" />
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
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground">
              No crews found.
            </div>
          )}
        </div>
      )}

      <AddCrewDialog open={addOpen} onOpenChange={setAddOpen} />
      {editing && (
        <EditCrewDialog
          open={!!editing}
          onOpenChange={(o) => { if (!o) setEditing(null);}}
          crew={editing}
        />
      )}
    </div>
  );
}
