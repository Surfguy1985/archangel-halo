import React, { useState, useRef, useEffect } from 'react';
import { AppleCard } from './AppleCard';
import { AppleTemplateGallery } from './AppleTemplateGallery';
import { AppleCardForm } from './AppleCardForm';
import { PM_TEMPLATES, VENDOR_TEMPLATES, AppleTemplate } from './templates';
import { Plus, Loader2, Sparkles, Map as MapIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface AppleBoardData {
  lanes: Array<{ key: string; label: string; [key: string]: any }>;
  cards: any[];
}

export interface AppleBoardProps {
  board: AppleBoardData | undefined;
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
  showToast?: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
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

export function AppleBoard({ 
  board, 
  isLoading, 
  viewer, 
  boardKey, 
  onLoginRequired, 
  onOpenBirdseye, 
  onCardClick, 
  onCardMove, 
  onCreateAiCard, 
  onCreateCard,
  showToast
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

  const handleDrop = (e: React.DragEvent, laneKey: string) => {
    e.preventDefault();
    stopAutoScroll();
    setDragOverLane(null);
    if (!draggedCard || viewer.readOnly) {
      if (viewer.readOnly && showToast) {
        showToast({
          title: "Sign in required",
          description: "You are viewing as a guest. Sign in to make changes.",
          variant: "destructive"
        });
      }
      return;
    }
    
    if (!isPm && laneKey === 'done') {
      const card = board?.cards?.find((c: any) => c.cardKey === draggedCard);
      if (card && (card.template === 'job' || card.template === 'invoice' || card.template === 'request')) {
        if (showToast) {
          showToast({
            title: "Cannot move to Done",
            description: "This card must be completed by the office.",
            variant: "destructive"
          });
        }
        return;
      }
    }
    
    const dropIndex = computeDropIndex(laneKey, e.clientY, draggedCard);
    onCardMove(draggedCard, laneKey, dropIndex);
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
      <div className="flex-1 flex items-center justify-center bg-[#fafafa]">
        <Loader2 className="h-8 w-8 animate-spin text-[#007AFF]" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#fafafa] overflow-hidden">
      {/* AI Card Builder — only on vendor tab */}
      {!isPm && onCreateAiCard && (
        <div className="px-5 py-4 bg-white border-b border-black/[0.06]">
          <div
            className={`relative flex items-center gap-3 px-4 py-3 rounded-[16px] bg-gradient-to-r from-[#007AFF]/5 to-[#5856D6]/5 border transition-all ${
              isAiFocused ? 'border-[#007AFF]/40 shadow-[0_0_0_4px_rgba(0,122,255,0.08)]' : 'border-black/[0.06]'
            }`}
          >
            <Sparkles className="h-5 w-5 text-[#007AFF] shrink-0" />
            <input
              type="text"
              placeholder="Ask HALO to build a card..."
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
              className="flex-1 bg-transparent text-[15px] text-[#1d1d1f] placeholder:text-[#8E8E93] focus:outline-none disabled:opacity-50"
            />
            {aiPrompt.length > 0 && (
              <button
                onClick={handleAiSubmit}
                disabled={isAiSubmitting}
                className="h-8 px-4 rounded-[8px] bg-[#007AFF] text-white text-[12px] font-semibold hover:bg-[#0051D5] active:scale-95 transition-all disabled:opacity-50"
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
                'Who's on site right now?',
                'Progress on my active job',
              ].map((sample) => (
                <button
                  key={sample}
                  onClick={() => setAiPrompt(sample)}
                  className="px-3 py-1.5 rounded-[10px] bg-white border border-black/[0.08] text-[12px] text-[#6e6e73] hover:text-[#1d1d1f] hover:border-[#007AFF]/30 transition-all"
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
        className="flex-1 flex overflow-x-auto px-5 py-4 gap-4"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.2) transparent'
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
              className={`flex shrink-0 flex-col w-[340px] rounded-[20px] transition-all ${
                dragOverLane === lane.key ? 'bg-black/[0.02] ring-2 ring-[#007AFF]/30' : ''
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
                  <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
                    {lane.label}
                  </h3>
                  <span className="text-[13px] font-medium text-[#8E8E93]">
                    {laneCards.length}
                  </span>
                </div>
                {!viewer.readOnly && (
                  <button
                    onClick={() => {
                      setDefaultLane(lane.key);
                      setTemplateGalleryOpen(true);
                    }}
                    className="h-7 w-7 rounded-[8px] bg-black/[0.04] hover:bg-black/[0.08] transition-colors flex items-center justify-center"
                    title="Add card"
                  >
                    <Plus className="h-4 w-4 text-[#1d1d1f]" />
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
                      isDragged={draggedCard === card.cardKey}
                      readOnly={viewer.readOnly}
                      onDragStart={(e) => handleDragStart(e, card.cardKey)}
                      onDragEnd={(e) => handleDragEnd(e, card.cardKey)}
                      onClick={() => onCardClick(card)}
                    />
                  ))}
                </AnimatePresence>
                {laneCards.length === 0 && (
                  <div className="flex items-center justify-center h-24 text-[13px] text-[#8E8E93] font-medium">
                    No cards
                  </div>
                )}
              </div>

              {onOpenBirdseye && lane.key === 'in_progress' && !isPm && (
                <div className="px-4 pb-3">
                  <button
                    onClick={onOpenBirdseye}
                    className="w-full h-10 px-4 rounded-[12px] bg-gradient-to-r from-emerald-500/10 to-emerald-600/10 border border-emerald-500/20 text-emerald-700 text-[13px] font-semibold hover:from-emerald-500/15 hover:to-emerald-600/15 transition-all flex items-center justify-center gap-2"
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
