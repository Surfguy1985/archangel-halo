import { ExternalLink, CheckCircle2, Circle, FileText, Check, Users, Receipt, List, MapPin, AlertTriangle, Camera, X } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useState } from 'react';
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
      {/* INVOICE — full approve & pay flow inside the detail view */}
      {module.type === 'invoice' && (
        <div className="space-y-4">
          <div className="flex justify-between items-end">
            <div>
              <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground">Invoice {module.invoiceNo}</h4>
              <div className="text-3xl font-bold mt-1">${module.amount?.toLocaleString()}</div>
            </div>
            <div className="text-right">
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                String(module.status).toLowerCase() === 'paid' ? 'bg-emerald-500/10 text-emerald-600' :
                String(module.status).toLowerCase() === 'overdue' ? 'bg-destructive/10 text-destructive' :
                'bg-amber-500/10 text-amber-600'
              }`}>{module.status}</span>
              {module.dueDate && <div className="text-xs text-muted-foreground mt-2 font-medium">Due {module.dueDate}</div>}
            </div>
          </div>
          {module.approvedAt && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Approved{module.approvedBy ? ` by ${module.approvedBy}` : ''}
              {module.payMethod && <span className="ml-auto text-[10px] font-bold uppercase tracking-widest">{module.payMethod === 'ach' ? 'Paying by ACH' : 'Paying by check'}</span>}
            </div>
          )}
          {module.pdfUrl && (
            <button type="button" onClick={() => setPdfViewerUrl(module.pdfUrl)} className="w-full flex justify-center items-center gap-2 px-4 py-3 bg-muted text-foreground font-bold text-sm rounded-xl border border-border hover:bg-muted/80 transition-colors">
              <FileText className="w-4 h-4" /> View Invoice PDF
            </button>
          )}
          {cardKey && (
            <ModuleDecision cardKey={cardKey} token={token} module={module} readOnly={!!readOnly} onReadOnlyClick={onReadOnlyClick} tint={{ bd: '#e8e8ed' }} />
          )}
        </div>
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
