import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

type Suggestion = {
  id: string; agent: string; severity: string; title: string; body: string;
  action?: { type: string; refId?: string };
};

/** Proactive HaloCommand agent suggestions — Punchlist only. */
export function AgentSuggestionsStrip({ enabled }: { enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ["command-suggestions"],
    queryFn: async () => {
      const res = await fetch("/api/command/suggestions", { credentials: "include" });
      if (!res.ok) return { suggestions: [] as Suggestion[] };
      return res.json() as Promise<{ suggestions: Suggestion[] }>;
    },
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });

  const items = (data?.suggestions || []).slice(0, 5);
  if (!enabled || items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[90] flex w-[min(920px,94vw)] -translate-x-1/2 flex-col gap-2">
      {items.map((s) => (
        <div key={s.id} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-[#B4FF44]/30 bg-[#0f1410]/95 px-4 py-3 shadow-xl backdrop-blur">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#B4FF44]" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#B4FF44]/80">{s.agent} · {s.severity}</div>
            <div className="text-sm font-semibold text-white">{s.title}</div>
            <div className="text-xs text-white/60">{s.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
export default AgentSuggestionsStrip;
