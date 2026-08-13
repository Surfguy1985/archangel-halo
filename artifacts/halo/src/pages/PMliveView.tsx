/**
 * PMliveView — the property manager's mobile live link destination.
 *
 * NOT a dashboard or portal. A lightweight read-only view:
 *   • Short daily summary (crew count, job count, completion)
 *   • Live crew status (GPS-correlated from today's check-ins)
 *   • Latest field photos (from Base44 via HALO sync)
 *   • Field notes / work summaries
 *   • Simple chat input to ask deeper questions
 *
 * Accessed via a secure token link texted by the office.
 * No login required. Expires in 24 hours by default. Mobile-first.
 */

import { useState, useEffect, useRef } from "react";
import {
  MapPin, ClipboardList, Camera, MessageSquare,
  Loader2, AlertCircle, Send, CheckCircle2, ChevronDown,
} from "lucide-react";

interface PMViewData {
  property: {
    id: string;
    name: string;
    city: string;
    units: number;
    address?: string;
  };
  summary: {
    date: string;
    crewsOnSite: number;
    unitsActive: number;
    unitsCompleted: number;
    totalJobs: number;
  };
  crews: Array<{
    id: string;
    name: string;
    status: "on_site" | "available" | "en_route";
    lastSeenAt: string | null;
    unitLabel: string | null;
    lat: number | null;
    lng: number | null;
  }>;
  photos: Array<{
    id: string;
    path: string;
    kind: string;
    unitLabel: string | null;
    crewName: string | null;
    createdAt: string;
  }>;
  workNotes: Array<{
    id: string;
    unitLabel: string | null;
    summary: string;
    crewName: string | null;
    createdAt: string;
  }>;
  permissions: { map: boolean; kanban: boolean; money: boolean };
  expiresAt: string;
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diff < 2) return "just now";
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff / 60)}h ago`;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { ...opts, credentials: "same-origin" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? String(res.status)), { status: res.status });
  return json;
}

export default function PMliveView({ token }: { token: string }) {
  const [data, setData] = useState<PMViewData | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error" | "expired">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "halo"; text: string }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch(`/api/live/${token}`)
      .then((d) => { setData(d); setLoadState("ready"); })
      .catch((err) => {
        setLoadState(err.status === 410 || err.status === 404 ? "expired" : "error");
        setErrorMsg(err.message ?? "Unable to load.");
      });
  }, [token]);

  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", text: msg }]);
    setChatLoading(true);
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    try {
      const res = await apiFetch(`/api/live/${token}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      setChatMessages(prev => [...prev, { role: "halo", text: res.text }]);
    } catch {
      setChatMessages(prev => [...prev, { role: "halo", text: "Unable to answer right now — try again." }]);
    }
    setChatLoading(false);
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  };

  if (loadState === "loading") {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#060C18]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 text-[#B4FF44] animate-spin" />
          <span className="text-white/35 text-[13px]">Loading your update…</span>
        </div>
      </div>
    );
  }

  if (loadState === "expired" || (loadState === "error" && !data)) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#060C18] px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="w-10 h-10 text-[#E11D48]/60" />
          <div>
            <p className="text-white/70 text-[18px] font-semibold mb-1">
              {loadState === "expired" ? "Link has expired" : "Link not found"}
            </p>
            <p className="text-white/35 text-[13px] leading-relaxed max-w-[280px]">
              {loadState === "expired"
                ? "This link is no longer active. Contact your property management team for an updated link."
                : errorMsg}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const today = new Date(data.summary.date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
  const crewsOnSite = data.crews.filter(c => c.status === "on_site");

  return (
    <div className="min-h-[100dvh] bg-[#060C18] text-white" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>

      {/* Header */}
      <div className="px-5 pt-[max(16px,env(safe-area-inset-top))] pb-4 border-b border-white/[0.07]">
        <div className="text-[10px] font-bold tracking-[0.25em] uppercase text-white/25 mb-0.5">HALO Daily</div>
        <h1 className="text-[22px] font-bold text-white leading-tight">{data.property.name}</h1>
        <p className="text-[12.5px] text-white/40 mt-0.5">{today}</p>
      </div>

      {/* Summary strip */}
      <div className="flex border-b border-white/[0.06]">
        {[
          { label: "On site", value: data.summary.crewsOnSite, accent: "#22C55E" },
          { label: "Active", value: data.summary.unitsActive, accent: "#3B82F6" },
          { label: "Done", value: data.summary.unitsCompleted, accent: "#B4FF44" },
        ].map(({ label, value, accent }) => (
          <div key={label} className="flex-1 py-4 text-center border-r border-white/[0.06] last:border-0">
            <div className="text-[28px] font-bold leading-none" style={{ color: accent }}>{value}</div>
            <div className="text-[10px] text-white/35 mt-0.5 font-medium">{label}</div>
          </div>
        ))}
      </div>

      {/* Crew Status */}
      {data.crews.length > 0 && (
        <section className="px-5 py-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-3.5 h-3.5 text-[#22C55E]" />
            <span className="text-[11px] font-bold tracking-[0.15em] uppercase text-white/45">
              Crew on Site
            </span>
          </div>
          <div className="space-y-2.5">
            {data.crews.map(crew => (
              <div key={crew.id} className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  crew.status === "on_site" ? "bg-[#22C55E]" :
                  crew.status === "en_route" ? "bg-[#3B82F6] animate-pulse" : "bg-white/20"
                }`} />
                <div className="flex-1 min-w-0">
                  <span className="text-[13.5px] font-medium text-white/80">{crew.name}</span>
                  {crew.unitLabel && (
                    <span className="text-white/40 text-[12px] ml-1.5">· Unit {crew.unitLabel}</span>
                  )}
                </div>
                {crew.lastSeenAt && (
                  <span className="text-[10.5px] text-white/28 shrink-0">{timeAgo(crew.lastSeenAt)}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Field Photos */}
      {data.photos.length > 0 && (
        <section className="px-5 py-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <Camera className="w-3.5 h-3.5 text-white/40" />
            <span className="text-[11px] font-bold tracking-[0.15em] uppercase text-white/45">
              Latest Field Photos
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {data.photos.slice(0, 6).map(photo => (
              <div key={photo.id} className="relative rounded-[12px] overflow-hidden bg-white/[0.05] border border-white/[0.07] aspect-video">
                <img
                  src={`/api/storage${photo.path}`}
                  alt={photo.unitLabel ? `Unit ${photo.unitLabel}` : "Field photo"}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {photo.unitLabel && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                    <span className="text-[10px] text-white/80">Unit {photo.unitLabel}</span>
                    {photo.kind === "before" && <span className="ml-1 text-[9px] text-[#F59E0B]/80">Before</span>}
                    {photo.kind === "after" && <span className="ml-1 text-[9px] text-[#22C55E]/80">After</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Work Notes */}
      {data.workNotes.length > 0 && (
        <section className="px-5 py-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="w-3.5 h-3.5 text-white/40" />
            <span className="text-[11px] font-bold tracking-[0.15em] uppercase text-white/45">
              Field Notes
            </span>
          </div>
          <div className="space-y-3">
            {data.workNotes.map(note => (
              <div key={note.id} className="bg-white/[0.04] border border-white/[0.06] rounded-[12px] px-3.5 py-3">
                {note.unitLabel && (
                  <div className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/30 mb-1">
                    Unit {note.unitLabel}
                  </div>
                )}
                <p className="text-[13px] text-white/70 leading-relaxed">{note.summary}</p>
                <div className="flex items-center gap-2 mt-2">
                  {note.crewName && <span className="text-[10.5px] text-white/30">{note.crewName}</span>}
                  <span className="text-[10.5px] text-white/20">{timeAgo(note.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Chat section */}
      <section className="px-5 py-5 pb-[max(24px,env(safe-area-inset-bottom))]">
        <button
          onClick={() => setChatOpen(v => !v)}
          className="w-full flex items-center gap-2 mb-3"
        >
          <MessageSquare className="w-3.5 h-3.5 text-[#B4FF44]/60" />
          <span className="text-[11px] font-bold tracking-[0.15em] uppercase text-white/45 flex-1 text-left">
            Ask a question
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-white/25 transition-transform ${chatOpen ? "rotate-180" : ""}`} />
        </button>

        {chatOpen && (
          <div>
            <p className="text-[12px] text-white/30 mb-3">
              Ask anything about {data.property.name} — crew status, job progress, timelines, costs.
            </p>

            {/* Chat history */}
            {chatMessages.length > 0 && (
              <div className="space-y-2 mb-3 max-h-[40vh] overflow-y-auto">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-[13px] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      m.role === "user"
                        ? "bg-[#B4FF44] text-[#07101E] font-medium rounded-br-[4px]"
                        : "bg-white/[0.07] border border-white/[0.08] text-white/75 rounded-bl-[4px]"
                    }`}>
                      {m.text}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white/[0.07] border border-white/[0.08] rounded-[13px] rounded-bl-[4px] px-4 py-3 flex items-center gap-1.5">
                      {[0,1,2].map(i => (
                        <div key={i} className="w-[5px] h-[5px] rounded-full bg-white/30"
                          style={{ animation: `bounce 1.2s ${i * 0.18}s ease-in-out infinite` }} />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>
            )}

            {/* Input */}
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") sendChat(); }}
                placeholder={`Ask about ${data.property.name}…`}
                className="flex-1 h-11 bg-white/[0.06] border border-white/[0.08] rounded-[12px] px-3.5 text-[13px] text-white placeholder:text-white/25 focus:outline-none focus:border-[#B4FF44]/30"
              />
              <button
                onClick={sendChat}
                disabled={!chatInput.trim() || chatLoading}
                className="w-11 h-11 rounded-[12px] bg-[#B4FF44] grid place-items-center disabled:opacity-30 active:scale-[0.94] transition-all"
              >
                <Send className="w-4 h-4 text-[#07101E]" />
              </button>
            </div>

            {/* Suggested questions */}
            {chatMessages.length === 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {[
                  "When will units be done?",
                  "Who is on site right now?",
                  "Any delays today?",
                ].map(q => (
                  <button
                    key={q}
                    onClick={() => { setChatInput(q); }}
                    className="text-[11px] text-white/35 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] hover:text-white/55 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/[0.05] text-center">
        <p className="text-[10px] text-white/18">
          Powered by HALO · Expires {new Date(data.expiresAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}
