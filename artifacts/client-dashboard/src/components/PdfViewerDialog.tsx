import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { X, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";

interface Props {
  url: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PdfViewerDialog({ url, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-none w-full md:w-[90vw] h-[100dvh] md:h-[90vh] p-0 md:rounded-2xl border-none overflow-hidden bg-muted m-0 focus-visible:outline-none focus:outline-none">
        <DialogTitle className="sr-only">PDF Viewer</DialogTitle>
        
        {/* Header Bar */}
        <div className="absolute top-0 left-0 right-0 h-14 bg-background/90 backdrop-blur border-b border-border flex items-center justify-between px-4 z-10">
          <div className="font-bold text-sm">Document Viewer</div>
          <div className="flex items-center gap-2">
            <a 
              href={url} 
              target="_blank" 
              rel="noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-muted text-sm font-medium transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Open in New Tab
            </a>
            <button 
              onClick={() => onOpenChange(false)}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="w-full h-full pt-14 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {open && (
            <iframe 
              src={url} 
              className="w-full h-full border-none bg-background" 
              onLoad={() => setLoading(false)}
              title="PDF Document"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
