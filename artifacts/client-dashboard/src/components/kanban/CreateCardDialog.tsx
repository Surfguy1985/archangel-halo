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
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>Add New Card</DialogTitle>
            <DialogDescription>
              Adding to lane: <strong>{laneLabel}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required placeholder="e.g. Broken sprinkler at building 4" />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Provide more details..." />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="dueOn">Due Date (Optional)</Label>
              <Input id="dueOn" type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createCard.isPending}>
              {createCard.isPending ? 'Creating...' : 'Create Card'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
