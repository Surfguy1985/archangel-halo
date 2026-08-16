import React, { useState, useRef, useEffect } from 'react';
import { AppleCard } from './AppleCard';
import { AppleTemplateGallery } from './AppleTemplateGallery';
import { AppleCardForm } from './AppleCardForm';
import { PM_TEMPLATES, VENDOR_TEMPLATES, AppleTemplate } from './templates';
import { Plus, Loader2, Sparkles, Map as MapIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import '../commandSurface.css';

export interface AppleBoardData {
  lanes: Array<{ key: string; label: string; [key: string]: any }>;
  cards: any[];
}

export interface AppleBoardProps {
  board: AppleBoardData | undefined;
  token?: string;
  isLoading?: boolean;
  viewer: { readOnly: boolean; authenticated: boolean; permissions?: string[] };
  boardKey?: 'pm';
  onLoginRequired: () => void;
  onOpenBirdseye?: () => void;
  onCardClick: (card: any) => void;
  onCardMove: (cardKey: string, laneKey: string, dropIndex?: number) => void;
  onCreateAiCard?: (prompt: string) => Promise<void>;
  onCreateCard?: (data: any) => Promise<void>;
  onDispatchAction?: (action: any) => Promise<void>;
  /** When provided, each card shows a small trash icon that clears it into history. */
  onCardClear?: (card: any) => void;
  /** Which side of the card thread this viewer is on — picks which unread
   * message count lights up red on cards. Defaults to the client side. */
  viewerSide?: 'client' | 'office';
  showToast?: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
}

const DEFAULT_LANE_COLORS: Record<string, string> = {
  planning: 'rgba(255,255,255,0.35)',
  todo: '#B4FF44',
  doing: '#C9A227',
  done: 'rgba(255,255,255,0.45)',
  inbox: 'rgba(180,255,68,0.55)',
  requested: '#C23B22',
  scheduled: '#B4FF44',
  in_progress: '#C9A227',
  billing: 'rgba(255,255,255,0.35)',
};

export function AppleBoard({ 
  board, 
  token,
  isLoading, 
  viewer, 
  boardKey, 
  onLoginRequired, 
  onOpenBirdseye, 
  onCardClick, 
  onCardMove, 
  onCreateAiCard, 
  onCreateCard,
  showToast,
  onCardClear,
  viewerSide
}: AppleBoardProps) {
  const isPm = boardKey === 'pm';

  const [draggedCard, setDraggedCard] = useState<string | null>(null);
  const [dragOverLane, setDragOverLane] = useState<string | null>(null);
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<AppleTemplate | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [defaultLane, setDefaultLane] = useState('todo');

  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiFocused, setIsAiFocused] = useState(false);
  const [isAiSubmitting, setIsAiSubmitting] = useState(false);

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

  const performMove = (cardKey: string | null, laneKey: string, clientY: number) => {
    if (!cardKey || viewer.readOnly) {
      if (viewer.readOnly && showToast) {
        showToast({
          title: "Sign in required",
          description: "You are viewing as a guest. Sign in to make changes.",
          variant: "destructive"
        });
      }
      return;
    }

    // Mirror the server's card.moved gate exactly: only job:, crew: and
    // invoice: cards are barred from ENTERING Done (HALO moves them when the
    // work/payment actually completes). Reordering a card already in Done is
    // allowed, and every other card type (push:, request:, custom:) may move
    // to any lane on its board.
    if (!isPm && laneKey === 'done') {
      const card = board?.cards?.find((c: any) => c.cardKey === cardKey);
      const officeControlled =
        cardKey.startsWith('job:') || cardKey.startsWith('crew:') || cardKey.startsWith('invoice:');
      if (card && officeControlled && card.lane !== 'done') {
        if (showToast) {
          showToast({
            title: "Cannot move to Done",
            description: cardKey.startsWith('invoice:')
              ? "Invoices move to Done when payment clears in HALO."
              : "It moves when HALO confirms the work is complete.",
            variant: "destructive"
          });
        }
        return;
      }
    }

    const dropIndex = computeDropIndex(laneKey, clientY, cardKey);
    onCardMove(cardKey, laneKey, dropIndex);
  };

  const handleDrop = (e: React.DragEvent, laneKey: string) => {
    e.preventDefault();
    stopAutoScroll();
    setDragOverLane(null);
    performMove(draggedCard, laneKey, e.clientY);
    setDraggedCard(null);
  };

  // ---- Touch drag (mobile) ----------------------------------------------
  // HTML5 drag-and-drop is unavailable on iOS/Android browsers, so cards
  // support a long-press pointer drag on touch devices. Desktop keeps the
  // native DnD path untouched.
  const touchDrag = useRef<{ cardKey: string; startX: number; startY: number } | null>(null);

  const laneKeyAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-apple-lane-key]');
    return el?.getAttribute('data-apple-lane-key') ?? null;
  };

  const beginTouchDrag = (cardKey: string, x: number, y: number) => {
    touchDrag.current = { cardKey, startX: x, startY: y };
    setDraggedCard(cardKey);
    const el = document.getElementById(`card-${cardKey}`);
    if (el) {
      el.style.transition = 'none';
      el.style.zIndex = '50';
      el.style.position = 'relative';
      el.style.pointerEvents = 'none';
      el.style.transform = 'scale(1.04)';
      el.style.boxShadow = '0 12px 32px rgba(0,0,0,0.18)';
    }
    autoScrollPoint.current = { x, y };
    startAutoScroll();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch { /* noop */ }
    }
  };

  const moveTouchDrag = (x: number, y: number) => {
    const st = touchDrag.current;
    if (!st) return;
    autoScrollPoint.current = { x, y };
    const el = document.getElementById(`card-${st.cardKey}`);
    if (el) {
      el.style.transform = `translate(${x - st.startX}px, ${y - st.startY}px) scale(1.04) rotate(1.5deg)`;
    }
    setDragOverLane(laneKeyAt(x, y));
  };

  const endTouchDrag = (x: number, y: number, cancelled: boolean) => {
    const st = touchDrag.current;
    touchDrag.current = null;
    stopAutoScroll();
    setDragOverLane(null);
    setDraggedCard(null);
    if (!st) return;
    const el = document.getElementById(`card-${st.cardKey}`);
    if (el) {
      el.style.transition = '';
      el.style.zIndex = '';
      el.style.position = '';
      el.style.pointerEvents = '';
      el.style.transform = '';
      el.style.boxShadow = '';
    }
    if (!cancelled) {
      const laneKey = laneKeyAt(x, y);
      if (laneKey) performMove(st.cardKey, laneKey, y);
    }
  };

  const computeDropIndex = (laneKey: string, clientY: number, draggedKey: string): number => {
    const cards = board?.cards || [];
    const laneCards = cards
      .filter((c: any) => c.lane === laneKey && c.cardKey !== draggedKey)
      .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
    for (let i = 0; i < laneCards.length; i++) {
      const el = document.getElementById(`card-${laneCards[i].cardKey}`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return laneCards.length;
  };

  const handleCreateCard = async (data: any) => {
    if (onCreateCard) {
      await onCreateCard(data);
    }
  };

  const handleAiSubmit = async () => {
    if (!aiPrompt.trim() || !onCreateAiCard) return;
    setIsAiSubmitting(true);
    try {
      await onCreateAiCard(aiPrompt.trim());
      setAiPrompt('');
    } catch (err) {
      // handled by parent
    } finally {
      setIsAiSubmitting(false);
    }
  };

  const lanes = board?.lanes || [];
  const cards = board?.cards || [];
  const templates = isPm ? PM_TEMPLATES : VENDOR_TEMPLATES;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center cb-cmd-board">
        <Loader2 className="h-8 w-8 animate-spin text-[#B4FF44]" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col cb-cmd-board overflow-hidden">
      {/* AI Card Builder — only on vendor tab */}
      {!isPm && onCreateAiCard && (
        <div className="px-3 py-3 sm:px-5 sm:py-4 border-b border-white/[0.05]">
          <div
            className={`relative flex items-center gap-3 px-4 py-3 rounded-[16px] bg-white/[0.03] border transition-all ${
              isAiFocused ? 'border-[#B4FF44]/40' : 'border-white/[0.09]'
            }`}
          >
            <Sparkles className="h-5 w-5 text-[#B4FF44] shrink-0" />
            <input
              type="text"
              placeholder="Ask this board to build a card…"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onFocus={() => setIsAiFocused(true)}
              onBlur={() => setIsAiFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAiSubmit();
                }
              }}
              disabled={isAiSubmitting}
              className="flex-1 bg-transparent text-[15px] text-white/88 placeholder:text-white/35 focus:outline-none disabled:opacity-50"
            />
            {aiPrompt.length > 0 && (
              <button
                onClick={handleAiSubmit}
                disabled={isAiSubmitting}
                className="h-8 px-4 rounded-[8px] bg-[#B4FF44] text-[#07101E] text-[12px] font-semibold hover:brightness-105 active:scale-95 transition-all disabled:opacity-50"
              >
                {isAiSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Build'}
              </button>
            )}
          </div>
          
          {isAiFocused && aiPrompt.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex flex-wrap gap-2 mt-3"
            >
              {[
                'All my unpaid invoices',
                "Who's on site right now?",
                'Progress on my active job',
              ].map((sample) => (
                <button
                  key={sample}
                  onClick={() => setAiPrompt(sample)}
                  className="px-3 py-1.5 rounded-[10px] bg-white/[0.04] border border-white/[0.09] text-[12px] text-white/55 hover:text-white/85 hover:border-[#B4FF44]/30 transition-all"
                >
                  {sample}
                </button>
              ))}
            </motion.div>
          )}
        </div>
      )}

      {/* Lanes Container */}
      <main
        ref={boardScrollRef as any}
        className="flex-1 flex overflow-x-auto px-3 py-3 gap-3 snap-x snap-proximity sm:px-5 sm:py-4 sm:gap-4 sm:snap-none"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255, 255, 255, 0.18) transparent'
        }}
      >
        {lanes.map((lane: any) => {
          const laneColor = DEFAULT_LANE_COLORS[lane.key] || DEFAULT_LANE_COLORS.todo;
          const laneCards = cards
            .filter((c: any) => c.lane === lane.key)
            .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));

          return (
            <div
              key={lane.key}
              data-apple-lane-key={lane.key}
              data-testid={`lane-${lane.key}`}
              className={`cb-apple-lane flex shrink-0 flex-col w-[85vw] max-w-[340px] snap-start sm:w-[340px] sm:max-w-none sm:snap-align-none transition-all ${
                dragOverLane === lane.key ? 'ring-2 ring-[#B4FF44]/40' : ''
              }`}
              onDragOver={(e) => handleDragOver(e, lane.key)}
              onDragLeave={(e) => handleDragLeave(e, lane.key)}
              onDrop={(e) => handleDrop(e, lane.key)}
            >
              {/* Lane Header */}
              <div className="px-4 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: laneColor }}
                  />
                  <h3 className="text-[15px] font-semibold text-white/88 tracking-tight">
                    {lane.label}
                  </h3>
                  <span className="text-[13px] font-medium text-white/40">
                    {laneCards.length}
                  </span>
                </div>
                {(!viewer.readOnly || !viewer.authenticated) && (
                  <button
                    onClick={() => {
                      // Guests see the button too — tapping it prompts sign-in
                      // instead of silently hiding the ability to add cards.
                      if (viewer.readOnly) {
                        if (!viewer.authenticated && onLoginRequired) onLoginRequired();
                        else if (showToast) showToast({ title: 'Read-only access', description: 'Ask your property manager for edit access.' });
                        return;
                      }
                      setDefaultLane(lane.key);
                      setTemplateGalleryOpen(true);
                    }}
                    className="cb-ios-orb h-9 w-9 sm:h-8 sm:w-8 flex items-center justify-center"
                    title="Add card"
                  >
                    <Plus className="h-4 w-4 text-white/80" />
                  </button>
                )}
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2.5 apple-lane-scroll">
                <AnimatePresence mode="popLayout">
                  {laneCards.map((card: any) => (
                    <AppleCard
                      key={card.cardKey}
                      card={card}
                      token={token}
                      audience={isPm ? 'pm' : 'vendor'}
                      viewerSide={viewerSide}
                      isDragged={draggedCard === card.cardKey}
                      readOnly={viewer.readOnly}
                      onReadOnlyClick={() => {
                        if (!viewer.authenticated) onLoginRequired();
                        else if (showToast) showToast({ title: 'Read-only access', description: 'Ask your property manager for edit access.' });
                      }}
                      onDragStart={(e) => handleDragStart(e, card.cardKey)}
                      onDragEnd={(e) => handleDragEnd(e, card.cardKey)}
                      onTouchDragBegin={(x, y) => beginTouchDrag(card.cardKey, x, y)}
                      onTouchDragMove={moveTouchDrag}
                      onTouchDragEnd={endTouchDrag}
                      onClick={() => onCardClick(card)}
                      onClear={onCardClear ? () => onCardClear(card) : undefined}
                    />
                  ))}
                </AnimatePresence>
                {laneCards.length === 0 && (
                  <div className="flex items-center justify-center h-24 text-[13px] text-white/35 font-medium">
                    No cards
                  </div>
                )}
              </div>

              {onOpenBirdseye && lane.key === 'in_progress' && !isPm && (
                <div className="px-4 pb-3">
                  <button
                    onClick={onOpenBirdseye}
                    className="w-full h-10 px-4 rounded-[12px] bg-white/[0.04] border border-white/[0.09] text-[#B4FF44] text-[13px] font-semibold hover:bg-white/[0.07] transition-all flex items-center justify-center gap-2"
                  >
                    <MapIcon className="h-4 w-4" />
                    View Live Map
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </main>

      <AppleTemplateGallery
        open={templateGalleryOpen}
        onClose={() => setTemplateGalleryOpen(false)}
        onSelectTemplate={(t) => {
          setSelectedTemplate(t);
          setTemplateGalleryOpen(false);
          setFormOpen(true);
        }}
        templates={templates}
      />

      <AppleCardForm
        template={selectedTemplate}
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setSelectedTemplate(null);
        }}
        onBack={() => {
          setFormOpen(false);
          setTemplateGalleryOpen(true);
        }}
        defaultLane={defaultLane}
        availableLanes={lanes}
        boardKey={boardKey}
        onSubmit={handleCreateCard}
      />
    </div>
  );
}
