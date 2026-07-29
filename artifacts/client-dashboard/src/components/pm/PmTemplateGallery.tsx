import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PM_TEMPLATES, PM_CATEGORY_COLORS, PmTemplate } from './pm-templates';
import { X } from 'lucide-react';

interface PmTemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: PmTemplate) => void;
}

export function PmTemplateGallery({ open, onClose, onSelectTemplate }: PmTemplateGalleryProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] p-0 overflow-hidden bg-[#fafafa] border-0 shadow-[0_20px_60px_rgba(0,0,0,0.12)] rounded-[24px]">
        <div className="flex flex-col h-full max-h-[85vh]">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 shrink-0 border-b border-black/[0.06]">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[28px] font-semibold text-[#1d1d1f] tracking-[-0.02em]">
                  New Card
                </h2>
                <p className="text-[15px] text-[#6e6e73] mt-1.5 font-normal">
                  Choose a template to get started
                </p>
              </div>
              <button
                onClick={onClose}
                className="h-8 w-8 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] transition-colors flex items-center justify-center"
              >
                <X className="h-4 w-4 text-[#1d1d1f]" />
              </button>
            </div>
          </div>

          {/* Template Grid */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PM_TEMPLATES.map((template) => {
                const Icon = template.icon;
                const color = PM_CATEGORY_COLORS[template.category];
                
                return (
                  <button
                    key={template.key}
                    onClick={() => onSelectTemplate(template)}
                    className="group flex flex-col text-left p-5 rounded-[18px] bg-white border border-black/[0.06] hover:border-black/[0.12] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="h-9 w-9 rounded-[10px] flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${color}15` }}
                      >
                        <Icon className="h-4.5 w-4.5" style={{ color }} strokeWidth={2.5} />
                      </div>
                      <span className="font-semibold text-[16px] text-[#1d1d1f] tracking-[-0.01em]">
                        {template.name}
                      </span>
                    </div>
                    <p className="text-[13px] text-[#6e6e73] leading-[1.4] font-normal">
                      {template.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
