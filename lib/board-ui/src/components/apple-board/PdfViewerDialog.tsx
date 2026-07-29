import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, Loader2 } from "lucide-react";

interface Props {
  url: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PdfViewerDialog({ url, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(true);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative z-10 w-full h-[100dvh] md:h-full md:max-h-[90vh] md:max-w-[90vw] bg-[#fafafa] shadow-[0_20px_60px_rgba(0,0,0,0.12)] md:rounded-[24px] overflow-hidden flex flex-col"
          >
            {/* Header Bar */}
            <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-black/[0.06] bg-white/90 px-4 backdrop-blur-md">
              <div className="font-semibold text-[14px] text-[#1d1d1f]">Document Viewer</div>
              <div className="flex items-center gap-2">
                <a 
                  href={url} 
                  target="_blank" 
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] hover:bg-black/[0.04] text-[12px] font-medium text-[#1d1d1f] transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open in New Tab
                </a>
                <div className="w-px h-4 bg-black/[0.06]" />
                <button 
                  onClick={() => onOpenChange(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-black/[0.04] transition-colors text-[#1d1d1f]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 w-full relative bg-[#f5f5f7]">
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#8E8E93]" />
                </div>
              )}
              {open && (
                <iframe 
                  src={url} 
                  className="w-full h-full border-none" 
                  onLoad={() => setLoading(false)}
                  title="PDF Document"
                />
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}