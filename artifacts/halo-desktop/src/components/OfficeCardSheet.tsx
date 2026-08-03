import React, { useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { WaybillStrip, railFor, plainStatus } from "@workspace/board-ui";

/**
 * OfficeCardSheet — the office-side detail sheet for a board row.
 * Deliberately mirrors the client's CardDetailDialog IA (header with
 * cardKey • template, waybill strip, title / description / notes sections)
 * so both sides of the mirror read the same way; office actions live in
 * the footer. Keyboard: C comments, Esc closes (Dialog handles it).
 */
export function OfficeCardSheet({
  card,
  lanes,
  onClose,
  onMove,
  onComments,
  onRemove,
}: {
  card: any | null;
  lanes: Array<{ key: string; label: string }>;
  onClose: () => void;
  onMove: (cardKey: string, laneKey: string) => void;
  onComments: (card: any) => void;
  /** Only offered for office-pushed cards; HALO-derived cards clear themselves. */
  onRemove: ((card: any) => void) | null;
}) {
  // Action keys while the sheet is open — same letters as the list hints.
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "c" || e.key === "C") { e.preventDefault(); onComments(card); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, onComments]);

  if (!card) return null;
  const rail = railFor(card);
  const status = plainStatus(card, rail);

  const section = (label: string, value: React.ReactNode) => (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">{label}</Label>
      <div className="text-[13px] font-[500] leading-relaxed bg-black/[0.02] p-4 rounded-xl border border-black/5">
        {value}
      </div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="office-card-sheet">
        <DialogHeader>
          <DialogTitle className="text-xl font-[800]">Card Details</DialogTitle>
          <DialogDescription className="font-[600] uppercase tracking-wider text-xs">
            {card.cardKey} • {card.template}
          </DialogDescription>
        </DialogHeader>

        {card.waybill?.stages && (
          <WaybillStrip
            code={card.waybillCode}
            stages={card.waybill.stages}
            holder={card.waybill.holder}
            live={card.waybill.live !== false}
          />
        )}

        <div className="flex flex-col gap-5 py-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">Title</Label>
            <div className="text-[15px] font-[800] leading-snug" data-testid="sheet-title">{card.title}</div>
            <div className="text-[12px] font-semibold text-muted-foreground">
              {status}
              {typeof card.amount === "number" && (
                <span className="ml-2 tabular-nums">${card.amount.toLocaleString()}</span>
              )}
            </div>
          </div>

          {section("Description", card.description || <span className="text-muted-foreground italic">No description provided</span>)}
          {section("Client notes", card.notes || <span className="text-muted-foreground italic">No notes</span>)}

          <div className="flex flex-col gap-2">
            <Label className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">Move to</Label>
            <div className="flex flex-wrap gap-2">
              {lanes.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  data-testid={`sheet-move-${l.key}`}
                  disabled={l.key === card.lane}
                  onClick={() => onMove(card.cardKey, l.key)}
                  className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
                    l.key === card.lane
                      ? "border-[#041029] bg-[#041029] text-[#B4FF44]"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {onRemove && (
            <Button variant="outline" onClick={() => onRemove(card)} data-testid="sheet-remove">
              Remove
            </Button>
          )}
          <Button onClick={() => onComments(card)} data-testid="sheet-comments">
            Comments <span className="ml-1.5 opacity-60">C</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
