import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCreateClientBoardCard, getGetClientPmBoardQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { PmTemplate, PM_CATEGORY_COLORS } from './pm-templates';
import { X, ArrowLeft } from 'lucide-react';

interface PmCardFormProps {
  token: string;
  template: PmTemplate | null;
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  defaultLane?: string;
}

export function PmCardForm({ token, template, open, onClose, onBack, defaultLane = 'todo' }: PmCardFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCard = useCreateClientBoardCard();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [lane, setLane] = useState(defaultLane);
  const [checklist, setChecklist] = useState<string[]>([]);

  const mutateFnRef = useRef(createCard.mutate);
  mutateFnRef.current = createCard.mutate;

  useEffect(() => {
    if (open && template) {
      setTitle('');
      setDescription('');
      setNotes('');
      setDueOn('');
      setLane(defaultLane);
      setChecklist(template.checklist || []);
    }
  }, [open, template, defaultLane]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!template) return;

    const checklistItems = checklist.filter(Boolean).map((text, idx) => ({ 
      id: `temp-${idx}`, 
      text, 
      done: false 
    }));

    mutateFnRef.current({
      token,
      data: {
        board: 'pm',
        title,
        lane,
        template: template.key,
        description: description || undefined,
        notes: notes || undefined,
        priority: template.priority,
        dueOn: dueOn || undefined,
        labels: template.labelPreset ? [template.labelPreset] : undefined,
        checklist: checklistItems.length > 0 ? checklistItems : undefined,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Card created" });
        queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        onClose();
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to create card", variant: "destructive" });
      }
    });
  };

  if (!template) return null;

  const Icon = template.icon;
  const color = PM_CATEGORY_COLORS[template.category];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] p-0 overflow-hidden bg-[#fafafa] border-0 shadow-[0_20px_60px_rgba(0,0,0,0.12)] rounded-[24px]">
        <form onSubmit={handleSubmit} className="flex flex-col h-full max-h-[90vh]">
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
                <Input
                  id="pm-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`${template.name} for...`}
                  required
                  autoFocus
                  className="h-11 rounded-[10px] border-black/[0.12] bg-white font-normal text-[15px] focus-visible:ring-1 focus-visible:ring-offset-0"
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
                  <option value="planning">Planning</option>
                  <option value="todo">To Do</option>
                  <option value="doing">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>

              {/* Due Date */}
              <div className="flex flex-col gap-2">
                <label htmlFor="pm-due" className="text-[13px] font-semibold text-[#1d1d1f]">
                  Due Date <span className="text-[#6e6e73] font-normal">(Optional)</span>
                </label>
                <Input
                  id="pm-due"
                  type="date"
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
                  className="h-11 rounded-[10px] border-black/[0.12] bg-white font-normal text-[15px] w-full max-w-[200px] focus-visible:ring-1 focus-visible:ring-offset-0"
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
                <Textarea
                  id="pm-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add details about this card..."
                  className="rounded-[10px] min-h-[100px] border-black/[0.12] bg-white font-normal text-[15px] resize-none focus-visible:ring-1 focus-visible:ring-offset-0"
                />
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-2">
                <label htmlFor="pm-notes" className="text-[13px] font-semibold text-[#1d1d1f]">
                  Internal Notes <span className="text-[#6e6e73] font-normal">(Optional)</span>
                </label>
                <Textarea
                  id="pm-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Private notes for your team..."
                  className="rounded-[10px] min-h-[80px] border-black/[0.12] bg-white font-normal text-[15px] resize-none focus-visible:ring-1 focus-visible:ring-offset-0"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-5 border-t border-black/[0.06] shrink-0 bg-white">
            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                className="h-11 px-5 rounded-[10px] font-semibold text-[#007AFF] hover:bg-[#007AFF]/[0.08] hover:text-[#007AFF]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createCard.isPending}
                className="h-11 px-6 rounded-[10px] font-semibold shadow-sm hover:shadow-md transition-all active:scale-[0.98]"
                style={{ backgroundColor: color }}
              >
                {createCard.isPending ? 'Creating...' : 'Create Card'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
