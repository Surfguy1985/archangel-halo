import React, { useState } from 'react';
import { useCreateClientBoardCard } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';

interface CreateCardDialogProps {
  token: string;
  laneKey: string;
  laneLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateCardDialog({ token, laneKey, laneLabel, open, onOpenChange }: CreateCardDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCard = useCreateClientBoardCard();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [dueOn, setDueOn] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    createCard.mutate({
      token,
      data: {
        title,
        lane: laneKey,
        description: description || undefined,
        notes: notes || undefined,
        dueOn: dueOn || undefined,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Card created" });
        queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
        setTitle('');
        setDescription('');
        setNotes('');
        setDueOn('');
        onOpenChange(false);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to create card", variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[28px] border-black/5 shadow-[0_24px_64px_rgba(0,0,0,0.15)] p-0 overflow-hidden">
        <form onSubmit={handleCreate} className="flex flex-col">
          <div className="px-8 pt-8 pb-4">
            <DialogHeader>
              <DialogTitle className="text-xl font-[800] text-[#101c33]">Add New Card</DialogTitle>
              <DialogDescription className="font-[600] uppercase tracking-wider text-xs">
                Adding to lane: <strong className="text-[#101c33] font-[800]">{laneLabel}</strong>
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex flex-col gap-5 px-8 py-4">
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="title" className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">Title</Label>
              <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required placeholder="e.g. Broken sprinkler at building 4" className="h-11 rounded-xl font-[600]" />
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="description" className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">Description <span className="opacity-50">(Optional)</span></Label>
              <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Provide more details..." className="rounded-xl min-h-[80px] font-[500]" />
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="dueOn" className="text-xs font-[800] uppercase tracking-widest text-muted-foreground">Due Date <span className="opacity-50">(Optional)</span></Label>
              <Input id="dueOn" type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} className="h-11 rounded-xl font-[600]" />
            </div>
          </div>

          <div className="px-8 py-6 mt-2 bg-black/[0.015] border-t border-black/5">
            <DialogFooter className="gap-3 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-10 rounded-xl font-[800]">
                Cancel
              </Button>
              <Button type="submit" disabled={createCard.isPending} className="h-10 rounded-xl bg-[#d8f84e] text-[#101c33] font-[800] shadow-[0_2px_12px_rgba(216,248,78,0.3)] hover:bg-[#c8e83e] hover:shadow-[0_4px_16px_rgba(216,248,78,0.4)]">
                {createCard.isPending ? 'Creating...' : 'Create Card'}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}