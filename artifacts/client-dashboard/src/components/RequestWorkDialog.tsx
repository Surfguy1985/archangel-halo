import { useState } from 'react';
import {
  useCreateClientWorkRequest,
  useGetClientRequestOptions,
  getGetClientRequestOptionsQueryKey,
  getGetClientBoardQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

/**
 * Request-work composer launched from the board. Reuses the existing
 * /client/:token/requests flow (same one the office Pipeline consumes) —
 * a submitted request lands as a card in the Requested lane on next read.
 */
export function RequestWorkDialog({
  token,
  open,
  onOpenChange,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const options = useGetClientRequestOptions(token, {
    query: { queryKey: getGetClientRequestOptionsQueryKey(token), enabled: open },
  });
  const createRequest = useCreateClientWorkRequest();

  const [serviceId, setServiceId] = useState<string>('');
  const [customLabel, setCustomLabel] = useState('');
  const [unitNo, setUnitNo] = useState('');
  const [notes, setNotes] = useState('');
  const [neededBy, setNeededBy] = useState('');

  const services = options.data?.services ?? [];
  const picked = services.find((s) => s.id === serviceId) ?? null;
  const serviceLabel = picked ? picked.service : customLabel.trim();

  const reset = () => {
    setServiceId('');
    setCustomLabel('');
    setUnitNo('');
    setNotes('');
    setNeededBy('');
  };

  const submit = () => {
    if (!serviceLabel) {
      toast({ title: 'What work do you need?', description: 'Pick a service or describe it.', variant: 'destructive' });
      return;
    }
    createRequest.mutate(
      {
        token,
        data: {
          serviceId: picked ? picked.id : null,
          serviceLabel,
          unitNo: unitNo.trim() || null,
          notes: notes.trim() || null,
          neededBy: neededBy || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: 'Request sent', description: 'It’s on your board in Requested — we’ll review it right away.' });
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          reset();
          onOpenChange(false);
        },
        onError: (err: any) => {
          toast({
            title: 'Could not send request',
            description: err?.data?.error ?? 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const inputCls =
    'w-full rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-[16px]">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold text-[#1d1d1f]">Request work</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {services.length > 0 && (
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#6e6e73]">Service</label>
              <select
                data-testid="select-request-service"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className={inputCls}
              >
                <option value="">Something else…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.service}
                    {s.detail ? ` — ${s.detail}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!picked && (
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#6e6e73]">What needs doing?</label>
              <input
                data-testid="input-request-label"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="e.g. Pressure wash breezeways, building C"
                className={inputCls}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#6e6e73]">Unit (optional)</label>
              <input
                data-testid="input-request-unit"
                value={unitNo}
                onChange={(e) => setUnitNo(e.target.value)}
                placeholder="e.g. 204"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#6e6e73]">Needed by (optional)</label>
              <input
                data-testid="input-request-needed-by"
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[#6e6e73]">Details (optional)</label>
            <textarea
              data-testid="input-request-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything the crew should know"
              className={inputCls}
            />
          </div>
          <button
            data-testid="button-request-submit"
            onClick={submit}
            disabled={createRequest.isPending}
            className="w-full rounded-[10px] bg-[#007AFF] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {createRequest.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Send request'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
