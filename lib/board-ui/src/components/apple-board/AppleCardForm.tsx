import React, { useState, useEffect } from 'react';
import { AppleTemplate, APPLE_CATEGORY_COLORS, APPLE_CATEGORY_TEXT } from './templates';
import { headerBase } from './contrast';
import { X, ArrowLeft } from 'lucide-react';

import { motion, AnimatePresence } from 'framer-motion';

interface AppleCardFormProps {
  template: AppleTemplate | null;
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  defaultLane?: string;
  availableLanes: { key: string; label: string }[];
  boardKey?: string; // 'pm' or undefined for vendor
  onSubmit: (data: any) => Promise<void>;
}

export function AppleCardForm({ template, open, onClose, onBack, defaultLane = 'todo', availableLanes, boardKey, onSubmit }: AppleCardFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [lane, setLane] = useState(defaultLane);
  const [checklist, setChecklist] = useState<string[]>([]);

  useEffect(() => {
    if (open && template) {
      setTitle('');
      setDescription('');
      setNotes('');
      setDueOn('');
      setLane(defaultLane);
      setChecklist(template.checklist || []);
      setIsSubmitting(false);
    }
  }, [open, template, defaultLane]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        template: template?.key || 'blank',
        lane,
        title: title.trim(),
        description: description.trim(),
        notes: notes.trim(),
        dueOn: dueOn || undefined,
        category: template?.category || 'blank',
        priority: template?.priority || 'normal',
        // Server contract: checklist items are {id, text, done} objects, not
        // bare strings — sending strings makes the create 400 with a blank
        // "Invalid input" for every template that ships a checklist.
        checklist: checklist.map((text) => ({
          id:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          text,
          done: false,
        })),
        labels: template?.labelPreset ? [template.labelPreset] : [],
        board: boardKey,
      });
      onClose();
    } catch (err) {
      // Error handling by parent
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!template) return null;

  const Icon = template.icon;
  const color = APPLE_CATEGORY_COLORS[template.category] || APPLE_CATEGORY_COLORS.blank;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative z-10 w-full max-w-2xl bg-[#fafafa] shadow-[0_20px_60px_rgba(0,0,0,0.12)] rounded-[24px] overflow-hidden m-4"
          >
            <form onSubmit={handleSubmit} className="flex flex-col max-h-[90vh]">
              {/* Header */}
          <div className="px-8 pt-8 pb-6 shrink-0 border-b border-black/[0.06]">
            <div className="flex items-start justify-between mb-4">
              <button
                type="button"
                onClick={onBack}
                className="h-8 w-8 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] transition-colors flex items-center justify-center"
              >
                <ArrowLeft className="h-4 w-4 text-[#1d1d1f]" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] transition-colors flex items-center justify-center"
              >
                <X className="h-4 w-4 text-[#1d1d1f]" />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div
                className="h-11 w-11 rounded-[12px] flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${color}15` }}
              >
                <Icon className="h-5 w-5" style={{ color }} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-[24px] font-semibold text-[#1d1d1f] tracking-[-0.02em]">
                  {template.name}
                </h2>
                <p className="text-[13px] text-[#6e6e73] font-normal">
                  {template.description}
                </p>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <div className="flex flex-col gap-6 max-w-xl">
              {/* Title */}
              <div className="flex flex-col gap-2">
                <label htmlFor="pm-title" className="text-[13px] font-semibold text-[#1d1d1f]">
                  Title
                </label>
                <input
                  id="pm-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`${template.name} for...`}
                  required
                  autoFocus
                  className="h-11 px-3 rounded-[10px] border border-black/[0.12] bg-white font-normal text-[15px] focus:outline-none focus:ring-1 focus:ring-[#007AFF] transition-all"
                  style={{ fontSize: '15px' }}
                />
              </div>

              {/* Lane */}
              <div className="flex flex-col gap-2">
                <label htmlFor="pm-lane" className="text-[13px] font-semibold text-[#1d1d1f]">
                  Status
                </label>
                <select
                  id="pm-lane"
                  value={lane}
                  onChange={(e) => setLane(e.target.value)}
                  className="h-11 rounded-[10px] border border-black/[0.12] bg-white px-3 text-[15px] font-normal focus:outline-none focus:ring-1 focus:ring-[#007AFF] focus:border-[#007AFF]"
                >
                  {availableLanes.map(l => (
                    <option key={l.key} value={l.key}>{l.label}</option>
                  ))}
                </select>
              </div>

              {/* Due Date */}
              <div className="flex flex-col gap-2">
                <label htmlFor="pm-due" className="text-[13px] font-semibold text-[#1d1d1f]">
                  Due Date <span className="text-[#6e6e73] font-normal">(Optional)</span>
                </label>
                <input
                  id="pm-due"
                  type="date"
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
                  className="h-11 px-3 rounded-[10px] border border-black/[0.12] bg-white font-normal text-[15px] w-full max-w-[200px] focus:outline-none focus:ring-1 focus:ring-[#007AFF] transition-all"
                />
              </div>

              {/* Checklist */}
              {checklist.length > 0 && (
                <div className="flex flex-col gap-2">
                  <label className="text-[13px] font-semibold text-[#1d1d1f]">
                    Checklist
                  </label>
                  <div className="flex flex-col gap-2 p-4 bg-white border border-black/[0.06] rounded-[12px]">
                    {checklist.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <div className="h-5 w-5 rounded-full border-2 border-[#d1d1d6] shrink-0 mt-0.5" />
                        <input
                          type="text"
                          value={item}
                          onChange={(e) => {
                            const updated = [...checklist];
                            updated[idx] = e.target.value;
                            setChecklist(updated);
                          }}
                          className="flex-1 text-[15px] font-normal text-[#1d1d1f] bg-transparent border-none outline-none p-0"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="flex flex-col gap-2">
                <label htmlFor="pm-desc" className="text-[13px] font-semibold text-[#1d1d1f]">
                  Description <span className="text-[#6e6e73] font-normal">(Optional)</span>
                </label>
                <textarea
                  id="pm-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add details about this card..."
                  className="rounded-[10px] p-3 min-h-[100px] border border-black/[0.12] bg-white font-normal text-[15px] resize-none focus:outline-none focus:ring-1 focus:ring-[#007AFF] transition-all"
                />
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-2">
                <label htmlFor="pm-notes" className="text-[13px] font-semibold text-[#1d1d1f]">
                  Internal Notes <span className="text-[#6e6e73] font-normal">(Optional)</span>
                </label>
                <textarea
                  id="pm-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Private notes for your team..."
                  className="rounded-[10px] p-3 min-h-[80px] border border-black/[0.12] bg-white font-normal text-[15px] resize-none focus:outline-none focus:ring-1 focus:ring-[#007AFF] transition-all"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-5 border-t border-black/[0.06] shrink-0 bg-white">
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="h-11 px-5 rounded-[10px] font-semibold text-[#007AFF] hover:bg-[#007AFF]/[0.08] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="h-11 px-6 rounded-[10px] font-semibold shadow-sm hover:shadow-md transition-all active:scale-[0.98] disabled:opacity-50"
                style={
                  (APPLE_CATEGORY_TEXT[template.category] ?? '#FFFFFF') === '#000000'
                    ? { backgroundColor: color, color: '#000000' }
                    : { backgroundColor: headerBase(color), color: '#FFFFFF' }
                }
              >
                {isSubmitting ? 'Creating...' : 'Create Card'}
              </button>
            </div>
          </div>
        </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
