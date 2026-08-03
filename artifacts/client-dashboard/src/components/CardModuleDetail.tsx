import { ExternalLink, CheckCircle2, Circle, FileText, Check, Users, Receipt, List, MapPin, AlertTriangle, Camera, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useEffect, useState } from 'react';
import { useClientBoardCardAction, getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { PdfViewerDialog } from './PdfViewerDialog';
import { BirdseyeMapDialog } from './BirdseyeMapDialog';
import { ModuleDecision } from './kanban/BoardCardModules';

function PhotoGallery({ photos }: { photos: { url: string; phase?: string | null }[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  if (!photos || photos.length === 0) return null;
  const phaseOrder = (p?: string | null) => (p === 'before' ? 0 : p === 'after' ? 2 : 1);
  const sorted = [...photos].sort((a, b) => phaseOrder(a.phase) - phaseOrder(b.phase));
  return (
    <div className="space-y-3">
      <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground flex items-center gap-2">
        <Camera className="w-4 h-4" /> Photos ({sorted.length})
      </h4>
      <div className="grid grid-cols-3 gap-2">
        {sorted.map((p, i) => (
          <button key={i} type="button" onClick={() => setLightbox(i)} className="relative aspect-square rounded-xl overflow-hidden border border-border group">
            <img src={p.url} alt={p.phase || 'photo'} className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
            {p.phase && (
              <span className={`absolute bottom-1 left-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md text-white ${p.phase === 'before' ? 'bg-slate-700/90' : p.phase === 'after' ? 'bg-emerald-600/90' : 'bg-sky-600/90'}`}>
                {p.phase}
              </span>
            )}
          </button>
        ))}
      </div>
      {lightbox !== null && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button type="button" className="absolute top-4 right-4 text-white/80 hover:text-white p-2" onClick={() => setLightbox(null)}>
            <X className="w-6 h-6" />
          </button>
          <img src={sorted[lightbox].url} alt="" className="max-h-[80vh] max-w-full rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
          <div className="mt-3 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {sorted[lightbox].phase && (
              <span className={`text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white ${sorted[lightbox].phase === 'before' ? 'bg-slate-600' : sorted[lightbox].phase === 'after' ? 'bg-emerald-600' : 'bg-sky-600'}`}>
                {sorted[lightbox].phase}
              </span>
            )}
            <span className="text-white/70 text-xs font-medium">{lightbox + 1} / {sorted.length}</span>
            <button type="button" disabled={lightbox === 0} onClick={() => setLightbox(lightbox - 1)} className="px-3 py-1 rounded-lg bg-white/10 text-white text-xs font-bold disabled:opacity-30">Prev</button>
            <button type="button" disabled={lightbox === sorted.length - 1} onClick={() => setLightbox(lightbox + 1)} className="px-3 py-1 rounded-lg bg-white/10 text-white text-xs font-bold disabled:opacity-30">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CardModuleDetail({ module, token, cardKey, readOnly, onReadOnlyClick }: { module: any; token: string; cardKey?: string; readOnly?: boolean; onReadOnlyClick?: () => void }) {
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);
  const [birdseyeOpen, setBirdseyeOpen] = useState(false);

  if (!module) return null;

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* INVOICE — guided approve → pay flow inside the detail view */}
      {module.type === 'invoice' && (
        <InvoiceApprovePay
          module={module}
          token={token}
          cardKey={cardKey}
          readOnly={!!readOnly}
          onReadOnlyClick={onReadOnlyClick}
          onViewPdf={(url) => setPdfViewerUrl(url)}
        />
      )}

      {/* FLAGS — attention items with schedule action */}
      {module.type === 'flags' && (
        <div className="space-y-4">
          <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> {module.totalCount || module.items?.length || 0} Flagged Items
          </h4>
          <div className="space-y-2">
            {(module.items || []).map((it: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-muted/30 rounded-xl border border-border">
                <div className="w-2 h-2 rounded-full bg-destructive mt-1.5 shrink-0" />
                <div className="min-w-0">
                  {it.unit && <div className="text-[10px] font-mono font-bold text-muted-foreground">{it.unit}</div>}
                  <div className="text-sm font-medium">{it.label}</div>
                </div>
              </div>
            ))}
          </div>
          {module.requestedAt ? (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="w-4 h-4" /> Work requested — the office is on it.
            </div>
          ) : cardKey ? (
            <ModuleDecision cardKey={cardKey} token={token} module={module} readOnly={!!readOnly} onReadOnlyClick={onReadOnlyClick} tint={{ bd: '#e8e8ed' }} />
          ) : null}
        </div>
      )}

      {/* PHOTOS — gallery with lightbox */}
      {module.type === 'photos' && (
        <PhotoGallery photos={(module.photoUrls || []).map((u: string) => ({ url: u }))} />
      )}

      {/* SUMMARY */}
      {module.type === 'summary' && (
        <div className="space-y-6">
          {/* Recap header — works for both old (counts-only) and new (full) snapshots */}
          <div className="flex flex-wrap items-center gap-2">
            {module.result && (
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                module.result === 'exceeded' ? 'bg-emerald-500/10 text-emerald-600' :
                module.result === 'followup' ? 'bg-amber-500/10 text-amber-600' :
                'bg-muted text-muted-foreground'
              }`}>{module.result === 'exceeded' ? 'Exceeded expectations' : module.result === 'followup' ? 'Follow-up needed' : 'Standards met'}</span>
            )}
            {module.unitNo && <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-muted text-muted-foreground">Unit {module.unitNo}</span>}
            {module.crewLead && <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{module.crewLead}</span>}
            {module.serviceDate && <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{module.serviceDate}</span>}
          </div>
          {typeof module.flagCount === 'number' && module.flagCount > 0 && (!module.flaggedItems || module.flaggedItems.length === 0) && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-sm font-medium text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {module.flagCount} item{module.flagCount === 1 ? '' : 's'} flagged during this visit — see the full recap for details.
            </div>
          )}
          {(module.taskSections || []).map((sec: any, i: number) => (
            <div key={i} className="space-y-3">
              <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground">{sec.title}</h4>
              <div className="space-y-2">
                {sec.items?.map((item: any, j: number) => (
                  <div key={j} className="flex items-start gap-3 p-3 bg-muted/30 rounded-xl border border-border">
                    {item.checked ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground/30 shrink-0 mt-0.5" />
                    )}
                    <span className={`text-sm font-medium leading-relaxed ${item.checked ? 'text-foreground' : 'text-muted-foreground line-through decoration-muted-foreground/30'}`}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {module.flaggedItems && module.flaggedItems.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> Flagged During Visit
              </h4>
              {module.flaggedItems.map((f: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-amber-500/5 rounded-xl border border-amber-500/20">
                  <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{f.label}</div>
                    {f.note && <div className="text-xs text-muted-foreground mt-0.5">{f.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {module.photos && module.photos.length > 0 && <PhotoGallery photos={module.photos} />}
          {module.observations && (
            <div className="space-y-2">
              <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground">Crew Observations</h4>
              <p className="text-sm font-medium leading-relaxed p-3 bg-muted/30 rounded-xl border border-border">{module.observations}</p>
            </div>
          )}
          {module.summaryUrl && (
            <a href={module.summaryUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-bold text-sm rounded-lg hover:bg-primary/90 transition-colors">
              <ExternalLink className="w-4 h-4" /> View Full Web Recap
            </a>
          )}
        </div>
      )}

      {/* CREWMAP */}
      {module.type === 'crewmap' && module.crews && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground">Dispatched Crews</h4>
            <button onClick={() => setBirdseyeOpen(true)} className="text-xs font-bold bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors">
              Live Map
            </button>
          </div>
          <div className="grid gap-3">
            {module.crews.map((c: any, i: number) => (
              <div key={i} className="flex items-start gap-4 p-4 bg-muted/30 rounded-xl border border-border">
                <div className="relative">
                  {c.selfieUrl ? (
                    <img src={c.selfieUrl} alt={c.crewName} className="w-12 h-12 rounded-full object-cover border-2 border-background shadow-sm" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center font-bold text-lg border-2 border-background shadow-sm">
                      {c.crewName?.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {c.onSite && <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-background rounded-full" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <h5 className="font-bold text-base">{c.crewName}</h5>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{c.unitNo}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{c.description || c.crewTrade}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs font-medium text-muted-foreground">
                    {c.lastCheckinAt ? (
                      <span className="flex items-center gap-1">
                        {c.onSite ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Circle className="w-3 h-3" />}
                        {c.lastCheckinKind === 'checkin' ? 'In ' : 'Out '} 
                        {formatDistanceToNow(parseISO(c.lastCheckinAt), { addSuffix: true })}
                      </span>
                    ) : (
                      <span>Not checked in</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <BirdseyeMapDialog token={token} open={birdseyeOpen} onOpenChange={setBirdseyeOpen} />
        </div>
      )}

      {/* INVOICE BATCH */}
      {module.type === 'invoice_batch' && module.invoices && (
        <div className="space-y-4">
          <div className="flex justify-between items-end mb-2">
            <div>
              <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground">Batch Summary</h4>
              <div className="text-2xl font-bold mt-1">${module.totalAmount?.toLocaleString()} <span className="text-sm font-medium text-muted-foreground">Total</span></div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-destructive">${module.unpaidAmount?.toLocaleString()}</div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Unpaid</div>
            </div>
          </div>
          <div className="space-y-2">
            {module.invoices.map((inv: any, i: number) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-muted/30 rounded-xl border border-border">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{inv.invoiceNo}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                      inv.status?.toLowerCase() === 'paid' ? 'bg-emerald-500/10 text-emerald-600' :
                      inv.status?.toLowerCase() === 'overdue' ? 'bg-destructive/10 text-destructive' :
                      'bg-amber-500/10 text-amber-600'
                    }`}>
                      {inv.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Due {inv.dueDate}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="font-bold text-lg">${inv.amount?.toLocaleString()}</div>
                  <div className="flex gap-2">
                    {inv.pdfUrl && (
                      <button onClick={() => setPdfViewerUrl(inv.pdfUrl)} className="p-2 bg-background border border-border rounded-lg hover:bg-muted transition-colors">
                        <FileText className="w-4 h-4" />
                      </button>
                    )}
                    {inv.payUrl && (
                      <a href={inv.payUrl} target="_blank" rel="noreferrer" className="px-4 py-2 bg-primary text-primary-foreground font-bold text-sm rounded-lg hover:bg-primary/90 transition-colors">
                        Pay
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BID */}
      {module.type === 'bid' && module.lineItems && (
        <div className="space-y-4">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground">{module.bidNo}</h4>
              <p className="text-sm text-muted-foreground mt-1">{module.scope}</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">${module.amount?.toLocaleString()}</div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{module.status}</div>
            </div>
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-4 py-3 text-left">Service</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {module.lineItems.map((li: any, i: number) => (
                  <tr key={i} className="bg-background">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{li.service}</div>
                      {li.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{li.description}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{li.qty}</td>
                    <td className="px-4 py-3 text-right font-medium">${li.amount?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {module.pdfUrl && (
            <button onClick={() => setPdfViewerUrl(module.pdfUrl)} className="w-full flex justify-center items-center gap-2 px-4 py-3 bg-muted text-foreground font-bold text-sm rounded-xl border border-border hover:bg-muted/80 transition-colors">
              <FileText className="w-4 h-4" /> View Full Proposal PDF
            </button>
          )}
        </div>
      )}

      <PdfViewerDialog url={pdfViewerUrl || ''} open={!!pdfViewerUrl} onOpenChange={(o) => { if(!o) setPdfViewerUrl(null); }} />
    </div>
  );
}

/**
 * Guided invoice approve → pay motion (spec: one decision per screen).
 * Hierarchy: amount + PO large, line items, swipeable photos, budget check
 * vs. the original request. Approve is the single primary button; Dispute is
 * a text button opening a one-field sheet. Approval chains straight into a
 * pay state on the same sheet (existing pay-flow underneath), and payment
 * hand-off shows a quiet auto-dismissing success moment.
 */
function InvoiceApprovePay({
  module,
  token,
  cardKey,
  readOnly,
  onReadOnlyClick,
  onViewPdf,
}: {
  module: any;
  token: string;
  cardKey?: string;
  readOnly: boolean;
  onReadOnlyClick?: () => void;
  onViewPdf: (url: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const actionMut = useClientBoardCardAction();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeNote, setDisputeNote] = useState('');
  const [photoIdx, setPhotoIdx] = useState(0);
  // justApproved drives the slide-into-pay moment; justPaid the success check.
  const [justApproved, setJustApproved] = useState(false);
  const [justPaid, setJustPaid] = useState(false);

  useEffect(() => {
    if (!justPaid) return;
    const t = setTimeout(() => setJustPaid(false), 2200);
    return () => clearTimeout(t);
  }, [justPaid]);

  const isPaid = String(module.status || '').toLowerCase() === 'paid';
  const isOverdue = String(module.status || '').toLowerCase() === 'overdue';
  const approved = !!module.approvedAt;
  const disputed = !!module.disputedAt;
  const photos: string[] = module.photoUrls || [];
  const lineItems: Array<{ label: string; unitNo?: string | null; qty?: number | null; amount?: number | null }> =
    module.lineItems || [];
  const requestedBudget: number | null = typeof module.requestedBudget === 'number' ? module.requestedBudget : null;
  const amount: number = module.amount ?? 0;
  const budgetDelta = requestedBudget != null ? amount - requestedBudget : null;

  const guard = (fn: () => void) => {
    if (readOnly) {
      if (onReadOnlyClick) onReadOnlyClick();
      else toast({ title: 'Sign in required', description: 'You are viewing as a guest.', variant: 'destructive' });
      return;
    }
    fn();
  };

  const runAction = (data: Record<string, unknown>, opts?: { onDone?: () => void; openUrl?: string | null }) => {
    // Open synchronously so mobile popup blockers allow it.
    if (opts?.openUrl) window.open(opts.openUrl, '_blank', 'noopener');
    actionMut.mutate(
      { token, cardId: cardKey!, data: data as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          opts?.onDone?.();
        },
        onError: (err: any) => {
          toast({ title: 'Action failed', description: err?.data?.error ?? err.message ?? 'Could not complete', variant: 'destructive' });
        },
      },
    );
  };

  const pending = actionMut.isPending;

  return (
    <div className="space-y-4" data-testid="invoice-approve-pay">
      {/* Big numbers first: amount + PO */}
      <div className="flex items-end justify-between">
        <div>
          <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground">Invoice {module.invoiceNo}</h4>
          <div className="text-4xl font-bold mt-1 tabular-nums" data-testid="invoice-amount">${amount.toLocaleString()}</div>
          {module.poNumber && (
            <div className="mt-1 text-sm font-semibold text-muted-foreground" data-testid="invoice-po">PO {module.poNumber}</div>
          )}
        </div>
        <div className="text-right">
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
            isPaid ? 'bg-emerald-500/10 text-emerald-600' :
            isOverdue ? 'bg-destructive/10 text-destructive' :
            'bg-amber-500/10 text-amber-600'
          }`}>{module.status}</span>
          {module.dueDate && <div className="text-xs text-muted-foreground mt-2 font-medium">Due {module.dueDate}</div>}
        </div>
      </div>

      {/* Budget check vs. the original request */}
      {requestedBudget != null && !isPaid && (
        <div
          data-testid="invoice-budget-check"
          className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium border ${
            budgetDelta != null && budgetDelta > 0.005
              ? 'bg-amber-500/5 border-amber-500/20 text-amber-700'
              : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-700'
          }`}
        >
          {budgetDelta != null && budgetDelta > 0.005 ? (
            <>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              ${budgetDelta.toLocaleString()} over your requested budget of ${requestedBudget.toLocaleString()}
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Within your requested budget of ${requestedBudget.toLocaleString()}
            </>
          )}
        </div>
      )}

      {disputed && (
        <div data-testid="invoice-disputed" className="flex items-start gap-2 p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-sm font-medium text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Disputed — the office is reviewing{module.disputeNote ? `: “${module.disputeNote}”` : '.'}</span>
        </div>
      )}

      {!disputed && module.disputeResolvedAt && !isPaid && (
        <div data-testid="invoice-dispute-resolved" className="flex items-start gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Dispute resolved by the office{module.disputeResponse ? `: “${module.disputeResponse}”` : '.'}</span>
        </div>
      )}

      {/* Line items */}
      {lineItems.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden" data-testid="invoice-line-items">
          {lineItems.map((li, i) => (
            <div key={i} className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${i > 0 ? 'border-t border-border/60' : ''}`}>
              <div className="min-w-0">
                <span className="font-medium">{li.label}</span>
                {li.unitNo && <span className="ml-2 text-xs font-mono text-muted-foreground">Unit {li.unitNo}</span>}
              </div>
              <div className="shrink-0 tabular-nums font-medium">
                {li.qty != null && li.qty !== 1 && <span className="mr-2 text-xs text-muted-foreground">×{li.qty}</span>}
                {li.amount != null && <>${li.amount.toLocaleString()}</>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Swipeable job photos */}
      {photos.length > 0 && (
        <div data-testid="invoice-photos">
          <div className="relative rounded-xl overflow-hidden border border-border aspect-video bg-muted">
            <img src={photos[Math.min(photoIdx, photos.length - 1)]} alt="Job photo" className="w-full h-full object-cover" loading="lazy" />
            {photos.length > 1 && (
              <>
                <button type="button" disabled={photoIdx === 0} onClick={() => setPhotoIdx((i) => Math.max(0, i - 1))} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button type="button" disabled={photoIdx >= photos.length - 1} onClick={() => setPhotoIdx((i) => Math.min(photos.length - 1, i + 1))} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
                <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white">
                  {Math.min(photoIdx, photos.length - 1) + 1} / {photos.length}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {module.pdfUrl && (
        <button type="button" onClick={() => onViewPdf(module.pdfUrl)} className="w-full flex justify-center items-center gap-2 px-4 py-3 bg-muted text-foreground font-bold text-sm rounded-xl border border-border hover:bg-muted/80 transition-colors">
          <FileText className="w-4 h-4" /> View Invoice PDF
        </button>
      )}

      {/* ------------------------------------------------- Decision / pay area */}
      {justPaid ? (
        /* Quiet success moment — auto-dismisses */
        <div data-testid="invoice-pay-success" className="flex flex-col items-center justify-center gap-2 py-6 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="h-6 w-6 text-emerald-600" />
          </div>
          <div className="text-lg font-bold tabular-nums">${amount.toLocaleString()}</div>
        </div>
      ) : isPaid ? (
        <div className="flex items-center justify-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-sm font-bold text-emerald-700">
          <CheckCircle2 className="w-4 h-4" /> Paid — thank you
        </div>
      ) : !approved ? (
        /* Screen 1: approve is the single primary; dispute is a text button */
        <div className="space-y-2">
          {module.canApprove && cardKey && (
            <button
              type="button"
              data-testid="button-invoice-approve"
              disabled={pending}
              onClick={() => guard(() => runAction({ action: 'approve' }, { onDone: () => setJustApproved(true) }))}
              className="w-full rounded-xl bg-[#B4FF44] py-3.5 text-sm font-extrabold uppercase tracking-wider text-[#101C33] hover:bg-[#9EE622] disabled:opacity-50 transition-colors"
            >
              {pending ? 'Approving…' : 'Approve Invoice'}
            </button>
          )}
          {!disputed && cardKey && (
            <button
              type="button"
              data-testid="button-invoice-dispute"
              onClick={() => guard(() => setDisputeOpen(true))}
              className="w-full py-1.5 text-[13px] font-semibold text-muted-foreground hover:text-destructive transition-colors"
            >
              Something looks wrong? Dispute
            </button>
          )}
        </div>
      ) : (
        /* Screen 2: approved — slide into the pay state, one full-width Pay */
        <div className={`space-y-2 ${justApproved ? 'animate-in slide-in-from-bottom-4 fade-in duration-300' : ''}`} data-testid="invoice-pay-state">
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Approved{module.approvedBy ? ` by ${module.approvedBy}` : ''}
          </div>
          {module.payMethod === 'check' ? (
            <>
              <div className="flex items-center justify-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-sm font-bold text-emerald-700">
                <CheckCircle2 className="w-4 h-4" /> Check on the way
              </div>
              {cardKey && (
                <button
                  type="button"
                  data-testid="button-invoice-pay-ach-instead"
                  disabled={pending}
                  onClick={() => guard(() => runAction({ action: 'pay_method', method: 'ach' }, { openUrl: module.payUrl, onDone: () => setJustPaid(true) }))}
                  className="w-full py-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  Pay by ACH instead
                </button>
              )}
            </>
          ) : (
            <>
              {cardKey && (
                <button
                  type="button"
                  data-testid="button-invoice-pay"
                  disabled={pending || !module.payUrl}
                  onClick={() => guard(() => runAction({ action: 'pay_method', method: 'ach' }, { openUrl: module.payUrl, onDone: () => setJustPaid(true) }))}
                  className="w-full rounded-xl bg-[#B4FF44] py-3.5 text-sm font-extrabold uppercase tracking-wider text-[#101C33] hover:bg-[#9EE622] disabled:opacity-50 transition-colors"
                >
                  {pending ? 'Opening…' : `Pay $${amount.toLocaleString()}${module.payMethod === 'ach' ? ' · ACH' : ''}`}
                </button>
              )}
              {cardKey && (
                <button
                  type="button"
                  data-testid="button-invoice-pay-check"
                  disabled={pending}
                  onClick={() => guard(() => runAction({ action: 'pay_method', method: 'check' }))}
                  className="w-full py-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  Mailing a check instead
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* One-field dispute sheet */}
      {disputeOpen && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => setDisputeOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="invoice-dispute-sheet">
            <h4 className="text-[15px] font-bold">What looks wrong?</h4>
            <textarea
              data-testid="input-dispute-note"
              autoFocus
              value={disputeNote}
              onChange={(e) => setDisputeNote(e.target.value)}
              rows={3}
              placeholder="e.g. We were quoted $950 for this work"
              className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-destructive/30"
            />
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setDisputeOpen(false)} className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold">
                Cancel
              </button>
              <button
                type="button"
                data-testid="button-dispute-send"
                disabled={pending || !disputeNote.trim()}
                onClick={() =>
                  runAction(
                    { action: 'dispute', note: disputeNote.trim() },
                    {
                      onDone: () => {
                        setDisputeOpen(false);
                        setDisputeNote('');
                        toast({ title: 'Dispute sent', description: 'The office was flagged and will follow up.' });
                      },
                    },
                  )
                }
                className="flex-1 rounded-xl bg-destructive py-2.5 text-sm font-bold text-destructive-foreground disabled:opacity-50"
              >
                {pending ? 'Sending…' : 'Send dispute'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
