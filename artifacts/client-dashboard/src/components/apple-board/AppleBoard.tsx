import React, { useState, useRef, useEffect } from 'react';
import { 
  useGetClientPmBoard, 
  useGetClientBoard,
  useDispatchClientBoardAction, 
  useCreateClientBoardAiCard,
  ClientBoardCardView, 
  getGetClientPmBoardQueryKey,
  getGetClientBoardQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { AppleCard } from './AppleCard';
import { AppleTemplateGallery } from './AppleTemplateGallery';
import { AppleCardForm } from './AppleCardForm';
import { PM_TEMPLATES, VENDOR_TEMPLATES, AppleTemplate } from './templates';
import { Plus, Loader2, Sparkles, Map as MapIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CardDetailPanel } from '@/components/CardDetailPanel';
import { BirdseyeMapDialog } from '@/components/BirdseyeMapDialog';

interface AppleBoardProps {
  token: string;
  viewer: { readOnly: boolean; authenticated: boolean; permissions?: string[] };
  boardKey?: 'pm';
  onLoginRequired: () => void;
  onOpenBirdseye?: () => void;
}

const DEFAULT_LANE_COLORS: Record<string, string> = {
  planning: '#8E8E93',
  todo: '#007AFF',
  doing: '#FF9500',
  done: '#34C759',
  inbox: '#AF52DE',
  requested: '#FF3B30',
  scheduled: '#5856D6',
  in_progress: '#FF9500',
  billing: '#8E8E93',
};

export function AppleBoard({ token, viewer, boardKey, onLoginRequired, onOpenBirdseye }: AppleBoardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isPm = boardKey === 'pm';

  const pmQuery = useGetClientPmBoard(token, {
    query: {
      queryKey: getGetClientPmBoardQueryKey(token),
      refetchInterval: 30000,
      enabled: isPm,
    }
  });

  const vendorQuery = useGetClientBoard(token, {
    query: {
      queryKey: getGetClientBoardQueryKey(token),
      refetchInterval: 30000,
      enabled: !isPm,
    }
  });

  const boardQuery = isPm ? pmQuery : vendorQuery;
  const board = boardQuery.data;
  const isLoading = boardQuery.isLoading;

  const dispatchAction = useDispatchClientBoardAction();
  const createAiCard = useCreateClientBoardAiCard();

  const [draggedCard, setDraggedCard] = useState<string | null>(null);
  const [dragOverLane, setDragOverLane] = useState<string | null>(null);
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<AppleTemplate | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [defaultLane, setDefaultLane] = useState('todo');
  const [detailCard, setDetailCard] = useState<ClientBoardCardView | null>(null);

  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiFocused, setIsAiFocused] = useState(false);

  const boardScrollRef = useRef<HTMLElement | null>(null);
  const autoScrollPoint = useRef<{ x: number; y: number } | null>(null);
  const autoScrollRaf = useRef<number | null>(null);
  const moveCardRef = useRef<(cardKey: string, laneKey: string, dropIndex?: number) => void>(() => {});
  const dropIndexRef = useRef<(laneKey: string, clientY: number, draggedKey: string) => number>(() => 0);
  const readOnlyRef = useRef(false);

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

  const stopAutoScroll = () => {
    if (autoScrollRaf.current !== null) {
      cancelAnimationFrame(autoScrollRaf.current);
      autoScrollRaf.current = null;
    }
    autoScrollPoint.current = null;
  };

  const startAutoScroll = () => {
    if (autoScrollRaf.current !== null) return;
    const EDGE = 56;
    const MAX_SPEED = 18;
    const speedFor = (dist: number) =>
      Math.ceil(((EDGE - Math.max(0, dist)) / EDGE) * MAX_SPEED);
    const step = () => {
      autoScrollRaf.current = null;
      const p = autoScrollPoint.current;
      if (!p) return;
      const boardEl = boardScrollRef.current;
      if (boardEl) {
        const r = boardEl.getBoundingClientRect();
        if (p.x < r.left + EDGE) boardEl.scrollLeft -= speedFor(p.x - r.left);
        else if (p.x > r.right - EDGE) boardEl.scrollLeft += speedFor(r.right - p.x);
      }
      const laneScroll = document
        .elementFromPoint(p.x, p.y)
        ?.closest('.apple-lane-scroll') as HTMLElement | null;
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
    
    if (!isPm && laneKey === 'done') {
      const card = board?.cards?.find(c => c.cardKey === draggedCard);
      if (card && (card.template === 'job' || card.template === 'invoice' || card.template === 'request')) {
         toast({
           title: "Cannot move to Done",
           description: "This card must be completed by the office.",
           variant: "destructive"
         });
         return;
      }
    }
    
    moveCard(draggedCard, laneKey, computeDropIndex(laneKey, e.clientY, draggedCard));
  };

  const computeDropIndex = (laneKey: string, clientY: number, draggedKey: string): number => {
    const cards = board?.cards || [];
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

  const moveCard = (cardKey: string, laneKey: string, dropIndex?: number) => {
    const cards = board?.cards || [];
    const card = cards.find(c => c.cardKey === cardKey);
    if (!card) return;

    const targetLaneKeys = cards
      .filter(c => c.lane === laneKey && c.cardKey !== cardKey)
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map(c => c.cardKey);
    const insertAt = Math.max(0, Math.min(dropIndex ?? 0, targetLaneKeys.length));

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
      const qKey = isPm ? getGetClientPmBoardQueryKey(token) : getGetClientBoardQueryKey(token);
      queryClient.setQueryData(qKey, (old: any) => {
        if (!old) return old;
        return { ...old, cards: previousCards };
      });
    };

    const qKey = isPm ? getGetClientPmBoardQueryKey(token) : getGetClientBoardQueryKey(token);
    queryClient.setQueryData(qKey, (old: any) => {
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
          queryClient.invalidateQueries({ queryKey: qKey });
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
        ?.closest('[data-apple-lane-key]') as HTMLElement | null;
      const laneKey = laneEl?.dataset.appleLaneKey;
      if (laneKey) {
        if (!isPm && laneKey === 'done') {
          const c = board?.cards?.find(x => x.cardKey === s.cardKey);
          if (c && (c.template === 'job' || c.template === 'invoice' || c.template === 'request')) {
             toast({ title: "Cannot move to Done", description: "This card must be completed by the office.", variant: "destructive" });
             return;
          }
        }
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
      autoScrollPoint.current = { x: t.clientX, y: t.clientY };
      if (s.ghost) {
        s.ghost.style.left = `${t.clientX - s.offsetX}px`;
        s.ghost.style.top = `${t.clientY - s.offsetY}px`;
      }
      const laneEl = document
        .elementFromPoint(t.clientX, t.clientY)
        ?.closest('[data-apple-lane-key]') as HTMLElement | null;
      setDragOverLane(laneEl?.dataset.appleLaneKey ?? null);
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
      ghost.style.transform = 'scale(1.03)';
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

  const handleSelectTemplate = (template: AppleTemplate) => {
    setSelectedTemplate(template);
    setTemplateGalleryOpen(false);
    setFormOpen(true);
  };

  const handleFormBack = () => {
    setFormOpen(false);
    setTemplateGalleryOpen(true);
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setSelectedTemplate(null);
  };

  const handleNewCard = (laneKey?: string) => {
    if (viewer.readOnly) {
      onLoginRequired();
      return;
    }
    setDefaultLane(laneKey || (isPm ? 'todo' : 'requested'));
    setTemplateGalleryOpen(true);
  };

  const submitAiCard = (prompt: string) => {
    if (viewer.readOnly) {
      toast({ title: "Sign in required", description: "You are viewing as a guest.", variant: "destructive" });
      return;
    }
    if (!prompt.trim()) return;

    createAiCard.mutate(
      { token, data: { prompt } },
      {
        onSuccess: () => {
          toast({ title: "Card created" });
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          setAiPrompt('');
          setIsAiFocused(false);
        },
        onError: (err: any) => {
          if (err.status === 403) {
            toast({ title: "Access Denied", description: "Read-only viewers cannot create cards.", variant: "destructive" });
          } else {
            toast({ title: "Error", description: "HALO couldn't build this card right now.", variant: "destructive" });
          }
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#007AFF]" />
      </div>
    );
  }

  const cards = board?.cards || [];
  const lanes = board?.lanes || [];
  const hasCards = cards.length > 0;
  
  const templates = isPm ? PM_TEMPLATES : VENDOR_TEMPLATES;
  
  const title = isPm ? "Your property board" : "Archangel Operations";
  const desc = isPm 
    ? "Create cards from templates to organize work orders, leases, inspections, and more."
    : "Review service updates, invoices, quotes, and live tracker links.";

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[#fafafa]">
      {/* Optional AI Composer Header for Vendor Tab */}
      {!isPm && (
        <div className="px-6 py-4 border-b border-black/[0.06] bg-white shrink-0 flex items-center justify-between">
          <div className="flex-1 max-w-2xl relative">
            <div className={`flex items-center bg-[#f5f5f7] rounded-[14px] border transition-all duration-200 ${isAiFocused ? 'border-[#007AFF] shadow-sm bg-white' : 'border-transparent'}`}>
              <div className="pl-4">
                 {createAiCard.isPending ? <Loader2 className="h-5 w-5 text-[#007AFF] animate-spin" /> : <Sparkles className="h-5 w-5 text-[#007AFF]" />}
              </div>
              <input 
                type="text" 
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onFocus={() => setIsAiFocused(true)}
                onBlur={() => setTimeout(() => setIsAiFocused(false), 200)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    submitAiCard(aiPrompt);
                  }
                }}
                disabled={createAiCard.isPending}
                placeholder={createAiCard.isPending ? "HALO is building your card..." : "Ask HALO to build a card..."}
                className="flex-1 h-12 bg-transparent text-[15px] px-3 font-medium text-[#1d1d1f] placeholder:text-[#6e6e73] focus:outline-none disabled:opacity-50"
              />
              <button 
                disabled={createAiCard.isPending || !aiPrompt.trim()}
                onClick={() => submitAiCard(aiPrompt)}
                className="h-8 px-4 mr-2 bg-[#007AFF] text-white text-[13px] font-semibold rounded-[8px] hover:bg-[#0051D5] transition-colors disabled:opacity-50"
              >
                Send
              </button>
            </div>
            
            <AnimatePresence>
              {isAiFocused && !aiPrompt && !createAiCard.isPending && (
                <motion.div 
                  initial={{ opacity: 0, y: -5 }} 
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute top-full left-0 mt-2 flex flex-wrap gap-2 z-10"
                >
                  {["All my unpaid invoices", "Who's on site right now?", "Progress on my active job"].map((prompt, i) => (
                    <button 
                      key={i} 
                      onMouseDown={(e) => {
                        e.preventDefault();
                        submitAiCard(prompt);
                      }}
                      className="text-[12px] font-medium bg-white border border-black/[0.06] text-[#6e6e73] hover:text-[#1d1d1f] hover:border-black/[0.12] px-3 py-1.5 rounded-full shadow-sm"
                    >
                      {prompt}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          <div className="flex gap-3">
            {onOpenBirdseye && (
              <button
                onClick={onOpenBirdseye}
                className="flex items-center gap-1.5 h-12 px-4 rounded-[14px] bg-white border border-black/[0.06] text-[#1d1d1f] text-[14px] font-semibold hover:border-black/[0.12] hover:shadow-sm transition-all"
              >
                <MapIcon className="h-4.5 w-4.5 text-[#007AFF]" />
                Live Map
              </button>
            )}
            <button
              onClick={() => handleNewCard()}
              className="flex items-center gap-1.5 h-12 px-4 rounded-[14px] bg-[#007AFF] text-white text-[14px] font-semibold hover:bg-[#0051D5] shadow-sm hover:shadow-md transition-all active:scale-[0.98]"
            >
              <Plus className="h-4.5 w-4.5" />
              New Card
            </button>
          </div>
        </div>
      )}

      <main
        ref={boardScrollRef}
        className="flex-1 flex overflow-x-auto p-6 gap-4 bg-[#fafafa]"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {!hasCards && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto text-center px-6"
          >
            <div className="h-20 w-20 rounded-[20px] bg-[#007AFF]/10 flex items-center justify-center mb-6">
              <Plus className="h-10 w-10 text-[#007AFF]" strokeWidth={2.5} />
            </div>
            <h2 className="text-[28px] font-semibold text-[#1d1d1f] tracking-[-0.02em] mb-3">
              {title}
            </h2>
            <p className="text-[17px] text-[#6e6e73] leading-[1.4] mb-8">
              {desc}
            </p>
            <button
              onClick={() => handleNewCard()}
              className="h-12 px-6 rounded-[12px] bg-[#007AFF] text-white font-semibold text-[17px] shadow-sm hover:shadow-md hover:bg-[#0051D5] transition-all active:scale-[0.98]"
            >
              Create from template
            </button>
          </motion.div>
        )}

        {hasCards && lanes.map((lane: { key: string; label: string; description?: string }) => {
          const laneCards = cards
            .filter(c => c.lane === lane.key)
            .sort((a, b) => (a.position || 0) - (b.position || 0));
          const isOver = dragOverLane === lane.key;
          const color = DEFAULT_LANE_COLORS[lane.key] || '#8E8E93';

          return (
            <div
              key={lane.key}
              data-apple-lane-key={lane.key}
              data-testid={`lane-${lane.key}`}
              className={`flex shrink-0 flex-col w-[340px] rounded-[20px] transition-all ${
                isOver ? 'ring-2 ring-[#007AFF] ring-offset-2 ring-offset-[#fafafa]' : ''
              }`}
              onDragOver={(e) => handleDragOver(e, lane.key)}
              onDragLeave={(e) => handleDragLeave(e, lane.key)}
              onDrop={(e) => handleDrop(e, lane.key)}
            >
              {/* Lane Header */}
              <div className="flex flex-col gap-2 px-4 py-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <h2 className="text-[13px] font-semibold text-[#1d1d1f] tracking-wide uppercase">
                    {lane.label}
                  </h2>
                  <span className="flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-[#f5f5f7] text-[11px] font-semibold text-[#6e6e73]">
                    {laneCards.length}
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => handleNewCard(lane.key)}
                    className="h-6 w-6 rounded-full hover:bg-[#f5f5f7] transition-colors flex items-center justify-center"
                  >
                    <Plus className="h-4 w-4 text-[#6e6e73]" strokeWidth={2.5} />
                  </button>
                </div>
                {lane.description && (
                  <p className="text-[11px] text-[#6e6e73] font-normal">{lane.description}</p>
                )}
              </div>

              {/* Cards */}
              <div
                className="flex-1 overflow-y-auto apple-lane-scroll px-4 flex flex-col gap-3 min-h-[200px] pb-4"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                <AnimatePresence>
                  {laneCards.map((card) => (
                    <motion.div
                      key={card.cardKey}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      onTouchStart={(e) => handleTouchStart(e, card.cardKey)}
                      onClick={() => { if (!draggedCard) setDetailCard(card); }}
                    >
                      <AppleCard
                        card={card}
                        token={token}
                        readOnly={viewer.readOnly}
                        onDragStart={(e) => handleDragStart(e, card.cardKey)}
                        onDragEnd={(e) => handleDragEnd(e, card.cardKey)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>

                {laneCards.length === 0 && (
                  <div className="flex-1 flex items-center justify-center border-2 border-dashed border-black/[0.06] rounded-[18px] min-h-[120px]">
                    <p className="text-[13px] text-[#6e6e73] font-normal">Drop cards here</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </main>

      <AppleTemplateGallery
        open={templateGalleryOpen}
        onClose={() => setTemplateGalleryOpen(false)}
        onSelectTemplate={handleSelectTemplate}
        templates={templates}
      />

      <AppleCardForm
        token={token}
        template={selectedTemplate}
        open={formOpen}
        onClose={handleFormClose}
        onBack={handleFormBack}
        defaultLane={defaultLane}
        availableLanes={lanes}
        boardKey={boardKey}
      />

      {detailCard && (
        <CardDetailPanel
          card={detailCard}
          token={token}
          readOnly={viewer.readOnly}
          onClose={() => setDetailCard(null)}
        />
      )}
    </div>
  );
}