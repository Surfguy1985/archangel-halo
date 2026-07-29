import React, { useState, useMemo } from 'react';
import { useCreateClientBoardCard } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { TEMPLATE_SPECS, TemplateSpec } from './templateSpec';
import { Layers, ArrowLeft } from 'lucide-react';

interface CreateCardDialogProps {
  token: string;
  // If provided, we pre-fill the lane and skip lane selection. If not, we ask for a lane.
  defaultLaneKey?: string; 
  defaultLaneLabel?: string;
  availableLanes: { key: string; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateCardDialog({ token, defaultLaneKey, defaultLaneLabel, availableLanes, open, onOpenChange }: CreateCardDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCard = useCreateClientBoardCard();

  const [step, setStep] = useState<'template' | 'form'>('template');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateSpec | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [laneKey, setLaneKey] = useState(defaultLaneKey || '');

  // Reset state when opening
  React.useEffect(() => {
    if (open) {
      setStep('template');
      setSelectedTemplate(null);
      setTitle('');
      setDescription('');
      setNotes('');
      setDueOn('');
      setLaneKey(defaultLaneKey || (availableLanes.length > 0 ? availableLanes[0].key : ''));
    }
  }, [open, defaultLaneKey, availableLanes]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    createCard.mutate({
      token,
      data: {
        title,
        lane: laneKey,
        template: selectedTemplate?.key ?? undefined,
        description: description || undefined,
        notes: notes || undefined,
        dueOn: dueOn || undefined,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Card created" });
        queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
        onOpenChange(false);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to create card", variant: "destructive" });
      }
    });
  };

  const categories = useMemo(() => {
    const cats: Record<string, TemplateSpec[]> = {};
    for (const spec of Object.values(TEMPLATE_SPECS)) {
      if (!cats[spec.categoryLabel]) cats[spec.categoryLabel] = [];
      cats[spec.categoryLabel].push(spec);
    }
    return cats;
  }, []);

  const selectTemplate = (spec: TemplateSpec) => {
    setSelectedTemplate(spec);
    setTitle(spec.name + ' - ');
    setStep('form');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl rounded-[24px] border border-black/10 shadow-[0_32px_64px_rgba(0,0,0,0.15)] p-0 overflow-hidden bg-[#fdfdfc]">
        
        {step === 'template' && (
          <div className="flex flex-col h-[70vh] max-h-[800px]">
            <div className="px-6 pt-6 pb-4 border-b border-black/5 bg-white shrink-0">
              <DialogHeader>
                <DialogTitle className="text-xl font-[800] text-[#101c33] flex items-center gap-2">
                  <Layers className="h-5 w-5 text-primary" />
                  Create a Card
                </DialogTitle>
                <DialogDescription className="text-[13px] font-[600] text-muted-foreground mt-1">
                  Choose a template from the library to get started.
                </DialogDescription>
              </DialogHeader>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-[#f4f3f0]">
              <div className="flex flex-col gap-8">
                {Object.entries(categories).map(([catLabel, specs]) => (
                  <div key={catLabel}>
                    <h4 className="text-[11px] font-[800] uppercase tracking-widest text-muted-foreground mb-3">{catLabel}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {specs.map(spec => (
                        <button
                          key={spec.key}
                          onClick={() => selectTemplate(spec)}
                          className="flex flex-col text-left p-4 rounded-[12px] bg-white border border-black/5 shadow-sm hover:shadow-md hover:border-black/10 transition-all active:scale-[0.98] group"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: spec.accent }} />
                            <span className="font-[800] text-[13px] text-[#101c33] group-hover:text-primary transition-colors">{spec.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-auto text-[10px] font-[600] text-muted-foreground uppercase">
                            <span className="bg-black/5 px-1.5 py-0.5 rounded-sm">{spec.codePrefix}</span>
                            <span>•</span>
                            <span>{spec.pipeline.length} stages</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'form' && (
          <form onSubmit={handleCreate} className="flex flex-col h-[70vh] max-h-[800px]">
            <div className="px-6 pt-6 pb-4 border-b border-black/5 bg-white shrink-0">
              <div className="flex items-center gap-3 mb-4">
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-black/5" onClick={() => setStep('template')}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <DialogTitle className="text-xl font-[800] text-[#101c33]">Configure Card</DialogTitle>
                  {selectedTemplate && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: selectedTemplate.accent }} />
                      <span className="text-[12px] font-[800] uppercase tracking-wider text-muted-foreground">{selectedTemplate.name}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 bg-[#f4f3f0] flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="title" className="text-[11px] font-[800] uppercase tracking-widest text-muted-foreground">Title</Label>
                <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required autoFocus className="h-12 rounded-[10px] font-[600] bg-white border-black/10 shadow-sm text-[15px]" />
              </div>

              {!defaultLaneKey && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="lane" className="text-[11px] font-[800] uppercase tracking-widest text-muted-foreground">Lane</Label>
                  <select
                    id="lane"
                    value={laneKey}
                    onChange={e => setLaneKey(e.target.value)}
                    required
                    className="h-12 rounded-[10px] font-[600] bg-white border border-black/10 shadow-sm text-[14px] px-3 focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  >
                    <option value="" disabled>Select a lane...</option>
                    {availableLanes.map(l => (
                      <option key={l.key} value={l.key}>{l.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="description" className="text-[11px] font-[800] uppercase tracking-widest text-muted-foreground">Description <span className="opacity-50">(Optional)</span></Label>
                <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} className="rounded-[10px] min-h-[100px] font-[500] bg-white border-black/10 shadow-sm resize-none" />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="dueOn" className="text-[11px] font-[800] uppercase tracking-widest text-muted-foreground">Due Date <span className="opacity-50">(Optional)</span></Label>
                <Input id="dueOn" type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} className="h-12 rounded-[10px] font-[600] bg-white border-black/10 shadow-sm w-full max-w-[200px]" />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="notes" className="text-[11px] font-[800] uppercase tracking-widest text-muted-foreground">Internal Notes <span className="opacity-50">(Optional)</span></Label>
                <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} className="rounded-[10px] min-h-[80px] font-[500] bg-white border-black/10 shadow-sm resize-none" />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-black/5 bg-white shrink-0">
              <DialogFooter className="gap-3 sm:gap-0">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-11 rounded-[8px] font-[800] text-muted-foreground hover:bg-black/5 hover:text-[#101c33]">
                  Cancel
                </Button>
                <Button type="submit" disabled={createCard.isPending} className="h-11 rounded-[8px] bg-[#d8f84e] text-[#101c33] font-[800] px-8 shadow-sm hover:shadow-md hover:brightness-105 active:scale-[0.98] transition-all">
                  {createCard.isPending ? 'Creating...' : 'Create Card'}
                </Button>
              </DialogFooter>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}