import { useEffect, useState } from "react";
import { useParams } from "wouter";
import {
  useGetClientRequestOptions,
  getGetClientRequestOptionsQueryKey,
  useCreateClientWorkRequest,
} from "@workspace/api-client-react";
import { CheckCircle2, Loader2, Send, ShieldCheck, Siren, Wrench } from "lucide-react";
import { FalkonBadge } from "@/components/FalkonBadge";

export default function ClientRequest() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetClientRequestOptions(token, {
    query: { queryKey: getGetClientRequestOptionsQueryKey(token) },
  });
  const create = useCreateClientWorkRequest();

  // Token→cookie session exchange: the API is in strict mode, so the POST
  // below requires the httpOnly session cookie. Absolute /api on purpose.
  useEffect(() => {
    if (!token) return;
    fetch(`/api/client/${token}/session`, { method: "POST", credentials: "include" }).catch(() => {});
  }, [token]);

  const [serviceId, setServiceId] = useState("");
  const [customService, setCustomService] = useState("");
  const [unitNo, setUnitNo] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 text-primary mx-auto mb-3" />
          <div className="font-display font-bold text-[18px] text-foreground">Invalid link</div>
          <p className="text-[13px] text-muted-foreground mt-1">This dashboard link isn't valid or the account is paused.</p>
        </div>
      </div>
    );
  }

  const picked = data.services.find((s) => s.id === serviceId);
  const serviceLabel = serviceId === "other" ? customService.trim() : (picked?.service ?? "");
  // Needed-by within 24h auto-flags an emergency (mirrors the server).
  const within24h = (() => {
    if (!neededBy) return false;
    const [y, m, d] = neededBy.split("-").map(Number);
    if (!y || !m || !d) return false;
    return new Date(y, m - 1, d, 23, 59, 59).getTime() - Date.now() <= 24 * 3600 * 1000;
  })();
  const isEmergency = emergency || within24h;
  const canSubmit = serviceLabel.length > 0 && (isEmergency || poNumber.trim().length > 0) && !create.isPending;

  const submit = () => {
    setError(null);
    create.mutate(
      {
        token,
        data: {
          serviceId: serviceId && serviceId !== "other" ? serviceId : null,
          serviceLabel,
          unitNo: unitNo || null,
          neededBy: neededBy || null,
          notes: notes || null,
          requesterName: requesterName || null,
          poNumber: poNumber.trim() || null,
          emergency: isEmergency,
        },
      },
      {
        onSuccess: () => {
          setSent(serviceLabel);
          setServiceId("");
          setCustomService("");
          setUnitNo("");
          setNeededBy("");
          setNotes("");
          setPoNumber("");
          setEmergency(false);
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  const inputCls =
    "w-full border border-border rounded-[10px] px-3 py-2.5 text-[14px] bg-card focus:outline-none focus:ring-2 focus:ring-[var(--gold-light,#B4FF44)]";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-card border-b border-border px-[18px] pt-[22px] pb-[18px]">
        <div className="max-w-[640px] mx-auto flex items-center gap-[14px]">
          {data.logoUrl && (
            <img src={data.logoUrl} alt="" className="w-[44px] h-[44px] rounded-[10px] object-contain bg-muted" />
          )}
          <div>
            <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-dark)]">
              {data.propertyName}
            </div>
            <div className="font-display font-bold text-[22px] tracking-[-0.01em] text-foreground flex items-center gap-2">
              <Wrench className="w-[20px] h-[20px]" /> Request work
            </div>
            <div className="text-[12.5px] text-muted-foreground mt-[2px]">
              Pick a service, tell us when you need it done, and it goes straight to our team.
            </div>
          </div>
        </div>
      </header>

      <main className="px-[14px] py-[18px] pb-[44px] max-w-[640px] mx-auto flex-1 w-full space-y-[14px]">
        {sent && (
          <div className="bg-[var(--gold-light,#B4FF44)]/15 border border-[var(--gold-light,#B4FF44)] rounded-[12px] p-[12px] flex items-start gap-[8px]" data-testid="banner-sent">
            <CheckCircle2 className="w-[16px] h-[16px] mt-[1px] text-[var(--gold-dark)] shrink-0" />
            <div className="text-[13px] text-foreground">
              <span className="font-semibold">Request sent.</span> "{sent}" is with our team — we'll accept it and schedule the work, or reach out with questions.
            </div>
          </div>
        )}

        <div className="bg-card rounded-[16px] border border-border shadow-sm p-[18px] space-y-[14px]">
          <div>
            <label className="block text-[12px] font-bold uppercase tracking-wide text-muted-foreground mb-[6px]">Service *</label>
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className={inputCls}
              data-testid="select-service"
            >
              <option value="">Choose a service…</option>
              {data.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.service}
                  {s.detail ? ` — ${s.detail}` : ""}
                </option>
              ))}
              <option value="other">Something else…</option>
            </select>
            {serviceId === "other" && (
              <input
                value={customService}
                onChange={(e) => setCustomService(e.target.value)}
                placeholder="Describe the work you need"
                className={`${inputCls} mt-[8px]`}
                data-testid="input-custom-service"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-[12px]">
            <div>
              <label className="block text-[12px] font-bold uppercase tracking-wide text-muted-foreground mb-[6px]">Complete by</label>
              <input
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
                className={inputCls}
                data-testid="input-needed-by"
              />
            </div>
            <div>
              <label className="block text-[12px] font-bold uppercase tracking-wide text-muted-foreground mb-[6px]">Unit # (optional)</label>
              <input
                value={unitNo}
                onChange={(e) => setUnitNo(e.target.value)}
                placeholder="e.g. 204"
                className={inputCls}
                data-testid="input-unit"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-bold uppercase tracking-wide text-muted-foreground mb-[6px]">
              PO number {isEmergency ? "(optional for emergencies)" : "*"}
            </label>
            <div className="flex items-stretch gap-[8px]">
              <input
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder={isEmergency ? "PO # (can follow later)" : "PO #"}
                className={`${inputCls} flex-1`}
                data-testid="input-po-number"
              />
              <button
                type="button"
                onClick={() => setEmergency((v) => !v)}
                title="Emergency — skip the PO; the office reviews and approves it manually"
                className={`shrink-0 flex items-center gap-[6px] rounded-[10px] border px-[12px] font-display font-bold text-[13px] ${
                  isEmergency
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : "border-border bg-card text-foreground"
                }`}
                data-testid="toggle-emergency"
              >
                <Siren className="w-[15px] h-[15px]" /> Emergency
              </button>
            </div>
            <p className="mt-[6px] text-[11.5px] text-muted-foreground">
              {isEmergency
                ? "No PO needed — our office is alerted immediately and will approve & post the work manually."
                : "A PO number is required to send a request — unless it's an emergency."}
            </p>
          </div>

          <div>
            <label className="block text-[12px] font-bold uppercase tracking-wide text-muted-foreground mb-[6px]">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Anything our crew should know — access, scope, urgency…"
              className={inputCls}
              data-testid="input-notes"
            />
          </div>

          <div>
            <label className="block text-[12px] font-bold uppercase tracking-wide text-muted-foreground mb-[6px]">Your name</label>
            <input
              value={requesterName}
              onChange={(e) => setRequesterName(e.target.value)}
              placeholder="So we know who to follow up with"
              className={inputCls}
              data-testid="input-requester"
            />
          </div>

          {error && <div className="text-[12.5px] text-destructive font-medium">{error}</div>}

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 bg-[var(--gold-light,#B4FF44)] text-black font-display font-bold rounded-[12px] py-[12px] text-[15px] disabled:opacity-50"
            data-testid="button-send-request"
          >
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send request
          </button>
        </div>

        <div className="pt-4 flex justify-center"><FalkonBadge /></div>
      </main>
    </div>
  );
}
