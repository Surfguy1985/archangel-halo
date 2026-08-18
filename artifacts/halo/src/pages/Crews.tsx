import { useListCrews, useGenerateCrewPortalLink, useUpdateCrew, getListCrewsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Radio, ChevronRight, Link2, Check, Pickaxe, MapPin, Phone, Briefcase, HardHat, QrCode } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { normalizeCrewPortalLink } from "@workspace/board-ui";
import { AddCrewSheet } from "@/components/AddCrewSheet";
import { EditCrewSheet } from "@/components/EditCrewSheet";
import { useToast } from "@/hooks/use-toast";

type CrewRow = {
  id: string;
  name: string;
  trade?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  isLeader?: boolean | null;
  paymentTerms?: string | null;
  services?: { name: string; rate?: number | null }[] | null;
};

export default function Crews() {
  const [, navigate] = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const [editCrew, setEditCrew] = useState<CrewRow | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const { data: crews, isLoading } = useListCrews({ query: { queryKey: getListCrewsQueryKey(), refetchInterval: 30000 } });
  const genLink = useGenerateCrewPortalLink();
  const updateCrew = useUpdateCrew();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Foreman = team authority (isLeader) + the Wings role tier. They move
  // together so dispatch grouping and profit-share weighting agree.
  const toggleForeman = (
    e: React.MouseEvent,
    crew: { id: string; name: string; isLeader?: boolean | null },
  ) => {
    e.stopPropagation();
    const on = crew.isLeader === true;
    updateCrew.mutate(
      { id: crew.id, data: { isLeader: !on, role: !on ? "foreman" : "crew" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrewsQueryKey() });
          toast({
            title: !on ? `${crew.name} is a foreman` : `${crew.name} is back on crew`,
            description: !on
              ? "He can now add crew members with QR codes from his paycard."
              : "QR crew codes are turned off for him.",
          });
        },
        onError: () => toast({ title: "Could not save that", variant: "destructive" }),
      },
    );
  };

  const handleLiveLink = (e: React.MouseEvent, crewId: string, crewName: string) => {
    e.stopPropagation(); // Prevent navigating to crew detail
    genLink.mutate(
      { id: crewId },
      {
        onSuccess: async (res) => {
          const url = normalizeCrewPortalLink(res.path) ?? "";
          try {
            await navigator.clipboard.writeText(url);
            setCopiedId(crewId);
            toast({
              title: "Link copied",
              description: `Portal link for ${crewName} copied to clipboard.`,
            });
            setTimeout(() => setCopiedId((c) => (c === crewId ? null : c)), 2000);
          } catch {
            toast({ title: "Live link", description: url });
          }
        },
      },
    );
  };

  const handleEdit = (e: React.MouseEvent, crew: any) => {
    e.stopPropagation(); // Prevent navigating to crew detail
    setEditCrew({
      id: crew.id,
      name: crew.name,
      trade: crew.trade,
      company: crew.company,
      phone: crew.phone,
      email: crew.email,
      isLeader: crew.isLeader,
      paymentTerms: crew.paymentTerms,
      services: crew.services,
    });
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both pb-24">
      {/* Header Area */}
      <div className="px-[6px] mb-[20px]">
        <div className="flex items-center justify-between mb-[8px]">
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)] leading-none">
            Crews
          </h1>
          <div className="flex items-center gap-[8px]">
            <button
              onClick={() => navigate("/crew-links")}
              aria-label="Crew links and QR codes"
              className="w-[38px] h-[38px] rounded-full grid place-items-center bg-card border border-[var(--hairline)] text-[var(--ink)] transition-transform active:scale-[0.9]"
            >
              <QrCode className="w-[18px] h-[18px]" strokeWidth={2} />
            </button>
            <button
              onClick={() => setAddOpen(true)}
              aria-label="Add crew member"
              className="w-[38px] h-[38px] rounded-full grid place-items-center bg-[var(--gold-light)] text-[var(--ink)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-transform active:scale-[0.9]"
            >
              <Plus className="w-[20px] h-[20px]" strokeWidth={2.5} />
            </button>
          </div>
        </div>
        <p className="text-[14px] text-muted-foreground ml-[2px]">
          Today's dispatch and vendor directory.
        </p>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-[12px] px-[6px]">
          {[1, 2, 3].map(i => <div key={i} className="h-[140px] bg-card rounded-[20px] border border-[var(--hairline)]"></div>)}
        </div>
      ) : (
        <div className="flex flex-col gap-[14px] px-[6px]">
          {crews?.map((crew) => {
            const isOnSite = crew.todayStatus === "site";
            
            return (
              <div 
                key={crew.id} 
                onClick={() => navigate(`/crews/${crew.id}`)}
                className="group relative bg-card rounded-[20px] p-[18px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] cursor-pointer overflow-hidden transition-transform active:scale-[0.98]"
              >
                <div className="flex justify-between items-start mb-[16px] relative z-10">
                  <div className="flex items-center gap-[12px]">
                    <div className="relative">
                      <div className={`w-[44px] h-[44px] rounded-[14px] grid place-items-center font-display font-bold text-[18px] shrink-0 shadow-inner overflow-hidden ${
                        isOnSite 
                          ? 'bg-[linear-gradient(135deg,#E8F2FF,#D1E4FF)] text-blue-700 border border-blue-200/50' 
                          : 'bg-[var(--ink)] text-[var(--gold-light)]'
                      }`}>
                        {crew.selfiePath ? (
                          <img
                            src={`/api/storage${crew.selfiePath}`}
                            alt={crew.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          crew.name.substring(0, 1)
                        )}
                      </div>
                      {isOnSite && (
                        <div className="absolute -bottom-[2px] -right-[2px] w-[14px] h-[14px] rounded-full bg-blue-500 border-2 border-card flex items-center justify-center">
                          <div className="w-[4px] h-[4px] bg-white rounded-full animate-pulse" />
                        </div>
                      )}
                      {!isOnSite && (crew.pendingPackets ?? 0) > 0 && (
                        <div className="absolute -top-[4px] -right-[4px] min-w-[16px] h-[16px] rounded-full bg-red-500 border-2 border-card flex items-center justify-center px-[3px]">
                          <span className="text-[9px] font-bold text-white leading-none">
                            {(crew.pendingPackets ?? 0) > 9 ? "9+" : crew.pendingPackets}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    <div>
                      <div className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--ink)] flex items-center gap-[6px]">
                        {crew.name}
                        {isOnSite && <Radio className="w-[12px] h-[12px] text-blue-500 animate-pulse" />}
                      </div>
                      <div className="text-[13px] text-muted-foreground flex items-center gap-[4px]">
                        <Pickaxe className="w-[12px] h-[12px] opacity-60" />
                        {crew.trade || "General Subcontractor"}
                      </div>
                    </div>
                  </div>
                  
                  <div className="shrink-0 pl-[8px]">
                    {isOnSite ? (
                      <span className="inline-flex items-center px-[10px] py-[4px] rounded-full bg-blue-50 text-blue-700 text-[11px] font-bold tracking-wide uppercase shadow-sm border border-blue-100">
                        On Site
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-[10px] py-[4px] rounded-full bg-[rgba(23,24,28,0.04)] text-muted-foreground text-[11px] font-bold tracking-wide uppercase border border-[rgba(23,24,28,0.05)]">
                        Idle
                      </span>
                    )}
                  </div>
                </div>

                {/* Status / Location row */}
                {isOnSite && crew.todayProperty && (
                  <div className="mb-[16px] px-[12px] py-[10px] bg-blue-50/50 rounded-[14px] border border-blue-100/50">
                    <div className="flex items-center gap-[8px] text-[13px] text-blue-900/80 font-medium">
                      <MapPin className="w-[14px] h-[14px] text-blue-500 shrink-0" />
                      <span className="truncate">
                        {crew.todayJob ? <span className="font-semibold">{crew.todayJob}</span> : null}
                        {crew.todayJob ? <span className="mx-1 opacity-50">·</span> : null}
                        {crew.todayProperty}
                      </span>
                    </div>
                  </div>
                )}

                {/* Foreman toggle — unlocks QR crew onboarding on his paycard */}
                {(() => {
                  const isForeman = crew.isLeader === true;
                  return (
                    <div
                      className={`flex items-center justify-between gap-[10px] mb-[14px] px-[12px] py-[10px] rounded-[14px] border transition-colors relative z-10 ${
                        isForeman
                          ? "bg-[var(--gold-tint)] border-[var(--gold-light)]"
                          : "bg-[rgba(19,34,58,0.03)] border-[var(--hairline)]"
                      }`}
                    >
                      <div className="flex items-center gap-[9px] min-w-0">
                        <HardHat
                          className={`w-[16px] h-[16px] shrink-0 ${isForeman ? "text-[var(--gold-dark)]" : "text-muted-foreground/60"}`}
                        />
                        <div className="min-w-0">
                          <div className="text-[13px] font-display font-bold text-[var(--ink)] leading-tight">Foreman</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {isForeman ? "Can add crew with QR codes" : "Runs no crew of his own"}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isForeman}
                        aria-label={`Foreman: ${crew.name}`}
                        data-testid={`foreman-toggle-${crew.id}`}
                        disabled={updateCrew.isPending}
                        onClick={(e) => toggleForeman(e, crew)}
                        className={`relative w-[48px] h-[28px] rounded-full shrink-0 transition-colors disabled:opacity-50 ${
                          isForeman ? "bg-[var(--gold-light)]" : "bg-[rgba(19,34,58,0.16)]"
                        }`}
                      >
                        <span
                          className={`absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow-sm transition-all ${
                            isForeman ? "left-[23px]" : "left-[3px]"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })()}

                {/* Action Buttons */}
                <div className="flex items-center justify-between pt-[14px] border-t border-[var(--hairline)] relative z-10">
                  <button
                    onClick={(e) => handleLiveLink(e, crew.id, crew.name)}
                    disabled={genLink.isPending}
                    aria-label={`Copy portal link for ${crew.name}`}
                    className={`flex items-center justify-center gap-[6px] h-[36px] px-[14px] rounded-[12px] text-[13px] font-display font-bold transition-all active:scale-[0.96] disabled:opacity-50 ${
                      copiedId === crew.id
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-card border border-[var(--hairline)] text-[var(--ink)] hover:bg-[var(--paper)]"
                    }`}
                  >
                    {copiedId === crew.id ? (
                      <>
                        <Check className="w-[14px] h-[14px]" /> Copied Link
                      </>
                    ) : (
                      <>
                        <Link2 className="w-[14px] h-[14px] text-[var(--gold-dark)]" /> Live Portal
                      </>
                    )}
                  </button>
                  
                  <div className="flex items-center gap-[6px]">
                    <button
                      onClick={(e) => handleEdit(e, crew)}
                      aria-label={`Edit ${crew.name}`}
                      className="w-[36px] h-[36px] rounded-[12px] grid place-items-center text-muted-foreground bg-[rgba(19,34,58,0.04)] hover:bg-[rgba(19,34,58,0.08)] transition-colors active:scale-[0.95]"
                    >
                      <Pencil className="w-[14px] h-[14px]" />
                    </button>
                    <div className="w-[36px] h-[36px] rounded-[12px] grid place-items-center text-muted-foreground/40 bg-[rgba(19,34,58,0.02)] transition-colors group-hover:text-muted-foreground/80 group-hover:bg-[rgba(19,34,58,0.06)]">
                      <ChevronRight className="w-[16px] h-[16px]" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          
          {crews?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-[60px] text-center">
              <div className="w-[64px] h-[64px] rounded-full bg-card border border-[var(--hairline)] flex items-center justify-center mb-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                <Briefcase className="w-[28px] h-[28px] text-muted-foreground/40" />
              </div>
              <div className="font-display font-bold text-[18px] text-[var(--ink)] mb-[4px]">
                No crews yet
              </div>
              <div className="text-[14px] text-muted-foreground max-w-[240px]">
                Tap the plus button to add subcontractors or internal crew members.
              </div>
            </div>
          )}
        </div>
      )}

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
