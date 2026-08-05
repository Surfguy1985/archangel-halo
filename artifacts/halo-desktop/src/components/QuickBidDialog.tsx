import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProperties,
  useGetProperty,
  useCreateBid,
  useGetBidAiPricing,
  getListBidsQueryKey,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";
import { Sparkles, Loader2, FileText, Check } from "lucide-react";

const fieldCls =
  "w-full bg-white border border-border rounded-[11px] py-2.5 px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40";
const labelCls = "text-[10px] font-bold text-[var(--gold-dark)]";
const primaryBtn =
  "w-full flex items-center justify-center gap-2 bg-[var(--gold-light)] text-black px-4 py-2.5 rounded-full font-bold hover:bg-[var(--gold-dark)] transition-colors shadow-sm disabled:opacity-50 disabled:pointer-events-none";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const CUSTOM = "__custom__";

export default function QuickBidDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: properties } = useListProperties();
  const [propertyId, setPropertyId] = useState("");
  const { data: propertyDetail } = useGetProperty(propertyId, {
    query: { enabled: !!propertyId, queryKey: getGetPropertyQueryKey(propertyId) },
  });
  const priceItems = propertyDetail?.priceItems ?? [];

  const [serviceChoice, setServiceChoice] = useState(""); // price item id or CUSTOM
  const [customService, setCustomService] = useState("");
  const [customDetails, setCustomDetails] = useState("");
  const [unitNo, setUnitNo] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; bidNo: string; amount: number } | null>(null);

  const isCustom = serviceChoice === CUSTOM;
  const pickedItem = priceItems.find((pi) => pi.id === serviceChoice);
  const serviceName = isCustom ? customService.trim() : (pickedItem?.service ?? "");

  const aiPricing = useGetBidAiPricing();
  const [aiResult, setAiResult] = useState<{
    suggested: number;
    marketLow: number;
    marketHigh: number;
    wholesaleNotes?: string | null;
    rationale: string;
  } | null>(null);

  const createBid = useCreateBid();

  const reset = () => {
    setPropertyId("");
    setServiceChoice("");
    setCustomService("");
    setCustomDetails("");
    setUnitNo("");
    setQty("1");
    setPrice("");
    setError("");
    setCreated(null);
    setAiResult(null);
  };

  const runAi = () => {
    if (!serviceName) {
      setError("Pick or type a service first");
      return;
    }
    setError("");
    setAiResult(null);
    const prop = (properties ?? []).find((p) => p.id === propertyId);
    aiPricing.mutate(
      {
        data: {
          service: serviceName,
          details: isCustom ? customDetails.trim() || null : pickedItem?.detail ?? null,
          city: prop?.address ?? null,
          qty: parseFloat(qty) || 1,
        },
      },
      {
        onSuccess: (r) => setAiResult(r),
        onError: (e) => setError(e.message || "AI pricing failed — type a price manually"),
      },
    );
  };

  const submit = () => {
    setError("");
    if (!propertyId) return setError("Pick a property");
    if (!serviceName) return setError(isCustom ? "Type the new service name" : "Pick a service");
    const q = parseFloat(qty) || 1;
    const p = parseFloat(price);
    if (!Number.isFinite(p) || p <= 0) return setError("Enter a price (or use the AI check)");
    const amount = Math.round(q * p * 100) / 100;
    createBid.mutate(
      {
        data: {
          propertyId,
          unitNo: unitNo.trim() || undefined,
          scope: serviceName + (isCustom && customDetails.trim() ? ` — ${customDetails.trim()}` : ""),
          amount,
          status: "sent",
          lineItems: [
            {
              service: serviceName,
              description: isCustom ? customDetails.trim() || undefined : pickedItem?.detail ?? undefined,
              qty: q,
              unitPrice: p,
            },
          ],
        },
      },
      {
        onSuccess: (bid) => {
          queryClient.invalidateQueries({ queryKey: getListBidsQueryKey() });
          setCreated({ id: bid.id, bidNo: bid.bidNo, amount });
        },
        onError: (e) => setError(e.message || "Couldn't create the bid"),
      },
    );
  };

  const q = parseFloat(qty) || 1;
  const p = parseFloat(price) || 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{created ? "Bid drafted" : "New bid"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Send it to your client — work starts when they enter the bid number on their board."
              : "Price anything — from the price book or a brand-new service."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4" data-testid="panel-bid-created">
            {/* Invoice-style draft header */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 bg-[var(--ink)] text-white flex items-center justify-between">
                <span className="font-display font-bold text-base tracking-wide">
                  BID {created.bidNo}
                </span>
                <span className="text-white/70 text-sm">
                  {(properties ?? []).find((prop) => prop.id === propertyId)?.name ?? ""}
                </span>
              </div>
              <div className="px-4 py-3 text-sm flex items-center justify-between">
                <div>
                  <div className="font-semibold">{serviceName}</div>
                  <div className="text-muted-foreground text-xs">
                    {q} × {money(p)}
                    {unitNo.trim() ? ` · Unit ${unitNo.trim()}` : ""}
                  </div>
                </div>
                <div className="font-display font-bold text-lg">{money(created.amount)}</div>
              </div>
              <div className="px-4 py-3 border-t border-border bg-[var(--gold-tint)] text-[12.5px] leading-relaxed">
                <strong>To begin this work:</strong> open your client board, tap{" "}
                <strong>Request Work</strong>, and type <strong>{created.bidNo}</strong> where it
                says “Bid number.” Everything pre-fills and the job starts right away.
              </div>
            </div>
            <div className="flex gap-2">
              <a
                href={`/api/bids/${created.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 flex items-center justify-center gap-2 border border-border rounded-full py-2.5 text-sm font-bold hover:bg-muted transition-colors"
                data-testid="link-bid-pdf"
              >
                <FileText className="w-4 h-4" /> View bid PDF
              </a>
              <button type="button" className={`${primaryBtn} flex-1`} onClick={() => onOpenChange(false)} data-testid="button-bid-done">
                <Check className="w-4 h-4" /> Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <span className={labelCls}>PROPERTY</span>
              <select
                value={propertyId}
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  setServiceChoice("");
                  setAiResult(null);
                }}
                className={fieldCls}
                data-testid="select-bid-property"
              >
                <option value="">Pick a property…</option>
                {(properties ?? []).map((prop) => (
                  <option key={prop.id} value={prop.id}>
                    {prop.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <span className={labelCls}>SERVICE</span>
              <select
                value={serviceChoice}
                onChange={(e) => {
                  const v = e.target.value;
                  setServiceChoice(v);
                  setAiResult(null);
                  const hit = priceItems.find((pi) => pi.id === v);
                  if (hit && hit.rate != null) setPrice(String(hit.rate));
                }}
                className={fieldCls}
                disabled={!propertyId}
                data-testid="select-bid-service"
              >
                <option value="">{propertyId ? "Pick a service…" : "Pick a property first"}</option>
                {priceItems.map((pi) => (
                  <option key={pi.id} value={pi.id}>
                    {pi.service}
                    {pi.rate != null ? ` — ${money(pi.rate)}` : ""}
                  </option>
                ))}
                <option value={CUSTOM}>＋ Custom — something not on the list</option>
              </select>
            </div>

            {isCustom && (
              <div className="p-3 rounded-xl bg-[var(--paper)] border border-border space-y-2">
                <div className="space-y-1">
                  <span className={labelCls}>NEW SERVICE NAME</span>
                  <input
                    value={customService}
                    onChange={(e) => setCustomService(e.target.value)}
                    placeholder="e.g. Gate repair, Mold remediation…"
                    className={fieldCls}
                    data-testid="input-bid-custom-service"
                  />
                </div>
                <div className="space-y-1">
                  <span className={labelCls}>WHAT'S INVOLVED (helps the AI price it)</span>
                  <textarea
                    value={customDetails}
                    onChange={(e) => setCustomDetails(e.target.value)}
                    placeholder="Scope, materials, size — e.g. replace motor on sliding vehicle gate"
                    rows={2}
                    className={fieldCls}
                    data-testid="input-bid-custom-details"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <span className={labelCls}>UNIT # (OPTIONAL)</span>
                <input value={unitNo} onChange={(e) => setUnitNo(e.target.value)} placeholder="Unit" className={fieldCls} data-testid="input-bid-unit" />
              </div>
              <div className="space-y-1">
                <span className={labelCls}>QTY</span>
                <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className={fieldCls} data-testid="input-bid-qty" />
              </div>
              <div className="space-y-1">
                <span className={labelCls}>PRICE EACH</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  className={fieldCls}
                  data-testid="input-bid-price"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={runAi}
              disabled={aiPricing.isPending || !serviceName}
              className="w-full flex items-center justify-center gap-2 border border-[var(--primary)]/50 bg-[var(--gold-tint)] rounded-full py-2.5 text-sm font-bold hover:border-[var(--primary)] transition-colors disabled:opacity-50"
              data-testid="button-bid-ai-pricing"
            >
              {aiPricing.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Checking market rates…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-[var(--secondary)]" /> AI market rate check
                </>
              )}
            </button>

            {aiResult && (
              <div className="p-3 rounded-xl border border-[var(--primary)]/40 bg-[var(--gold-tint)] space-y-2 text-[12.5px]" data-testid="panel-ai-pricing">
                <div className="flex items-center justify-between">
                  <span>
                    Market: <strong>{money(aiResult.marketLow)}</strong> – <strong>{money(aiResult.marketHigh)}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setPrice(String(aiResult.suggested))}
                    className="px-3 py-1 rounded-full bg-[var(--primary)] text-black text-xs font-bold"
                    data-testid="button-use-ai-price"
                  >
                    Use {money(aiResult.suggested)}
                  </button>
                </div>
                {aiResult.wholesaleNotes && (
                  <p className="text-muted-foreground">Materials: {aiResult.wholesaleNotes}</p>
                )}
                <p className="text-muted-foreground">{aiResult.rationale}</p>
              </div>
            )}

            <div className="flex items-center justify-between text-sm px-1">
              <span className="text-muted-foreground">Bid total</span>
              <span className="font-display font-bold text-lg">{money(Math.round(q * p * 100) / 100)}</span>
            </div>

            {error && <p className="text-xs text-destructive text-center">{error}</p>}
            <button type="button" onClick={submit} disabled={createBid.isPending} className={primaryBtn} data-testid="button-create-bid">
              {createBid.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Draft bid
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
