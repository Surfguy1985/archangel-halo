/**
 * WalkModeOverlay — full-screen walk capture (desktop variant).
 *
 * A manager walking a unit speaks naturally, captures observations,
 * and HALO structures the scope. Voice audio is transcribed via
 * /api/walk/voice/parse. Surfaces inline in the HALO Command thread
 * as a full-screen takeover.
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
  ArrowLeft,
} from "lucide-react";

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
  const [isParsing, setIsParsing] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [phase, setPhase] = useState<"setup" | "capture" | "review">("setup");

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        handleParseVoice(blob);
      };
      mr.start();
      mediaRef.current = mr;
      setIsListening(true);
    } catch {
      // Microphone not available — user can type instead
    }
  };

  const stopListening = () => {
    if (mediaRef.current && mediaRef.current.state === "recording") {
      mediaRef.current.stop();
    }
    setIsListening(false);
  };

  // Convert recorded audio blob to base64 and send to walk voice parse endpoint.
  const handleParseVoice = async (blob: Blob) => {
    setIsParsing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        try {
          const res = await fetch("/api/walk/voice/parse", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: base64 }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.items && Array.isArray(data.items)) {
              const newItems: CapturedItem[] = data.items.map(
                (item: { description?: string; service?: string; note?: string }, idx: number) => ({
                  id: `voice-${Date.now()}-${idx}`,
                  description: item.description ?? "Work item",
                  unit: unit || "TBD",
                  service: item.service,
                  note: item.note,
                  hasPhoto: false,
                  source: "voice" as const,
                })
              );
              setItems(prev => [...prev, ...newItems]);
            } else if (data.transcript) {
              addManualItemText(data.transcript);
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

  const addManualItemText = (text: string) => {
    const desc = text.trim();
    if (!desc) return;
    setItems(prev => [
      ...prev,
      { id: `manual-${Date.now()}`, description: desc, unit: unit || "TBD", hasPhoto: false, source: "manual" },
    ]);
  };

  const addManualItem = () => {
    addManualItemText(manualInput);
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

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background/98 backdrop-blur-sm">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <div className="w-9 h-9 rounded-[11px] bg-primary grid place-items-center shrink-0 shadow-[0_4px_12px_rgba(180,255,68,0.28)]">
          <Footprints className="w-[18px] h-[18px] text-primary-foreground" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-primary/70">HALO Walk Mode</div>
          <div className="text-[12.5px] text-muted-foreground truncate">
            {phase === "setup"
              ? "Where are you walking?"
              : `Unit ${unit || "TBD"} · ${items.length} item${items.length !== 1 ? "s" : ""} captured`}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-accent/40 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors active:scale-[0.94]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Phase: Setup ─────────────────────────────────────────────── */}
      {phase === "setup" && (
        <div className="flex-1 flex flex-col items-center justify-center px-8 gap-7 max-w-xl mx-auto w-full">
          <div>
            <div className="text-[28px] font-bold text-foreground leading-tight tracking-[-0.01em] mb-2">
              Which unit are you walking?
            </div>
            <p className="text-[14px] text-muted-foreground leading-relaxed">
              Enter the unit number or location. Speak naturally as you walk — HALO structures your scope automatically.
            </p>
          </div>
          <input
            autoFocus
            value={unit}
            onChange={e => setUnit(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && unit.trim()) setPhase("capture"); }}
            placeholder="312, Lobby, Pool Area…"
            className="w-full h-12 rounded-[12px] bg-card border border-border px-4 text-[15px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/15 transition-all"
          />
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setPhase("capture")}
              className="flex-1 rounded-[12px] bg-primary text-primary-foreground font-bold text-[14px] py-3 active:scale-[0.97] transition-transform shadow-[0_4px_14px_rgba(180,255,68,0.28)]"
            >
              Start walk
            </button>
            <button
              onClick={handleOpenWalkApp}
              className="flex items-center gap-2 px-5 rounded-[12px] bg-card border border-border text-muted-foreground font-bold text-[14px] py-3 hover:text-foreground hover:bg-accent/30 transition-colors active:scale-[0.97]"
            >
              Full app <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: Capture ───────────────────────────────────────────── */}
      {phase === "capture" && (
        <div className="flex-1 flex overflow-hidden max-w-2xl mx-auto w-full">
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Items list */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-2">
              {items.length === 0 && !isParsing && (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <div className="w-14 h-14 rounded-full bg-primary/8 border border-primary/18 grid place-items-center">
                    <Mic className="w-6 h-6 text-primary/55" />
                  </div>
                  <div className="text-center">
                    <div className="text-[14px] text-muted-foreground leading-relaxed mb-1">
                      Hold the mic and describe what you see
                    </div>
                    <div className="text-[12px] text-muted-foreground/50">
                      "Living room needs paint, carpet is worn"
                    </div>
                  </div>
                </div>
              )}

              {isParsing && (
                <div className="flex items-center gap-3 bg-primary/7 border border-primary/18 rounded-[14px] px-4 py-4">
                  <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
                  <div>
                    <div className="text-[13.5px] text-primary/85 font-medium">Processing your voice…</div>
                    <div className="text-[11.5px] text-primary/50 mt-0.5">Extracting work items</div>
                  </div>
                </div>
              )}

              {items.map(item => (
                <div key={item.id} className="flex items-start gap-3 bg-card border border-border rounded-[12px] px-4 py-3">
                  <div className="mt-0.5 shrink-0">
                    {item.source === "voice" ? (
                      <Mic className="w-3.5 h-3.5 text-primary" />
                    ) : item.source === "photo" ? (
                      <Camera className="w-3.5 h-3.5 text-[#F59E0B]" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] text-foreground/90 font-medium leading-snug">{item.description}</div>
                    {item.service && <div className="text-[11.5px] text-primary/65 mt-1">{item.service}</div>}
                    {item.note && <div className="text-[11.5px] text-muted-foreground mt-0.5">{item.note}</div>}
                  </div>
                  <button
                    onClick={() => removeItem(item.id)}
                    className="w-7 h-7 rounded-full bg-accent/30 grid place-items-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 mt-0.5"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Manual input */}
            <div className="px-6 py-3 border-t border-border">
              <div className="flex items-center gap-2">
                <input
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addManualItem(); }}
                  placeholder="Type an observation…"
                  className="flex-1 h-10 rounded-[10px] bg-card border border-border px-3 text-[13.5px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/35 transition-all"
                />
                <button
                  onClick={addManualItem}
                  disabled={!manualInput.trim()}
                  className="w-10 h-10 rounded-[10px] bg-card border border-border grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors active:scale-[0.95]"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Action row */}
            <div className="px-6 pb-6 flex items-center gap-3">
              <button
                onPointerDown={startListening}
                onPointerUp={stopListening}
                onPointerLeave={stopListening}
                disabled={isParsing}
                className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 transition-all select-none ${
                  isListening
                    ? "bg-destructive shadow-[0_0_20px_rgba(225,29,72,0.4)] scale-[1.04]"
                    : "bg-primary shadow-[0_4px_14px_rgba(180,255,68,0.28)] active:scale-[0.93]"
                }`}
              >
                {isListening
                  ? <MicOff className="w-5 h-5 text-white" strokeWidth={2.5} />
                  : <Mic className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
                }
              </button>

              {isListening && (
                <div className="flex-1 text-[13px] text-muted-foreground italic">Listening… release to stop</div>
              )}

              {!isListening && items.length > 0 && (
                <button
                  onClick={() => setPhase("review")}
                  className="flex-1 flex items-center justify-center gap-2 rounded-[12px] bg-card border border-border text-foreground/80 font-bold text-[14px] py-3.5 active:scale-[0.97] transition-all hover:bg-accent/30"
                >
                  Review {items.length} item{items.length !== 1 ? "s" : ""}
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}

              {!isListening && items.length === 0 && (
                <div className="flex-1 text-[13px] text-muted-foreground/50 text-center">
                  Hold the mic to describe what you see
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Phase: Review ────────────────────────────────────────────── */}
      {phase === "review" && (
        <div className="flex-1 flex flex-col overflow-hidden max-w-2xl mx-auto w-full">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-2">
            <div className="text-[22px] font-bold text-foreground tracking-[-0.01em] mb-4">
              Review scope — Unit {unit || "TBD"}
            </div>
            {items.map(item => (
              <div key={item.id} className="flex items-start gap-3 bg-card border border-border rounded-[12px] px-4 py-3">
                <div className="w-5 h-5 rounded-full bg-primary/15 border border-primary/30 grid place-items-center shrink-0 mt-0.5">
                  <Check className="w-2.5 h-2.5 text-primary" strokeWidth={2.5} />
                </div>
                <div className="flex-1">
                  <div className="text-[13.5px] text-foreground/90 font-medium leading-snug">{item.description}</div>
                  {item.service && <div className="text-[11.5px] text-primary/60 mt-0.5">{item.service}</div>}
                </div>
              </div>
            ))}
          </div>

          <div className="px-6 pb-6 flex gap-3">
            <button
              onClick={() => setPhase("capture")}
              className="w-12 h-12 flex items-center justify-center rounded-[12px] bg-card border border-border text-muted-foreground hover:text-foreground transition-colors active:scale-[0.95]"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleSend}
              className="flex-1 flex items-center justify-center gap-2 rounded-[12px] bg-primary text-primary-foreground font-bold text-[14px] py-3.5 active:scale-[0.97] transition-transform shadow-[0_4px_14px_rgba(180,255,68,0.28)]"
            >
              <Check className="w-5 h-5" strokeWidth={2.5} />
              Send {items.length} item{items.length !== 1 ? "s" : ""} to HALO
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
