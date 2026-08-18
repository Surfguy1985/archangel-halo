import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetConciergeHistory,
  useConfirmConciergeAction,
  getGetClientBoardQueryKey,
  getGetClientBoardKpisQueryKey,
  getGetConciergeHistoryQueryKey,
} from '@workspace/api-client-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, Send, Loader2, Check } from 'lucide-react';

// -----------------------------------------------------------------------------
// Concierge chat — a bubble on the board that opens a full-height chat sheet.
// Answers stream in over SSE; any action the concierge proposes renders as a
// confirm chip and only runs when tapped (through the same endpoint the
// equivalent board button uses).
// -----------------------------------------------------------------------------

type Chip = { id: string; label: string; summary: string; confirmToken: string; expiresAt: string };
type Msg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips?: Chip[];
  status?: string | null;
};

const SUGGESTIONS = [
  "Where's my crew right now?",
  "How much longer on the make ready?",
  'What invoices are waiting on me?',
  'Can we get a bid on a gate repair?',
];

// [[card:job:123|1601 Make Ready]] → tappable deep link into the board.
function renderContent(text: string, onOpenCard: (cardKey: string) => void) {
  const parts: React.ReactNode[] = [];
  const re = /\[\[card:([A-Za-z0-9_:.-]+)\|([^\]]+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const cardKey = m[1];
    parts.push(
      <button
        key={`link-${i++}`}
        onClick={() => onOpenCard(cardKey)}
        className="inline-flex items-center gap-1 rounded-full bg-black text-white px-2.5 py-0.5 text-xs font-semibold align-middle hover:opacity-80"
        data-testid={`link-concierge-card-${cardKey}`}
      >
        {m[2]}
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function ConciergeChat({
  token,
  authenticated,
  onOpenCard,
}: {
  token: string;
  authenticated: boolean;
  onOpenCard: (cardKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const historyQuery = useGetConciergeHistory(token, {
    query: { queryKey: getGetConciergeHistoryQueryKey(token), enabled: open && authenticated },
  });

  // Seed local messages from persisted history once per open.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || !historyQuery.data) return;
    seededRef.current = true;
    setMessages(
      (historyQuery.data.messages ?? []).map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        chips: (m.chips ?? []) as Chip[],
      })),
    );
  }, [open, historyQuery.data]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  const confirmAction = useConfirmConciergeAction({
    mutation: {
      onSuccess: (res, vars) => {
        const chipToken = vars.data.confirmToken;
        setConfirmedIds((prev) => new Set(prev).add(chipToken));
        setMessages((prev) => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            role: 'assistant',
            content: res.ok ? `✓ ${res.message}` : res.message,
          },
        ]);
        queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
        queryClient.invalidateQueries({ queryKey: getGetClientBoardKpisQueryKey(token) });
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ?? 'That confirmation expired — ask again';
        toast({ title: msg, variant: 'destructive' });
      },
    },
  });

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: message };
    const draftId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg, { id: draftId, role: 'assistant', content: '', status: 'Thinking…' }]);

    const update = (fn: (m: Msg) => Msg) =>
      setMessages((prev) => prev.map((m) => (m.id === draftId ? fn(m) : m)));

    try {
      const resp = await fetch(`/api/client/${token}/concierge`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });
      if (!resp.ok || !resp.body) {
        const j = await resp.json().catch(() => null);
        update((m) => ({ ...m, status: null, content: j?.error ?? 'The concierge is unavailable right now.' }));
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Parse complete SSE events.
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const eventLine = raw.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(7).trim();
          let data: any = null;
          try {
            data = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }
          if (event === 'status') update((m) => ({ ...m, status: data.text }));
          if (event === 'delta') update((m) => ({ ...m, status: null, content: m.content + data.text }));
          if (event === 'chips') update((m) => ({ ...m, chips: data.chips as Chip[] }));
        }
      }
      update((m) => ({ ...m, status: null }));
    } catch {
      update((m) => ({ ...m, status: null, content: m.content || 'Connection dropped — try again.' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-4 z-40 flex h-13 w-13 items-center justify-center rounded-full bg-black text-[#B4FF44] shadow-lg shadow-black/30 hover:scale-105 transition-transform"
        style={{ height: 52, width: 52 }}
        aria-label="Ask the concierge"
        data-testid="button-concierge-open"
      >
        <Sparkles className="h-6 w-6" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="h-[92dvh] flex flex-col p-0 rounded-t-2xl">
          <SheetHeader className="px-4 pt-4 pb-2 border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> Concierge
            </SheetTitle>
          </SheetHeader>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="pt-6 space-y-2">
                <p className="text-sm text-muted-foreground text-center">
                  Ask anything about your property — I can check status, find your crew, and file
                  requests for you.
                </p>
                <div className="flex flex-col gap-2 pt-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-xl border px-3 py-2.5 text-left text-sm hover:bg-muted"
                      data-testid={`button-concierge-suggestion`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] rounded-2xl rounded-br-md bg-black text-white px-3.5 py-2 text-sm whitespace-pre-wrap'
                      : 'max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm whitespace-pre-wrap'
                  }
                >
                  {m.status ? (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {m.status}
                    </span>
                  ) : (
                    renderContent(m.content, (key) => {
                      setOpen(false);
                      onOpenCard(key);
                    })
                  )}
                  {(m.chips ?? []).length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {m.chips!.map((chip) => {
                        const done = confirmedIds.has(chip.confirmToken);
                        const expired = new Date(chip.expiresAt).getTime() < Date.now();
                        return (
                          <Button
                            key={chip.id}
                            size="sm"
                            disabled={done || expired || confirmAction.isPending}
                            onClick={() => confirmAction.mutate({ token, data: { confirmToken: chip.confirmToken } })}
                            className="w-full justify-start gap-2 bg-[#B4FF44] text-black hover:bg-[#a3ef35]"
                            data-testid={`button-concierge-confirm-${chip.id}`}
                          >
                            {done ? <Check className="h-4 w-4" /> : null}
                            {done ? 'Done' : expired ? 'Expired — ask again' : chip.label}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <form
            className="flex items-center gap-2 border-t px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your property…"
              className="flex-1 rounded-full border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/20"
              data-testid="input-concierge-message"
            />
            <Button
              type="submit"
              size="icon"
              disabled={busy || !input.trim()}
              className="rounded-full bg-black text-white"
              data-testid="button-concierge-send"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
