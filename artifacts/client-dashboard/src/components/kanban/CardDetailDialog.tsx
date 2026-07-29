import React, { useState, useEffect } from 'react';
import { ClientBoardCardView, useUpdateClientBoardCard } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';

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
        onClose();
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update card", variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={!!card} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>Card Details</DialogTitle>
            <DialogDescription>
              {card.cardKey} • {card.template}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Title</Label>
              {isFullyEditable ? (
                <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required />
              ) : (
                <div className="text-sm font-semibold">{card.title}</div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description</Label>
              {isFullyEditable ? (
                <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} />
              ) : (
                <div className="text-sm">{card.description || <span className="text-muted-foreground italic">No description</span>}</div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="notes">Client Notes</Label>
              {isNotesEditable ? (
                <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add private notes here..." />
              ) : (
                <div className="text-sm">{card.notes || <span className="text-muted-foreground italic">No notes</span>}</div>
              )}
            </div>

            {isFullyEditable && (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dueOn">Due Date</Label>
                  <Input id="dueOn" type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="priority">Priority</Label>
                  <select
                    id="priority"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
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
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">Due Date</span>
                <span className="text-sm">{card.dueOn}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {isNotesEditable || isFullyEditable ? 'Cancel' : 'Close'}
            </Button>
            {(isNotesEditable || isFullyEditable) && (
              <Button type="submit" disabled={updateCard.isPending}>
                {updateCard.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
