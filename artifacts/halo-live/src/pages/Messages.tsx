import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Send } from "lucide-react";
import logo from "@/assets/halo-logo.png";

type Msg = { id: string; who: string; role: string; text: string; at: string; unit?: string };

const seed: Msg[] = [
  { id: "1", who: "Bryce", role: "vendor", text: "Bldg 12 unit 1224 — after photos are up. Ready for PM look.", at: "2m", unit: "1224" },
  { id: "2", who: "Maya", role: "pulse", text: "Looks clean. Carpet edge in living — one more pass?", at: "1m", unit: "1224" },
  { id: "3", who: "Crew Luis", role: "field", text: "On it. Re-shooting after in 10.", at: "just now", unit: "1224" },
];

export function Messages() {
  const [msgs, setMsgs] = useState(seed);
  const [text, setText] = useState("");

  function send() {
    if (!text.trim()) return;
    setMsgs((m) => [
      ...m,
      { id: String(Date.now()), who: "You", role: "punchlist", text: text.trim(), at: "now", unit: "1224" },
    ]);
    setText("");
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col bg-halo-ink">
      <header className="flex items-center gap-3 border-b border-halo-line px-4 py-3">
        <Link href="/live" className="grid h-9 w-9 place-items-center rounded-full bg-halo-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <img src={logo} alt="" className="h-6 w-6" />
        <div>
          <div className="text-sm font-semibold">Unit board</div>
          <div className="text-xs text-halo-mist">Live · tied to map selection</div>
        </div>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.map((m) => (
          <div key={m.id} className="rounded-2xl border border-halo-line bg-halo-card p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-halo-mist">
              <span>
                <span className="font-semibold text-white">{m.who}</span> · {m.role}
                {m.unit ? ` · #${m.unit}` : ""}
              </span>
              <span>{m.at}</span>
            </div>
            <p className="text-sm leading-relaxed">{m.text}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-halo-line p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message this unit…"
          className="flex-1 rounded-full border border-halo-line bg-halo-card px-4 py-2.5 text-sm outline-none focus:border-halo-lime/40"
        />
        <button type="button" onClick={send} className="grid h-10 w-10 place-items-center rounded-full bg-halo-lime text-halo-ink">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
