/**
 * CommandSheet — entity-scoped HALO chat in a bottom sheet.
 * Opens a conversation anchored to a specific business object (job, property,
 * invoice, crew). The brain is given full entity context so questions like
 * "why is this over budget?" resolve automatically.
 */
import { useState, useEffect, useRef } from "react";
import { X, Send, Loader2, MessageSquare, ChevronRight } from "lucide-react";

interface ConvMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: string;
  createdAt?: string;
}

interface CommandSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "job" | "property" | "invoice" | "crew";
  entityId: string;
  entityLabel: string;
}

export function CommandSheet({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityLabel,
}: CommandSheetProps) {
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load or create the entity conversation when the sheet opens
  useEffect(() => {
    if (!open || !entityId || !entityType) return;
    setInitLoading(true);
    fetch(`/api/command/conversations/entity/${entityType}/${entityId}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setConvId(data.conversation?.id ?? data.conversationId ?? null);
          setMessages(data.messages ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setInitLoading(false));
  }, [open, entityType, entityId]);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setConvId(null);
      setMessages([]);
      setInput("");
    }
  }, [open]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when sheet opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 350);
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || !convId || loading) return;
    setInput("");
    const userMsg: ConvMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch(`/api/command/conversations/${convId}/ask`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.ok) {
        const data = await res.json();
        const reply = data.text ?? data.reply ?? "";
        if (reply) {
          setMessages((prev) => [
            ...prev,
            {
              id: `ai-${Date.now()}`,
              role: "assistant",
              content: reply,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      }
    } catch {
      // silent — user can retry
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!open) return null;

  const ENTITY_ACCENT: Record<string, string> = {
    job: "#6366F1",
    property: "#8B5CF6",
    invoice: "#B4FF44",
    crew: "#3B82F6",
  };
  const accent = ENTITY_ACCENT[entityType] ?? "#B4FF44";

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: "rgba(0,0,0,0.6)" }}>
      {/* Tap outside to close */}
      <div className="flex-1" onClick={() => onOpenChange(false)} />

      {/* Sheet */}
      <div
        className="w-full rounded-t-[24px] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300"
        style={{
          background: "linear-gradient(180deg, #08111E 0%, #060D1A 100%)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderBottom: "none",
          maxHeight: "78vh",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
          <div
            className="w-7 h-7 rounded-[8px] grid place-items-center shrink-0"
            style={{ background: `${accent}14`, border: `1px solid ${accent}28` }}
          >
            <MessageSquare className="w-3.5 h-3.5" style={{ color: accent }} strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: accent }}>
              Ask HALO
            </div>
            <div className="text-[12px] text-white/60 truncate font-medium">{entityLabel}</div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="w-7 h-7 rounded-full grid place-items-center text-white/35 hover:text-white/70 hover:bg-white/8 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
          {initLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-white/25" />
            </div>
          ) : messages.length === 0 ? (
            <div className="py-8 text-center">
              <div className="text-[13px] text-white/35 leading-relaxed">
                Ask anything about this {entityType}.
                <br />
                HALO has full context.
              </div>
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {["What's the current status?", "Any issues I should know about?"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="flex items-center gap-1 text-[11px] font-medium px-3 py-1.5 rounded-full border border-white/10 text-white/45 hover:text-white/70 hover:border-white/20 transition-colors"
                  >
                    {s}
                    <ChevronRight className="w-3 h-3" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-3.5 py-2.5 rounded-[16px] text-[13px] leading-relaxed ${
                    msg.role === "user"
                      ? "text-[#0A0F1A] font-medium"
                      : "text-white/80 bg-white/[0.045] border border-white/[0.06]"
                  }`}
                  style={
                    msg.role === "user"
                      ? { background: accent, borderRadius: "16px 16px 4px 16px" }
                      : { borderRadius: "4px 16px 16px 16px" }
                  }
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/[0.045] border border-white/[0.06] px-4 py-2.5 rounded-[4px_16px_16px_16px] flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white/35" />
                <span className="text-[12px] text-white/35">Thinking…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 pb-safe-or-4 pt-2 border-t border-white/[0.06]">
          <div
            className="flex items-end gap-2 rounded-[16px] px-3.5 py-2"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about this…"
              className="flex-1 bg-transparent resize-none text-[14px] text-white/80 placeholder:text-white/22 outline-none leading-snug py-1 max-h-[100px]"
              disabled={loading || initLoading || !convId}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading || !convId}
              className="w-7 h-7 rounded-[8px] grid place-items-center transition-all active:scale-95 disabled:opacity-30"
              style={{ background: accent }}
            >
              <Send className="w-3.5 h-3.5 text-[#0A0F1A]" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
