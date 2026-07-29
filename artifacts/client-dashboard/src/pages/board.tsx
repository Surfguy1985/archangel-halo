import { useLocation, useParams } from 'wouter';
import { useGetClientBoard, useDispatchClientBoardAction, useMarkClientBoardTourSeen, ClientBoardCardView } from '@workspace/api-client-react';
import { LoginDialog } from '@/components/LoginDialog';
import { useToast } from '@/hooks/use-toast';
import { BoardCard } from '@/components/kanban/BoardCard';
import { CardDetailDialog } from '@/components/kanban/CardDetailDialog';
import { CreateCardDialog } from '@/components/kanban/CreateCardDialog';
import { Button } from '@/components/ui/button';
import { MapPin, User, Loader2, Info, Plus, LayoutGrid, BookOpen, Headphones, Layers, LayoutList, AlertCircle, X, Check, Calendar, ArrowRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNow, isBefore, parseISO, startOfDay } from 'date-fns';
import { DashboardTour } from '@/components/DashboardTour';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useEffect, useRef, useState, useMemo } from 'react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

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
  const [expandedLane, setExpandedLane] = useState<string | null>(null);
  const isCoarsePointer = React.useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
    [],
  );

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
  const moveCardRef = useRef<(cardKey: string, laneKey: string, dropIndex?: number) => void>(() => {});
  const dropIndexRef = useRef<(laneKey: string, clientY: number, draggedKey: string) => number>(() => 0);
  const readOnlyRef = useRef(false);
  
  const [createCardOpen, setCreateCardOpen] = useState(false);
  const [createLaneKey, setCreateLaneKey] = useState<string | null>(null);
  const [createLaneLabel, setCreateLaneLabel] = useState<string>('');
  
  const [tourOpen, setTourOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);

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

  // Derived Triage List
  // A card needs a decision if: priority is urgent/high OR it is past dueOn OR it is in the "requested" lane
  const [localDismissedTriage, setLocalDismissedTriage] = useState<Set<string>>(new Set());

  const triageCards = useMemo(() => {
    if (!board?.cards) return [];
    
    return board.cards.filter(c => {
      if (localDismissedTriage.has(c.cardKey)) return false;
      if (c.lane === 'done') return false; // Ignore closed cards
      
      const isUrgent = c.priority === 'urgent' || c.priority === 'high';
      let isPastDue = false;
      if (c.dueOn) {
        // Only past due if it's strictly before today
        isPastDue = isBefore(parseISO(c.dueOn), startOfDay(new Date()));
      }
      const isRequested = c.lane === 'requested' || c.lane === 'inbox'; // check both
      
      return isUrgent || isPastDue || isRequested;
    }).sort((a, b) => {
      // Sort most-urgent first. 'urgent' > 'high' > everything else
      const pMap: Record<string, number> = { urgent: 3, high: 2, medium: 1, normal: 1, low: 0, none: 0 };
      const pA = pMap[a.priority ?? 'none'] ?? 0;
      const pB = pMap[b.priority ?? 'none'] ?? 0;
      if (pA !== pB) return pB - pA;
      // Then oldest due date
      if (a.dueOn && b.dueOn) {
        return parseISO(a.dueOn).getTime() - parseISO(b.dueOn).getTime();
      }
      if (a.dueOn) return -1;
      if (b.dueOn) return 1;
      return 0;
    });
  }, [board?.cards, localDismissedTriage]);


  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f4f3f0]">
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
      <div className="flex h-screen items-center justify-center bg-[#f4f3f0]">
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
    moveCard(draggedCard, laneKey, computeDropIndex(laneKey, e.clientY, draggedCard));
  };

  // Where in the lane the pointer/finger dropped: index of the first card
  // whose vertical midpoint sits below the drop point (dragged card excluded).
  const computeDropIndex = (laneKey: string, clientY: number, draggedKey: string): number => {
    const laneCards = cards
      .filter(c => c.lane === laneKey && c.cardKey !== draggedKey)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    for (let i = 0; i < laneCards.length; i++) {
      const el = document.getElementById(`card-${laneCards[i].cardKey}`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return laneCards.length;
  };

  // Shared by both the HTML5 drop handler (desktop) and the touch drag
  // handler (phones/tablets): optimistic move + dispatch + revert on failure.
  // dropIndex is the insertion index within the target lane (dragged card
  // excluded); the full lane order is sent so the server can persist it.
  const moveCard = (cardKey: string, laneKey: string, dropIndex?: number) => {
    const card = cards.find(c => c.cardKey === cardKey);
    if (!card) return;

    const targetLaneKeys = cards
      .filter(c => c.lane === laneKey && c.cardKey !== cardKey)
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map(c => c.cardKey);
    const insertAt = Math.max(0, Math.min(dropIndex ?? 0, targetLaneKeys.length));
    // No-op: same lane, same slot.
    if (card.lane === laneKey) {
      const currentOrder = cards
        .filter(c => c.lane === laneKey)
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map(c => c.cardKey);
      if (currentOrder.indexOf(cardKey) === insertAt) return;
    }
    const orderedCardKeys = [...targetLaneKeys];
    orderedCardKeys.splice(insertAt, 0, cardKey);

    const previousCards = cards.map(c => ({ ...c }));
    const revert = () => {
      queryClient.setQueryData(getGetClientBoardQueryKey(token), (old: any) => {
        if (!old) return old;
        return { ...old, cards: previousCards };
      });
    };
    queryClient.setQueryData(getGetClientBoardQueryKey(token), (old: any) => {
      if (!old) return old;
      return {
        ...old,
        cards: old.cards.map((c: any) => {
          const idx = orderedCardKeys.indexOf(c.cardKey);
          if (c.cardKey === cardKey) return { ...c, lane: laneKey, position: insertAt };
          if (idx >= 0) return { ...c, position: idx };
          return c;
        })
      };
    });

    dispatchAction.mutate({
      token,
      data: {
        action: "card.moved",
        cardKey,
        payload: { lane: laneKey, position: insertAt, orderedCardKeys }
      }
    }, {
      onSuccess: (outcome) => {
        if (!outcome.ok) {
          revert();
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
        revert();
        toast({
          title: "Error",
          description: "Network error while moving card",
          variant: "destructive"
        });
      }
    });
  };

  moveCardRef.current = moveCard;
  dropIndexRef.current = computeDropIndex;
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
      if (laneKey) {
        moveCardRef.current(s.cardKey, laneKey, dropIndexRef.current(laneKey, clientY, s.cardKey));
      }
    };

    const onMove = (ev: TouchEvent) => {
      const s = touchDrag.current;
      if (!s || ev.touches.length !== 1) return;
      const t = ev.touches[0]!;
      if (!s.active) {
        if (Math.hypot(t.clientX - s.startX, t.clientY - s.startY) > 10) {
          if (s.timer) clearTimeout(s.timer);
          s.cleanup();
          touchDrag.current = null;
        }
        return;
      }
      ev.preventDefault();
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

  const renderTriageSheet = () => {
    return (
      <Sheet open={triageOpen} onOpenChange={setTriageOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto bg-[#fdfdfc] p-0 border-l border-black/10">
          <div className="p-6 border-b border-black/5 bg-white sticky top-0 z-10 shadow-sm">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-xl font-[800] text-[#101c33]">
                <AlertCircle className="h-5 w-5 text-[#e11d48]" />
                Triage Queue
              </SheetTitle>
              <SheetDescription className="text-[13px] font-[600] text-muted-foreground">
                These {triageCards.length} cards require your attention.
              </SheetDescription>
            </SheetHeader>
          </div>
          
          <div className="p-6 flex flex-col gap-4">
            <AnimatePresence>
              {triageCards.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center p-8 text-center bg-black/[0.02] border border-black/5 rounded-xl">
                  <Check className="h-10 w-10 text-[#1f7a52] mb-3" />
                  <p className="text-[14px] font-[800] text-[#101c33]">All caught up</p>
                  <p className="text-[12px] font-[600] text-muted-foreground mt-1">No urgent decisions needed.</p>
                </motion.div>
              ) : (
                triageCards.map((c) => {
                  const isUrgent = c.priority === 'urgent' || c.priority === 'high';
                  
                  // Primary action
                  const actionBtns = (c.actions ?? []).filter((a) => a.kind !== 'link');
                  const linkBtns = (c.actions ?? []).filter((a) => a.kind === 'link');
                  const primaryBtn = actionBtns.find((a) => a.kind === 'primary') ?? linkBtns[0] ?? actionBtns[0];

                  return (
                    <motion.div
                      layout
                      key={c.cardKey}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="flex flex-col gap-3 p-4 bg-white border border-black/10 shadow-sm rounded-[16px] hover:shadow-md transition-shadow relative overflow-hidden"
                    >
                      {isUrgent && <div className="absolute top-0 left-0 w-1 h-full bg-[#e11d48]" />}
                      
                      <div className="flex justify-between items-start pl-2">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-[800] uppercase tracking-wider text-muted-foreground mb-1">
                            {c.template} • {c.lane}
                          </span>
                          <h4 className="text-[14px] font-[800] text-[#101c33] leading-tight line-clamp-2">
                            {c.title}
                          </h4>
                          {c.subtitle && (
                            <p className="text-[11px] font-[600] text-muted-foreground mt-1 line-clamp-1">{c.subtitle}</p>
                          )}
                        </div>
                        {c.dueOn && (
                          <div className="flex items-center gap-1 text-[10px] font-[800] px-2 py-1 bg-black/5 rounded-[6px] text-muted-foreground shrink-0">
                            <Calendar className="h-3 w-3" />
                            {formatDistanceToNow(parseISO(c.dueOn), { addSuffix: true })}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-2 pl-2">
                        {primaryBtn ? (
                          primaryBtn.href ? (
                            <a href={primaryBtn.href} target="_blank" rel="noreferrer" className="flex-1 h-9 flex items-center justify-center bg-[#d8f84e] text-[#101c33] text-[11px] font-[800] uppercase tracking-wider rounded-[8px] shadow-sm hover:brightness-105 transition-all">
                              {primaryBtn.label}
                            </a>
                          ) : (
                            <button
                              onClick={() => {
                                if (viewer.readOnly) {
                                  setTriageOpen(false);
                                  setLoginOpen(true);
                                  return;
                                }
                                dispatchAction.mutate({ token, data: { action: primaryBtn.key, cardKey: c.cardKey, payload: {} } }, {
                                  onSuccess: () => {
                                    toast({ title: 'Done', description: `Action executed for ${c.title}` });
                                    queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
                                  },
                                  onError: () => {
                                    toast({ title: 'Action failed', description: 'Could not complete this action.', variant: 'destructive' });
                                  },
                                });
                              }}
                              className="flex-1 h-9 flex items-center justify-center bg-[#d8f84e] text-[#101c33] text-[11px] font-[800] uppercase tracking-wider rounded-[8px] shadow-sm hover:brightness-105 transition-all"
                            >
                              {primaryBtn.label}
                            </button>
                          )
                        ) : null}
                        <button
                          onClick={() => {
                            setSelectedCard(c);
                            setTriageOpen(false);
                          }}
                          className={`h-9 flex items-center justify-center px-3 bg-[#101c33] text-white text-[11px] font-[800] uppercase tracking-wider rounded-[8px] shadow-sm hover:bg-[#101c33]/90 transition-colors ${primaryBtn ? '' : 'flex-1'}`}
                        >
                          Open
                        </button>
                        
                        <button
                          onClick={() => {
                            setLocalDismissedTriage(prev => {
                              const next = new Set(prev);
                              next.add(c.cardKey);
                              return next;
                            });
                          }}
                          className="h-9 px-3 flex items-center justify-center border border-black/10 bg-white text-muted-foreground text-[11px] font-[800] uppercase tracking-wider rounded-[8px] shadow-sm hover:bg-black/5 transition-colors"
                        >
                          Defer
                        </button>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </SheetContent>
      </Sheet>
    );
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex h-screen flex-col bg-[#f4f3f0] font-sans relative overflow-hidden"
    >
      {/* Header */}
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-black/5 bg-[#fdfdfc] px-6 shadow-sm z-50">
        <div className="flex items-center gap-5">
          {logoUrl ? (
            <img src={logoUrl} alt={propertyName} className="h-9 max-w-[140px] object-contain drop-shadow-sm" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#d8f84e] text-[#101c33] font-[900] text-lg shadow-sm border border-black/5">
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

          {/* Triage Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTriageOpen(true)}
            className="h-10 rounded-[10px] gap-2 text-[12px] font-[800] border-black/10 bg-white hover:bg-black/[0.02] shadow-sm text-[#101c33] px-4 relative"
          >
            <AlertCircle className={`h-4 w-4 ${triageCards.length > 0 ? 'text-[#e11d48]' : 'text-muted-foreground'}`} />
            Triage
            {triageCards.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#e11d48] text-[9px] font-bold text-white shadow-sm border border-white">
                {triageCards.length}
              </span>
            )}
          </Button>

          {/* Big Create Button — visible to guests too; prompts sign-in */}
          {(
            <Button
              size="sm"
              onClick={() => {
                if (viewer.readOnly) {
                  setLoginOpen(true);
                  return;
                }
                setCreateLaneKey(null);
                setCreateCardOpen(true);
              }}
              className="h-10 rounded-[10px] gap-2 text-[12px] font-[800] bg-[#d8f84e] hover:bg-[#d8f84e]/90 text-[#101c33] px-5 shadow-sm hover:shadow-md transition-all active:scale-95"
            >
              <Plus className="h-4 w-4" />
              Create Card
            </Button>
          )}

          <div className="h-5 w-[1px] bg-black/10 mx-1" />

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 rounded-[10px] bg-black/5 p-1 shadow-inner">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setViewMode('stacked'); setExpandedLane(null); }}
                  className={`flex h-[30px] w-[30px] items-center justify-center rounded-[8px] transition-all duration-300 ${viewMode === 'stacked' ? 'bg-white shadow-sm text-foreground scale-105' : 'text-muted-foreground hover:text-foreground hover:bg-black/5'}`}
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
                  className={`flex h-[30px] w-[30px] items-center justify-center rounded-[8px] transition-all duration-300 ${viewMode === 'unstacked' ? 'bg-white shadow-sm text-foreground scale-105' : 'text-muted-foreground hover:text-foreground hover:bg-black/5'}`}
                >
                  <LayoutList className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs font-bold"><p>List view</p></TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-[10px] hover:bg-black/5" onClick={() => setTourOpen(true)} data-testid="button-board-tour">
                <Headphones className="h-4 w-4 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs font-bold"><p>Take the guided tour</p></TooltipContent>
          </Tooltip>

          {viewer.permissions?.includes('unit_map') && (<>
            <Button variant="outline" size="sm" data-testid="button-map-view" className="h-10 rounded-[10px] gap-2 text-xs font-[800] border-black/10 bg-white hover:bg-black/[0.02] shadow-sm text-[#101c33]" onClick={() => setLocation(`/${token}/map`)}>
              <MapPin className="h-4 w-4" /> Map View
            </Button>
            <Button variant="outline" size="sm" data-testid="button-site-map" className="h-10 rounded-[10px] gap-2 text-xs font-[800] border-black/10 bg-white hover:bg-black/[0.02] shadow-sm text-[#101c33]" onClick={() => setLocation(`/${token}/units`)}>
              <LayoutGrid className="h-4 w-4" /> Site Map
            </Button>
          </>)}

          {viewer.permissions?.includes('hub') && (
            <Button variant="outline" size="sm" className="h-10 rounded-[10px] gap-2 text-xs font-[800] border-black/10 bg-white hover:bg-black/[0.02] shadow-sm text-[#101c33]" onClick={() => setLocation(`/${token}/hub`)}>
              <BookOpen className="h-4 w-4" /> Hub
            </Button>
          )}

          {viewer.authenticated ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-[10px] ml-1" onClick={handleLogout}>
                  <div className="flex h-full w-full items-center justify-center rounded-[8px] bg-[#101c33] text-white shadow-sm hover:scale-105 transition-transform">
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
            <Button variant="ghost" size="sm" className="h-10 rounded-[10px] gap-1.5 text-xs font-[800] text-muted-foreground hover:text-[#101c33] hover:bg-black/5 ml-1" onClick={() => setLoginOpen(true)}>
              <User className="h-4 w-4" /> Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Main Board */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden pt-6">
        
        {viewer.readOnly && (
          <motion.div 
            initial={{ opacity: 0, height: 0, y: -10 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            className="mx-6 mb-6 flex items-center justify-center rounded-[16px] border border-primary/30 bg-[#d8f84e]/10 px-5 py-3.5 text-sm font-[700] text-[#101c33] shadow-sm backdrop-blur-md"
          >
            <Info className="mr-2 h-5 w-5 text-[#b6d338]" />
            You are viewing this board as a guest. 
            <button className="ml-1 underline decoration-2 underline-offset-2 font-[800] hover:text-[#b6d338] transition-colors" onClick={() => setLoginOpen(true)}>
              Sign in to make changes.
            </button>
          </motion.div>
        )}

        <div className={`flex h-full items-start gap-4 px-6 pb-6 min-w-max`}>
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
                className={`flex h-full w-[360px] shrink-0 flex-col rounded-[20px] transition-all duration-300 relative bg-[#fdfdfc] border border-black/10 shadow-[0_2px_8px_rgba(0,0,0,0.02)] ${
                  dragOverLane === lane.key && draggedCard
                    ? 'ring-2 ring-primary ring-offset-4 ring-offset-[#f4f3f0] shadow-xl'
                    : 'hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]'
                }`}
                onMouseEnter={() => {
                  if (!isCoarsePointer) setHoveredLane(lane.key);
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
                <div className="flex items-center justify-between px-4 pt-4 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#101c33' }}></span>
                    <span className="text-[13px] font-[800] uppercase tracking-widest text-[#101c33] leading-none">{lane.label}</span>
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-[6px] bg-black/5 px-1.5 text-[10px] font-[800] text-muted-foreground ml-1">
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
                  </div>
                </div>
                {lane.hint && (
                  <div className="px-4 pb-3">
                    <p className="text-[11px] font-[600] text-muted-foreground line-clamp-1">{lane.hint}</p>
                  </div>
                )}

                {/* Lane Cards Scroll Area */}
                <div
                  className="kanban-lane-scroll flex-1 overflow-y-auto overflow-x-hidden px-3 pt-1 pb-16"
                  onClickCapture={(e) => {
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
                        
                        // We want dense cards so overlap is quite a lot
                        // the card is around ~260px high maybe.
                        const overlap = 220; 
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
                        className="flex flex-col items-center justify-center py-10 opacity-40 border-2 border-dashed border-black/10 rounded-[16px] bg-black/[0.02] h-[200px]"
                      >
                        <Layers className="h-6 w-6 text-muted-foreground mb-2" />
                        <p className="text-[12px] font-[800] text-muted-foreground uppercase tracking-widest">Empty</p>
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </main>

      {renderTriageSheet()}

      {/* Modals */}
      <CreateCardDialog 
        token={token}
        availableLanes={lanes}
        defaultLaneKey={createLaneKey || undefined}
        defaultLaneLabel={createLaneLabel}
        open={createCardOpen || createLaneKey !== null} 
        onOpenChange={(open) => {
          setCreateCardOpen(open);
          if (!open) setCreateLaneKey(null);
        }} 
      />
      
      <CardDetailDialog 
        card={selectedCard} 
        token={token} 
        readOnly={viewer.readOnly}
        onClose={() => setSelectedCard(null)} 
      />

      <LoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        token={token}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
        }}
      />
      
      {tourOpen && <DashboardTour onClose={() => setTourOpen(false)} />}
    </motion.div>
  );
}
