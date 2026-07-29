import React, { useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { useGetClientBoard, useDispatchClientBoardAction, ClientBoardCardView } from '@workspace/api-client-react';
import { LoginDialog } from '@/components/LoginDialog';
import { useToast } from '@/hooks/use-toast';
import { BoardCard } from '@/components/kanban/BoardCard';
import { CardDetailDialog } from '@/components/kanban/CardDetailDialog';
import { CreateCardDialog } from '@/components/kanban/CreateCardDialog';
import { Button } from '@/components/ui/button';
import { MapPin, User, Loader2, Info, Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNow } from 'date-fns';

export default function KanbanBoard() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [loginOpen, setLoginOpen] = useState(false);
  const [draggedCard, setDraggedCard] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<ClientBoardCardView | null>(null);
  
  const [createLaneKey, setCreateLaneKey] = useState<string | null>(null);
  const [createLaneLabel, setCreateLaneLabel] = useState<string>('');

  const { data: board, isLoading, error } = useGetClientBoard(token, {
    query: {
      queryKey: getGetClientBoardQueryKey(token),
      refetchInterval: 10000,
    }
  });

  const dispatchAction = useDispatchClientBoardAction();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm font-medium">Loading command center...</p>
        </div>
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-foreground">Invalid or Expired Link</h1>
          <p className="mt-2 text-muted-foreground">We couldn't load the operations board. Please check your link or contact your property manager.</p>
        </div>
      </div>
    );
  }

  const { viewer, lanes, cards, propertyName, logoUrl } = board;

  const handleDragStart = (e: React.DragEvent, cardKey: string) => {
    setDraggedCard(cardKey);
    e.dataTransfer.effectAllowed = 'move';
    // Small delay to allow the drag image to be generated before styling
    setTimeout(() => {
      const el = document.getElementById(`card-${cardKey}`);
      if (el) el.classList.add('opacity-50');
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent, cardKey: string) => {
    setDraggedCard(null);
    const el = document.getElementById(`card-${cardKey}`);
    if (el) el.classList.remove('opacity-50');
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, laneKey: string) => {
    e.preventDefault();
    if (!draggedCard || viewer.readOnly) {
      if (viewer.readOnly) {
        toast({
          title: "Sign in required",
          description: "You are viewing as a guest. Sign in to make changes.",
          variant: "destructive"
        });
      }
      return;
    }

    const card = cards.find(c => c.cardKey === draggedCard);
    if (!card || card.lane === laneKey) return;

    // Optimistically update
    const previousLane = card.lane;
    queryClient.setQueryData(getGetClientBoardQueryKey(token), (old: any) => {
      if (!old) return old;
      return {
        ...old,
        cards: old.cards.map((c: any) => 
          c.cardKey === draggedCard ? { ...c, lane: laneKey } : c
        )
      };
    });

    dispatchAction.mutate({
      token,
      data: {
        action: "card.moved",
        cardKey: draggedCard,
        payload: { lane: laneKey, position: 0 }
      }
    }, {
      onSuccess: (outcome) => {
        if (!outcome.ok) {
          // Revert on failure
          queryClient.setQueryData(getGetClientBoardQueryKey(token), (old: any) => {
            if (!old) return old;
            return {
              ...old,
              cards: old.cards.map((c: any) => 
                c.cardKey === draggedCard ? { ...c, lane: previousLane } : c
              )
            };
          });
          toast({
            title: "Move blocked",
            description: outcome.reason || outcome.message || "Cannot move card",
            variant: "destructive"
          });
        } else {
          toast({
            title: "Card moved",
            description: outcome.message || "Successfully moved card"
          });
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
        }
      },
      onError: () => {
        // Revert on error
        queryClient.setQueryData(getGetClientBoardQueryKey(token), (old: any) => {
          if (!old) return old;
          return {
            ...old,
            cards: old.cards.map((c: any) => 
              c.cardKey === draggedCard ? { ...c, lane: previousLane } : c
            )
          };
        });
        toast({
          title: "Error",
          description: "Network error while moving card",
          variant: "destructive"
        });
      }
    });
  };

  const handleLogout = () => {
    localStorage.removeItem(`halo_client_session_${token}`);
    queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
    toast({ title: "Signed out", description: "You are now viewing as a guest." });
  };

  return (
    <div className="flex h-screen flex-col bg-background font-sans">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 shadow-sm">
        <div className="flex items-center gap-4">
          {logoUrl ? (
            <img src={logoUrl} alt={propertyName} className="h-8 max-w-[120px] object-contain" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
              {propertyName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="h-6 w-[1px] bg-border" />
          <div>
            <h1 className="text-sm font-bold tracking-tight text-foreground leading-tight">{propertyName}</h1>
            {board.propertyAddress && (
              <p className="text-[11px] font-semibold text-muted-foreground">{board.propertyAddress}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-secondary/50 px-3 py-1.5 border">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <span className="text-[10px] font-bold tracking-widest text-foreground uppercase">Live</span>
          </div>

          <Button variant="outline" size="sm" className="h-8 gap-2 text-xs font-semibold" onClick={() => setLocation(`/${token}/map`)}>
            <MapPin className="h-3.5 w-3.5" /> Map View
          </Button>

          {viewer.authenticated ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={handleLogout}>
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-primary/20 text-primary-foreground">
                    {viewer.name?.charAt(0).toUpperCase() || <User className="h-4 w-4" />}
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end">
                <div className="flex flex-col gap-1 p-1 text-xs">
                  <span className="font-semibold">{viewer.name || viewer.email}</span>
                  <span className="text-muted-foreground">Sign out</span>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs font-semibold text-muted-foreground" onClick={() => setLoginOpen(true)}>
              <User className="h-3.5 w-3.5" /> Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Main Board */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        {viewer.readOnly && (
          <div className="mb-4 flex items-center justify-center rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-foreground">
            <Info className="mr-2 h-4 w-4 text-primary" />
            You are viewing this board as a guest. 
            <button className="ml-1 underline font-bold text-primary" onClick={() => setLoginOpen(true)}>
              Sign in to make changes.
            </button>
          </div>
        )}

        <div className="flex h-full items-start gap-4">
          {lanes.map((lane) => {
            const laneCards = cards.filter(c => c.lane === lane.key).sort((a, b) => (a.position || 0) - (b.position || 0));
            return (
              <div 
                key={lane.key} 
                className="flex h-full w-[356px] shrink-0 flex-col rounded-xl border bg-secondary/30"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, lane.key)}
              >
                <div className="flex items-center justify-between p-3 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-widest text-foreground">{lane.label}</span>
                    <span className="flex h-4 min-w-[16px] items-center justify-center rounded bg-background px-1 text-[10px] font-bold text-muted-foreground border">
                      {laneCards.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!viewer.readOnly && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 rounded-md hover:bg-secondary" 
                            onClick={() => {
                              setCreateLaneKey(lane.key);
                              setCreateLaneLabel(lane.label);
                            }}
                          >
                            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent><p>Add Card</p></TooltipContent>
                      </Tooltip>
                    )}
                    {lane.hint && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground opacity-50 hover:opacity-100" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{lane.hint}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>

                <div className="kanban-lane-scroll flex-1 overflow-y-auto p-2 pt-0">
                  <div className="flex flex-col gap-3 min-h-[100px]">
                    {laneCards.map(card => (
                      <div key={card.cardKey} onClick={() => setSelectedCard(card)}>
                        <BoardCard
                          card={card}
                          token={token}
                          readOnly={viewer.readOnly}
                          onDragStart={(e) => handleDragStart(e, card.cardKey)}
                          onDragEnd={(e) => handleDragEnd(e, card.cardKey)}
                        />
                      </div>
                    ))}
                    {laneCards.length === 0 && (
                      <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/50 py-8 text-center">
                        <span className="text-xs font-semibold text-muted-foreground/60">Drop a card here</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <LoginDialog token={token} open={loginOpen} onOpenChange={setLoginOpen} />
      
      <CardDetailDialog 
        card={selectedCard} 
        token={token} 
        readOnly={viewer.readOnly} 
        onClose={() => setSelectedCard(null)} 
      />

      {createLaneKey && (
        <CreateCardDialog
          token={token}
          laneKey={createLaneKey}
          laneLabel={createLaneLabel}
          open={!!createLaneKey}
          onOpenChange={(open) => !open && setCreateLaneKey(null)}
        />
      )}
    </div>
  );
}
