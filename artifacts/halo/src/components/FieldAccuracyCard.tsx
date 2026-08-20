/**
 * Tinder-style field accuracy card + bot margin + Complete → invoicing. Punchlist only.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Plus, Trash2, Users, Wrench, DollarSign, X, Sparkles, TrendingUp, Send } from "lucide-react";

type MarginReport = {
  lines: Array<{ serviceCode: string; label: string; invoiceCents: number; crewCents: number; marginCents: number; marginPct: number | null }>;
  invoiceTotalCents: number; crewTotalCents: number; marginTotalCents: number; marginPct: number | null;
};
function dollars(c?: number | null) { return c == null ? "—" : `$${(c / 100).toFixed(2)}`; }
function pct(p?: number | null) { return p == null ? "—" : `${(p * 100).toFixed(1)}%`; }
function parseDollars(s: string) { const n = Number(String(s).replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : null; }

export function FieldAccuracyCard({ jobId, enabled, onClose }: { jobId: string | null; enabled: boolean; onClose?: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState({ crew: true, services: true, prices: true });
  const [crewRows, setCrewRows] = useState<Array<{ serviceCode: string; label: string; crewName: string }>>([]);
  const [serviceRows, setServiceRows] = useState<Array<{ serviceCode: string; label: string }>>([]);
  const [priceRows, setPriceRows] = useState<Array<{ serviceCode: string; label: string; expectedCents: number | null; actualCents: number | null; status: string; editDollars: string }>>([]);
  const [notes, setNotes] = useState("");
  const [newService, setNewService] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"edit" | "margin">("edit");
  const [marginReport, setMarginReport] = useState<MarginReport | null>(null);
  const [botNotes, setBotNotes] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["field-accuracy-card", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/work-reviews/job/${jobId}/field-card`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load field card");
      return res.json();
    },
    enabled: enabled && !!jobId,
  });
  const v = data?.verification;
  const reviewId = data?.review?.id;

  useEffect(() => {
    if (data?.showMargin && data?.marginReport) {
      setPhase("margin");
      setMarginReport(data.marginReport);
      setBotNotes(data.review?.botNotes || "");
    }
  }, [data]);

  useEffect(() => {
    if (!v) return;
    const lines = v.lines || [];
    setCrewRows(lines.map((l: any) => ({ serviceCode: l.serviceCode, label: l.label, crewName: l.assignedCrewName || "" })));
    const svc = [...lines.map((l: any) => ({ serviceCode: l.serviceCode, label: l.label })), ...(v.missingServices || []).map((m: any) => ({ serviceCode: m.serviceCode, label: m.label }))];
    const seen = new Set<string>();
    setServiceRows(svc.filter((s) => { if (seen.has(s.serviceCode)) return false; seen.add(s.serviceCode); return true; }));
    setPriceRows(lines.map((l: any) => ({
      serviceCode: l.serviceCode, label: l.label, expectedCents: l.expectedInvoiceCents, actualCents: l.actualInvoiceCents, status: l.status,
      editDollars: l.expectedInvoiceCents != null && l.status !== "ok" ? (l.expectedInvoiceCents / 100).toFixed(2) : l.actualInvoiceCents != null ? (l.actualInvoiceCents / 100).toFixed(2) : "",
    })));
  }, [v]);

  const submitField = useMutation({
    mutationFn: async () => {
      if (!reviewId) throw new Error("No review id");
      const res = await fetch(`/api/work-reviews/${reviewId}/field-submit`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submittedBy: "field",
          edits: {
            confirmAccurate: true, notes: notes || undefined, services: serviceRows.map((s) => s.label),
            linePrices: priceRows.map((p) => ({ serviceCode: p.serviceCode, invoiceCents: parseDollars(p.editDollars) ?? p.actualCents ?? 0 })),
            crewAssignments: crewRows.map((c) => ({ serviceCode: c.serviceCode, crewId: "", crewName: c.crewName })),
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Submit failed");
      return body;
    },
    onSuccess: (body) => {
      setError("");
      if (body.marginReport) { setMarginReport(body.marginReport); setBotNotes(body.notes || body.message || ""); setPhase("margin"); }
      else if (body.next === "needs_fix") { setError(body.notes || "Bot needs fixes"); qc.invalidateQueries({ queryKey: ["field-accuracy-card", jobId] }); }
    },
    onError: (e: Error) => setError(e.message),
  });

  const complete = useMutation({
    mutationFn: async () => {
      if (!reviewId) throw new Error("No review id");
      const res = await fetch(`/api/work-reviews/${reviewId}/complete`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Complete failed");
      return body;
    },
    onSuccess: () => { setBotNotes("Sent to invoicing queue ✓"); qc.invalidateQueries({ queryKey: ["work-reviews"] }); setTimeout(() => onClose?.(), 1400); },
    onError: (e: Error) => setError(e.message),
  });

  if (!enabled || !jobId) return null;
  if (isLoading) return <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80 text-white/70">Loading accuracy card…</div>;
  if (!v && !data?.review) return null;
  const jobLabel = v?.jobNo || jobId.slice(0, 8);

  return (
    <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/75 p-3 backdrop-blur-sm sm:items-center">
      <div className="relative flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#1a1f1c] to-[#0c100e] shadow-2xl">
        <div className="relative shrink-0 border-b border-white/10 bg-[#B4FF44]/10 px-5 pb-4 pt-5">
          <button type="button" className="absolute right-3 top-3 rounded-full p-2 text-white/40" onClick={() => onClose?.()}><X className="h-5 w-5" /></button>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#B4FF44]">
            <Sparkles className="h-3.5 w-3.5" />{phase === "margin" ? "Bot final · live margin" : "Field accuracy review"}
          </div>
          <h2 className="mt-2 text-xl font-bold text-white">Job {jobLabel}{v?.unitNo ? <span className="text-white/50"> · Unit {v.unitNo}</span> : null}</h2>
          <p className="mt-1 text-sm text-white/55">{phase === "margin" ? "Confirm margin, then Complete → invoicing." : "1 Crew · 2 Services · 3 Prices — then bot builds margin."}</p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {phase === "edit" && (
            <>
              <Sec icon={<Users className="h-4 w-4" />} title="1 · Crew on the right services?" open={open.crew} onToggle={() => setOpen((s) => ({ ...s, crew: !s.crew }))} accent="crew">
                {crewRows.map((row, i) => (
                  <div key={row.serviceCode + i} className="mb-2 rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="text-xs uppercase text-white/40">Service</div>
                    <div className="text-sm font-medium text-white">{row.label}</div>
                    <input className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white" value={row.crewName} placeholder="Crew name" onChange={(e) => { const n = [...crewRows]; n[i] = { ...row, crewName: e.target.value }; setCrewRows(n); }} />
                  </div>
                ))}
              </Sec>
              <Sec icon={<Wrench className="h-4 w-4" />} title="2 · Are these services correct?" open={open.services} onToggle={() => setOpen((s) => ({ ...s, services: !s.services }))} accent="services">
                {serviceRows.map((row, i) => (
                  <div key={row.serviceCode + i} className="mb-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
                    <input className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" value={row.label} onChange={(e) => { const n = [...serviceRows]; n[i] = { ...row, label: e.target.value }; setServiceRows(n); }} />
                    <button type="button" className="p-1.5 text-red-300/80" onClick={() => setServiceRows(serviceRows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                <div className="mt-2 flex gap-2">
                  <input className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white" placeholder="Add service" value={newService} onChange={(e) => setNewService(e.target.value)} />
                  <button type="button" className="rounded-xl bg-[#B4FF44]/15 px-3 py-2 text-sm font-semibold text-[#B4FF44]" onClick={() => { if (!newService.trim()) return; setServiceRows([...serviceRows, { serviceCode: newService.trim().toUpperCase().replace(/\s+/g, "_"), label: newService.trim() }]); setNewService(""); }}><Plus className="h-4 w-4" /></button>
                </div>
              </Sec>
              <Sec icon={<DollarSign className="h-4 w-4" />} title="3 · Prices match master list?" open={open.prices} onToggle={() => setOpen((s) => ({ ...s, prices: !s.prices }))} accent="prices">
                {priceRows.map((row, i) => (
                  <div key={row.serviceCode + i} className="mb-2 rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="flex justify-between text-sm text-white"><span>{row.label}</span>{row.expectedCents != null && <span className="text-[#B4FF44]">Master {dollars(row.expectedCents)}</span>}</div>
                    <div className="mt-1 text-[11px] text-white/40">Was {dollars(row.actualCents)} · {row.status}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-white/40">$</span>
                      <input className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white" value={row.editDollars} onChange={(e) => { const n = [...priceRows]; n[i] = { ...row, editDollars: e.target.value }; setPriceRows(n); }} />
                      {row.expectedCents != null && <button type="button" className="shrink-0 rounded-lg bg-[#B4FF44]/15 px-2 py-2 text-[11px] font-semibold text-[#B4FF44]" onClick={() => { const n = [...priceRows]; n[i] = { ...row, editDollars: (row.expectedCents! / 100).toFixed(2) }; setPriceRows(n); }}>Use master</button>}
                    </div>
                  </div>
                ))}
              </Sec>
              <textarea className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" rows={2} placeholder="Notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </>
          )}
          {phase === "margin" && marginReport && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-[#B4FF44]/25 bg-[#B4FF44]/10 p-4">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#B4FF44]"><TrendingUp className="h-4 w-4" /> Live margin report</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-[10px] uppercase text-white/45">Invoice</div><div className="text-sm font-bold text-white">{dollars(marginReport.invoiceTotalCents)}</div></div>
                  <div><div className="text-[10px] uppercase text-white/45">Crew pay</div><div className="text-sm font-bold text-white">{dollars(marginReport.crewTotalCents)}</div></div>
                  <div><div className="text-[10px] uppercase text-white/45">Margin</div><div className="text-sm font-bold text-[#B4FF44]">{pct(marginReport.marginPct)}</div></div>
                </div>
                <div className="mt-2 text-center text-xs text-white/50">Profit {dollars(marginReport.marginTotalCents)}</div>
              </div>
              {marginReport.lines.map((l) => (
                <div key={l.serviceCode} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2.5">
                  <div className="flex justify-between text-sm text-white"><span>{l.label}</span><span className="font-semibold text-[#B4FF44]">{pct(l.marginPct)}</span></div>
                  <div className="mt-1 flex justify-between text-[11px] text-white/45"><span>Inv {dollars(l.invoiceCents)}</span><span>Crew {dollars(l.crewCents)}</span><span>Margin {dollars(l.marginCents)}</span></div>
                </div>
              ))}
              {botNotes && <p className="text-xs text-white/50">{botNotes}</p>}
            </div>
          )}
        </div>
        <div className="shrink-0 space-y-2 border-t border-white/10 bg-black/40 px-4 py-4">
          {error && <p className="text-center text-sm text-red-300">{error}</p>}
          {phase === "edit" && (
            <button type="button" disabled={submitField.isPending || !reviewId} onClick={() => submitField.mutate()} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#B4FF44] py-3.5 text-sm font-bold text-black disabled:opacity-50">
              <Check className="h-5 w-5" />{submitField.isPending ? "Bot reviewing…" : "Submit — bot final + margin"}
            </button>
          )}
          {phase === "margin" && (
            <button type="button" disabled={complete.isPending || !reviewId} onClick={() => complete.mutate()} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#B4FF44] py-3.5 text-sm font-bold text-black disabled:opacity-50">
              <Send className="h-5 w-5" />{complete.isPending ? "Sending…" : "Complete — send to invoicing"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Sec({ icon, title, open, onToggle, children, accent }: { icon: React.ReactNode; title: string; open: boolean; onToggle: () => void; children: React.ReactNode; accent: string }) {
  const c = accent === "crew" ? "text-sky-300" : accent === "services" ? "text-violet-300" : "text-amber-300";
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <span className={c}>{icon}</span><span className="flex-1 text-sm font-semibold text-white">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
      </button>
      {open && <div className="border-t border-white/5 px-4 pb-4 pt-2">{children}</div>}
    </div>
  );
}

export function FieldAccuracyCardOverlay({ enabled, jobId }: { enabled: boolean; jobId?: string | null }) {
  const [dismissed, setDismissed] = useState(false);
  const { data: pending } = useQuery({
    queryKey: ["work-reviews-pending-field"],
    queryFn: async () => { const res = await fetch("/api/work-reviews?status=pending_field", { credentials: "include" }); return res.ok ? res.json() : { reviews: [] }; },
    enabled: enabled && !jobId, refetchInterval: enabled ? 20_000 : false,
  });
  const { data: marginReady } = useQuery({
    queryKey: ["work-reviews-margin-ready"],
    queryFn: async () => { const res = await fetch("/api/work-reviews?status=margin_ready", { credentials: "include" }); return res.ok ? res.json() : { reviews: [] }; },
    enabled: enabled && !jobId, refetchInterval: enabled ? 20_000 : false,
  });
  const useJob = jobId || marginReady?.reviews?.[0]?.jobId || pending?.reviews?.[0]?.jobId || null;
  if (!enabled || dismissed || !useJob) return null;
  return <FieldAccuracyCard jobId={useJob} enabled={enabled} onClose={() => setDismissed(true)} />;
}
export default FieldAccuracyCard;
