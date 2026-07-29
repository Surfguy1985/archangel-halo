import { useLocation, useParams } from 'wouter';
import { useGetClientBoard, useDispatchClientBoardAction, useMarkClientBoardTourSeen, ClientBoardCardView } from '@workspace/api-client-react';
import { LoginDialog } from '@/components/LoginDialog';
import { useToast } from '@/hooks/use-toast';
import { BoardCard } from '@/components/kanban/BoardCard';
import { CardDetailDialog } from '@/components/kanban/CardDetailDialog';
import { CreateCardDialog } from '@/components/kanban/CreateCardDialog';
import { Button } from '@/components/ui/button';
import { MapPin, User, Loader2, Info, Plus, LayoutGrid, BookOpen, Headphones, Layers, LayoutList, AlertCircle, X, Check, Calendar, ArrowRight, Search, LogOut, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNow, isBefore, parseISO, startOfDay, format } from 'date-fns';
import { DashboardTour } from '@/components/DashboardTour';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { specFor, CATEGORY_COLORS } from '@/components/kanban/templateSpec';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

// hint: Logic changed on both sides. Requires understanding intent of each change.
function Board() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [loginOpen, setLoginOpen] = useState(false);
  const [draggedCard, setDraggedCard] = useState<string | null>(null);
  const [dragOverLane, setDragOverLane] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
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
  // Edge auto-scroll while a drag is active (touch or HTML5). The pointer
  // position is written into autoScrollPoint and a rAF loop nudges the board
  // horizontally / the lane under the pointer vertically when near an edge.
  const boardScrollRef = useRef<HTMLElement | null>(null);
  const autoScrollPoint = useRef<{ x: number; y: number } | null>(null);
  const autoScrollRaf = useRef<number | null>(null);

  const stopAutoScroll = () => {
    if (autoScrollRaf.current !== null) {
      cancelAnimationFrame(autoScrollRaf.current);
      autoScrollRaf.current = null;
    }
    autoScrollPoint.current = null;
  };

  const startAutoScroll = () => {
    if (autoScrollRaf.current !== null) return;
    const EDGE = 56; // px from an edge where scrolling kicks in
    const MAX_SPEED = 18; // px per frame at the very edge
    const speedFor = (dist: number) =>
      Math.ceil(((EDGE - Math.max(0, dist)) / EDGE) * MAX_SPEED);
    const step = () => {
      autoScrollRaf.current = null;
      const p = autoScrollPoint.current;
      if (!p) return;
      // Horizontal: the main board container.
      const board = boardScrollRef.current;
      if (board) {
        const r = board.getBoundingClientRect();
        if (p.x < r.left + EDGE) board.scrollLeft -= speedFor(p.x - r.left);
        else if (p.x > r.right - EDGE) board.scrollLeft += speedFor(r.right - p.x);
      }
      // Vertical: the lane scroll area under the pointer.
      const laneScroll = document
        .elementFromPoint(p.x, p.y)
        ?.closest('.kanban-lane-scroll') as HTMLElement | null;
      if (laneScroll) {
        const r = laneScroll.getBoundingClientRect();
        if (p.y < r.top + EDGE) laneScroll.scrollTop -= speedFor(p.y - r.top);
        else if (p.y > r.bottom - EDGE) laneScroll.scrollTop += speedFor(r.bottom - p.y);
      }
      autoScrollRaf.current = requestAnimationFrame(step);
    };
    autoScrollRaf.current = requestAnimationFrame(step);
  };

  useEffect(() => stopAutoScroll, []);
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

  // Update currentTime every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

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

  // REGRESSION FIX #3: Derive categories from templateSpec.ts specFor() — must be before early returns
  const categoryCounts = useMemo(() => {
    if (!board?.cards) return {};
    const counts: Record<string, number> = {};
    board.cards.forEach(c => {
      const spec = specFor(c.template);
      const cat = spec.categoryLabel;
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [board?.cards]);

  const categoryChips = useMemo(() => [
    { key: 'maintenance', label: 'Maintenance', color: CATEGORY_COLORS.maintenance },
    { key: 'money', label: 'Money', color: CATEGORY_COLORS.money },
    { key: 'vendor', label: 'Vendor', color: CATEGORY_COLORS.vendor },
    { key: 'compliance', label: 'Compliance', color: CATEGORY_COLORS.compliance },
    { key: 'leasing', label: 'Leasing', color: CATEGORY_COLORS.leasing },
    { key: 'access', label: 'Access', color: CATEGORY_COLORS.access },
    { key: 'people', label: 'People', color: CATEGORY_COLORS.people },
    { key: 'intel', label: 'Intel', color: CATEGORY_COLORS.intel },
  ].map(cat => ({ ...cat, count: categoryCounts[cat.key] || 0 }))
   .filter(cat => cat.count > 0), [categoryCounts]);

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
    autoScrollPoint.current = { x: e.clientX, y: e.clientY };
    startAutoScroll();
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      const el = document.getElementById(`card-${cardKey}`);
      if (el) el.classList.add('opacity-40', 'scale-95');
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent, cardKey: string) => {
    stopAutoScroll();
    setDraggedCard(null);
    const el = document.getElementById(`card-${cardKey}`);
    if (el) el.classList.remove('opacity-40', 'scale-95');
  };

  const handleDragOver = (e: React.DragEvent, laneKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    autoScrollPoint.current = { x: e.clientX, y: e.clientY };
    if (dragOverLane !== laneKey) setDragOverLane(laneKey);
  };

  const handleDragLeave = (e: React.DragEvent, laneKey: string) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      if (dragOverLane === laneKey) setDragOverLane(null);
    }
  };

  const handleDrop = (e: React.DragEvent, laneKey: string) => {
    e.preventDefault();
    stopAutoScroll();
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
      stopAutoScroll();
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
      // Feed the auto-scroll loop so the board scrolls when the finger
      // holds near a screen edge (lanes off-screen become reachable).
      autoScrollPoint.current = { x: t.clientX, y: t.clientY };
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
      autoScrollPoint.current = { x: s.startX, y: s.startY };
      startAutoScroll();
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

  const overdueCount = cards.filter(c => c.dueOn && isBefore(parseISO(c.dueOn), startOfDay(new Date())) && c.lane !== 'done').length;
  const urgentCount = cards.filter(c => (c.priority === 'urgent' || c.priority === 'high') && c.lane !== 'done').length;
  const doneCount = cards.filter(c => c.lane === 'done').length;
  const openCount = cards.filter(c => c.lane !== 'done').length;
  
  // Real metrics from card data for the Pulse rail
  const pulseMetrics = [
    { label: 'OPEN WORK', value: openCount.toString(), delta: '', note: 'active cards', bg: '#4a6070' },
    { label: 'SLA AT RISK', value: urgentCount.toString(), delta: '', note: 'urgent/high priority', bg: '#c25a1e' },
    { label: 'OVERDUE', value: overdueCount.toString(), delta: '', note: 'past due dates', bg: '#b23a2e' },
    { label: 'SETTLED', value: doneCount.toString(), delta: '', note: 'closed cards', bg: '#1f7a52' },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex h-screen flex-col bg-[#f1f0ec] font-sans relative overflow-hidden"
    >
      {/* 4. App Chrome - Header */}
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[#e4e2db] bg-[#ffffff] px-[20px] shadow-[0_1px_2px_rgba(16,28,51,0.05)] z-50 sticky top-0">
        <div className="flex items-center gap-[16px]">
          {logoUrl ? (
            <img src={logoUrl} alt={propertyName} className="h-[26px] object-contain drop-shadow-sm" />
          ) : (
            <div className="text-[20px] font-[800] text-[#101c33] tracking-tight">HALO</div>
          )}
          <div className="h-[26px] w-[1px] bg-[#e4e2db]" />
          <div className="flex flex-col justify-center">
            <h1 className="text-[13px] font-[700] text-[#101c33] leading-tight">{propertyName}</h1>
            {board.propertyAddress && (
              <p className="text-[10.5px] font-[600] text-[#8C8A81] leading-tight">{board.propertyAddress}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-[16px]">
          <div className="flex items-center h-[32px] gap-2 rounded-[8px] bg-[#101c33] px-3 border border-[#101c33]/20 shadow-sm overflow-hidden group">
            <span className="relative flex h-[6px] w-[6px]">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#D8F84E] opacity-75" style={{ animation: 'pulseDot 1.6s infinite' }}></span>
              <span className="relative inline-flex rounded-full h-[6px] w-[6px] bg-[#D8F84E]"></span>
            </span>
            <span className="text-[10px] font-[800] text-[#D8F84E] tracking-widest uppercase">LIVE</span>
            <span className="font-mono text-[10px] font-[700] text-white/80 group-hover:text-white transition-colors border-l border-white/20 pl-2 ml-1">
              {format(currentTime, 'HH:mm')}
            </span>
          </div>

          {/* REGRESSION FIX #2: Restore Map View, Site Map, Hub buttons with testids */}
          {viewer.permissions?.includes('unit_map') && (
            <>
              <button
                data-testid="button-map-view"
                className="h-[32px] px-3 rounded-[8px] bg-white border border-[#e4e2db] text-[#101c33] text-[11px] font-[700] hover:bg-[#F4F2EC] transition-colors flex items-center gap-1.5"
                onClick={() => setLocation(`/${token}/map`)}
              >
                <MapPin className="h-3.5 w-3.5" /> Map
              </button>
              <button
                data-testid="button-site-map"
                className="h-[32px] px-3 rounded-[8px] bg-white border border-[#e4e2db] text-[#101c33] text-[11px] font-[700] hover:bg-[#F4F2EC] transition-colors flex items-center gap-1.5"
                onClick={() => setLocation(`/${token}/units`)}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Units
              </button>
            </>
          )}

          {viewer.permissions?.includes('hub') && (
            <button
              className="h-[32px] px-3 rounded-[8px] bg-white border border-[#e4e2db] text-[#101c33] text-[11px] font-[700] hover:bg-[#F4F2EC] transition-colors flex items-center gap-1.5"
              onClick={() => setLocation(`/${token}/hub`)}
            >
              <BookOpen className="h-3.5 w-3.5" /> Hub
            </button>
          )}

          <button
            data-testid="button-board-tour"
            onClick={() => setTourOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F0EC] text-[#96948B] hover:bg-[#E7E5DD] hover:text-[#101c33] transition-colors"
            title="Take the guided tour"
          >
            <Headphones className="h-4 w-4" />
          </button>

          <div className="h-[26px] w-[1px] bg-[#e4e2db]" />

          {viewerAuthenticated ? (
            <button onClick={handleLogout} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F0EC] text-[#101c33] hover:bg-[#E7E5DD] transition-colors" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={() => setLoginOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F0EC] text-[#101c33] hover:bg-[#E7E5DD] transition-colors" title="Sign in">
              <User className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Pulse rail */}
      <div className="flex h-[56px] shrink-0 bg-[#101c33] overflow-x-auto kanban-lane-scroll hide-scrollbar items-center gap-[1px]">
        {pulseMetrics.map((m, i) => (
          <div key={i} className="flex-1 min-w-[186px] h-full flex flex-col justify-center px-4 hover:bg-white/5 transition-colors cursor-pointer group relative">
            <div className="flex items-center gap-2">
              <div className="w-[5px] h-[5px]" style={{ background: m.bg }} />
              <span className="text-[9px] font-[800] tracking-[0.12em] text-[#8FA0B8] uppercase">{m.label}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[23px] font-[700] tracking-[-0.035em] text-white leading-none">{m.value}</span>
              <span className="text-[9.5px] text-[#7E8FA8]">{m.note}</span>
            </div>
            <div className="absolute bottom-0 left-0 w-full h-[4px] bg-white/10 group-hover:bg-white/20 transition-colors">
              <div className="h-full bg-[#D8F84E]/50 w-1/3" />
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center px-[20px] py-[10px] shrink-0 bg-[#FBFAF7] border-b border-[#e4e2db] gap-4">
        <span className="text-[10px] font-[800] tracking-widest text-[#96948B] uppercase">LENS</span>
        
        <div className="flex p-[2px] bg-[#E7E5DD] border border-[#DCD9D1] rounded-[10px]">
          <button className="px-3 py-1 text-[11px] font-[700] rounded-[8px] bg-white text-[#101c33] shadow-[0_1px_3px_rgba(16,28,51,0.13)]">Flow</button>
        </div>

        <div className="w-[1px] h-[20px] bg-[#e4e2db]" />

        <div className="flex flex-1 overflow-x-auto hide-scrollbar gap-2 items-center kanban-lane-scroll">
          <button 
            onClick={() => setActiveCategory(null)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] text-[11px] font-[700] transition-colors ${!activeCategory ? 'bg-[#101c33] text-white' : 'bg-transparent text-[#96948B] hover:bg-[#E7E5DD] border border-transparent hover:border-[#DCD9D1]'}`}
          >
            All
          </button>
          {categoryChips.map(cat => (
            <button 
              key={cat.key}
              onClick={() => setActiveCategory(activeCategory === cat.key ? null : cat.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] text-[11px] font-[700] border transition-colors ${activeCategory === cat.key ? 'bg-[#101c33] text-white border-[#101c33]' : 'bg-white text-[#101c33] border-[#DCD9D1] shadow-sm hover:border-[#101c33]/20'}`}
            >
              <div className="w-2.5 h-2.5 rounded-[2px]" style={{ background: cat.color }} />
              {cat.label}
              <span className={`font-mono ml-1 ${activeCategory === cat.key ? 'text-white/70' : 'text-[#96948B]'}`}>{cat.count}</span>
            </button>
          ))}
        </div>

        <div className="w-[1px] h-[20px] bg-[#e4e2db]" />

        <div className="flex items-center gap-2 shrink-0">
          {/* REGRESSION FIX #4: Wire Site map button or remove if not feasible */}
          {viewer.permissions?.includes('unit_map') && (
            <div className="flex p-[2px] bg-[#E7E5DD] border border-[#DCD9D1] rounded-[10px] mr-2">
              <button className="px-3 py-1 text-[11px] font-[700] rounded-[8px] bg-white text-[#101c33] shadow-[0_1px_3px_rgba(16,28,51,0.13)]">Board view</button>
              <button 
                onClick={() => setLocation(`/${token}/units`)}
                className="px-3 py-1 text-[11px] font-[700] rounded-[8px] text-[#96948B] hover:text-[#101c33]"
              >
                Site map
              </button>
            </div>
          )}
          
          <button
            onClick={() => setTriageOpen(true)}
            data-testid="button-triage"
            className="flex items-center gap-2 h-[32px] px-4 rounded-[8px] bg-[#101c33] text-white text-[11px] font-[800] uppercase tracking-wider shadow-[0_1px_2px_rgba(16,28,51,0.2)] hover:bg-[#101c33]/90 transition-colors"
          >
            <Zap className={`h-3.5 w-3.5 ${triageCards.length > 0 ? 'text-[#D8F84E]' : 'text-white/50'}`} />
            Triage {triageCards.length > 0 ? triageCards.length : ''}
          </button>
          
          <button
            onClick={() => {
              if (viewer.readOnly) {
                setLoginOpen(true);
                return;
              }
              setCreateLaneKey(null);
              setCreateLaneLabel('');
              setCreateCardOpen(true);
            }}
            data-testid="button-create-card"
            className="flex items-center gap-1 h-[32px] px-3 rounded-[8px] bg-[#D8F84E] text-[#101c33] text-[11px] font-[800] uppercase tracking-wider shadow-sm hover:bg-[#C8EC33] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Card
          </button>
        </div>
      </div>

      {/* 5. The board */}
      <main
        ref={boardScrollRef}
        className="flex-1 flex overflow-x-auto kanban-lane-scroll p-[18px] px-[20px] gap-[14px]"
      >
        {lanes.map((lane) => {
          const laneCards = cards
            .filter((c) => c.lane === lane.key)
            .filter(c => {
              // REGRESSION FIX #3: Filter by specFor category instead of hardcoded templates
              if (!activeCategory) return true;
              const spec = specFor(c.template);
              return spec.categoryLabel === activeCategory;
            })
            // REGRESSION FIX #1: Sort by position (persisted drag order), NOT by SLA heat
            .sort((a, b) => (a.position || 0) - (b.position || 0));

          const isOver = dragOverLane === lane.key;
          // Compute hot count for the "N hot" indicator (uses heat, but doesn't reorder)
          const hasHotCards = laneCards.some(c => c.dueOn && isBefore(parseISO(c.dueOn), startOfDay(new Date())));
          const hotCount = laneCards.filter(c => c.dueOn && isBefore(parseISO(c.dueOn), startOfDay(new Date()))).length;

          // Spec colors and descriptions for Flow lens
          let statusColor = '#8c8a81';
          let description = 'Unknown column.';
          
          if (lane.key === 'inbox') { statusColor = '#4a6070'; description = 'Auto-detected by sensors, portals and inboxes.'; }
          if (lane.key === 'requested') { statusColor = '#c25a1e'; description = 'A decision only the manager can make.'; }
          if (lane.key === 'scheduled') { statusColor = '#33639f'; description = 'Crews on site, money moving, clocks running.'; }
          if (lane.key === 'in_progress') { statusColor = '#b23a2e'; description = 'Waiting on a part, a signature, or vendor.'; }
          if (lane.key === 'billing') { statusColor = '#7a4a9e'; description = 'Work claimed done — QC to confirm.'; }
          if (lane.key === 'done') { statusColor = '#1f7a52'; description = 'Closed today. Auto-archives at midnight.'; }

          return (
            <div
              key={lane.key}
              data-lane-key={lane.key}
              className={`flex shrink-0 flex-col w-[362px] bg-[#E7E5DD] border border-[#DCD9D1] rounded-[14px] p-[10px] transition-all duration-200 ${isOver ? 'ring-2 ring-[#101c33] ring-offset-2 ring-offset-[#F1F0EC]' : ''}`}
              onDragOver={(e) => handleDragOver(e, lane.key)}
              onDragLeave={(e) => handleDragLeave(e, lane.key)}
              onDrop={(e) => handleDrop(e, lane.key)}
            >
              {/* Column header */}
              <div className="flex flex-col gap-1.5 px-2 py-1 mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-[8px] h-[8px]" style={{ background: statusColor }} />
                  <h2 className="text-[11px] font-[800] uppercase tracking-[0.09em] text-[#101c33]">{lane.label}</h2>
                  <span className="flex items-center justify-center h-4 min-w-[16px] px-1 rounded-[8px] bg-black/5 text-[9px] font-[800] text-[#96948B]">
                    {laneCards.length}
                  </span>
                  <div className="flex-1" />
                  {hasHotCards && (
                    <span className="text-[10px] font-[800] text-[#e11d48]">
                      {hotCount} hot
                    </span>
                  )}
                </div>
                <p className="text-[10px] font-[500] text-[#8C8A81]">{description}</p>
              </div>

              <div className="flex-1 overflow-y-auto kanban-lane-scroll hide-scrollbar px-1 flex flex-col gap-[14px] min-h-[100px] relative pb-[10px]">
                {laneCards.map((card) => (
                  <div key={card.cardKey} className="card-snap" onTouchStart={(e) => handleTouchStart(e, card.cardKey)} onClick={() => { if (!draggedCard) setSelectedCard(card); }}>
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
                  <div className="absolute inset-x-2 top-0 bottom-2 border-2 border-dashed border-[#DCD9D1] rounded-[14px] flex items-center justify-center text-[12px] font-[600] text-[#96948B] opacity-50 pointer-events-none">
                    Drop a card here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </main>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} token={token} />

      {selectedCard && (
        <CardDetailDialog
          card={selectedCard}
          token={token}
          readOnly={viewer.readOnly}
          onClose={() => setSelectedCard(null)}
        />
      )}

      <CreateCardDialog
        token={token}
        defaultLaneKey={createLaneKey || undefined}
        defaultLaneLabel={createLaneLabel}
        availableLanes={lanes}
        open={createCardOpen}
        onOpenChange={setCreateCardOpen}
      />

      {tourOpen && <DashboardTour onClose={() => setTourOpen(false)} />}
      {renderTriageSheet()}
    </motion.div>
  );
}

export default Board;
