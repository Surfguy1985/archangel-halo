import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Mic } from "lucide-react";
import { useState } from "react";

export function VoiceCaptureSheet({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  const toggleListen = () => {
    setListening(!listening);
    if (!listening) {
      setTranscript("Listening... (mock transcript would appear here)");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]">
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[14px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Talk to HALO</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Speak updates, log expenses, or schedule jobs.</div>
          </SheetHeader>
          
          <div className="flex flex-col items-center justify-center my-[20px]">
            <button 
              className={`w-[66px] h-[66px] rounded-full relative grid place-items-center shadow-[0_6px_20px_rgba(143,106,31,0.38)] before:content-[''] before:absolute before:inset-0 before:rounded-full before:bg-[conic-gradient(from_210deg,var(--gold-dark),var(--gold-light),var(--gold),var(--gold-dark))] after:content-[''] after:absolute after:inset-[3.5px] after:rounded-full after:bg-[var(--ink)] ${listening ? 'animate-pulse' : ''}`}
              onClick={toggleListen}
            >
              <Mic className="relative z-10 w-[24px] h-[24px] text-[var(--gold-light)]" />
            </button>
            <span className="block text-center text-[12px] tracking-[0.16em] uppercase text-[var(--gold-dark)] font-bold mt-[12px]">
              {listening ? "LISTENING" : "TAP TO SPEAK"}
            </span>
          </div>
          
          {transcript && (
            <div className="bg-card rounded-[14px] border border-border shadow-[var(--shadow)] p-[14px_15px] text-[15px] text-[var(--ink2)] min-h-[66px] relative before:content-['“'] before:font-display before:text-[22px] before:text-[var(--gold)] before:leading-[0] before:mr-[2px]">
              {transcript}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
