import React from 'react';
import { motion } from 'framer-motion';
import { APPLE_CATEGORY_COLORS, APPLE_CATEGORY_TEXT, resolveTemplate, type BoardAudience } from './templates';
import { MessageSquare, Calendar, Wrench, FileText, FileSearch, HardHat, FileSignature, Layers, Trash2 } from 'lucide-react';
import { formatDistanceToNow, parseISO, isBefore, startOfDay } from 'date-fns';
import { ModuleMetrics, ModuleEvidence, ModuleDecision } from '../kanban/BoardCardModules';
import { ModuleBoundary } from '../kanban/ModuleBoundary';
import { WaybillStrip } from '../card/WaybillStrip';

// Falkon face for every card, color-coded by service: the template category
// drives the header gradient, while the network strip stays uniform.
const SERVICE_LABELS: Record<string, string> = {
  maintenance: 'Maintenance',
  lease: 'Leasing',
  rent: 'Rent',
  move: 'Move',
  coordination: 'Coordination',
  vendor: 'Vendor',
  billing: 'Billing',
  access: 'Access',
  blank: 'General',
};

import { shade, headerBase } from './contrast';

interface AppleCardProps {
  card: any;
  readOnly?: boolean;
  onReadOnlyClick?: () => void;
  isDragged?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onTouchDragBegin?: (x: number, y: number) => void;
  onTouchDragMove?: (x: number, y: number) => void;
  onTouchDragEnd?: (x: number, y: number, cancelled: boolean) => void;
  onClick?: () => void;
  token?: string;
  audience?: BoardAudience;
  /** When provided, renders a small trash icon that clears the card into history. */
  onClear?: () => void;
  /** Which side of the card thread this viewer is on. Defaults to client. */
  viewerSide?: 'client' | 'office';
}

