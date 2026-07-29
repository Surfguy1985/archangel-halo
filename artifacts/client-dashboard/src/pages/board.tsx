import { useLocation, useParams } from 'wouter';
import { useGetClientBoard, useDispatchClientBoardAction, useMarkClientBoardTourSeen, ClientBoardCardView } from '@workspace/api-client-react';
import { LoginDialog } from '@/components/LoginDialog';
import { useToast } from '@/hooks/use-toast';
import { BoardCard } from '@/components/kanban/BoardCard';
import { CardDetailDialog } from '@/components/kanban/CardDetailDialog';
import { CreateCardDialog } from '@/components/kanban/CreateCardDialog';
import { Button } from '@/components/ui/button';
import { MapPin, User, Loader2, Info, Plus, LayoutGrid, BookOpen, Headphones, Layers, LayoutList } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { DashboardTour } from '@/components/DashboardTour';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useEffect, useRef, useState } from 'react';

export default function KanbanBoard() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [loginOpen, setLoginOpen] = useState(false);
  const [draggedCard, setDraggedCard] = useState<string | null>(null);
  const [dragOverLane, setDragOverLane] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<ClientBoardCardView | null>(null);
  const [hoveredLane, setHoveredLane] = useState<string | null>(null);
  // Touch devices have no hover: first tap on a stacked lane expands it.
  // Taps also emit synthetic mouseenter events, so hover is ignored entirely
  // on coarse pointers or the tap would fall through to a buried card.
  const [expandedLane, setExpandedLane] = useState<string | null>(null);
  const isCoarsePointer = React.useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
    [],
  );

  // Touch-drag state (see handleTouchStart below). Declared up here so hook
  // order stays stable across the loading/error early returns.
  const touchDrag = useRef<{
    cardKey: string;
    startX: number;
    startY: number;
    timer: ReturnType<typeof setTimeout> | null;
    active: boolean;
    ghost: HTMLElement | null;
    offsetX: number;
    offsetY: number;
    el: HTMLElement;
    cleanup: () => void;
  } | null>(null);
  const suppressClick = useRef(false);
  // Latest values for native listeners without re-binding.
  const moveCardRef = useRef<(cardKey: string, laneKey: string) => void>(() => {});
  const readOnlyRef = useRef(false);
  
  const [createLaneKey, setCreateLaneKey] = useState<string | null>(null);
  const [createLaneLabel, setCreateLaneLabel] = useState<string>('');
  const [tourOpen, setTourOpen] = useState(false);

  const [viewMode, setViewMode] = useState<'stacked' | 'unstacked'>(() => {
    try {
      return (localStorage.getItem('halo_board_view_mode') as 'stacked' | 'unstacked') || 'unstacked';
    } catch {
      return 'unstacked';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('halo_board_view_mode', viewMode);
    } catch {}
  }, [viewMode]);

  const { data: board, isLoading, error } = useGetClientBoard(token, {
    query: {
      queryKey: getGetClientBoardQueryKey(token),
      refetchInterval: 10000,
    }
  });

  const dispatchAction = useDispatchClientBoardAction();
  const markTourSeen = useMarkClientBoardTourSeen();

  const boardLoaded = !isLoading && !error && !!board;
  const viewerAuthenticated = board?.viewer?.authenticated ?? false;
  const viewerTourSeen = board?.viewer?.tourSeen ?? false;
  
  useEffect(() => {
    if (!boardLoaded) return;
    const tourSeenKey = `halo_dashboard_tour_seen_${token}`;
    if (viewerAuthenticated) {
      if (!viewerTourSeen) {
        markTourSeen.mutate({ token });
        try { localStorage.setItem(tourSeenKey, '1'); } catch { /* ignore */ }
        setTourOpen(true);
      }
      return;
    }
    let seen = true;
    try {
      seen = localStorage.getItem(tourSeenKey) === '1';
    } catch {
      // storage unavailable
    }
    if (!seen) {
      try { localStorage.setItem(tourSeenKey, '1'); } catch { /* ignore */ }
      setTourOpen(true);
    }
  }, [boardLoaded, viewerAuthenticated, viewerTourSeen, token]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }} 
          animate={{ opacity: 1, scale: 1 }} 
          className="flex flex-col items-center gap-4 text-muted-foreground"
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-bold tracking-widest uppercase">Loading workspace...</p>
        </motion.div>
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="max-w-md text-center p-8 bg-white rounded-[24px] shadow-xl border border-black/5">
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
    setTimeout(() => {
      const el = document.getElementById(`card-${cardKey}`);
      if (el) el.classList.add('opacity-40', 'scale-95');
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent, cardKey: string) => {
    setDraggedCard(null);
    const el = document.getElementById(`card-${cardKey}`);
    if (el) el.classList.remove('opacity-40', 'scale-95');
  };

  const handleDragOver = (e: React.DragEvent, laneKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverLane !== laneKey) setDragOverLane(laneKey);
  };

  const handleDragLeave = (e: React.DragEvent, laneKey: string) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      if (dragOverLane === laneKey) setDragOverLane(null);
    }
  };

  const handleDrop = (e: React.DragEvent, laneKey: string) => {
    e.preventDefault();
    setDragOverLane(null);
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
    moveCard(draggedCard, laneKey);
  };

  // Shared by both the HTML5 drop handler (desktop) and the touch drag
  // handler (phones/tablets): optimistic move + dispatch + revert on failure.
  const moveCard = (cardKey: string, laneKey: string) => {
    const card = cards.find(c => c.cardKey === cardKey);
    if (!card || card.lane === laneKey) return;

    const previousLane = card.lane;
    queryClient.setQueryData(getGetClientBoardQueryKey(token), (old: any) => {
      if (!old) return old;
      return {
        ...old,
        cards: old.cards.map((c: any) => 
          c.cardKey === cardKey ? { ...c, lane: laneKey } : c
        )
      };
    });

    dispatchAction.mutate({
      token,
      data: {
        action: "card.moved",
        cardKey,
        payload: { lane: laneKey, position: 0 }
      }
    }, {
      onSuccess: (outcome) => {
        if (!outcome.ok) {
          queryClient.setQueryData(getGetClientBoardQueryKey(token), (old: any) => {
            if (!old) return old;
            return {
              ...old,
              cards: old.cards.map((c: any) => 
                c.cardKey === cardKey ? { ...c, lane: previousLane } : c
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
        queryClient.setQueryData(getGetClientBoardQueryKey(token), (old: any) => {
          if (!old) return old;
          return {
            ...old,
            cards: old.cards.map((c: any) => 
              c.cardKey === cardKey ? { ...c, lane: previousLane } : c
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

  // -------------------------------------------------------------------------
  // Touch drag (phones/tablets). HTML5 drag events never fire on touch
  // screens, so a long-press (200ms) picks the card up, a floating ghost
  // follows the finger, and elementFromPoint finds the lane under it.
  // Short swipes still scroll the lane; taps still open the card detail.
  // -------------------------------------------------------------------------
  moveCardRef.current = moveCard;
  readOnlyRef.current = viewer.readOnly;

  const handleTouchStart = (e: React.TouchEvent, cardKey: string) => {
    if (e.touches.length !== 1) return;
    const cardEl = document.getElementById(`card-${cardKey}`);
    if (!cardEl) return;
    const touch = e.touches[0];
    const startX = touch.clientX;
    const startY = touch.clientY;

    const endDrag = (drop: boolean, clientX: number, clientY: number) => {
      const s = touchDrag.current;
      if (!s) return;
      if (s.timer) clearTimeout(s.timer);
      s.cleanup();
      touchDrag.current = null;
      if (!s.active) return;
      s.ghost?.remove();
      s.el.classList.remove('opacity-40', 'scale-95');
      setDraggedCard(null);
      setDragOverLane(null);
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 300);
      if (!drop) return;
      const laneEl = document
        .elementFromPoint(clientX, clientY)
        ?.closest('[data-lane-key]') as HTMLElement | null;
      const laneKey = laneEl?.dataset.laneKey;
      if (laneKey) moveCardRef.current(s.cardKey, laneKey);
    };

    const onMove = (ev: TouchEvent) => {
      const s = touchDrag.current;
      if (!s || ev.touches.length !== 1) return;
      const t = ev.touches[0]!;
      if (!s.active) {
        // Finger moved before the long-press fired — it's a scroll, not a drag.
        if (Math.hypot(t.clientX - s.startX, t.clientY - s.startY) > 10) {
          if (s.timer) clearTimeout(s.timer);
          s.cleanup();
          touchDrag.current = null;
        }
        return;
      }
      ev.preventDefault(); // block page/lane scrolling while dragging
      if (s.ghost) {
        s.ghost.style.left = `${t.clientX - s.offsetX}px`;
        s.ghost.style.top = `${t.clientY - s.offsetY}px`;
      }
      const laneEl = document
        .elementFromPoint(t.clientX, t.clientY)
        ?.closest('[data-lane-key]') as HTMLElement | null;
      setDragOverLane(laneEl?.dataset.laneKey ?? null);
    };

    const onEnd = (ev: TouchEvent) => {
      const t = ev.changedTouches[0];
      endDrag(true, t?.clientX ?? startX, t?.clientY ?? startY);
      if (touchDrag.current === null && suppressClick.current) ev.preventDefault();
    };
    const onCancel = () => endDrag(false, startX, startY);

    const cleanup = () => {
      cardEl.removeEventListener('touchmove', onMove);
      cardEl.removeEventListener('touchend', onEnd);
      cardEl.removeEventListener('touchcancel', onCancel);
    };
    cardEl.addEventListener('touchmove', onMove, { passive: false });
    cardEl.addEventListener('touchend', onEnd);
    cardEl.addEventListener('touchcancel', onCancel);

    const timer = setTimeout(() => {
      const s = touchDrag.current;
      if (!s) return;
      if (readOnlyRef.current) {
        // Guests get the same sign-in prompt as on desktop when they try
        // to pick a card up.
        toast({
          title: "Sign in required",
          description: "You are viewing as a guest. Sign in to make changes.",
          variant: "destructive"
        });
        s.cleanup();
        touchDrag.current = null;
        return;
      }
      s.active = true;
      setDraggedCard(cardKey);
      // Floating ghost that follows the finger.
      const rect = s.el.getBoundingClientRect();
      const ghost = s.el.cloneNode(true) as HTMLElement;
      ghost.id = '';
      ghost.style.position = 'fixed';
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.zIndex = '9999';
      ghost.style.pointerEvents = 'none';
      ghost.style.transform = 'scale(1.03) rotate(1.5deg)';
      ghost.style.boxShadow = '0 16px 40px rgba(0,0,0,0.25)';
      ghost.style.opacity = '0.95';
      document.body.appendChild(ghost);
      s.ghost = ghost;
      s.offsetX = s.startX - rect.left;
      s.offsetY = s.startY - rect.top;
      s.el.classList.add('opacity-40', 'scale-95');
      try { navigator.vibrate?.(30); } catch { /* unsupported */ }
    }, 200);

    touchDrag.current = {
      cardKey,
      startX,
      startY,
      timer,
      active: false,
      ghost: null,
      offsetX: 0,
      offsetY: 0,
      el: cardEl,
      cleanup,
    };
  };

  const handleLogout = () => {
    localStorage.removeItem(`halo_client_session_${token}`);
    queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
    toast({ title: "Signed out", description: "You are now viewing as a guest." });
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex h-screen flex-col bg-background font-sans relative overflow-hidden"
    >
      {/* Header */}
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-black/5 bg-white/60 backdrop-blur-2xl px-6 shadow-sm z-50">
        <div className="flex items-center gap-5">
          {logoUrl ? (
            <img src={logoUrl} alt={propertyName} className="h-9 max-w-[140px] object-contain drop-shadow-sm" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d8f84e] text-[#101c33] font-black text-lg shadow-[0_2px_12px_rgba(216,248,78,0.5)]">
              {propertyName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="h-7 w-[1px] bg-black/10" />
          <div>
            <h1 className="text-[15px] font-[800] tracking-tight text-[#101c33] leading-tight">{propertyName}</h1>
            {board.propertyAddress && (
              <p className="text-[11px] font-[600] text-muted-foreground">{board.propertyAddress}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 border border-black/5 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#d8f84e] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#b6d338]"></span>
            </span>
            <span className="text-[10px] font-[800] tracking-widest text-[#101c33] uppercase">Live</span>
          </div>

          <div className="h-5 w-[1px] bg-black/10 mx-1" />

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 rounded-full bg-black/5 p-1 shadow-inner">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setViewMode('stacked'); setExpandedLane(null); }}
                  className={`flex h-[28px] w-[28px] items-center justify-center rounded-full transition-all duration-300 ${viewMode === 'stacked' ? 'bg-white shadow-sm text-foreground scale-105' : 'text-muted-foreground hover:text-foreground hover:bg-black/5'}`}
                >
                  <Layers className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs font-bold"><p>Stacked view</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setViewMode('unstacked'); setExpandedLane(null); }}
                  className={`flex h-[28px] w-[28px] items-center justify-center rounded-full transition-all duration-300 ${viewMode === 'unstacked' ? 'bg-white shadow-sm text-foreground scale-105' : 'text-muted-foreground hover:text-foreground hover:bg-black/5'}`}
                >
                  <LayoutList className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs font-bold"><p>List view</p></TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-black/5" onClick={() => setTourOpen(true)} data-testid="button-board-tour">
                <Headphones className="h-4 w-4 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs font-bold"><p>Take the guided tour</p></TooltipContent>
          </Tooltip>

          <Button variant="outline" size="sm" className="h-9 rounded-xl gap-2 text-xs font-[800] border-black/10 hover:bg-black/5 shadow-sm text-[#101c33]" onClick={() => setLocation(`/${token}/map`)} data-testid="button-map-view">
            <MapPin className="h-4 w-4" /> Map View
          </Button>

          {viewer.permissions?.includes('unit_map') && (
            <Button variant="outline" size="sm" className="h-9 rounded-xl gap-2 text-xs font-[800] border-black/10 hover:bg-black/5 shadow-sm text-[#101c33]" onClick={() => setLocation(`/${token}/units`)}>
              <LayoutGrid className="h-4 w-4" /> Units
            </Button>
          )}

          {viewer.permissions?.includes('hub') && (
            <Button variant="outline" size="sm" className="h-9 rounded-xl gap-2 text-xs font-[800] border-black/10 hover:bg-black/5 shadow-sm text-[#101c33]" onClick={() => setLocation(`/${token}/hub`)}>
              <BookOpen className="h-4 w-4" /> Hub
            </Button>
          )}

          {viewer.authenticated ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full ml-1" onClick={handleLogout}>
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-[#101c33] text-white shadow-sm hover:scale-105 transition-transform">
                    {viewer.name?.charAt(0).toUpperCase() || <User className="h-4 w-4" />}
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="rounded-xl p-2 border-black/10">
                <div className="flex flex-col gap-1 text-xs">
                  <span className="font-[800] text-[#101c33] px-1">{viewer.name || viewer.email}</span>
                  <span className="text-muted-foreground font-semibold hover:bg-black/5 p-1 rounded-md cursor-pointer transition-colors">Sign out</span>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="ghost" size="sm" className="h-9 rounded-xl gap-1.5 text-xs font-[800] text-muted-foreground hover:text-[#101c33] hover:bg-black/5 ml-1" onClick={() => setLoginOpen(true)}>
              <User className="h-4 w-4" /> Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Main Board */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden">
        
        {viewer.readOnly && (
          <motion.div 
            initial={{ opacity: 0, height: 0, y: -10 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            className="mx-6 mt-6 flex items-center justify-center rounded-[20px] border border-primary/30 bg-[#d8f84e]/10 px-5 py-3.5 text-sm font-[700] text-[#101c33] shadow-sm backdrop-blur-md"
          >
            <Info className="mr-2 h-5 w-5 text-[#b6d338]" />
            You are viewing this board as a guest. 
            <button className="ml-1 underline decoration-2 underline-offset-2 font-[800] hover:text-[#b6d338] transition-colors" onClick={() => setLoginOpen(true)}>
              Sign in to make changes.
            </button>
          </motion.div>
        )}

        <div className={`flex h-full items-start gap-6 px-6 pb-6 min-w-max ${viewer.readOnly ? 'pt-4' : 'pt-6'}`}>
          {lanes.map((lane, index) => {
            const laneCards = cards.filter(c => c.lane === lane.key).sort((a, b) => (a.position || 0) - (b.position || 0));
            const isLaneHovered =
              hoveredLane === lane.key || dragOverLane === lane.key || expandedLane === lane.key;

            return (
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08, duration: 0.6, ease: [0.2, 0.65, 0.3, 0.9] }}
                key={lane.key} 
                data-testid={`lane-${lane.key}`}
                data-lane-key={lane.key}
                className={`flex h-full w-[360px] shrink-0 flex-col rounded-[32px] transition-all duration-300 relative ${
                  dragOverLane === lane.key && draggedCard
                    ? 'bg-primary/10 border-2 border-[#d8f84e]/60 shadow-[0_0_40px_rgba(216,248,78,0.25)]'
                    : 'bg-black/[0.015] border border-black/[0.04] shadow-[inset_0_1px_2px_rgba(255,255,255,1)] dark:shadow-none hover:bg-black/[0.025]'
                }`}
                onMouseEnter={() => {
                  if (!isCoarsePointer) setHoveredLane(lane.key);
                  // Expansion is exclusive: entering another lane collapses the
                  // previously tap-expanded one (mouseleave isn't reliable).
                  setExpandedLane((prev) => (prev === lane.key ? prev : null));
                }}
                onMouseLeave={() => {
                  setHoveredLane(null);
                  if (expandedLane === lane.key) setExpandedLane(null);
                }}
                onDragOver={(e) => handleDragOver(e, lane.key)}
                onDragLeave={(e) => handleDragLeave(e, lane.key)}
                onDrop={(e) => handleDrop(e, lane.key)}
              >
                {/* Lane Header */}
                <div className="flex items-center justify-between px-5 py-4 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-[800] uppercase tracking-widest text-[#101c33]/80">{lane.label}</span>
                    <span className="flex h-5 min-w-[22px] items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-[800] text-[#101c33]/60 shadow-sm border border-black/5">
                      {laneCards.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {lane.hint && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-4 w-4 text-muted-foreground opacity-40 hover:opacity-100 transition-opacity cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="rounded-xl border-black/10 font-medium text-xs">
                          <p>{lane.hint}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {!viewer.readOnly && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button 
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-white border border-black/5 shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all text-[#101c33]" 
                            onClick={() => {
                              setCreateLaneKey(lane.key);
                              setCreateLaneLabel(lane.label);
                            }}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="rounded-xl border-black/10 font-bold text-xs"><p>Add Card</p></TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>

                {/* Lane Cards Scroll Area */}
                <div
                  className="kanban-lane-scroll flex-1 overflow-y-auto overflow-x-hidden px-3 pt-1 pb-16"
                  onClickCapture={(e) => {
                    // Touch-safe stacked mode: with no hover available, the first
                    // tap expands the stack instead of activating a buried card.
                    // Expansion is exclusive — claiming it collapses other lanes.
                    if (viewMode !== 'stacked' || laneCards.length <= 1) return;
                    const laneOpen =
                      hoveredLane === lane.key ||
                      expandedLane === lane.key ||
                      dragOverLane === lane.key;
                    if (!laneOpen) {
                      e.stopPropagation();
                      e.preventDefault();
                    }
                    if (expandedLane !== lane.key) setExpandedLane(lane.key);
                  }}
                >
                  <div className="flex flex-col gap-3 min-h-[150px] relative">
                    <AnimatePresence mode="popLayout">
                      {laneCards.map((card, i) => {
                        const isStackedMode = viewMode === 'stacked';
                        const isStacked = isStackedMode && !isLaneHovered;
                        
                        // Overlap determines how much of the underlying card is hidden.
                        // 430 height - 364 overlap = 66px exposed per card. Plus 12px gap = 78px total exposed.
                        const overlap = 364; 
                        const mt = i === 0 ? 0 : (isStacked ? -overlap : 0);
                        const scale = isStacked ? Math.max(0.9, 1 - (laneCards.length - 1 - i) * 0.015) : 1;
                        
                        return (
                          <motion.div
                            layout="position"
                            key={card.cardKey}
                            initial={{ opacity: 0, y: 30, scale: 0.95 }}
                            animate={{ 
                              opacity: 1, 
                              y: 0, 
                              marginTop: mt,
                              scale: scale,
                              zIndex: i
                            }}
                            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                            transition={{ 
                              type: "spring", 
                              stiffness: 350, 
                              damping: 35, 
                              mass: 0.8 
                            }}
                            style={{ transformOrigin: "top center" }}
                          >
                            <div
                              onClick={() => {
                                if (suppressClick.current) return;
                                setSelectedCard(card);
                              }}
                              onTouchStart={(e) => handleTouchStart(e, card.cardKey)}
                            >
                              <BoardCard
                                card={card}
                                token={token}
                                readOnly={viewer.readOnly}
                                onDragStart={(e) => handleDragStart(e, card.cardKey)}
                                onDragEnd={(e) => handleDragEnd(e, card.cardKey)}
                              />
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                    
                    {laneCards.length === 0 && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="flex flex-col items-center justify-center rounded-[24px] border-2 border-dashed border-black/10 py-16 text-center bg-black/[0.01] mt-2"
                      >
                        <span className="text-[11px] font-[800] text-muted-foreground/50 uppercase tracking-widest">Drop a card here</span>
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </main>

      <AnimatePresence>
        {tourOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <DashboardTour onClose={() => setTourOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

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
    </motion.div>
  );
}
