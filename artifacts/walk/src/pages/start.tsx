import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { 
  useGetWalkTarget,
  useListWalks, 
  useCreateWalk, 
  Walk,
  WalkInputKind
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight, Play, MapPin, ClipboardCheck, History, Compass, LocateFixed, Navigation, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';

const WALK_KINDS = [
  { id: 'discovery', label: 'Discovery', desc: 'Find new work', icon: Compass, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { id: 'baseline', label: 'Baseline', desc: 'Initial state', icon: MapPin, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  { id: 'qa', label: 'QA', desc: 'Check work', icon: ClipboardCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  { id: 'completion', label: 'Completion', desc: 'Sign-off', icon: History, color: 'text-orange-500', bg: 'bg-orange-500/10' },
] as const;

export default function StartScreen() {
  const [, setLocation] = useLocation();
  const [selectedKind, setSelectedKind] = useState<WalkInputKind>('discovery');

  // GPS locator
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(true);

  const locate = () => {
    if (!navigator.geolocation) { setLocating(false); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };
  useEffect(locate, []);

  const { data: target, isLoading: isLoadingTarget } = useGetWalkTarget(
    coords ?? undefined,
    { request: { credentials: 'include' } }
  );
  const isLoadingProps = isLoadingTarget || (locating && !target);

  const distanceLabel =
    target?.located && typeof target.distanceM === 'number'
      ? target.distanceM < 950
        ? `${target.distanceM} m away`
        : `${(target.distanceM / 1609.34).toFixed(1)} mi away`
      : null;

  // Load recent walks
  const { data: allWalks, isLoading: isLoadingWalks } = useListWalks(
    {},
    { request: { credentials: 'include' } }
  );
  const walks = allWalks?.slice(0, 10);

  // Mutations
  const createWalk = useCreateWalk({
    request: { credentials: 'include' }
  });

  const handleStartWalk = () => {
    if (!target?.propertyId) return;
    
    createWalk.mutate(
      { data: { propertyId: target.propertyId, kind: selectedKind } },
      {
        onSuccess: (newWalk) => {
          setLocation(`/walk/${newWalk.id}`);
        }
      }
    );
  };

  const handleResumeWalk = (walk: Walk) => {
    if (walk.status === 'completed') {
      setLocation(`/walk/${walk.id}/review`);
    } else {
      setLocation(`/walk/${walk.id}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden animate-in fade-in duration-300 relative">
      
      {/* Main Content Area - Centered and constrained */}
      <div className="flex-1 flex flex-col justify-center px-5 py-4 w-full max-w-sm mx-auto space-y-6">
        <h2 className="text-3xl font-extrabold tracking-tight text-center">Ready to walk?</h2>
        
        <div className="bg-card rounded-[2rem] p-4 shadow-subtle border border-black/[0.03] space-y-5">
          {/* Target Property */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between pl-1">
              <label className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-widest">Target Property</label>
              <button
                onClick={locate}
                disabled={locating}
                data-testid="button-locate-me"
                className="flex items-center gap-1 text-[11px] font-bold text-foreground bg-primary/20 hover:bg-primary/30 px-2.5 py-1 rounded-full active:scale-95 transition-all disabled:opacity-60"
              >
                {locating ? <Loader2 className="w-3 h-3 animate-spin" /> : <LocateFixed className="w-3 h-3" />}
                {locating ? 'Locating…' : 'Locate me'}
              </button>
            </div>
            {isLoadingProps ? (
              <div className="h-16 w-full animate-pulse bg-muted rounded-2xl" />
            ) : (
              <div
                className="flex items-center gap-3 min-h-[4rem] px-4 py-3 rounded-2xl bg-muted/50"
                data-testid="walk-target-property"
              >
                <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center shadow-sm ${target?.located ? 'bg-primary' : 'bg-white'}`}>
                  {target?.located
                    ? <Navigation className="w-4 h-4 text-primary-foreground" />
                    : <MapPin className="w-4 h-4 text-foreground" />}
                </div>
                <div className="min-w-0">
                  <span className="block text-base font-bold text-foreground truncate">
                    {target?.name ?? 'Property unavailable'}
                  </span>
                  {target?.located && (
                    <span className="block text-[11px] font-bold text-muted-foreground" data-testid="text-located-distance">
                      Nearest to you{distanceLabel ? ` · ${distanceLabel}` : ''}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Walk Type - 2x2 compact grid */}
          <div className="space-y-2.5">
            <label className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-widest pl-1">Walk Type</label>
            <div className="grid grid-cols-2 gap-2">
              {WALK_KINDS.map(kind => {
                const Icon = kind.icon;
                const isSelected = selectedKind === kind.id;
                return (
                  <button
                    key={kind.id}
                    onClick={() => setSelectedKind(kind.id)}
                    className={`flex items-center gap-2.5 p-3 rounded-2xl text-left transition-all active:scale-[0.97] ${
                      isSelected 
                        ? 'bg-foreground text-background ring-[3px] ring-primary/40 shadow-md scale-[1.02]' 
                        : 'bg-muted/40 hover:bg-muted text-foreground border border-transparent'
                    }`}
                  >
                    <div className={`p-1.5 rounded-full shrink-0 ${isSelected ? 'bg-background/20 text-background' : kind.bg + ' ' + kind.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm truncate leading-tight">{kind.label}</div>
                      <div className={`text-[10px] truncate mt-0.5 leading-tight ${isSelected ? 'text-background/70' : 'text-muted-foreground'}`}>{kind.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Start Walk Button */}
          <Button 
            className="w-full h-14 text-lg font-extrabold rounded-2xl shadow-float active:scale-[0.98] transition-all mt-2" 
            disabled={!target?.propertyId || createWalk.isPending}
            onClick={handleStartWalk}
            data-testid="button-start-walk"
          >
            {createWalk.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Play className="w-4 h-4 mr-2 fill-current" />
                START WALK
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Drawer for Recent Walks */}
      <Drawer>
        <div className="shrink-0 p-4 pb-6 w-full flex justify-center">
          <DrawerTrigger asChild>
            <button className="flex flex-col items-center justify-center gap-1 group">
              <ChevronUp className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors animate-bounce" />
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                Recent Walks {walks?.length ? `(${walks.length})` : ''}
              </span>
            </button>
          </DrawerTrigger>
        </div>

        <DrawerContent className="bg-card border-0 rounded-t-[2rem] max-h-[85dvh] flex flex-col">
          <DrawerHeader className="shrink-0 text-left px-6 pt-6 pb-2 border-b border-black/[0.03]">
            <DrawerTitle className="text-xl font-extrabold tracking-tight">Recent Walks</DrawerTitle>
          </DrawerHeader>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isLoadingWalks ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-20 w-full animate-pulse bg-muted rounded-2xl" />
                ))}
              </div>
            ) : walks?.length === 0 ? (
              <div className="p-8 text-center rounded-3xl border border-dashed border-black/10">
                <Compass className="w-8 h-8 text-muted-foreground opacity-50 mx-auto mb-3" />
                <p className="text-sm font-bold text-muted-foreground">No recent walks</p>
              </div>
            ) : (
              walks?.map(walk => {
                const kindInfo = WALK_KINDS.find(k => k.id === walk.kind) || WALK_KINDS[0];
                const KindIcon = kindInfo.icon;
                
                return (
                  <button
                    key={walk.id}
                    onClick={() => handleResumeWalk(walk)}
                    className="w-full flex items-center justify-between p-4 rounded-2xl bg-card shadow-subtle border border-black/[0.03] active:scale-[0.98] transition-all text-left group hover:border-black/10"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-full shrink-0 ${kindInfo.bg} ${kindInfo.color}`}>
                        <KindIcon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 pr-2">
                        <div className="font-extrabold text-foreground truncate text-base leading-tight">{walk.propertyName}</div>
                        <div className="flex items-center gap-1.5 mt-1 text-[11px] font-bold text-muted-foreground">
                          <span className="capitalize">{walk.kind}</span>
                          <span className="opacity-50">•</span>
                          <span>{format(new Date(walk.startedAt || Date.now()), 'MMM d')}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {walk.status === 'open' ? (
                        <span className="px-2 py-0.5 bg-primary/20 text-foreground font-extrabold text-[10px] rounded-full tracking-wider">OPEN</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-muted text-muted-foreground font-extrabold text-[10px] rounded-full tracking-wider">DONE</span>
                      )}
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