export function AppleCard({ card, readOnly, isDragged, onDragStart, onDragEnd, onTouchDragBegin, onTouchDragMove, onTouchDragEnd, onClick, token, onReadOnlyClick, audience, onClear, viewerSide }: AppleCardProps) {
  // Long-press touch drag: HTML5 DnD doesn't exist on mobile browsers.
  // Hold ~250ms to lift the card; moving early is treated as a scroll.
  const justDragged = React.useRef(false);
  const gestureCleanup = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => gestureCleanup.current?.(), []);
  const handleTouchStart = (e: React.TouchEvent) => {
    if (readOnly || !onTouchDragBegin) return;
    const t = e.touches[0];
    if (!t) return;
    const startX = t.clientX;
    const startY = t.clientY;
    let active = false;
    const timer = setTimeout(() => {
      active = true;
      onTouchDragBegin(startX, startY);
    }, 250);
    const detach = () => {
      clearTimeout(timer);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', cancel);
      gestureCleanup.current = null;
    };
    const move = (ev: TouchEvent) => {
      const tt = ev.touches[0];
      if (!tt) return;
      if (!active) {
        // Finger moved before the long-press fired — it's a scroll.
        if (Math.hypot(tt.clientX - startX, tt.clientY - startY) > 8) detach();
        return;
      }
      if (ev.cancelable) ev.preventDefault();
      onTouchDragMove?.(tt.clientX, tt.clientY);
    };
    const end = (ev: TouchEvent) => {
      const tt = ev.changedTouches[0];
      detach();
      if (active) {
        justDragged.current = true;
        setTimeout(() => { justDragged.current = false; }, 400);
        onTouchDragEnd?.(tt?.clientX ?? startX, tt?.clientY ?? startY, false);
      }
    };
    const cancel = () => {
      detach();
      if (active) onTouchDragEnd?.(startX, startY, true);
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', cancel);
    // Unmount-safe: if the card disappears mid-gesture, listeners still go away.
    gestureCleanup.current = () => {
      detach();
      if (active) onTouchDragEnd?.(startX, startY, true);
    };
  };
  // Resolve against the viewer's own catalog first — `unit_turnover` and
  // `blank` exist in both PM and Vendor with different styling.
  let template = resolveTemplate(card.template, audience);

  // If not found (e.g. HALO-generated card like 'invoice' or 'crew'), use fallback
  if (!template) {
    let fallbackCategory: any = 'blank';
    let fallbackIcon = Layers;
    let fallbackName = card.title;
    
    switch (card.template) {
      case 'invoice': fallbackCategory = 'billing'; fallbackIcon = FileText; break;
      case 'crew': fallbackCategory = 'coordination'; fallbackIcon = HardHat; break;
      case 'request': fallbackCategory = 'maintenance'; fallbackIcon = Wrench; break;
      case 'makeready': fallbackCategory = 'maintenance'; fallbackIcon = FileSignature; break;
      case 'job': fallbackCategory = 'maintenance'; fallbackIcon = Wrench; break;
      // Office-pushed cards ("push_<kind>") — color-code by what they carry.
      case 'push_invoice':
      case 'push_invoice_batch': fallbackCategory = 'billing'; fallbackIcon = FileText; break;
      case 'push_bid': fallbackCategory = 'rent'; fallbackIcon = FileSignature; break;
      case 'push_flag': fallbackCategory = 'vendor'; fallbackIcon = Wrench; break;
      case 'push_photos': fallbackCategory = 'move'; fallbackIcon = FileSearch; break;
      case 'push_summary': fallbackCategory = 'lease'; fallbackIcon = FileSearch; break;
      case 'push_crewmap': fallbackCategory = 'coordination'; fallbackIcon = HardHat; break;
      case 'push_document': fallbackCategory = 'access'; fallbackIcon = FileText; break;
      case 'push_note': fallbackCategory = 'coordination'; fallbackIcon = MessageSquare; break;
      case 'push_referral': fallbackCategory = 'lease'; fallbackIcon = MessageSquare; break;
      default: fallbackCategory = 'blank'; fallbackIcon = Layers; break;
    }

    template = {
      key: card.template,
      name: fallbackName,
      icon: fallbackIcon,
      description: '',
      category: fallbackCategory,
      priority: 'normal'
    };
  }

  const Icon = template.icon;
  const color = APPLE_CATEGORY_COLORS[template.category] || APPLE_CATEGORY_COLORS.blank;

  const checkedCount = card.checklist?.filter((c: any) => c.done).length || 0;
  const totalCount = card.checklist?.length || 0;
  const checklistProgress = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;

  const isPastDue = card.dueOn && isBefore(parseISO(card.dueOn), startOfDay(new Date()));

  const priorityColors: Record<string, string> = {
    urgent: '#FF3B30',
    high: '#FF9500',
    normal: '#8E8E93',
    medium: '#8E8E93',
    low: '#C7C7CC',
  };

  const priorityDot = priorityColors[card.priority || 'normal'] || priorityColors.normal;

  const waybill = card.waybill as { stages: Array<{ stage: string; at: string; byLabel?: string | null }>; holder?: string; live?: boolean } | undefined;

  // ── Falkon face for EVERY card: two-tone scheme — lime tiles carry BLACK
  // header text on the raw lime; blue tiles carry WHITE text over a baby-blue
  // gradient. The network strip stays uniform across both.
  const headerText = APPLE_CATEGORY_TEXT[template.category] ?? '#FFFFFF';
  const darkText = headerText === '#000000';
  // White-text tiles run dark→light (135deg) so the header text (top-left)
  // always sits on the deep end while the tile still reads baby blue.
  const gradient = darkText
    ? `linear-gradient(135deg, ${color}, ${shade(color, -0.12)})`
    : `linear-gradient(135deg, ${shade(color, -0.42)}, ${color})`;
  const serviceLabel = template.labelPreset || SERVICE_LABELS[template.category] || template.category;

  // ── Lane-move landing glow ────────────────────────────────────────────
  // When an SSE update re-parents this card into a new lane, framer-motion's
  // shared layout (layoutId) glides it across the board instead of teleporting.
  // On top of the glide we flash a subtle scale/glow highlight for ~1s so the
  // eye lands on where the card went. First mount is baselined silently.
  const prevLane = React.useRef<string | null>(null);
  const [landed, setLanded] = React.useState(false);
  React.useEffect(() => {
    const lane = card.lane ?? null;
    if (prevLane.current !== null && prevLane.current !== lane) {
      setLanded(true);
      const t = setTimeout(() => setLanded(false), 1000);
      prevLane.current = lane;
      return () => clearTimeout(t);
    }
    prevLane.current = lane;
    return undefined;
  }, [card.lane]);

  // Invoice ready for payment: flash a green border until the client picks
  // how they'll pay (check in the mail / their payment platform).
  const cardModule: any = card?.module ?? null;
  const invoiceReady =
    !!cardModule &&
    cardModule.type === 'invoice' &&
    String(cardModule.status ?? '').toLowerCase() !== 'paid' &&
    !cardModule.paymentChoice &&
    !cardModule.clientPaidAt;

  return (
    <motion.div
      id={`card-${card.cardKey}`}
      // Shared-layout: a card keeps its identity across lanes, so a re-parent
      // animates as a glide. Disabled mid-drag so the touch-drag inline
      // transforms (set directly on this node in AppleBoard) aren't fought.
      layout={isDragged ? false : 'position'}
      layoutId={`card-${card.cardKey}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{
        opacity: 1,
        scale: 1,
        boxShadow: landed
          ? '0 0 0 3px rgba(180,255,68,0.55), 0 8px 28px rgba(0,0,0,0.16)'
          : '0 0 0 0px rgba(180,255,68,0), 0 0px 0px rgba(0,0,0,0)',
      }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        layout: { type: 'spring', stiffness: 550, damping: 42 },
        boxShadow: { duration: landed ? 0.25 : 0.5 },
        default: { duration: 0.18 },
      }}
      draggable={!readOnly}
      /* Native HTML5 drag handlers, not framer-motion's pan-drag — motion.div's
         prop types only know the latter, so cast through. */
      onDragStart={onDragStart as unknown as React.ComponentProps<typeof motion.div>['onDragStart']}
      onDragEnd={onDragEnd as unknown as React.ComponentProps<typeof motion.div>['onDragEnd']}
      onTouchStart={handleTouchStart}
      onClick={() => {
        if (justDragged.current) return; // swallow the tap that ends a touch drag
        onClick?.();
      }}
      className={`flex flex-col border rounded-[18px] hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] transition-shadow cursor-pointer active:scale-[0.98] max-sm:select-none overflow-hidden relative bg-white${invoiceReady ? ' animate-pulse ring-2 ring-emerald-500' : ''}`}
      style={{ WebkitTouchCallout: 'none', borderColor: invoiceReady ? '#10b981' : `${color}40` } as React.CSSProperties}
      data-invoice-ready={invoiceReady ? 'true' : undefined}
    >
      {/* Branded header — service color owns the gradient; black text on lime, white on blue */}
      <div
        className="px-4 pt-3 pb-3"
        style={{
          backgroundImage: gradient,
          color: headerText,
          // White text can cross the gradient's lighter end — a soft shadow
          // keeps it readable across the full header width.
          textShadow: darkText ? undefined : '0 1px 2px rgba(0,0,0,.3)',
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="w-6 h-6 rounded-[7px] border-[1.5px] grid place-items-center shrink-0"
            style={darkText ? { borderColor: '#0B1428', color: '#0B1428' } : { borderColor: '#B4FF44', color: '#B4FF44' }}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          <span
            className="text-[9px] font-extrabold tracking-[.09em] uppercase px-2 py-[3px] rounded-md"
            style={darkText ? { background: 'rgba(11,20,40,.12)' } : { background: 'rgba(255,255,255,.2)' }}
          >
            {serviceLabel}
          </span>
          <span
            className="ml-auto inline-flex items-center gap-1 text-[9px] font-bold px-2 py-[3px] rounded-md whitespace-nowrap"
            style={darkText ? { background: 'rgba(11,20,40,.85)', color: '#B4FF44' } : { background: 'rgba(11,20,40,.42)', color: '#B4FF44' }}
          >
            Sealed to you
          </span>
        </div>
        <h3 className="text-[15px] font-bold leading-[1.25] tracking-[-0.02em] mt-2 line-clamp-2">{card.title}</h3>
        {card.subtitle && <p className="text-[11px] leading-[1.4] opacity-85 mt-0.5 line-clamp-1">{card.subtitle}</p>}
      </div>

      {/* Network waybill — six live dots synced to the card's lane */}
      {waybill && (
        <div className="px-2 pt-2">
          <WaybillStrip code={card.waybillCode} stages={waybill.stages} holder={waybill.holder} live={waybill.live !== false} />
        </div>
      )}

      <div className="flex flex-col flex-1 p-4 pt-3">
        {/* Modules (if any) */}
        {card.module && (
          <div className="mb-3 space-y-2">
            <ModuleBoundary module={card.module} surface="metrics" links={card.links}>
              <ModuleMetrics module={card.module} tint={{ bd: '#f5f5f7' }} />
            </ModuleBoundary>
            <ModuleBoundary module={card.module} surface="evidence">
              <ModuleEvidence module={card.module} tint={{ bg: '#fafafa', border: '#e8e8ed', hairline: '#e8e8ed', bd: '#e8e8ed' }} />
            </ModuleBoundary>
            {/* Rendered for read-only viewers too — tapping an action prompts
                sign-in via onReadOnlyClick instead of hiding the buttons. */}
            {token && card.actions && card.actions.length > 0 && (
              <ModuleBoundary module={card.module} surface="decision">
                <ModuleDecision cardKey={card.cardKey} token={token} module={card.module} readOnly={!!readOnly} onReadOnlyClick={onReadOnlyClick} tint={{ bd: '#e8e8ed' }} />
              </ModuleBoundary>
            )}
          </div>
        )}

        {/* Client labels (service chip moved into the header) */}
        {card.labels && card.labels.filter((l: any) => l !== template?.labelPreset).length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {card.labels.filter((l: any) => l !== template?.labelPreset).map((lbl: any, idx: number) => (
              <span
                key={idx}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide bg-[#f5f5f7] text-[#6e6e73]"
              >
                {lbl}
              </span>
            ))}
          </div>
        )}

        {/* Checklist Progress */}
        {totalCount > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[12px] font-medium text-[#6e6e73]">
                {checkedCount}/{totalCount}
              </span>
              <div className="flex-1 h-1.5 bg-[#f5f5f7] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${checklistProgress}%`, backgroundColor: color }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 mt-auto pt-1">
          <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: priorityDot }} />
          {(card.dueOn || card.scheduledOn) && (
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                isPastDue ? 'bg-[#FF3B30]/10 text-[#FF3B30]' : 'bg-[#f5f5f7] text-[#6e6e73]'
              }`}
            >
              <Calendar className="h-3 w-3" strokeWidth={2.5} />
              <span>
                {card.scheduledOn
                  ? `Sched ${formatDistanceToNow(parseISO(card.scheduledOn), { addSuffix: true })}`
                  : formatDistanceToNow(parseISO(card.dueOn!), { addSuffix: true })}
              </span>
            </div>
          )}
          <div className="flex-1" />
          {(() => {
            // Unread messages from the OTHER side of the thread: the office
            // mirror watches client messages, everyone else watches office
            // replies. Red badge = unread; gray = thread exists, all read.
            const unread =
              viewerSide === 'office'
                ? (card.unreadFromClient ?? 0)
                : (card.unreadComments ?? 0);
            if (unread > 0) {
              return (
                <div
                  className="flex items-center gap-1 rounded-full bg-[#FF3B30] px-2 py-0.5 text-white"
                  data-testid={`badge-unread-${card.cardKey}`}
                >
                  <MessageSquare className="h-3 w-3" strokeWidth={2.5} />
                  <span className="text-[11px] font-bold">{unread}</span>
                </div>
              );
            }
            if ((card.commentCount ?? 0) > 0) {
              return (
                <div className="flex items-center gap-1 text-[#6e6e73]">
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.5} />
                  <span className="text-[12px] font-medium">{card.commentCount}</span>
                </div>
              );
            }
            return null;
          })()}
          {onClear && (
            <button
              type="button"
              data-testid={`button-clear-card-${card.cardKey}`}
              title="Clear card (saved to History)"
              onClick={(e) => {
                e.stopPropagation();
                if (readOnly) {
                  onReadOnlyClick?.();
                  return;
                }
                onClear();
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full text-[#a1a1a6] hover:text-[#FF3B30] hover:bg-[#FF3B30]/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
