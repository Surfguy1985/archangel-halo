import { useListCrews } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Users, Plus, Search, MapPin, CheckCircle, Clock } from "lucide-react";
import { useState } from "react";

export default function Crews() {
  const [search, setSearch] = useState("");
  const { data: crews, isLoading } = useListCrews();

  const filtered = crews?.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    (c.trade && c.trade.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Crews</h1>
          <p className="text-muted-foreground">{crews?.length || 0} active crews</p>
        </div>
        <button className="flex items-center gap-2 bg-[var(--gold)] text-white px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> Add Crew
        </button>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input 
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search crews by name or trade..."
          className="w-full max-w-md pl-10 pr-4 py-2.5 rounded-md border border-input bg-card text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
              <div className="bg-card rounded-xl border border-border shadow-sm p-5 hover:border-[var(--gold)]/50 transition-colors group h-full flex flex-col">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--gold-tint)] flex items-center justify-center text-[var(--gold-dark)] group-hover:bg-[var(--gold)] group-hover:text-white transition-colors">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[var(--ink)] text-lg leading-tight group-hover:text-[var(--gold-dark)] transition-colors">{crew.name}</h3>
                      <p className="text-muted-foreground text-sm">{crew.trade || 'General'}</p>
                    </div>
                  </div>
                  {crew.isLeader && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--gold-dark)] px-2 py-0.5 rounded-full bg-[var(--gold-tint)]">
                      Leader
                    </span>
                  )}
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
    </div>
  );
}
