import React from 'react';
import { APPLE_CATEGORY_COLORS, PM_TEMPLATES, VENDOR_TEMPLATES } from './templates';
import { MessageSquare, Calendar, Wrench, FileText, FileSearch, HardHat, FileSignature, Layers } from 'lucide-react';
import { formatDistanceToNow, parseISO, isBefore, startOfDay } from 'date-fns';
import { ModuleMetrics, ModuleEvidence, ModuleDecision } from '../kanban/BoardCardModules';

interface AppleCardProps {
  card: any;
  readOnly?: boolean;
  isDragged?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onClick?: () => void;
  token?: string;
}

export function AppleCard({ card, readOnly, isDragged, onDragStart, onDragEnd, onClick, token }: AppleCardProps) {
  // Find template across both PM and Vendor
  let template = PM_TEMPLATES.find(t => t.key === card.template) 
              || VENDOR_TEMPLATES.find(t => t.key === card.template);

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

  return (
    <div
      id={`card-${card.cardKey}`}
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="flex flex-col p-4 bg-white border border-black/[0.06] rounded-[18px] hover:border-black/[0.12] hover:shadow-[0_4px_20px_rgba(0,0,0,0.08)] transition-all cursor-pointer active:scale-[0.98]"
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="h-8 w-8 rounded-[10px] flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="h-4 w-4" style={{ color }} strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] leading-[1.3] line-clamp-2 tracking-[-0.01em]">
            {card.title}
          </h3>
          {card.subtitle && (
            <p className="text-[12px] text-[#6e6e73] font-medium line-clamp-1 mt-0.5">
              {card.subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Modules (if any) */}
      {card.module && (
        <div className="mb-3 space-y-2">
          <ModuleMetrics module={card.module} tint={{ bd: '#f5f5f7' }} />
          <ModuleEvidence module={card.module} tint={{ bg: '#fafafa', border: '#e8e8ed', hairline: '#e8e8ed', bd: '#e8e8ed' }} />
          {!readOnly && token && card.actions && card.actions.length > 0 && (
            <ModuleDecision cardKey={card.cardKey} token={token} module={card.module} readOnly={!!readOnly} tint={{ bd: '#e8e8ed' }} />
          )}
        </div>
      )}

      {/* Category / Labels */}
      {(template.labelPreset || (card.labels && card.labels.length > 0)) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {template.labelPreset && (
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide"
              style={{ backgroundColor: `${color}15`, color: color }}
            >
              {template.labelPreset}
            </span>
          )}
          {card.labels?.filter((l: any) => l !== template?.labelPreset).map((lbl: any, idx: number) => (
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
                style={{
                  width: `${checklistProgress}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 mt-auto pt-2">
        {/* Priority Dot */}
        <div
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: priorityDot }}
        />

        {/* Due Date */}
        {(card.dueOn || card.scheduledOn) && (
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              isPastDue
                ? 'bg-[#FF3B30]/10 text-[#FF3B30]'
                : 'bg-[#f5f5f7] text-[#6e6e73]'
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

        {/* Comment Count */}
        {(card.commentCount ?? 0) > 0 && (
          <div className="flex items-center gap-1 text-[#6e6e73]">
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span className="text-[12px] font-medium">{card.commentCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}
