import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Loader2, Camera, X, Siren, ChevronLeft, Plus } from 'lucide-react';

/** A job card the client is requesting a change against (change order mode). */
export type ChangeOrderTarget = { jobId: string; title: string };

// Local-date helper: date-only strings must come from LOCAL parts, never UTC.
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STEPS = ['What & Where', 'When & How Much', 'PO & Confirm'] as const;

/**
 * Request-work wizard: three sliding steps, one decision per screen, nothing
 * starts blank where the system knows a value (roster units, price-list
 * services + rates, deadline quick chips). Reuses /client/:token/requests —
 * a submitted request lands in the Requested lane instantly (SSE push).
 */
export function RequestWorkDialog({
  token,
  open,
  onOpenChange,
  initialUnits,
  changeOrder,
  elevated,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUnits?: string[];
  changeOrder?: ChangeOrderTarget | null;
  /** Raise z-index above the Presentation Mode overlay so the wizard is visible. */
  elevated?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const options = useGetClientRequestOptions(token, {
    query: { queryKey: getGetClientRequestOptionsQueryKey(token), enabled: open },
  });
  const createRequest = useCreateClientWorkRequest();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState<string>('');
  const [customLabel, setCustomLabel] = useState('');
  const [units, setUnits] = useState<string[]>([]);
  const [unitInput, setUnitInput] = useState('');
  const [addingUnit, setAddingUnit] = useState(false);
  const [notes, setNotes] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [deadlineChip, setDeadlineChip] = useState<string>(''); // today | 48h | week | pick | ''
  const [budget, setBudget] = useState('');
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [poNumber, setPoNumber] = useState('');
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

  // Budget pre-fill: price-list rate × units picked (min 1). The client's own
  // number always wins once they touch the field.
  const suggestedBudget = useMemo(() => {
    const rate = picked?.rate;
    if (typeof rate !== 'number' || rate <= 0) return null;
    return Math.round(rate * Math.max(units.length, 1) * 100) / 100;
  }, [picked, units.length]);
  useEffect(() => {
    if (!budgetTouched) setBudget(suggestedBudget != null ? String(suggestedBudget) : '');
  }, [suggestedBudget, budgetTouched]);

  // Needed-by within 24h is auto-flagged as an emergency (mirrors the server).
  const within24h = (() => {
    if (!neededBy) return false;
    const [y, m, d] = neededBy.split('-').map(Number);
    if (!y || !m || !d) return false;
    return new Date(y, m - 1, d, 23, 59, 59).getTime() - Date.now() <= 24 * 3600 * 1000;
  })();
  const isEmergency = emergency || within24h;

  const deadlineChips = useMemo(() => {
    const now = new Date();
    const in2 = new Date(now);
    in2.setDate(now.getDate() + 2);
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + ((7 - now.getDay()) % 7 || 7)); // next Sunday
    return [
      { key: 'today', label: 'Today', value: localYmd(now) },
      { key: '48h', label: '48 hrs', value: localYmd(in2) },
      { key: 'week', label: 'This week', value: localYmd(endOfWeek) },
      { key: 'pick', label: 'Pick a date', value: '' },
    ];
  }, [open]);

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
    setStep(0);
    setServiceId('');
    setCustomLabel('');
    setUnits([]);
    setUnitInput('');
    setAddingUnit(false);
    setNotes('');
    setNeededBy('');
    setDeadlineChip('');
    setBudget('');
    setBudgetTouched(false);
    setEmergency(false);
    setPoNumber('');
    setPhotos([]);
  };

  const stepOneValid = !!serviceLabel;

  const next = () => {
    if (step === 0 && !stepOneValid) {
      toast({ title: 'What work do you need?', description: 'Pick a service or describe it.', variant: 'destructive' });
      return;
    }
    setStep((s) => Math.min(s + 1, 2));
  };

  const submit = () => {
    if (!serviceLabel) return;
    if (!isEmergency && !poNumber.trim()) {
      toast({
        title: 'PO number required',
        description: 'Add your PO number — or mark it as an emergency and the office will approve it manually.',
        variant: 'destructive',
      });
      return;
    }
    const budgetNum = Number(budget);
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
          poNumber: poNumber.trim() || null,
          photoPaths: photos.map((p) => p.path),
          changeOrderJobId: changeOrder?.jobId ?? null,
          budgetEstimate: Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : null,
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
  const labelCls = 'mb-1 block text-[12px] font-semibold text-[#6e6e73]';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setStep(0);
        onOpenChange(o);
      }}
    >
      <DialogContent
        className={`flex h-[min(92vh,720px)] max-w-md flex-col gap-0 rounded-[16px] p-0 ${elevated ? 'z-[95]' : ''}`}
        overlayClassName={elevated ? 'z-[94]' : undefined}
      >
        <DialogHeader className="shrink-0 border-b border-black/5 px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                data-testid="wizard-back"
                onClick={() => setStep((s) => Math.max(s - 1, 0))}
                className="-ml-1 rounded-full p-1 text-[#6e6e73] hover:bg-black/5"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <DialogTitle className="text-[17px] font-semibold text-[#1d1d1f]">
              {changeOrder ? 'Request a change' : 'Request work'}
            </DialogTitle>
          </div>
          {/* Step dots + label */}
          <div className="mt-2 flex items-center gap-2">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-[#007AFF]' : 'bg-black/10'}`}
              />
            ))}
          </div>
          <div data-testid="wizard-step-label" className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-[#6e6e73]">
            Step {step + 1} of 3 · {STEPS[step]}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {changeOrder && (
            <div data-testid="change-order-banner" className="mb-3 rounded-[10px] bg-[#007AFF]/10 px-3 py-2 text-[12px] font-semibold text-[#0a5ac2]">
              Change on: {changeOrder.title}
            </div>
          )}

          {/* ------------------------------------------------ Step 1 — What & Where */}
          {step === 0 && (
            <div className="space-y-4" data-testid="wizard-step-what">
              {services.length > 0 && (
                <div>
                  <label className={labelCls}>Service</label>
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
                  <label className={labelCls}>What needs doing?</label>
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
                <label className={labelCls}>
                  Units {units.length > 0 && <span className="text-[#007AFF]">· {units.length} selected</span>}
                </label>
                {unitLabels.length > 0 ? (
                  <div className="max-h-[200px] overflow-y-auto rounded-[10px] border border-black/10 bg-white p-2">
                    {/* Featured box — add a unit that isn't on the roster yet */}
                    {addingUnit ? (
                      <div className="mb-2 flex gap-2 rounded-[10px] border-2 border-[#B4FF44] bg-[#B4FF44]/15 p-2">
                        <input
                          data-testid="input-new-unit"
                          autoFocus
                          value={unitInput}
                          onChange={(e) => setUnitInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addTypedUnit();
                            }
                            if (e.key === 'Escape') {
                              setAddingUnit(false);
                              setUnitInput('');
                            }
                          }}
                          placeholder="New unit — e.g. 204"
                          className="h-9 w-full min-w-0 rounded-[8px] border border-black/10 bg-white px-2.5 text-[13px] outline-none focus:border-[#1d1d1f]"
                        />
                        <button
                          type="button"
                          data-testid="button-add-new-unit"
                          onClick={addTypedUnit}
                          className="shrink-0 rounded-[8px] bg-[#B4FF44] px-3 text-[13px] font-bold text-black"
                        >
                          Add
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid="button-new-unit"
                        onClick={() => setAddingUnit(true)}
                        className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-[10px] border-2 border-dashed border-[#9DB40F] bg-[#B4FF44]/15 px-3 py-2 text-[13px] font-bold text-[#3a4708] hover:bg-[#B4FF44]/30"
                      >
                        <Plus className="h-4 w-4" strokeWidth={2.5} />
                        Add a new unit
                      </button>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {[...unitLabels, ...units.filter((u) => !unitLabels.includes(u))].map((u) => (
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
                <label className={labelCls}>Details (optional)</label>
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
            </div>
          )}

          {/* --------------------------------------------- Step 2 — When & How Much */}
          {step === 1 && (
            <div className="space-y-4" data-testid="wizard-step-when">
              <div>
                <label className={labelCls}>When do you need it?</label>
                <div className="flex flex-wrap gap-1.5">
                  {deadlineChips.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      data-testid={`deadline-chip-${c.key}`}
                      onClick={() => {
                        setDeadlineChip(c.key);
                        if (c.key !== 'pick') setNeededBy(c.value);
                      }}
                      className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                        deadlineChip === c.key
                          ? 'bg-[#007AFF] text-white'
                          : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {deadlineChip === 'pick' && (
                  <input
                    data-testid="input-request-needed-by"
                    type="date"
                    value={neededBy}
                    onChange={(e) => setNeededBy(e.target.value)}
                    className={inputCls + ' mt-2'}
                  />
                )}
                {within24h && (
                  <p className="mt-1.5 text-[11px] font-medium text-[#c62828]">
                    That's within 24 hours — this becomes an emergency request and the office is alerted immediately.
                  </p>
                )}
              </div>

              <div>
                <label className={labelCls}>
                  Budget{' '}
                  {suggestedBudget != null && !budgetTouched && (
                    <span className="text-[#007AFF]">· from your price list</span>
                  )}
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-[#6e6e73]">$</span>
                  <input
                    data-testid="input-request-budget"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={budget}
                    onChange={(e) => {
                      setBudgetTouched(true);
                      setBudget(e.target.value);
                    }}
                    placeholder="0.00"
                    className={inputCls + ' pl-7'}
                  />
                </div>
                {picked?.rate != null && (
                  <p className="mt-1 text-[11px] text-[#6e6e73]">
                    {picked.service}: ${picked.rate.toLocaleString()}
                    {picked.unit ? ` ${picked.unit}` : ''}
                    {units.length > 1 ? ` × ${units.length} units` : ''}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ------------------------------------------------ Step 3 — PO & Confirm */}
          {step === 2 && (
            <div className="space-y-4" data-testid="wizard-step-confirm">
              <div>
                <label className={labelCls}>
                  PO number {isEmergency ? '(optional for emergencies)' : '(required)'}
                </label>
                <div className="flex items-stretch gap-2">
                  <input
                    data-testid="input-request-po-number"
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder={isEmergency ? 'PO # (can follow later)' : 'PO #'}
                    className={inputCls + ' flex-1'}
                  />
                  <button
                    type="button"
                    data-testid="toggle-request-emergency"
                    onClick={() => setEmergency((v) => !v)}
                    title="Emergency — skip the PO; the office reviews and approves it manually"
                    className={`flex shrink-0 items-center gap-1.5 rounded-[10px] border px-3 transition-colors ${
                      isEmergency
                        ? 'border-[#FF3B30] bg-[#FF3B30]/10'
                        : 'border-black/10 bg-white hover:bg-[#f5f5f7]'
                    }`}
                  >
                    <Siren className={`h-4 w-4 ${isEmergency ? 'text-[#FF3B30]' : 'text-[#6e6e73]'}`} />
                    <span className={`text-[13px] font-semibold ${isEmergency ? 'text-[#c62828]' : 'text-[#1d1d1f]'}`}>
                      Emergency
                    </span>
                  </button>
                </div>
                {isEmergency ? (
                  <p className="mt-1 text-[11px] font-medium text-[#c62828]">
                    {within24h && !emergency ? 'Auto-flagged — the date is ≤24h out. ' : ''}
                    No PO needed — the office is alerted immediately and will approve &amp; post it manually.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-[#6e6e73]">
                    Requests can't be sent without a PO — unless it's an emergency.
                  </p>
                )}
              </div>

              {/* Compact confirm summary */}
              <div data-testid="wizard-summary" className="space-y-2 rounded-[12px] bg-[#f5f5f7] p-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#6e6e73]">Review</div>
                <SummaryRow label="Work" value={serviceLabel || '—'} />
                <SummaryRow label="Units" value={units.length ? units.join(', ') : 'Not specified'} />
                <SummaryRow label="Needed by" value={neededBy || 'Flexible'} />
                <SummaryRow label="Budget" value={budget ? `$${Number(budget).toLocaleString()}` : 'Not set'} />
                <SummaryRow label="Photos" value={photos.length ? `${photos.length} attached` : 'None'} />
                {notes.trim() && <SummaryRow label="Notes" value={notes.trim()} />}
              </div>
            </div>
          )}
        </div>

        {/* One primary button per screen */}
        <div className="shrink-0 border-t border-black/5 px-5 py-4">
          {step < 2 ? (
            <button
              data-testid="wizard-next"
              onClick={next}
              className="w-full rounded-[10px] bg-[#007AFF] py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Continue
            </button>
          ) : (
            <button
              data-testid="button-request-submit"
              onClick={submit}
              disabled={createRequest.isPending || uploading}
              className={`w-full rounded-[10px] py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 ${
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[13px]">
      <span className="shrink-0 font-semibold text-[#6e6e73]">{label}</span>
      <span className="text-right font-medium text-[#1d1d1f]">{value}</span>
    </div>
  );
}
