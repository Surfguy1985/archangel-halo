/**
 * WalkModeOverlay — premium full-screen walk capture interface.
 *
 * A manager walking a unit speaks naturally, captures photos, and HALO
 * structures the scope. Surfaces inline in the HALO Command thread as a
 * full-screen takeover. Uses voice transcription and links to the Walk app
 * for the full capture + job-creation flow.
 */

import { useState, useRef, useEffect } from "react";
import {
  Mic,
  MicOff,
  Camera,
  X,
  Plus,
  ChevronRight,
  Footprints,
  Loader2,
  Check,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { useParseWalkVoice } from "@workspace/api-client-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CapturedItem {
  id: string;
  description: string;
  unit?: string;
  service?: string;
  note?: string;
  hasPhoto: boolean;
  source: "voice" | "manual" | "photo";
}

interface WalkModeOverlayProps {
  onClose: () => void;
  onSendToHalo: (items: CapturedItem[], summary: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WalkModeOverlay({ onClose, onSendToHalo }: WalkModeOverlayProps) {
  const [unit, setUnit] = useState("");
  const [items, setItems] = useState<CapturedItem[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [phase, setPhase] = useState<"setup" | "capture" | "review">("setup");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const parseWalkVoice = useParseWalkVoice?.();

  // Start microphone recording
  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        handleParseVoice(blob);
      };
      mr.start();
      mediaRef.current = mr;
      setIsListening(true);
      setTranscript("");
    } catch {
      // Microphone not available — show a hint
      setTranscript("(Microphone not available. Type your observations below.)");
    }
  };

  const stopListening = () => {
    if (mediaRef.current && mediaRef.current.state === "recording") {
      mediaRef.current.stop();
    }
    setIsListening(false);
  };

