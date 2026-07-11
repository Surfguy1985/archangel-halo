import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Send, Trash2 } from "lucide-react";
import {
  useGetBid,
  useUpdateBid,
  useDeleteBid,
  useSendBid,
  useNudgeBid,
  getGetBidQueryKey,
  getListBidsQueryKey,
  getGetTodayQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function BidDetailSheet({
  open,
  onOpenChange,
  bidId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bidId: string | null;
}) {
  const queryClient = useQueryClient();
  const { data: bid } = useGetBid(bidId ?? "", {
    query: {
      queryKey: getGetBidQueryKey(bidId ?? ""),
      enabled: open && !!bidId,
    },
  });
  const update = useUpdateBid();
  const del = useDeleteBid();
  const send = useSendBid();
  const nudge = useNudgeBid();

  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (open && bid) {
      setSendTo(bid.contactEmail ?? "");
      setSendOpen(false);
      setConfirmDelete(false);
      setFeedback(null);
    }
  }, [open, bid?.id]);

  if (!bidId) return null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListBidsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBidQueryKey(bidId) });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
  };

  const doSend = () => {
    send.mutate(
      { id: bidId, data: { to: sendTo.trim() || undefined } },
      {
        onSuccess: (res) => {
          if (res.sent) {
            invalidate();
            setSendOpen(false);
            setFeedback(`Proposal emailed to ${res.to}.`);
          } else {
            setFeedback(res.error ?? "Couldn't send.");
          }
        },
        onError: () => setFeedback("Couldn't send. Try again."),
      },
    );
  };

  const btnGold =
    "flex-1 rounded-[11px] py-[10px] text-[13px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] disabled:opacity-50 transition-transform active:scale-[0.98]";
  const btnCard =
    "flex-1 rounded-[11px] py-[10px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] disabled:opacity-50 transition-transform active:scale-[0.98]";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          {!bid ? (
            <div className="animate-pulse h-32 bg-card rounded-[16px]" />
          ) : (
            <>
              <SheetHeader className="text-left mb-[12px]">
                <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px] flex items-center gap-[8px]">
                  {bid.bidNo}
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full bg-[var(--muted)] text-muted-foreground">
                    {bid.status}
                  </span>
                </SheetTitle>
                <div className="text-[13px] text-muted-foreground">
                  {bid.propertyName || "No property"}
                  {bid.unitNo ? ` · Unit ${bid.unitNo}` : ""}
                  {bid.contactName ? ` · ${bid.contactName}` : ""}
                </div>
              </SheetHeader>

              {bid.scope && <div className="text-[13.5px] mb-[10px]">{bid.scope}</div>}
              {bid.welcomeMessage && (
                <div className="bg-card border border-[var(--gold)]/25 rounded-[13px] p-[12px] mb-[12px]">
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--gold-dark)] mb-[3px]">Welcome message</div>
                  <div className="text-[13px]">{bid.welcomeMessage}</div>
                </div>
              )}

              <div className="bg-card rounded-[13px] shadow-[var(--shadow)] overflow-hidden mb-[12px]">
                {bid.lineItems?.length ? (
                  bid.lineItems.map((it) => (
                    <div key={it.id} className="flex justify-between items-start px-[14px] py-[10px] border-b border-border last:border-b-0">
                      <div className="min-w-0 pr-[10px]">
                        <div className="text-[13.5px] font-semibold">{it.service}</div>
                        <div className="text-[12px] text-muted-foreground">
                          {it.qty} × {money(it.unitPrice)}
                          {it.description ? ` · ${it.description}` : ""}
                        </div>
                      </div>
                      <div className="font-mono text-[13.5px] font-semibold shrink-0">{money(it.amount)}</div>
                    </div>
                  ))
                ) : (
                  <div className="px-[14px] py-[10px] text-[13px] text-muted-foreground">No line items.</div>
                )}
                <div className="flex justify-between items-center px-[14px] py-[11px] bg-[var(--muted)]">
                  <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Total</span>
                  <span className="font-display font-bold text-[17px] tabular-nums">{money(bid.amount)}</span>
                </div>
              </div>

              <div className="flex gap-[8px] mb-[8px]">
                <a href={`/api/bids/${bid.id}/pdf`} target="_blank" rel="noreferrer" className={`${btnCard} flex items-center justify-center gap-[6px] no-underline text-foreground`}>
                  <FileText className="w-[15px] h-[15px]" /> View PDF
                </a>
                <button className={`${btnGold} flex items-center justify-center gap-[6px]`} onClick={() => setSendOpen((v) => !v)}>
                  <Send className="w-[15px] h-[15px]" /> Send proposal
                </button>
              </div>

              {sendOpen && (
                <div className="bg-card rounded-[13px] shadow-[var(--shadow)] p-[12px] mb-[8px] flex flex-col gap-[8px]">
                  <input
                    className={fieldCls}
                    type="email"
                    placeholder={bid.contactEmail ?? "recipient@example.com"}
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                  />
                  <button
                    className={btnGold}
                    onClick={doSend}
                    disabled={send.isPending || (!sendTo.trim() && !bid.contactEmail)}
                  >
                    {send.isPending ? "Sending…" : "Send with PDF attached"}
                  </button>
                  {!sendTo.trim() && !bid.contactEmail && (
                    <div className="text-[12px] text-destructive">No property contact email — enter a recipient.</div>
                  )}
                </div>
              )}

              <div className="flex gap-[8px] mb-[8px]">
                {bid.status !== "won" && (
                  <button className={btnCard} onClick={() => update.mutate({ id: bid.id, data: { status: "won" } }, { onSuccess: invalidate })} disabled={update.isPending}>
                    Mark won
                  </button>
                )}
                {bid.status !== "lost" && (
                  <button className={btnCard} onClick={() => update.mutate({ id: bid.id, data: { status: "lost" } }, { onSuccess: invalidate })} disabled={update.isPending}>
                    Mark lost
                  </button>
                )}
                {bid.status === "sent" && (
                  <button className={btnCard} onClick={() => nudge.mutate({ id: bid.id }, { onSuccess: invalidate })} disabled={nudge.isPending}>
                    Nudge
                  </button>
                )}
              </div>

              <button
                className="w-full rounded-[11px] py-[10px] text-[13px] font-display font-bold text-destructive bg-card border border-border shadow-[var(--shadow)] disabled:opacity-50 transition-transform active:scale-[0.98] flex items-center justify-center gap-[6px]"
                onClick={() =>
                  confirmDelete
                    ? del.mutate(
                        { id: bid.id },
                        {
                          onSuccess: () => {
                            invalidate();
                            onOpenChange(false);
                          },
                        },
                      )
                    : setConfirmDelete(true)
                }
                disabled={del.isPending}
              >
                <Trash2 className="w-[14px] h-[14px]" />
                {del.isPending ? "Deleting…" : confirmDelete ? "Tap again to confirm delete" : "Delete bid"}
              </button>

              {feedback && (
                <div className="text-[12.5px] text-center mt-[10px] text-muted-foreground">{feedback}</div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
