import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { APPLE_CATEGORY_COLORS, AppleTemplate } from './templates';
import { X } from 'lucide-react';

interface AppleTemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: AppleTemplate) => void;
  templates: AppleTemplate[];
}

export function AppleTemplateGallery({ open, onClose, onSelectTemplate, templates }: AppleTemplateGalleryProps) {
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
            className="relative z-10 w-full max-w-3xl bg-[#fafafa] shadow-[0_20px_60px_rgba(0,0,0,0.12)] rounded-[24px] overflow-hidden m-4 max-h-[85vh] flex flex-col"
          >
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
              {templates.map((template) => {
                const Icon = template.icon;
                const color = APPLE_CATEGORY_COLORS[template.category];
                
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
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
