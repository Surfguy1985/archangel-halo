import { useEffect, useRef, useState } from 'react';
import {
  useCreateClientWorkRequest,
  useGetClientRequestOptions,
  getGetClientRequestOptionsQueryKey,
  getGetClientBoardQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { uploadFile } from '@/lib/upload';
import { Loader2, Camera, X, Siren } from 'lucide-react';

/** A job card the client is requesting a change against (change order mode). */
export type ChangeOrderTarget = { jobId: string; title: string };

/**
 * Request-work composer launched from the board, a unit box, or a job card
 * ("Request a change"). Reuses the /client/:token/requests flow — a submitted
 * request lands as a card in the Requested lane instantly (SSE push).
 */
export function RequestWorkDialog({
  token,
  open,
  onOpenChange,
  initialUnits,
  changeOrder,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUnits?: string[];
  changeOrder?: ChangeOrderTarget | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const options = useGetClientRequestOptions(token, {
    query: { queryKey: getGetClientRequestOptionsQueryKey(token), enabled: open },
  });
  const createRequest = useCreateClientWorkRequest();
  const fileInput = useRef<HTMLInputElement>(null);

  const [serviceId, setServiceId] = useState<string>('');
  const [customLabel, setCustomLabel] = useState('');
  const [units, setUnits] = useState<string[]>([]);
  const [unitInput, setUnitInput] = useState('');
  const [notes, setNotes] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [emergency, setEmergency] = useState(false);
  const [photos, setPhotos] = useState<Array<{ path: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);

  // Prefill units when opened from a unit box on the map.
  useEffect(() => {
    if (open && initialUnits?.length) setUnits((prev) => (prev.length ? prev : initialUnits));
  }, [open, initialUnits]);

  const services = options.data?.services ?? [];
  const unitLabels = options.data?.unitLabels ?? [];
  const picked = services.find((s) => s.id === serviceId) ?? null;
  const serviceLabel = picked ? picked.service : customLabel.trim();

  // Needed-by within 24h is auto-flagged as an emergency (mirrors the server).
  const within24h = (() => {
    if (!neededBy) return false;
    const [y, m, d] = neededBy.split('-').map(Number);
    if (!y || !m || !d) return false;
    return new Date(y, m - 1, d, 23, 59, 59).getTime() - Date.now() <= 24 * 3600 * 1000;
  })();
  const isEmergency = emergency || within24h;

  const toggleUnit = (label: string) => {
    setUnits((prev) => (prev.includes(label) ? prev.filter((u) => u !== label) : [...prev, label]));
  };

  const addTypedUnit = () => {
    const v = unitInput.trim();
    if (!v) return;
    if (!units.includes(v)) setUnits((prev) => [...prev, v]);
    setUnitInput('');
  };

  const attachPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 10 - photos.length)) {
        const up = await uploadFile(file);
        if (up) setPhotos((prev) => [...prev, { path: up.objectPath, name: file.name }]);
        else toast({ title: 'Photo upload failed', description: file.name, variant: 'destructive' });
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const reset = () => {
    setServiceId('');
    setCustomLabel('');
    setUnits([]);
    setUnitInput('');
    setNotes('');
    setNeededBy('');
    setEmergency(false);
    setPhotos([]);
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
          units,
          unitNo: units[0] ?? null,
          notes: notes.trim() || null,
          neededBy: neededBy || null,
          emergency: isEmergency,
          photoPaths: photos.map((p) => p.path),
          changeOrderJobId: changeOrder?.jobId ?? null,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: isEmergency ? 'Emergency request sent' : changeOrder ? 'Change request sent' : 'Request sent',
            description: isEmergency
              ? 'The office was alerted immediately.'
              : 'It’s on your board in Requested — we’ll review it right away.',
          });
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
      <DialogContent className="max-w-md rounded-[16px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold text-[#1d1d1f]">
            {changeOrder ? 'Request a change' : 'Request work'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {changeOrder && (
            <div data-testid="change-order-banner" className="rounded-[10px] bg-[#007AFF]/10 px-3 py-2 text-[12px] font-semibold text-[#0a5ac2]">
              Change on: {changeOrder.title}
            </div>
          )}
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

          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[#6e6e73]">
              Units {units.length > 0 && <span className="text-[#007AFF]">· {units.length} selected</span>}
            </label>
            {unitLabels.length > 0 ? (
              <div className="max-h-[128px] overflow-y-auto rounded-[10px] border border-black/10 bg-white p-2">
                <div className="flex flex-wrap gap-1.5">
                  {unitLabels.map((u) => (
                    <button
                      key={u}
                      type="button"
                      data-testid={`unit-chip-${u}`}
                      onClick={() => toggleUnit(u)}
                      className={`rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                        units.includes(u)
                          ? 'bg-[#007AFF] text-white'
                          : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  data-testid="input-request-unit"
                  value={unitInput}
                  onChange={(e) => setUnitInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTypedUnit();
                    }
                  }}
                  placeholder="e.g. 204 — press Enter to add"
                  className={inputCls}
                />
                <button type="button" onClick={addTypedUnit} className="shrink-0 rounded-[10px] bg-[#f5f5f7] px-3 text-[13px] font-semibold text-[#1d1d1f] hover:bg-[#e8e8ed]">
                  Add
                </button>
              </div>
            )}
            {units.length > 0 && unitLabels.length === 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {units.map((u) => (
                  <span key={u} className="flex items-center gap-1 rounded-full bg-[#007AFF]/10 px-2.5 py-0.5 text-[12px] font-semibold text-[#0a5ac2]">
                    {u}
                    <button type="button" onClick={() => toggleUnit(u)}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
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

          <button
            type="button"
            data-testid="toggle-request-emergency"
            onClick={() => setEmergency((v) => !v)}
            className={`flex w-full items-center gap-2.5 rounded-[10px] border px-3 py-2.5 transition-colors ${
              isEmergency
                ? 'border-[#FF3B30] bg-[#FF3B30]/10'
                : 'border-black/10 bg-white hover:bg-[#f5f5f7]'
            }`}
          >
            <Siren className={`h-4 w-4 ${isEmergency ? 'text-[#FF3B30]' : 'text-[#6e6e73]'}`} />
            <span className={`text-[13px] font-semibold ${isEmergency ? 'text-[#c62828]' : 'text-[#1d1d1f]'}`}>
              Emergency — needed within 24 hours
            </span>
            {within24h && !emergency && (
              <span className="ml-auto text-[11px] font-semibold text-[#c62828]">auto — date is ≤24h out</span>
            )}
          </button>

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

          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => attachPhotos(e.target.files)}
            />
            <button
              type="button"
              data-testid="button-request-photos"
              onClick={() => fileInput.current?.click()}
              disabled={uploading || photos.length >= 10}
              className="flex items-center gap-2 rounded-[10px] bg-[#f5f5f7] px-3 py-2 text-[13px] font-semibold text-[#1d1d1f] hover:bg-[#e8e8ed] transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4 text-[#007AFF]" />}
              {photos.length ? `Photos (${photos.length})` : 'Add photos'}
            </button>
            {photos.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {photos.map((p) => (
                  <span key={p.path} className="flex items-center gap-1 rounded-full bg-[#f5f5f7] px-2.5 py-0.5 text-[11px] font-medium text-[#1d1d1f]">
                    <span className="max-w-[120px] truncate">{p.name}</span>
                    <button type="button" onClick={() => setPhotos((prev) => prev.filter((x) => x.path !== p.path))}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            data-testid="button-request-submit"
            onClick={submit}
            disabled={createRequest.isPending || uploading}
            className={`w-full rounded-[10px] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 ${
              isEmergency ? 'bg-[#FF3B30]' : 'bg-[#007AFF]'
            }`}
          >
            {createRequest.isPending ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : isEmergency ? (
              'Send emergency request'
            ) : changeOrder ? (
              'Send change request'
            ) : (
              'Send request'
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
