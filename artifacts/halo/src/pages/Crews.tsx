import { useListCrews, useGenerateCrewPortalLink } from "@workspace/api-client-react";
import { Plus, Pencil, Radio, ChevronRight, Link2, Check } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { AddCrewSheet } from "@/components/AddCrewSheet";
import { EditCrewSheet } from "@/components/EditCrewSheet";
import { useToast } from "@/hooks/use-toast";

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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { data: crews, isLoading } = useListCrews();
  const genLink = useGenerateCrewPortalLink();
  const { toast } = useToast();

  const handleLiveLink = (crewId: string) => {
    genLink.mutate(
      { id: crewId },
      {
        onSuccess: async (res) => {
          const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${res.path}`;
          try {
            await navigator.clipboard.writeText(url);
            setCopiedId(crewId);
            toast({
              title: "Live link copied",
              description: "Send it to the crew manually.",
            });
            setTimeout(() => setCopiedId((c) => (c === crewId ? null : c)), 1800);
          } catch {
            toast({ title: "Live link", description: url });
          }
        },
      },
    );
  };

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
            <Link
              href={`/crews/${crew.id}`}
              className="flex items-center gap-[9px] flex-1 min-w-0 transition-transform active:scale-[0.99]"
            >
              <div className="w-[30px] h-[30px] rounded-full bg-[var(--ink)] text-[var(--gold-light)] font-display font-bold text-[11.5px] grid place-items-center shrink-0">
                {crew.name.substring(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold truncate flex items-center gap-[5px]">
                  {crew.name}
                  <Radio className="w-[12px] h-[12px] text-[var(--gold)] shrink-0" />
                </div>
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
              <ChevronRight className="w-[15px] h-[15px] text-muted-foreground shrink-0" />
            </Link>
            <button
              onClick={() => handleLiveLink(crew.id)}
              disabled={genLink.isPending}
              aria-label={`Copy live portal link for ${crew.name}`}
              className={`shrink-0 h-[30px] flex items-center gap-[4px] rounded-full px-[10px] text-[11px] font-bold transition-transform active:scale-[0.9] disabled:opacity-50 ${
                copiedId === crew.id
                  ? "bg-[rgba(60,122,78,0.14)] text-[var(--green,#3c7a4e)]"
                  : "bg-[rgba(143,106,31,0.12)] text-[var(--gold-dark,#8f6a1f)]"
              }`}
            >
              {copiedId === crew.id ? (
                <>
                  <Check className="w-[13px] h-[13px]" /> Copied
                </>
              ) : (
                <>
                  <Link2 className="w-[13px] h-[13px]" /> Live link
                </>
              )}
            </button>
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
