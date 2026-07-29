import React, { useState, useEffect } from 'react';
import { ClientBoardCardView, useUpdateClientBoardCard, getGetClientBoardQueryKey, getGetClientPmBoardQueryKey } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { CardModuleDetail } from '../CardModuleDetail';

interface CardDetailDialogProps {
  card: ClientBoardCardView | null;
  token: string;
  readOnly: boolean;
  onClose: () => void;
}

export function CardDetailDialog({ card, token, readOnly, onClose }: CardDetailDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateCard = useUpdateClientBoardCard();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [priority, setPriority] = useState<string>('');

  useEffect(() => {
    if (card) {
      setTitle(card.title || '');
      setDescription(card.description || '');
      setNotes(card.notes || '');
      setDueOn(card.dueOn || '');
      setPriority(card.priority || '');
    }
  }, [card]);

  if (!card) return null;

  const isFullyEditable = card.editable && !readOnly;
  const isNotesEditable = !readOnly;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;

    const data: any = { notes };
    if (isFullyEditable) {
      data.title = title;
      data.description = description;
      data.dueOn = dueOn || undefined;
      data.priority = priority || undefined;
    }

    updateCard.mutate({
      token,
      cardKey: card.cardKey,
      data
    }, {
      onSuccess: () => {
        toast({ title: "Card updated" });
        queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
        queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        onClose();
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update card", variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={!!card} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-[28px] border-black/5 shadow-[0_24px_64px_rgba(0,0,0,0.15)] p-0">
        <form onSubmit={handleSave} className="flex flex-col h-full">
          <div className="px-8 pt-8 pb-4">
            <DialogHeader>
              <DialogTitle className="text-xl font-[800] text-[#101c33]">Card Details</DialogTitle>
              <DialogDescription className="font-[600] uppercase tracking-wider text-xs">
                {card.cardKey} • {card.template}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex flex-col gap-6 px-8 py-4">
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="title" className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">Title</Label>
              {isFullyEditable ? (
                <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required className="h-11 rounded-xl font-[600]" />
              ) : (
                <div className="text-[15px] font-[800] leading-snug">{card.title}</div>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="description" className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">Description</Label>
              {isFullyEditable ? (
                <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} className="rounded-xl min-h-[80px] font-[500]" />
              ) : (
                <div className="text-[13px] font-[500] leading-relaxed bg-black/[0.02] p-4 rounded-xl border border-black/5">
                  {card.description || <span className="text-muted-foreground italic">No description provided</span>}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="notes" className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">Client Notes</Label>
              {isNotesEditable ? (
                <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add private notes here..." className="rounded-xl min-h-[80px] font-[500]" />
              ) : (
                <div className="text-[13px] font-[500] leading-relaxed bg-black/[0.02] p-4 rounded-xl border border-black/5">
                  {card.notes || <span className="text-muted-foreground italic">No notes</span>}
                </div>
              )}
            </div>

            {isFullyEditable && (
              <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col gap-2.5">
                  <Label htmlFor="dueOn" className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">Due Date</Label>
                  <Input id="dueOn" type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} className="h-11 rounded-xl font-[600]" />
                </div>
                <div className="flex flex-col gap-2.5">
                  <Label htmlFor="priority" className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">Priority</Label>
                  <select
                    id="priority"
                    className="h-11 rounded-xl border border-input bg-background px-3 text-sm font-[600]"
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                  >
                    <option value="">None</option>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
            )}
            
            {/* Readonly info for context */}
            {!isFullyEditable && card.dueOn && (
              <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-black/[0.02] border border-black/5">
                <span className="text-[10px] font-[800] uppercase tracking-widest text-muted-foreground">Due Date</span>
                <span className="text-[13px] font-[800]">{card.dueOn}</span>
              </div>
            )}
            
            {card.module && (
              <div className="mt-2 p-4 rounded-xl bg-black/[0.02] border border-black/5">
                <CardModuleDetail module={card.module} token={token} cardKey={card.cardKey} readOnly={readOnly} />
              </div>
            )}
          </div>

          <div className="px-8 py-6 mt-2 bg-black/[0.015] border-t border-black/5">
            <DialogFooter className="gap-3 sm:gap-0">
              <Button type="button" variant="outline" onClick={onClose} className="h-10 rounded-xl font-[800]">
                {isNotesEditable || isFullyEditable ? 'Cancel' : 'Close'}
              </Button>
              {(isNotesEditable || isFullyEditable) && (
                <Button type="submit" disabled={updateCard.isPending} className="h-10 rounded-xl bg-[#d8f84e] text-[#101c33] font-[800] shadow-[0_2px_12px_rgba(216,248,78,0.3)] hover:bg-[#c8e83e] hover:shadow-[0_4px_16px_rgba(216,248,78,0.4)]">
                  {updateCard.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              )}
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}