  const handleParseVoice = async (blob: Blob) => {
    setIsParsing(true);
    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        try {
          const result = await fetch("/api/walk/voice/parse", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: base64 }),
          });
          if (result.ok) {
            const data = await result.json();
            // Parse response into items
            if (data.items && Array.isArray(data.items)) {
              const newItems: CapturedItem[] = data.items.map((item: { description?: string; service?: string; note?: string }, idx: number) => ({
                id: `voice-${Date.now()}-${idx}`,
                description: item.description ?? "Work item",
                unit: unit || "TBD",
                service: item.service,
                note: item.note,
                hasPhoto: false,
                source: "voice" as const,
              }));
              setItems(prev => [...prev, ...newItems]);
            } else if (data.transcript) {
              // Fallback: add as manual item
              setTranscript(data.transcript);
              addManualItem(data.transcript);
            }
          }
        } finally {
          setIsParsing(false);
        }
      };
    } catch {
      setIsParsing(false);
    }
  };

  const addManualItem = (text?: string) => {
    const desc = (text ?? manualInput).trim();
    if (!desc) return;
    setItems(prev => [
      ...prev,
      {
        id: `manual-${Date.now()}`,
        description: desc,
        unit: unit || "TBD",
        hasPhoto: false,
        source: "manual",
      },
    ]);
    setManualInput("");
  };

  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id));

  const handleOpenWalkApp = () => {
    window.open("/walk", "_blank", "noopener");
    onClose();
  };

  const handleSend = () => {
    const summary = `Walk capture — Unit ${unit || "TBD"} — ${items.length} item${items.length !== 1 ? "s" : ""}`;
    onSendToHalo(items, summary);
    onClose();
  };

  // Prevent body scroll while overlay is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#020B18]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-[calc(16px+env(safe-area-inset-top))] pb-4 border-b border-white/8">
        <div className="w-9 h-9 rounded-[12px] bg-[#B4FF44] grid place-items-center shrink-0">
          <Footprints className="w-5 h-5 text-[#07101E]" strokeWidth={2.5} />
        </div>
        <div className="flex-1">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#B4FF44]/80">
            HALO Walk Mode
          </div>
          <div className="text-[13px] text-white/60">
            {phase === "setup" ? "Where are you?" : `Unit ${unit} · ${items.length} item${items.length !== 1 ? "s" : ""}`}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/8 grid place-items-center text-white/50 hover:text-white/80 hover:bg-white/12 transition-colors"
        >
          <X className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Phase: Setup */}
      {phase === "setup" && (
        <div className="flex-1 flex flex-col justify-center px-6 gap-6">
          <div>
            <div className="text-[28px] font-bold text-white leading-tight mb-2">
              Which unit are<br />you walking?
            </div>
            <p className="text-[14px] text-white/50 leading-relaxed">
              Enter the unit number or location. You can speak or type your observations as you walk.
            </p>
          </div>
          <input
            autoFocus
            value={unit}
            onChange={e => setUnit(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && unit.trim()) setPhase("capture"); }}
            placeholder="e.g. 312, Lobby, Pool Area…"
            className="w-full h-[54px] rounded-[16px] bg-white/8 border border-white/15 px-4 text-[16px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#B4FF44]/50 focus:ring-2 focus:ring-[#B4FF44]/20 transition-all"
          />
          <div className="flex gap-3">
            <button
              onClick={() => setPhase("capture")}
              className="flex-1 rounded-[14px] bg-[#B4FF44] text-black font-bold text-[15px] py-[14px] active:scale-[0.97] transition-transform"
            >
              Start walk
            </button>
            <button
              onClick={handleOpenWalkApp}
              className="flex items-center gap-2 px-4 rounded-[14px] bg-white/8 border border-white/15 text-white/60 font-bold text-[14px] py-[14px] active:scale-[0.97] transition-colors hover:text-white/80"
            >
              Full app <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Phase: Capture */}
      {phase === "capture" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Items list */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {items.length === 0 && !isParsing && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-white/30">
                <Mic className="w-10 h-10" />
                <div className="text-center text-[14px] leading-relaxed">
                  Hold the mic button and describe what you see.<br />
                  <span className="text-[12px] text-white/20">e.g. "Living room needs paint, carpet is worn"</span>
                </div>
              </div>
            )}

            {isParsing && (
              <div className="flex items-center gap-3 bg-[#B4FF44]/8 border border-[#B4FF44]/20 rounded-[16px] px-4 py-4">
                <Loader2 className="w-5 h-5 text-[#B4FF44] animate-spin shrink-0" />
                <div>
                  <div className="text-[13px] text-[#B4FF44]/90 font-medium">HALO is processing your voice…</div>
                  <div className="text-[11px] text-[#B4FF44]/50 mt-0.5">Extracting work items</div>
                </div>
              </div>
            )}

            {items.map(item => (
              <div key={item.id} className="flex items-start gap-3 bg-white/6 rounded-[16px] px-4 py-3 border border-white/8">
                <div className="mt-0.5">
                  {item.source === "voice" ? (
                    <Mic className="w-4 h-4 text-[#B4FF44]" />
                  ) : item.source === "photo" ? (
                    <Camera className="w-4 h-4 text-[#F59E0B]" />
                  ) : (
                    <Plus className="w-4 h-4 text-white/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] text-white/90 font-medium leading-snug">{item.description}</div>
                  {item.service && (
                    <div className="text-[11px] text-[#B4FF44]/70 mt-1">{item.service}</div>
                  )}
                  {item.note && (
                    <div className="text-[11px] text-white/40 mt-0.5">{item.note}</div>
                  )}
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="w-7 h-7 rounded-full bg-white/6 grid place-items-center text-white/30 hover:text-[#E11D48] hover:bg-[#E11D48]/10 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Manual input row */}
          <div className="px-5 py-3 border-t border-white/8">
            <div className="flex items-center gap-2">
              <input
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addManualItem(); }}
                placeholder="Type an observation…"
                className="flex-1 h-[42px] rounded-[12px] bg-white/8 border border-white/12 px-3 text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#B4FF44]/40"
              />
              <button
                onClick={() => addManualItem()}
                disabled={!manualInput.trim()}
                className="w-[42px] h-[42px] rounded-[12px] bg-white/8 border border-white/12 grid place-items-center text-white/50 hover:text-white/80 disabled:opacity-30 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Action row */}
          <div className="px-5 pb-[calc(16px+env(safe-area-inset-bottom))] flex items-center gap-3">
            {/* Mic */}
            <button
              onPointerDown={startListening}
              onPointerUp={stopListening}
              onPointerLeave={stopListening}
              disabled={isParsing}
              className={`w-[60px] h-[60px] rounded-full flex items-center justify-center shrink-0 transition-all active:scale-[0.93] ${
                isListening
                  ? "bg-[#E11D48] shadow-[0_0_20px_rgba(225,29,72,0.5)]"
                  : "bg-[#B4FF44] shadow-[0_4px_20px_rgba(180,255,68,0.35)]"
              }`}
            >
              {isListening ? (
                <MicOff className="w-6 h-6 text-white" strokeWidth={2.5} />
              ) : (
                <Mic className="w-6 h-6 text-[#07101E]" strokeWidth={2.5} />
              )}
            </button>
            {isListening && (
              <div className="flex-1 text-[13px] text-white/60 italic">
                Listening… release to stop
              </div>
            )}

            {/* Review / send */}
            {!isListening && items.length > 0 && (
              <button
                onClick={() => setPhase("review")}
                className="flex-1 flex items-center justify-center gap-2 rounded-[14px] bg-white/10 border border-white/15 text-white/80 font-bold text-[13.5px] py-[14px] active:scale-[0.97] transition-all"
              >
                Review {items.length} item{items.length !== 1 ? "s" : ""}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {!isListening && items.length === 0 && (
              <div className="flex-1 text-[13px] text-white/30 text-center">
                Hold mic to describe what you see
              </div>
            )}
          </div>
        </div>
      )}

      {/* Phase: Review */}
      {phase === "review" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            <div className="text-[22px] font-bold text-white mb-4">
              Review scope for Unit {unit}
            </div>
            {items.map((item, i) => (
              <div key={item.id} className="flex items-start gap-3 bg-white/6 rounded-[16px] px-4 py-3 border border-white/8">
                <div className="w-5 h-5 rounded-full bg-[#B4FF44]/20 border border-[#B4FF44]/40 grid place-items-center shrink-0 mt-0.5">
                  <Check className="w-3 h-3 text-[#B4FF44]" strokeWidth={2.5} />
                </div>
                <div className="flex-1">
                  <div className="text-[13.5px] text-white/90 font-medium">{item.description}</div>
                  {item.service && <div className="text-[11px] text-[#B4FF44]/60 mt-0.5">{item.service}</div>}
                </div>
              </div>
            ))}
          </div>

          <div className="px-5 pb-[calc(20px+env(safe-area-inset-bottom))] flex gap-3">
            <button
              onClick={() => setPhase("capture")}
              className="w-[48px] h-[52px] flex items-center justify-center rounded-[14px] bg-white/8 border border-white/12 text-white/50 hover:text-white/80 transition-colors"
            >
              ←
            </button>
            <button
              onClick={handleSend}
              className="flex-1 flex items-center justify-center gap-2 rounded-[14px] bg-[#B4FF44] text-black font-bold text-[15px] py-[14px] active:scale-[0.97] transition-transform shadow-[0_4px_20px_rgba(180,255,68,0.35)]"
            >
              <Check className="w-5 h-5" strokeWidth={2.5} />
              Send {items.length} items to HALO
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
