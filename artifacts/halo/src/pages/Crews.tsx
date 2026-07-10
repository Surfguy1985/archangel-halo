import { useListCrews } from "@workspace/api-client-react";
import { Plus, Pencil } from "lucide-react";
import { useState } from "react";
import { AddCrewSheet } from "@/components/AddCrewSheet";
import { EditCrewSheet } from "@/components/EditCrewSheet";

type CrewRow = {
  id: string;
  name: string;
  trade?: string | null;
  phone?: string | null;
  isLeader?: boolean | null;
};

export default function Crews() {
  const [addOpen, setAddOpen] = useState(false);
  const [editCrew, setEditCrew] = useState<CrewRow | null>(null);
  const { data: crews, isLoading } = useListCrews();

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 pt-4">
        <div className="h-4 bg-muted rounded w-1/3"></div>
        <div className="h-32 bg-card rounded-[16px]"></div>
      </div>
    );
  }

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-[10px] mb-[14px]">
        <div className="text-[13px] text-muted-foreground flex-1">Today's dispatch</div>
        <button
          onClick={() => setAddOpen(true)}
          aria-label="Add crew member"
          className="w-[32px] h-[32px] shrink-0 rounded-full grid place-items-center bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] text-[var(--ink)] shadow-[0_4px_14px_rgba(143,106,31,0.34)] transition-transform active:scale-[0.9]"
        >
          <Plus className="w-[18px] h-[18px]" strokeWidth={2.4} />
        </button>
      </div>

      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px]">
        {crews?.map((crew, idx) => (
          <div key={crew.id} className={`flex items-center gap-[9px] py-[8px] ${idx !== 0 ? 'border-t border-border' : 'pt-[2px]'}`}>
            <div className="w-[30px] h-[30px] rounded-full bg-[var(--ink)] text-[var(--gold-light)] font-display font-bold text-[11.5px] grid place-items-center shrink-0">
              {crew.name.substring(0, 1)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-semibold truncate">{crew.name}</div>
              <div className="text-[12px] text-muted-foreground truncate">
                {crew.todayStatus === "site" && crew.todayProperty
                  ? `${crew.todayJob ? crew.todayJob + " · " : ""}${crew.todayProperty}`
                  : crew.trade || "General"}
              </div>
            </div>
            {crew.todayStatus === "site" ? (
              <span className="text-[11px] font-bold rounded-[20px] px-[10px] py-[4px] shrink-0 bg-[rgba(59,111,181,0.12)] text-[var(--blue)]">
                On site
              </span>
            ) : (
              <span className="text-[11px] font-bold rounded-[20px] px-[10px] py-[4px] shrink-0 bg-[rgba(23,24,28,0.055)] text-muted-foreground">
                Idle
              </span>
            )}
            <button
              onClick={() =>
                setEditCrew({
                  id: crew.id,
                  name: crew.name,
                  trade: crew.trade,
                  phone: crew.phone,
                  isLeader: crew.isLeader,
                })
              }
              aria-label={`Edit ${crew.name}`}
              className="w-[30px] h-[30px] shrink-0 rounded-full grid place-items-center text-muted-foreground transition-transform active:scale-[0.9]"
            >
              <Pencil className="w-[14px] h-[14px]" />
            </button>
          </div>
        ))}
        {crews?.length === 0 && (
          <div className="text-[13px] text-muted-foreground py-4 text-center">No crews found</div>
        )}
      </div>

      <AddCrewSheet open={addOpen} onOpenChange={setAddOpen} />
      {editCrew && (
        <EditCrewSheet
          open={!!editCrew}
          onOpenChange={(o) => !o && setEditCrew(null)}
          crew={editCrew}
        />
      )}
    </div>
  );
}
