import React, { useState } from 'react';
const TONES = {
  ink: '#101C33',
  warn: '#C25A1E',
  good: '#1F7A52',
};
import { CheckCircle2, ArrowUpRight, ExternalLink, Calendar, MapPin, FileText, Check, AlertTriangle, Camera, Receipt, Gift, CreditCard, Map as MapIcon, Users } from 'lucide-react';
import { useClientBoardCardAction, getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { PdfViewerDialog } from '../apple-board/PdfViewerDialog';

function safeDate(d?: string) {
  if (!d) return '—';
  try { return format(parseISO(d), 'MMM d'); } catch { return d; }
}

export function ModuleMetrics({ module, tint }: { module: any; tint: any }) {
  if (module.type === 'crewmap') {
    return (
      <div className="flex flex-col gap-[1px] rounded-[9px] mt-[6px] overflow-hidden bg-emerald-500/20 border border-emerald-500/30">
        <div className="flex justify-between items-center bg-white/90 p-2 backdrop-blur-md">
          <span className="text-[10px] font-[800] tracking-widest text-emerald-800 uppercase">Live Crews</span>
          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-md">{module.onSiteCount || 0} on site</span>
        </div>
        {module.crews?.slice(0, 3).map((c: any, i: number) => (
          <div key={i} className="bg-white/90 p-2 flex items-start gap-2 backdrop-blur-md">
            <div className="relative shrink-0">
              {c.selfieUrl ? (
                <img src={c.selfieUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-[10px] font-bold">
                  {c.crewName?.charAt(0).toUpperCase()}
                </div>
              )}
              {c.onSite && <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-500 border border-white rounded-full" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-[700] text-emerald-950 truncate">{c.crewName}</span>
                <span className="text-[9px] font-bold text-emerald-700/70">{c.unitNo}</span>
              </div>
              <div className="text-[9px] font-medium text-emerald-800/60 truncate">{c.description || c.crewTrade}</div>
            </div>
          </div>
        ))}
        {module.crews?.length > 3 && (
          <div className="bg-white/90 p-1.5 text-center text-[9px] font-bold text-emerald-800/50 backdrop-blur-md">
            + {module.crews.length - 3} more
          </div>
        )}
      </div>
    );
  }
  if (module.type === 'invoice_batch') {
    return (
      <div className="flex flex-col gap-[1px] rounded-[9px] mt-[6px] overflow-hidden bg-amber-500/20 border border-amber-500/30">
        <div className="flex justify-between items-center bg-white/90 p-2 backdrop-blur-md">
          <div className="flex flex-col">
            <span className="text-[9px] font-[800] tracking-widest text-amber-800/70 uppercase">Batch Due</span>
            <span className="text-[14px] font-[700] text-amber-950 leading-tight">${module.unpaidAmount?.toLocaleString() || '0'}</span>
          </div>
          <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-md">{module.count || 0} Invoices</span>
        </div>
        {module.invoices?.slice(0, 3).map((inv: any, i: number) => (
          <div key={i} className="bg-white/90 p-2 flex justify-between items-center backdrop-blur-md">
            <div className="flex flex-col min-w-0 pr-2">
              <span className="text-[11px] font-[700] text-amber-950 truncate">{inv.invoiceNo}</span>
              <span className="text-[9px] font-medium text-amber-800/60">{inv.status}</span>
            </div>
            <span className="text-[11px] font-[700] text-amber-900 shrink-0">${inv.amount?.toLocaleString()}</span>
          </div>
        ))}
        {module.invoices?.length > 3 && (
          <div className="bg-white/90 p-1.5 text-center text-[9px] font-bold text-amber-800/50 backdrop-blur-md">
            + {module.invoices.length - 3} more
          </div>
        )}
      </div>
    );
  }
  if (module.type === 'bid') {
    return (
      <div className="flex flex-col gap-[1px] rounded-[9px] mt-[6px] overflow-hidden bg-indigo-500/20 border border-indigo-500/30">
        <div className="flex justify-between items-start bg-white/90 p-2 backdrop-blur-md">
          <div className="flex flex-col">
            <span className="text-[9px] font-[800] tracking-widest text-indigo-800/70 uppercase">{module.status || 'PROPOSAL'}</span>
            <span className="text-[14px] font-[700] text-indigo-950 leading-tight">${module.amount?.toLocaleString() || '0'}</span>
            <span className="text-[10px] font-medium text-indigo-900 mt-1 line-clamp-1">{module.scope}</span>
          </div>
        </div>
        {module.lineItems?.slice(0, 3).map((li: any, i: number) => (
          <div key={i} className="bg-white/90 p-2 flex justify-between items-start backdrop-blur-md">
            <div className="flex flex-col min-w-0 pr-2">
              <span className="text-[10px] font-[700] text-indigo-950 truncate">{li.service}</span>
              <span className="text-[9px] font-medium text-indigo-800/60">Qty: {li.qty}</span>
            </div>
            <span className="text-[10px] font-[700] text-indigo-900 shrink-0">${li.amount?.toLocaleString()}</span>
          </div>
        ))}
        {module.lineItems?.length > 3 && (
          <div className="bg-white/90 p-1.5 text-center text-[9px] font-bold text-indigo-800/50 backdrop-blur-md">
            + {module.lineItems.length - 3} more
          </div>
        )}
      </div>
    );
  }
  if (module.type === 'document') {
    return (
      <div className="grid grid-cols-1 gap-[1px] rounded-[9px] mt-[6px] h-[70px] overflow-hidden bg-slate-500/20 border border-slate-500/30">
        <div className="flex flex-col bg-white/90 pt-[9px] px-[9px] pb-0 backdrop-blur-md">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-slate-700/70 uppercase whitespace-nowrap overflow-hidden text-ellipsis">DOCUMENT</span>
          <span className="text-[15px] font-[700] tracking-[-0.035em] overflow-hidden text-ellipsis mt-[2px] text-slate-950 line-clamp-2 leading-tight">{module.label || 'Attached File'}</span>
        </div>
      </div>
    );
  }
  if (module.type === 'invoice') {
    return (
      <div className="grid grid-cols-3 gap-[1px] rounded-[9px] mt-[6px] h-[70px] overflow-hidden" style={{ background: tint.bd }}>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">INVOICE NO</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px] text-[#101C33]">{module.invoiceNo || '—'}</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">reference</span>
        </div>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">AMOUNT</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]" style={{ color: TONES.ink }}>${module.amount?.toLocaleString() || '0'}</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">{module.status?.toUpperCase() || 'OPEN'}</span>
        </div>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">DUE</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]" style={{ color: TONES.warn }}>{safeDate(module.dueDate)}</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">deadline</span>
        </div>
      </div>
    );
  }
  if (module.type === 'tracker') {
    return (
      <div className="grid grid-cols-3 gap-[1px] rounded-[9px] mt-[6px] h-[70px] overflow-hidden" style={{ background: tint.bd }}>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">JOB NO</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px] text-[#101C33]">{module.jobNo || '—'}</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">active</span>
        </div>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">UNIT</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px] text-[#101C33]">{module.unitNo || 'PROP'}</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">location</span>
        </div>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">LIVE</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]" style={{ color: TONES.good }}>GPS</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">tracking</span>
        </div>
      </div>
    );
  }
  if (module.type === 'flags') {
    return (
      <div className="grid grid-cols-3 gap-[1px] rounded-[9px] mt-[6px] h-[70px] overflow-hidden" style={{ background: tint.bd }}>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0 col-span-2">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">ATTENTION NEEDED</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px] text-[#b23a2e]">{module.totalCount || 0} ITEMS</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">flagged during visit</span>
        </div>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">STATUS</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]" style={{ color: module.requestedAt ? TONES.good : TONES.warn }}>
            {module.requestedAt ? 'REQD' : 'OPEN'}
          </span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">action</span>
        </div>
      </div>
    );
  }
  if (module.type === 'referral') {
    return (
      <div className="grid grid-cols-1 rounded-[9px] mt-[6px] h-[70px] overflow-hidden bg-[#101C33]">
        <div className="flex flex-col justify-center px-4 h-full relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#B4FF44]/20 to-transparent" />
          <span className="text-[10px] font-[800] tracking-[0.1em] text-[#B4FF44] uppercase">GROW THE NETWORK</span>
          <span className="text-[14px] font-[600] text-white mt-1 leading-tight">Refer a colleague and earn rewards.</span>
        </div>
      </div>
    );
  }
  if (module.type === 'link') {
    return (
      <div className="grid grid-cols-1 rounded-[9px] mt-[6px] h-[70px] overflow-hidden bg-white" style={{ border: `1px solid ${tint.bd}` }}>
        <div className="flex items-center px-4 h-full">
           <ExternalLink className="w-6 h-6 text-black/30 mr-3" />
           <div className="flex flex-col">
             <span className="text-[14px] font-[700] text-[#101C33]">{module.label}</span>
             <span className="text-[10px] font-[600] text-[#96948B] truncate max-w-[240px]">{module.url}</span>
           </div>
        </div>
      </div>
    );
  }
  if (module.type === 'summary') {
    const isExceeded = module.result === 'exceeded';
    const isMet = module.result === 'met';
    return (
      <div className="grid grid-cols-3 gap-[1px] rounded-[9px] mt-[6px] h-[70px] overflow-hidden" style={{ background: tint.bd }} data-testid={`module-summary-metrics-${module.summaryId}`}>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">UNIT</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px] text-[#101C33]">{module.unitNo || 'PROP'}</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">location</span>
        </div>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">DATE</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]" style={{ color: TONES.ink }}>{safeDate(module.serviceDate)}</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">serviced</span>
        </div>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">RESULT</span>
          <div className="mt-[4px] flex items-center">
            <span className={`inline-flex items-center justify-center rounded-[6px] px-[6px] py-[3px] text-[10px] font-[800] uppercase tracking-wider ${isExceeded ? 'bg-emerald-100 text-emerald-700' : isMet ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
              {module.result || 'UNKNOWN'}
            </span>
          </div>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[6px]">quality score</span>
        </div>
      </div>
    );
  }
  if (module.type === 'photos') {
    return (
      <div className="grid grid-cols-3 gap-[1px] rounded-[9px] mt-[6px] h-[70px] overflow-hidden" style={{ background: tint.bd }} data-testid={`module-photos-metrics-${module.jobId}`}>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">JOB NO</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px] text-[#101C33]">{module.jobNo || '—'}</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">reference</span>
        </div>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">UNIT</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px] text-[#101C33]">{module.unitNo || 'PROP'}</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">location</span>
        </div>
        <div className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
          <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">MEDIA</span>
          <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]" style={{ color: TONES.good }}>{module.totalCount || 0}</span>
          <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">photos added</span>
        </div>
      </div>
    );
  }
  return null;
}

export function ModuleEvidence({ module, tint }: { module: any; tint: any }) {
  if (module.type === 'invoice') {
    const hasPdf = !!module.pdfUrl;
    return (
      <div className="rounded-[9px] mt-[8px] h-[130px] overflow-hidden flex items-center justify-center relative" style={{ border: `1px solid ${tint.bd}`, background: 'linear-gradient(135deg, #EFEDE7, #F7F5F0)' }} data-testid={`module-invoice-evidence-${module.invoiceNo || ''}`}>
        {/* Miniature invoice "paper" sheet — slightly rotated with a soft shadow,
            same document-thumbnail spirit as the photos grid. */}
        <div className="relative w-[150px] h-[110px] bg-white rounded-[4px] shadow-[0_6px_16px_rgba(0,0,0,0.18)] rotate-[-4deg] overflow-hidden border border-black/5">
          {/* letterhead bar */}
          <div className="h-[14px] w-full bg-[#101C33] flex items-center px-2">
            <span className="text-[6px] font-[800] tracking-[0.12em] text-[#B4FF44] uppercase">Invoice</span>
          </div>
          <div className="p-2 flex flex-col gap-[3px]">
            {/* faux letterhead rows */}
            <div className="h-[3px] w-[70%] rounded-full bg-black/10" />
            <div className="h-[3px] w-[45%] rounded-full bg-black/[0.07]" />
            {/* faux line-item rows */}
            <div className="mt-1 flex flex-col gap-[3px]">
              <div className="flex items-center gap-1">
                <div className="h-[2.5px] flex-1 rounded-full bg-black/[0.06]" />
                <div className="h-[2.5px] w-[16px] rounded-full bg-black/[0.10]" />
              </div>
              <div className="flex items-center gap-1">
                <div className="h-[2.5px] flex-1 rounded-full bg-black/[0.06]" />
                <div className="h-[2.5px] w-[16px] rounded-full bg-black/[0.10]" />
              </div>
              <div className="flex items-center gap-1">
                <div className="h-[2.5px] w-[60%] rounded-full bg-black/[0.06]" />
                <div className="h-[2.5px] w-[16px] rounded-full bg-black/[0.10]" />
              </div>
            </div>
          </div>
          {/* real amount overlaid on the sheet foot */}
          <div className="absolute bottom-0 inset-x-0 bg-[#FBFAF7] border-t border-black/5 px-2 py-1 flex items-end justify-between">
            <span className="text-[6px] font-[800] tracking-widest text-[#96948B] uppercase">Total Due</span>
            <span className="text-[13px] font-[800] text-[#101C33] tracking-tight leading-none">${module.amount?.toLocaleString() || '0'}</span>
          </div>
        </div>
        {/* invoice number + status overlay */}
        <div className="absolute left-2 bottom-2 z-10 flex flex-col">
          <span className="text-[9px] font-[800] text-[#101C33] tracking-tight">{module.invoiceNo || '—'}</span>
          <span className="text-[8px] font-[700] uppercase tracking-wider text-[#96948B]">{module.status || 'OPEN'}</span>
        </div>
        {/* PDF badge when a document is attached */}
        {hasPdf && (
          <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-[5px] bg-[#101C33] px-1.5 py-0.5 shadow-sm">
            <FileText className="h-2.5 w-2.5 text-[#B4FF44]" strokeWidth={2.5} />
            <span className="text-[8px] font-[800] tracking-wider text-white">PDF</span>
          </div>
        )}
      </div>
    );
  }
  if (module.type === 'tracker') {
    const crewName: string = module.crewName || '';
    const crewInitial = crewName ? crewName.charAt(0).toUpperCase() : 'C';
    const unitLabel = module.unitNo || module.jobNo || 'On site';
    return (
      <div className="rounded-[9px] mt-[8px] h-[130px] overflow-hidden flex flex-col relative group" style={{ border: `1px solid ${tint.bd}` }} data-testid={`module-tracker-evidence-${module.jobId || ''}`}>
        {/* Stylized live-map background — light paper with soft road lines,
            no external tiles/deps. Reads instantly as "map preview". */}
        <div className="absolute inset-0" style={{ backgroundColor: '#FDFBF7' }} />
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 340 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {/* park / block fills */}
          <rect x="14" y="10" width="70" height="46" rx="4" fill="#EAF3E6" />
          <rect x="236" y="66" width="86" height="52" rx="4" fill="#E7EEF6" />
          <rect x="150" y="12" width="60" height="40" rx="4" fill="#F1EEE7" />
          {/* soft road lines */}
          <path d="M-10 44 H360" stroke="#E4DFD4" strokeWidth="10" strokeLinecap="round" />
          <path d="M-10 92 H360" stroke="#E4DFD4" strokeWidth="8" strokeLinecap="round" />
          <path d="M118 -10 V140" stroke="#E4DFD4" strokeWidth="9" strokeLinecap="round" />
          <path d="M232 -10 V140" stroke="#E4DFD4" strokeWidth="7" strokeLinecap="round" />
          {/* thin center dashes on the main road */}
          <path d="M-10 44 H360" stroke="#FFFFFF" strokeWidth="1.5" strokeDasharray="7 7" />
          <path d="M118 -10 V140" stroke="#FFFFFF" strokeWidth="1.5" strokeDasharray="7 7" />
        </svg>
        {/* Pulsing location pin near the road intersection */}
        <div className="absolute left-[112px] top-[36px] z-10">
          <span className="absolute inset-0 -m-1 rounded-full bg-[#101C33]/20 animate-ping" style={{ width: 22, height: 22 }} />
          <span className="relative grid place-items-center w-[22px] h-[22px] rounded-full bg-[#101C33] shadow-md">
            <MapPin className="h-3 w-3 text-[#B4FF44]" strokeWidth={2.5} />
          </span>
        </div>
        {/* Foreground crew + LIVE overlay */}
        <div className="relative z-20 mt-auto flex items-center gap-2 p-[10px]">
          <div className="relative shrink-0">
            {module.crewSelfieUrl ? (
              <img src={module.crewSelfieUrl} alt={crewName || 'Crew'} className="w-8 h-8 rounded-full object-cover border-2 border-white shadow-sm" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#101C33] text-white flex items-center justify-center text-[12px] font-[800] border-2 border-white shadow-sm">
                {crewInitial}
              </div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-white animate-pulse" />
          </div>
          <div className="flex-1 min-w-0 rounded-[7px] bg-white/85 backdrop-blur-sm px-2 py-1 shadow-sm border border-black/5">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
              <span className="text-[9px] font-[800] uppercase tracking-wider text-[#1F7A52]">Live</span>
              <span className="text-[9px] font-[700] text-[#96948B] truncate">· {unitLabel}</span>
            </div>
            <div className="text-[11px] font-[700] text-[#101C33] truncate leading-tight">
              {crewName || 'Crew on the move'}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (module.type === 'flags') {
    const items = module.items || [];
    return (
      <div className="bg-white rounded-[9px] mt-[8px] h-[130px] overflow-hidden flex flex-col" style={{ border: `1px solid ${tint.bd}` }}>
        <div className="h-[24px] flex items-center px-[10px] border-b border-black/5 bg-[#FBFAF7] shrink-0">
          <span className="text-[9px] font-[800] text-[#101C33] uppercase tracking-wider">{items.length} Flagged Items</span>
        </div>
        <div className="flex-1 overflow-y-auto kanban-lane-scroll p-1">
          {items.map((it: any, i: number) => (
             <div key={i} className="flex items-start gap-2 p-1.5 border-b border-black/5 last:border-0">
                <div className="w-[4px] h-[4px] rounded-full bg-[#b23a2e] mt-[5px] shrink-0" />
                <div className="flex flex-col">
                   {it.unit && <span className="text-[9px] font-mono font-[700] text-[#96948B]">{it.unit}</span>}
                   <span className="text-[11px] font-[600] text-[#2E2C27] leading-tight">{it.label}</span>
                </div>
             </div>
          ))}
          {items.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground h-full">No details provided.</div>
          )}
        </div>
      </div>
    );
  }
  if (module.type === 'referral') {
    return (
      <div className="bg-white rounded-[9px] mt-[8px] h-[130px] overflow-hidden flex flex-col p-[12px] relative" style={{ border: `1px solid ${tint.bd}` }}>
         <p className="text-[12px] font-[500] text-[#6E6C63] leading-snug">
           Know another property that needs reliable service? Send them our way and we'll take care of them.
         </p>
         <div className="mt-auto p-2 bg-[#FBFAF7] rounded-[6px] border border-black/5 text-[10px] font-[600] text-[#96948B]">
           "Great work deserves to be shared."
         </div>
      </div>
    );
  }
  if (module.type === 'link') {
    return (
      <div className="bg-white rounded-[9px] mt-[8px] h-[130px] overflow-hidden flex flex-col items-center justify-center p-4 text-center" style={{ border: `1px solid ${tint.bd}` }}>
         <ExternalLink className="h-8 w-8 text-black/10 mb-2" />
         <p className="text-[11px] font-[600] text-[#6E6C63] max-w-[200px]">
           This card contains an external resource. Click below to open.
         </p>
      </div>
    );
  }
  if (module.type === 'summary') {
    return (
      <div className="bg-white rounded-[9px] mt-[8px] h-[130px] overflow-hidden flex flex-col p-[12px] relative" style={{ border: `1px solid ${tint.bd}` }} data-testid={`module-summary-evidence-${module.summaryId}`}>
         <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-[#101C33]" />
            <span className="text-[11px] font-[800] uppercase tracking-wider text-[#101C33] truncate">{module.title || 'Service Recap'}</span>
         </div>
         <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between border-b border-black/5 pb-1">
               <span className="text-[11px] font-[600] text-[#6E6C63]">Checklist</span>
               <span className="text-[11px] font-[700] text-[#101C33]" data-testid={`module-summary-checklist-${module.summaryId}`}>{module.checkedCount || 0} of {module.itemCount || 0} done</span>
            </div>
            <div className="flex items-center justify-between border-b border-black/5 pb-1">
               <span className="text-[11px] font-[600] text-[#6E6C63]">Attention items</span>
               <span className="text-[11px] font-[700] text-[#101C33]">{module.flagCount || 0} flagged</span>
            </div>
            <div className="flex items-center justify-between">
               <span className="text-[11px] font-[600] text-[#6E6C63]">Evidence</span>
               <span className="text-[11px] font-[700] text-[#101C33]">{module.photoCount || 0} photos</span>
            </div>
         </div>
      </div>
    );
  }
  if (module.type === 'photos') {
    const urls = (module.photoUrls || []).slice(0, 4);
    return (
      <div className="bg-[#FBFAF7] rounded-[9px] mt-[8px] h-[130px] overflow-hidden flex flex-col p-[8px]" style={{ border: `1px solid ${tint.bd}` }} data-testid={`module-photos-evidence-${module.jobId}`}>
         {urls.length > 0 ? (
            <div className={`grid gap-2 h-full ${urls.length === 1 ? 'grid-cols-1' : urls.length === 2 ? 'grid-cols-2' : urls.length === 3 ? 'grid-cols-3' : 'grid-cols-2 grid-rows-2'}`}>
              {urls.map((url: string, i: number) => (
                <img key={i} src={url} alt={`Evidence ${i+1}`} className="w-full h-full object-cover rounded-xl border border-black/10 shadow-sm" />
              ))}
            </div>
         ) : (
            <div className="flex-1 flex flex-col items-center justify-center opacity-50">
               <Camera className="h-6 w-6 text-[#101C33] mb-1" />
               <span className="text-[10px] font-[700] uppercase text-[#101C33]">No photos</span>
            </div>
         )}
      </div>
    );
  }
  return null;
}

export function ModuleDecision({ module, tint, cardKey, token, readOnly, onReadOnlyClick }: { module: any; tint: any; cardKey: string; token: string; readOnly: boolean; onReadOnlyClick?: () => void }) {
  const queryClient = useQueryClient();
  const actionMut = useClientBoardCardAction();
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [unitNo, setUnitNo] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);

  const isPending = actionMut.isPending;

  const handleAction = (e: React.MouseEvent, action: string, data: any = {}, openUrl?: string | null) => {
    e.stopPropagation();
    if (readOnly) {
      // Guests get a sign-in prompt instead of a silently dead button.
      onReadOnlyClick?.();
      return;
    }
    // Open synchronously so mobile popup blockers allow it; the event is
    // recorded regardless of whether the tab stays open.
    if (openUrl) window.open(openUrl, '_blank', 'noopener');
    actionMut.mutate(
      { token, cardId: cardKey, data: { action, ...data } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          setFormOpen(false);
        },
        onError: (err: any) => {
          console.error(err);
        }
      }
    );
  };

  if (module.type === 'invoice') {
    // Single-path invoice decisions: the card face never carries its own
    // approve/pay buttons — every decision happens in the guided detail
    // sheet (InvoiceApprovePay). The button below deliberately has no
    // onClick, so the click bubbles to the card's own open handler.
    const isPaid = String(module.status || '').toLowerCase() === 'paid';
    return (
      <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0">
        {isPaid ? (
          <div className="flex-1 h-full rounded-[8px] bg-[#5c7a28]/10 text-[#5c7a28] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center pointer-events-none border border-[#5c7a28]/20">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> PAID — THANK YOU
          </div>
        ) : !module.approvedAt ? (
          <button type="button" data-testid="card-invoice-review" className="flex-1 h-full rounded-[8px] bg-[#B4FF44] text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#9EE622] transition-colors">
            Review &amp; Approve
          </button>
        ) : module.payMethod === 'check' ? (
          <button type="button" data-testid="card-invoice-open" className="flex-1 h-full rounded-[8px] bg-[#5c7a28]/10 text-[#5c7a28] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center border border-[#5c7a28]/20 hover:bg-[#5c7a28]/15 transition-colors">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> CHECK ON THE WAY
          </button>
        ) : (
          <button type="button" data-testid="card-invoice-pay" className="flex-1 h-full rounded-[8px] bg-[#B4FF44] text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#9EE622] transition-colors">
            Approved — Pay{typeof module.amount === 'number' ? ` $${module.amount.toLocaleString()}` : ''}
          </button>
        )}
      </div>
    );
  }

  if (module.type === 'tracker') {
    return (
      <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0">
         <a href={module.trackerUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="flex-1 h-full rounded-[8px] bg-[#101C33] text-white text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#101C33]/90 transition-colors shadow-sm">
            Open Live Tracker <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
         </a>
      </div>
    );
  }

  if (module.type === 'flags') {
    if (module.requestedAt) {
       return (
         <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0">
           <div className="flex-1 h-full rounded-[8px] bg-[#5c7a28]/10 text-[#5c7a28] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center pointer-events-none border border-[#5c7a28]/20">
             <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> WORK REQUESTED
           </div>
         </div>
       );
    }
    
    // Using a tiny absolute form that pops up over the evidence region when active
    return (
      <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0 relative">
        {formOpen && (
          <div className="absolute bottom-[40px] left-0 w-full bg-white rounded-[12px] p-3 shadow-[0_12px_30px_rgba(16,28,51,0.2)] border border-black/10 z-50 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
            <span className="text-[10px] font-[800] tracking-wider text-[#101C33] uppercase">Request Service</span>
            <input type="text" placeholder="Your name (optional)" value={name} onChange={e => setName(e.target.value)} className="h-8 text-[11px] px-2 rounded-[6px] border border-black/10 bg-black/[0.02] focus:outline-none focus:border-black/30" />
            <input type="text" placeholder="Notes or instructions" value={note} onChange={e => setNote(e.target.value)} className="h-8 text-[11px] px-2 rounded-[6px] border border-black/10 bg-black/[0.02] focus:outline-none focus:border-black/30" />
            <div className="flex gap-2">
              <input type="text" placeholder="Unit (opt)" value={unitNo} onChange={e => setUnitNo(e.target.value)} className="flex-1 min-w-0 h-8 text-[11px] px-2 rounded-[6px] border border-black/10 bg-black/[0.02] focus:outline-none focus:border-black/30" />
              <input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} className="flex-1 min-w-0 h-8 text-[11px] px-2 rounded-[6px] border border-black/10 bg-black/[0.02] focus:outline-none focus:border-black/30" />
            </div>
            <div className="flex gap-2 mt-1">
              <button type="button" onClick={() => setFormOpen(false)} className="flex-1 h-8 rounded-[6px] bg-white border border-black/10 text-[10px] font-[800] uppercase tracking-wider hover:bg-black/5">Cancel</button>
              <button type="button" disabled={isPending} onClick={(e) => handleAction(e, 'schedule', { name, note, unitNo, neededBy })} className="flex-1 h-8 rounded-[6px] bg-[#B4FF44] text-[#101C33] text-[10px] font-[800] uppercase tracking-wider hover:bg-[#9EE622] disabled:opacity-50">Submit</button>
            </div>
          </div>
        )}
        
        {module.canSchedule ? (
           <button type="button" onClick={(e) => { e.stopPropagation(); if (readOnly) { onReadOnlyClick?.(); return; } setFormOpen(!formOpen); }} className="flex-1 h-full rounded-[8px] bg-[#B4FF44] text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#9EE622] disabled:opacity-50 transition-colors">
              Schedule Work / Get Bid
           </button>
        ) : (
           <div className="flex-1 h-full rounded-[8px] bg-black/5 text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center opacity-50 pointer-events-none">
              REVIEW ONLY
           </div>
        )}
      </div>
    );
  }

  if (module.type === 'referral') {
    if (module.referredAt) {
       return (
         <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0">
           <div className="flex-1 h-full rounded-[8px] bg-[#5c7a28]/10 text-[#5c7a28] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center pointer-events-none border border-[#5c7a28]/20">
             <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> THANK YOU
           </div>
         </div>
       );
    }

    return (
      <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0 relative">
        {formOpen && (
          <div className="absolute bottom-[40px] left-0 w-full bg-[#101C33] rounded-[12px] p-3 shadow-[0_12px_30px_rgba(16,28,51,0.3)] border border-white/10 z-50 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
            <span className="text-[10px] font-[800] tracking-wider text-[#B4FF44] uppercase">Refer a Colleague</span>
            <input type="text" placeholder="Contact email or phone" value={contact} onChange={e => setContact(e.target.value)} className="h-8 text-[11px] px-2 rounded-[6px] border border-white/20 bg-white/5 text-white placeholder-white/40 focus:outline-none focus:border-[#B4FF44]" />
            <input type="text" placeholder="Your name (optional)" value={name} onChange={e => setName(e.target.value)} className="h-8 text-[11px] px-2 rounded-[6px] border border-white/20 bg-white/5 text-white placeholder-white/40 focus:outline-none focus:border-[#B4FF44]" />
            <div className="flex gap-2 mt-1">
              <button type="button" onClick={() => setFormOpen(false)} className="flex-1 h-8 rounded-[6px] bg-transparent border border-white/20 text-white text-[10px] font-[800] uppercase tracking-wider hover:bg-white/5">Cancel</button>
              <button type="button" disabled={isPending || readOnly || !contact} onClick={(e) => handleAction(e, 'refer', { contact, name })} className="flex-1 h-8 rounded-[6px] bg-[#B4FF44] text-[#101C33] text-[10px] font-[800] uppercase tracking-wider hover:bg-[#9EE622] disabled:opacity-50">Send</button>
            </div>
          </div>
        )}
        
        {module.canRefer && (
           <button type="button" onClick={(e) => { e.stopPropagation(); if (readOnly) { onReadOnlyClick?.(); return; } setFormOpen(!formOpen); }} className="flex-1 h-full rounded-[8px] bg-[#101C33] text-white text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#101C33]/90 disabled:opacity-50 transition-colors shadow-sm">
              Send Referral
           </button>
        )}
      </div>
    );
  }

  if (module.type === 'link') {
    return (
      <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0">
         <a href={module.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="flex-1 h-full rounded-[8px] bg-[#B4FF44] text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#9EE622] transition-colors">
            {module.label || 'Open Link'} <ExternalLink className="w-3.5 h-3.5 ml-1" />
         </a>
      </div>
    );
  }

  if (module.type === 'summary') {
    return (
      <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0" data-testid={`module-summary-decision-${module.summaryId}`}>
         <a href={module.summaryUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="flex-1 h-full rounded-[8px] bg-[#B4FF44] text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#9EE622] transition-colors shadow-sm">
            View full recap <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
         </a>
      </div>
    );
  }

  if (module.type === 'photos') {
    // Office mirror is read-only for walk approvals — show state, no button.
    if (module.clientApprovedAt) {
      return (
        <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0" data-testid={`module-photos-decision-${module.jobId}`}>
          <div className="flex-1 h-full rounded-[8px] bg-[#5c7a28]/10 text-[#5c7a28] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center pointer-events-none border border-[#5c7a28]/20">
            APPROVED — IN PROGRESS
          </div>
        </div>
      );
    }
    if (module.canApprove) {
      return (
        <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0" data-testid={`module-photos-decision-${module.jobId}`}>
          <div className="flex-1 h-full rounded-[8px] bg-black/5 text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center opacity-60 pointer-events-none">
            AWAITING CLIENT APPROVAL
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0" data-testid={`module-photos-decision-${module.jobId}`}>
         <div className="flex-1 h-full rounded-[8px] bg-black/5 text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center opacity-50 pointer-events-none">
            EVIDENCE LOGGED
         </div>
      </div>
    );
  }

  if (module.type === 'crewmap') {
    return (
      <>
        <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0">
          <button type="button" onClick={(e) => { e.stopPropagation(); /* Map is launched from parent board, disable here for now */ }} className="flex-1 h-full rounded-[8px] bg-[#101C33] text-white text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#101C33]/90 transition-colors">
            Live map unavailable
          </button>
        </div>
      </>
    );
  }

  if (module.type === 'invoice_batch') {
    const unpaidPayableInvoices = module.invoices?.filter((inv: any) => inv.status?.toLowerCase() !== 'paid' && inv.payUrl) || [];
    const singlePayUrl = unpaidPayableInvoices.length === 1 ? unpaidPayableInvoices[0].payUrl : null;

    return (
      <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0">
        <button type="button" className="flex-1 h-full rounded-[8px] bg-[#101C33] text-white text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#101C33]/90 transition-colors pointer-events-none">
          View Invoices
        </button>
        {singlePayUrl && (
          <a href={singlePayUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="flex-1 h-full rounded-[8px] bg-[#B4FF44] text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#9EE622] transition-colors">
            Pay Now
          </a>
        )}
      </div>
    );
  }

  if (module.type === 'bid') {
    return (
      <>
        <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0">
          <button type="button" onClick={(e) => { e.stopPropagation(); setPdfViewerUrl(module.pdfUrl); }} className="flex-1 h-full rounded-[8px] bg-[#101C33] text-white text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#101C33]/90 transition-colors">
            View Proposal
          </button>
        </div>
        <PdfViewerDialog url={pdfViewerUrl || ''} open={!!pdfViewerUrl} onOpenChange={(o) => { if(!o) setPdfViewerUrl(null); }} />
      </>
    );
  }

  if (module.type === 'document') {
    return (
      <>
        <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0">
          {module.isPdf ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); setPdfViewerUrl(module.url); }} className="flex-1 h-full rounded-[8px] bg-[#101C33] text-white text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#101C33]/90 transition-colors">
              View Document
            </button>
          ) : (
            <a href={module.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="flex-1 h-full rounded-[8px] bg-[#101C33] text-white text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#101C33]/90 transition-colors">
              Open Document
            </a>
          )}
        </div>
        <PdfViewerDialog url={pdfViewerUrl || ''} open={!!pdfViewerUrl} onOpenChange={(o) => { if(!o) setPdfViewerUrl(null); }} />
      </>
    );
  }

  return null;
}
