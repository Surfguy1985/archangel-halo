import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { 
  useGetWalkTarget,
  useListWalks, 
  useCreateWalk, 
  Walk,
  WalkInputKind
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight, Play, MapPin, ClipboardCheck, History } from 'lucide-react';
import { format } from 'date-fns';

const WALK_KINDS = [
  { id: 'discovery', label: 'Discovery', desc: 'Find new work', icon: MapPin },
  { id: 'baseline', label: 'Baseline', desc: 'Initial property state', icon: ClipboardCheck },
  { id: 'qa', label: 'QA', desc: 'Check completed work', icon: History },
  { id: 'completion', label: 'Completion', desc: 'Final sign-off', icon: History },
] as const;

export default function StartScreen() {
  const [, setLocation] = useLocation();
  const [selectedKind, setSelectedKind] = useState<WalkInputKind>('discovery');

  // The Walk app is locked to a single property (Thornbury), resolved server-side.
  const { data: target, isLoading: isLoadingProps } = useGetWalkTarget({
    request: { credentials: 'include' }
  });

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
    <div className="flex flex-col p-4 pb-20 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      
      {/* Start New Walk Section */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">New Walk</h2>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Property</label>
            {isLoadingProps ? (
              <div className="h-14 w-full animate-pulse bg-muted rounded-xl border border-border" />
            ) : (
              <div
                className="flex items-center gap-3 h-16 px-4 rounded-xl border border-border bg-card"
                data-testid="walk-target-property"
              >
                <MapPin className="w-5 h-5 text-primary shrink-0" />
                <span className="text-lg font-semibold text-foreground truncate">
                  {target?.name ?? 'Property unavailable'}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Walk Type</label>
            <div className="grid grid-cols-2 gap-3">
              {WALK_KINDS.map(kind => {
                const Icon = kind.icon;
                const isSelected = selectedKind === kind.id;
                return (
                  <button
                    key={kind.id}
                    onClick={() => setSelectedKind(kind.id)}
                    className={`flex flex-col items-start p-4 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                      isSelected 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border bg-card hover:bg-accent/5'
                    }`}
                  >
                    <div className={`p-2 rounded-lg mb-2 ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-bold text-foreground">{kind.label}</span>
                    <span className="text-xs text-muted-foreground mt-1">{kind.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Button 
            className="w-full h-20 text-xl font-bold rounded-2xl shadow-xl mt-4" 
            disabled={!target?.propertyId || createWalk.isPending}
            onClick={handleStartWalk}
            data-testid="button-start-walk"
          >
            {createWalk.isPending ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              <>
                <Play className="w-6 h-6 mr-2 fill-current" />
                START WALK
              </>
            )}
          </Button>
        </div>
      </section>

      {/* Recent Walks Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight text-muted-foreground">Recent Walks</h2>
        
        {isLoadingWalks ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 w-full animate-pulse bg-muted rounded-xl border border-border" />
            ))}
          </div>
        ) : walks?.length === 0 ? (
          <div className="p-8 text-center rounded-xl border-2 border-dashed border-border bg-muted/30">
            <p className="text-muted-foreground font-medium">No recent walks</p>
          </div>
        ) : (
          <div className="space-y-3">
            {walks?.map(walk => (
              <button
                key={walk.id}
                onClick={() => handleResumeWalk(walk)}
                className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card shadow-sm hover:border-primary/50 transition-all active:scale-[0.98] text-left group"
              >
                <div>
                  <div className="font-bold text-foreground truncate">{walk.propertyName}</div>
                  <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                    <span className="capitalize">{walk.kind}</span>
                    <span>&bull;</span>
                    <span>{format(new Date(walk.startedAt || Date.now()), 'MMM d, h:mm a')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {walk.status === 'open' ? (
                    <span className="px-2 py-1 bg-accent/10 text-accent font-bold text-xs rounded-md">OPEN</span>
                  ) : (
                    <span className="px-2 py-1 bg-muted text-muted-foreground font-bold text-xs rounded-md">DONE</span>
                  )}
                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
