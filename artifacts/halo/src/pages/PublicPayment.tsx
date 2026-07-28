import { useState, useMemo } from "react";
import { useParams } from "wouter";
import {
  useGetPublicPaymentRequest,
  useSubmitPublicPayment,
} from "@workspace/api-client-react";
import {
  CheckCircle2,
  CreditCard,
  Building2,
  DollarSign,
  Loader2,
  AlertCircle,
} from "lucide-react";

const fmtMoney = (n: number) => `$${n.toFixed(2)}`;
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString() : "";

type PaymentMethod = "card" | "ach" | "wire" | "echeck";

export default function PublicPayment() {
  const { token } = useParams<{ token: string }>();
  const { data: req, isLoading, isError } = useGetPublicPaymentRequest(token);
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [payerName, setPayerName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCode, setCardCode] = useState("");
  const [zip, setZip] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [email, setEmail] = useState("");
  const [success, setSuccess] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);

  const submit = useSubmitPublicPayment();

  const canSubmit = useMemo(() => {
    if (!payerName) return false;
    if (method === "card") {
      return !!cardNumber && !!cardExp && !!cardCode && !!zip;
    }
    if (method === "ach" || method === "echeck") {
      return !!routingNumber && !!accountNumber;
    }
    if (method === "wire") {
      return true;
    }
    return false;
  }, [method, payerName, cardNumber, cardExp, cardCode, zip, routingNumber, accountNumber]);

  const onSubmit = () => {
    const data: any = {
      method,
      payerName,
      email: email || undefined,
    };
    if (method === "card") {
      data.cardNumber = cardNumber;
      data.cardExp = cardExp;
      data.cardCode = cardCode;
      data.zip = zip;
    }
    if (method === "ach" || method === "echeck") {
      data.routingNumber = routingNumber;
      data.accountNumber = accountNumber;
    }

    submit.mutate(
      { token, data },
      {
        onSuccess: (res) => {
          setReceipt(res);
          setSuccess(true);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !req) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="text-center">
          <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
          <div className="font-display font-bold text-[18px] text-foreground">Invalid link</div>
          <p className="text-[13px] text-muted-foreground mt-1">
            This payment link isn't valid or has expired.
          </p>
        </div>
      </div>
    );
  }

  if (req.status === "paid" || success) {
    const r = receipt || {
      confirmationNo: req.confirmationNo,
      amount: req.paidAmount || req.total,
      paidAt: req.paidAt,
      method: req.paymentMethod,
    };
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-[420px] bg-card rounded-[24px] shadow-[0_8px_24px_rgba(0,0,0,0.12)] p-[32px] text-center">
          <div className="w-[64px] h-[64px] rounded-full bg-[rgba(60,122,78,0.12)] grid place-items-center mx-auto mb-[16px]">
            <CheckCircle2 className="w-[36px] h-[36px] text-[var(--green)]" />
          </div>
          <div className="font-display font-bold text-[26px] tracking-[-0.01em] text-foreground mb-[8px]">
            Payment received
          </div>
          <div className="text-[14px] text-muted-foreground mb-[24px]">
            Thank you for your payment.
          </div>

          <div className="bg-background rounded-[16px] p-[20px] text-left space-y-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Amount</span>
              <span className="font-display font-bold text-[20px] text-[var(--green)]">
                {fmtMoney(r.amount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted-foreground">Date</span>
              <span className="font-semibold">{fmtDate(r.paidAt)}</span>
            </div>
            {r.method && (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">Method</span>
                <span className="font-semibold uppercase">{r.method}</span>
              </div>
            )}
            {r.confirmationNo && (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">Confirmation</span>
                <span className="font-mono font-semibold">{r.confirmationNo}</span>
              </div>
            )}
          </div>

          <div className="mt-[20px] text-[12px] text-muted-foreground">
            Questions? Contact {req.companyEmail || req.companyPhone || "the office"}.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-card border-b border-border px-[18px] pt-[20px] pb-[16px]">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-primary">
          {req.companyName}
        </div>
        <div className="font-display font-bold text-[22px] tracking-[-0.01em] text-foreground">
          Payment request
        </div>
        {req.companyTagline && (
          <div className="text-[12.5px] text-muted-foreground">{req.companyTagline}</div>
        )}
      </header>

      <main className="px-[14px] py-[16px] pb-[40px] max-w-[560px] mx-auto w-full flex-1">
        <div className="bg-card rounded-[20px] shadow-[0_4px_12px_rgba(0,0,0,0.05)] p-[20px] mb-[20px]">
          <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-[6px]">
            Amount due
          </div>
          <div className="font-display font-bold text-[42px] tracking-[-0.02em] tabular-nums leading-none text-[var(--ink)] mb-[16px]">
            {fmtMoney(req.total)}
          </div>
          <div className="text-[13px] text-muted-foreground">
            {req.propertyName}
            {req.memo && ` · ${req.memo}`}
          </div>
        </div>

        {req.jobs && req.jobs.length > 0 && (
          <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px] mb-[20px]">
            <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-[10px]">
              Breakdown
            </div>
            {req.jobs.map((j, i) => (
              <div
                key={i}
                className={`flex items-center justify-between py-[10px] text-[14px] ${
                  i !== 0 ? "border-t border-border/60" : ""
                }`}
              >
                <span className="text-foreground">{j.label}</span>
                <span className="font-semibold tabular-nums">{fmtMoney(j.amount)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="bg-card rounded-[20px] shadow-[0_4px_12px_rgba(0,0,0,0.05)] p-[20px]">
          <div className="text-[14px] font-semibold text-foreground mb-[14px]">
            Choose payment method
          </div>
          <div className="grid grid-cols-2 gap-[8px] mb-[20px]">
            {[
              { key: "card" as PaymentMethod, label: "Card", icon: CreditCard },
              { key: "ach" as PaymentMethod, label: "ACH", icon: Building2 },
              { key: "wire" as PaymentMethod, label: "Wire", icon: DollarSign },
              { key: "echeck" as PaymentMethod, label: "eCheck", icon: Building2 },
            ].map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.key}
                  onClick={() => setMethod(m.key)}
                  className={`flex items-center justify-center gap-[6px] rounded-[12px] py-[12px] text-[14px] font-display font-bold transition-all ${
                    method === m.key
                      ? "bg-[var(--ink)] text-white shadow-[0_4px_12px_rgba(23,24,28,0.2)]"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted"
                  }`}
                  data-testid={`button-method-${m.key}`}
                >
                  <Icon className="w-[16px] h-[16px]" /> {m.label}
                </button>
              );
            })}
          </div>

          <div className="space-y-[12px]">
            <div>
              <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                Name
              </label>
              <input
                type="text"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder="Full name or company name"
                className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px]"
                data-testid="input-payer-name"
              />
            </div>

            {method === "card" && (
              <>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                    Card number
                  </label>
                  <input
                    type="text"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="4111 1111 1111 1111"
                    className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px] font-mono"
                    data-testid="input-card-number"
                  />
                </div>
                <div className="grid grid-cols-3 gap-[8px]">
                  <div className="col-span-2">
                    <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                      Expiry
                    </label>
                    <input
                      type="text"
                      value={cardExp}
                      onChange={(e) => setCardExp(e.target.value)}
                      placeholder="MM/YY"
                      className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px] font-mono"
                      data-testid="input-card-exp"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                      CVV
                    </label>
                    <input
                      type="text"
                      value={cardCode}
                      onChange={(e) => setCardCode(e.target.value)}
                      placeholder="123"
                      className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px] font-mono"
                      data-testid="input-card-code"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                    ZIP code
                  </label>
                  <input
                    type="text"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    placeholder="90210"
                    className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px]"
                    data-testid="input-zip"
                  />
                </div>
              </>
            )}

            {(method === "ach" || method === "echeck") && (
              <>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                    Routing number
                  </label>
                  <input
                    type="text"
                    value={routingNumber}
                    onChange={(e) => setRoutingNumber(e.target.value)}
                    placeholder="9 digits"
                    className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px] font-mono"
                    data-testid="input-routing"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                    Account number
                  </label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="Account number"
                    className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px] font-mono"
                    data-testid="input-account"
                  />
                </div>
              </>
            )}

            {method === "wire" && (
              <div className="bg-muted/30 rounded-[12px] p-[14px] text-[13px] text-muted-foreground leading-relaxed">
                <div className="font-semibold text-foreground mb-[6px]">Wire instructions</div>
                <div className="space-y-[4px] font-mono text-[12px]">
                  <div>Bank: First National Bank</div>
                  <div>Routing: 123456789</div>
                  <div>Account: 9876543210</div>
                  <div>Account Name: {req.companyName}</div>
                </div>
                <div className="mt-[10px] text-[12px]">
                  After wiring, click Confirm below to notify us. Include request #{req.requestNo}{" "}
                  in the wire memo.
                </div>
              </div>
            )}

            <div>
              <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
                Email (optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[15px]"
                data-testid="input-email"
              />
              <div className="text-[11px] text-muted-foreground mt-[4px]">
                For payment confirmation receipt.
              </div>
            </div>
          </div>

          {submit.isError && (
            <div className="mt-[14px] flex items-start gap-[8px] bg-destructive/10 rounded-[10px] p-[12px] text-[13px] text-destructive">
              <AlertCircle className="w-[16px] h-[16px] shrink-0 mt-[1px]" />
              <span>{submit.error?.message || "Payment failed. Please try again."}</span>
            </div>
          )}

          <button
            onClick={onSubmit}
            disabled={!canSubmit || submit.isPending}
            className="w-full mt-[20px] flex items-center justify-center gap-[8px] rounded-[14px] py-[15px] font-display font-bold text-[16px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_8px_24px_rgba(143,106,31,0.25)] disabled:opacity-50 disabled:shadow-none transition-all active:scale-[0.98]"
            data-testid="button-submit-payment"
          >
            {submit.isPending ? (
              <Loader2 className="w-[20px] h-[20px] animate-spin" />
            ) : (
              <CheckCircle2 className="w-[20px] h-[20px]" />
            )}
            {method === "wire" ? "Confirm wire sent" : `Pay ${fmtMoney(req.total)}`}
          </button>

          <div className="mt-[16px] text-[11px] text-center text-muted-foreground">
            Secure payment powered by {req.companyName}
          </div>
        </div>
      </main>
    </div>
  );
}
