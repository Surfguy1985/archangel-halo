import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetClientAccess,
  useUpdateClientAccessUser,
  getGetClientAccessQueryKey,
  useGetClientBilling,
  getGetClientBillingQueryKey,
  useUpdateClientBilling,
  usePutClientPaymentMethod,
  type ClientAccessUser,
  type ClientFeature,
  type ClientBillingView,
} from "@workspace/api-client-react";
import {
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { FalkonBadge } from "@/components/FalkonBadge";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

function UserAccessCard({
  token,
  user,
  features,
}: {
  token: string;
  user: ClientAccessUser;
  features: ClientFeature[];
}) {
  const queryClient = useQueryClient();
  const update = useUpdateClientAccessUser();
  const [error, setError] = useState<string | null>(null);

  const mutate = (data: { role?: string; permissions?: string[]; resetToRoleDefaults?: boolean }) => {
    setError(null);
    update.mutate(
      { token, userId: user.id, data },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({ queryKey: getGetClientAccessQueryKey(token) }),
        onError: (err) => setError(err.message),
      },
    );
  };

  const toggle = (key: string) => {
    const has = user.permissions.includes(key);
    mutate({
      permissions: has
        ? user.permissions.filter((k) => k !== key)
        : [...user.permissions, key],
    });
  };

  return (
    <div className={`bg-card rounded-[16px] border border-border shadow-sm p-[18px] ${user.active ? "" : "opacity-60"}`} data-testid={`card-user-${user.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-display font-bold text-[16px] text-foreground flex items-center gap-2">
            {user.name}
            {!user.active && (
              <span className="text-[10px] font-bold uppercase bg-muted text-muted-foreground rounded-full px-2 py-0.5">Inactive</span>
            )}
          </div>
          <div className="text-[12.5px] text-muted-foreground truncate">{user.email}</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={user.role}
            onChange={(e) => mutate({ role: e.target.value })}
            disabled={update.isPending}
            className="border border-border rounded-[10px] px-3 py-2 text-[13px] font-semibold bg-card"
            data-testid={`select-role-${user.id}`}
          >
            {Object.entries(ROLE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          {user.customized && (
            <button
              onClick={() => mutate({ resetToRoleDefaults: true })}
              disabled={update.isPending}
              className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              title="Back to the standard access for this role"
              data-testid={`button-reset-${user.id}`}
            >
              <RotateCcw className="w-3 h-3" /> Use role defaults
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[16px] gap-y-[8px] mt-[14px]">
        {features.map((f) => {
          const checked = user.permissions.includes(f.key);
          return (
            <label
              key={f.key}
              className={`flex items-start gap-[9px] rounded-[10px] border p-[10px] cursor-pointer transition-colors ${
                checked ? "border-[var(--gold-light,#B4FF44)] bg-[var(--gold-light,#B4FF44)]/10" : "border-border hover:bg-muted/40"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(f.key)}
                disabled={update.isPending}
                className="mt-[2px] accent-[var(--gold,#4a7000)]"
                data-testid={`checkbox-${user.id}-${f.key}`}
              />
              <span>
                <span className="block text-[13px] font-semibold text-foreground leading-tight">{f.label}</span>
                <span className="block text-[11px] text-muted-foreground leading-snug mt-[2px]">{f.description}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-[10px] flex items-center justify-between min-h-[18px]">
        <span className="text-[11px] text-muted-foreground">
          {user.customized ? "Custom access" : `Standard ${ROLE_LABELS[user.role] ?? user.role} access`}
          {" · "}{user.permissions.length} of {features.length} features
        </span>
        {update.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>
      {error && <div className="mt-[6px] text-[12px] text-destructive font-medium">{error}</div>}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? "th"}`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function PaymentMethodForm({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const save = usePutClientPaymentMethod();
  const [methodType, setMethodType] = useState<"card" | "ach">("card");
  const [f, setF] = useState({
    payerName: "",
    cardNumber: "",
    cardExp: "",
    cardCode: "",
    accountNumber: "",
    routingNumber: "",
    bankName: "",
    zip: "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const input =
    "w-full border border-border rounded-[10px] px-3 py-2 text-[13.5px] bg-card";

  const submit = () => {
    setError(null);
    save.mutate(
      { token, data: { methodType, ...f } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBillingQueryKey(token) });
          onDone();
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className="mt-3 space-y-[10px]">
      <div className="flex gap-2">
        {(["card", "ach"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMethodType(t)}
            className={`px-3 py-1.5 rounded-full text-[12.5px] font-bold border ${methodType === t ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground"}`}
            data-testid={`button-method-${t}`}
          >
            {t === "card" ? "Card" : "Bank account (ACH)"}
          </button>
        ))}
      </div>
      <input placeholder="Name on the account" value={f.payerName} onChange={set("payerName")} className={input} data-testid="input-payer-name" />
      {methodType === "card" ? (
        <div className="grid grid-cols-2 gap-[8px]">
          <input placeholder="Card number" inputMode="numeric" value={f.cardNumber} onChange={set("cardNumber")} className={`${input} col-span-2`} data-testid="input-card-number" />
          <input placeholder="MM/YY" value={f.cardExp} onChange={set("cardExp")} className={input} data-testid="input-card-exp" />
          <input placeholder="CVV" inputMode="numeric" value={f.cardCode} onChange={set("cardCode")} className={input} data-testid="input-card-cvv" />
          <input placeholder="Billing ZIP" inputMode="numeric" value={f.zip} onChange={set("zip")} className={input} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-[8px]">
          <input placeholder="Bank name" value={f.bankName} onChange={set("bankName")} className={`${input} col-span-2`} />
          <input placeholder="Routing number" inputMode="numeric" value={f.routingNumber} onChange={set("routingNumber")} className={input} data-testid="input-routing" />
          <input placeholder="Account number" inputMode="numeric" value={f.accountNumber} onChange={set("accountNumber")} className={input} data-testid="input-account" />
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={save.isPending || !f.payerName.trim()}
          className="px-4 py-2 rounded-full bg-[var(--gold-light,#B4FF44)] text-black text-[13px] font-bold disabled:opacity-50"
          data-testid="button-save-payment-method"
        >
          {save.isPending ? "Saving…" : "Save payment method"}
        </button>
        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Lock className="w-3 h-3" /> Only the last 4 digits are kept — never the full number or CVV.
        </span>
      </div>
      {error && <div className="text-[12px] text-destructive font-medium">{error}</div>}
    </div>
  );
}

function BillingCard({ token, billing }: { token: string; billing: ClientBillingView }) {
  const queryClient = useQueryClient();
  const update = useUpdateClientBilling();
  const [editingPayment, setEditingPayment] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contact, setContact] = useState({
    name: billing.billingContact?.name ?? "",
    email: billing.billingContact?.email ?? "",
    company: billing.billingContact?.company ?? "",
    phone: billing.billingContact?.phone ?? "",
  });
  const [confirmTier, setConfirmTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the contact editor in sync with fresh server data (refetches,
  // updates from another tab) as long as it isn't being edited right now.
  useEffect(() => {
    if (!editingContact) {
      setContact({
        name: billing.billingContact?.name ?? "",
        email: billing.billingContact?.email ?? "",
        company: billing.billingContact?.company ?? "",
        phone: billing.billingContact?.phone ?? "",
      });
    }
  }, [billing.billingContact, editingContact]);

  const mutate = (data: Parameters<typeof update.mutate>[0]["data"], after?: () => void) => {
    setError(null);
    update.mutate(
      { token, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBillingQueryKey(token) });
          // Pause/resume flips the whole dashboard on or off — refresh the
          // access view too so the page swaps between full admin and billing-only.
          queryClient.invalidateQueries({ queryKey: getGetClientAccessQueryKey(token) });
          after?.();
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  const paused = billing.status === "paused";
  const pm = billing.paymentMethod;
  const input =
    "w-full border border-border rounded-[10px] px-3 py-2 text-[13.5px] bg-card";

  return (
    <div className="bg-card rounded-[16px] border border-border shadow-sm p-[18px] space-y-[16px]" data-testid="card-billing">
      <div className="flex items-center gap-2">
        <CreditCard className="w-[18px] h-[18px] text-[var(--gold-dark)]" />
        <div className="font-display font-bold text-[16px] text-foreground">Billing & subscription</div>
        {paused && (
          <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">Paused</span>
        )}
      </div>

      {/* Plan picker */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[10px]">
        {billing.plans.map((p) => {
          const current = p.tier === billing.tier;
          return (
            <button
              key={p.tier}
              onClick={() => !current && setConfirmTier(p.tier)}
              className={`text-left rounded-[12px] border p-[12px] transition-colors ${current ? "border-[var(--gold-light,#B4FF44)] bg-[var(--gold-light,#B4FF44)]/10" : "border-border hover:bg-muted/40"}`}
              data-testid={`plan-${p.tier}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-[14px]">{p.label}</span>
                {current && <span className="text-[10px] font-bold uppercase text-[var(--gold-dark)]">Current</span>}
              </div>
              <div className="font-display font-bold text-[20px] mt-1">
                ${p.pricePerMonth}<span className="text-[12px] font-normal text-muted-foreground">/mo</span>
              </div>
              <div className="text-[11.5px] text-muted-foreground mt-1 leading-snug">{p.blurb}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{p.userSeats} users · {p.guestSeats} guests</div>
            </button>
          );
        })}
      </div>
      {confirmTier && (
        <div className="rounded-[10px] bg-muted/50 p-[10px] flex items-center gap-3 flex-wrap">
          <span className="text-[12.5px]">
            Switch to the <b>{billing.plans.find((p) => p.tier === confirmTier)?.label}</b> plan? Seats change to the new plan's allowance and the new rate applies from your next pull.
          </span>
          <button
            onClick={() => mutate({ tier: confirmTier }, () => setConfirmTier(null))}
            disabled={update.isPending}
            className="px-3 py-1.5 rounded-full bg-foreground text-background text-[12px] font-bold"
            data-testid="button-confirm-plan"
          >
            {update.isPending ? "Switching…" : "Confirm switch"}
          </button>
          <button onClick={() => setConfirmTier(null)} className="text-[12px] font-semibold text-muted-foreground">Cancel</button>
        </div>
      )}
      <div className="text-[11px] text-muted-foreground -mt-2">
        Using {billing.seatUsage.usersActive} of {billing.seatUsage.userSeats} user seats · {billing.seatUsage.guestsActive} of {billing.seatUsage.guestSeats} guest seats
      </div>

      {/* Billing date + pause */}
      <div className="flex items-center gap-3 flex-wrap rounded-[12px] border border-border p-[12px]">
        <CalendarClock className="w-[16px] h-[16px] text-muted-foreground" />
        <div className="text-[13px]">
          {paused ? (
            <span className="font-semibold">Billing is paused — nothing will be pulled.</span>
          ) : billing.nextChargeOn ? (
            <>Next pull: <b>{fmtDate(billing.nextChargeOn)}</b></>
          ) : null}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-[12px] text-muted-foreground">Pull on the</label>
          <select
            value={billing.billingDay}
            onChange={(e) => mutate({ billingDay: Number(e.target.value) })}
            disabled={update.isPending}
            className="border border-border rounded-[10px] px-2 py-1.5 text-[13px] font-semibold bg-card"
            data-testid="select-billing-day"
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{ordinal(d)}</option>
            ))}
          </select>
          <button
            onClick={() => mutate({ status: paused ? "active" : "paused" })}
            disabled={update.isPending}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-bold border ${paused ? "bg-[var(--gold-light,#B4FF44)] text-black border-transparent" : "border-border text-muted-foreground hover:text-foreground"}`}
            data-testid="button-pause-resume"
          >
            {paused ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
            {paused ? "Resume subscription" : "Pause subscription"}
          </button>
        </div>
      </div>

      {/* Payment method */}
      <div className="rounded-[12px] border border-border p-[12px]">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[13px]" data-testid="text-payment-method">
            {pm ? (
              <>
                <b>{pm.methodType === "card" ? `${pm.brand ?? "Card"} •••• ${pm.last4}` : `${pm.bankName ?? "Bank account"} •••• ${pm.last4}`}</b>
                {pm.cardExp ? <span className="text-muted-foreground"> · exp {pm.cardExp}</span> : null}
                <span className="text-muted-foreground"> · {pm.payerName}</span>
              </>
            ) : (
              <span className="text-muted-foreground">No payment method on file yet.</span>
            )}
          </div>
          <button
            onClick={() => setEditingPayment((v) => !v)}
            className="text-[12.5px] font-bold text-[var(--gold-dark)]"
            data-testid="button-edit-payment"
          >
            {editingPayment ? "Close" : pm ? "Replace payment method" : "Add payment method"}
          </button>
        </div>
        {editingPayment && <PaymentMethodForm token={token} onDone={() => setEditingPayment(false)} />}
      </div>

      {/* Billing contact */}
      <div className="rounded-[12px] border border-border p-[12px]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px]">
            {billing.billingContact?.name || billing.billingContact?.email ? (
              <>
                <b>{billing.billingContact.name || "Billing contact"}</b>
                <span className="text-muted-foreground">
                  {billing.billingContact.email ? ` · ${billing.billingContact.email}` : ""}
                  {billing.billingContact.company ? ` · ${billing.billingContact.company}` : ""}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">No billing contact on file.</span>
            )}
          </div>
          <button
            onClick={() => setEditingContact((v) => !v)}
            className="text-[12.5px] font-bold text-[var(--gold-dark)]"
            data-testid="button-edit-contact"
          >
            {editingContact ? "Close" : "Change account info"}
          </button>
        </div>
        {editingContact && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-[8px]">
            <input placeholder="Billing contact name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} className={input} data-testid="input-contact-name" />
            <input placeholder="Billing email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} className={input} data-testid="input-contact-email" />
            <input placeholder="Company" value={contact.company} onChange={(e) => setContact({ ...contact, company: e.target.value })} className={input} />
            <input placeholder="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} className={input} />
            <button
              onClick={() => mutate({ billingContact: contact }, () => setEditingContact(false))}
              disabled={update.isPending}
              className="px-4 py-2 rounded-full bg-foreground text-background text-[13px] font-bold sm:col-span-2 justify-self-start"
              data-testid="button-save-contact"
            >
              {update.isPending ? "Saving…" : "Save account info"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="text-[12px] text-destructive font-medium">{error}</div>}
    </div>
  );
}

export default function ClientAdmin() {
  const { token } = useParams<{ token: string }>();

  // Token→cookie session exchange: the API is in strict mode, so mutations
  // (billing resume, payment method, access edits) require the httpOnly
  // session cookie. The exchange also mints for paused accounts on purpose.
  useEffect(() => {
    if (!token) return;
    fetch(`/api/client/${token}/session`, { method: "POST", credentials: "include" }).catch(() => {});
  }, [token]);

  const { data, isLoading, isError } = useGetClientAccess(token, {
    query: { queryKey: getGetClientAccessQueryKey(token), retry: false },
  });
  const { data: billing, isLoading: billingLoading } = useGetClientBilling(token, {
    query: { queryKey: getGetClientBillingQueryKey(token), retry: false },
  });

  if (isLoading || billingLoading) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  // Paused accounts: the dashboard (and team access) is off, but billing must
  // stay reachable so the admin can update payment info and resume.
  if ((isError || !data) && billing) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="bg-card border-b border-border px-[18px] pt-[22px] pb-[18px]">
          <div className="max-w-[860px] mx-auto">
            <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-dark)]">
              {billing.propertyName}
            </div>
            <div className="font-display font-bold text-[22px] tracking-[-0.01em] leading-snug text-foreground flex items-center gap-2">
              <CreditCard className="w-[20px] h-[20px]" /> Admin — Billing
            </div>
            <div className="text-[12.5px] text-muted-foreground mt-[2px]">
              Your subscription is paused, so the dashboard is off for your team. Resume below to bring it back.
            </div>
          </div>
        </header>
        <main className="px-[14px] py-[18px] pb-[44px] max-w-[860px] mx-auto flex-1 w-full space-y-[14px]">
          <BillingCard token={token} billing={billing} />
          <div className="pt-4 flex justify-center"><FalkonBadge /></div>
        </main>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 text-primary mx-auto mb-3" />
          <div className="font-display font-bold text-[18px] text-foreground">Invalid link</div>
          <p className="text-[13px] text-muted-foreground mt-1">
            This dashboard link isn't valid or the account is paused.
          </p>
          <div className="mt-8"><FalkonBadge /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-card border-b border-border px-[18px] pt-[22px] pb-[18px]">
        <div className="max-w-[860px] mx-auto flex items-center gap-[14px]">
          {data.logoUrl && (
            <img src={data.logoUrl} alt="" className="w-[44px] h-[44px] rounded-[10px] object-contain bg-muted" />
          )}
          <div>
            <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-dark)]">
              {data.propertyName}
            </div>
            <div className="font-display font-bold text-[22px] tracking-[-0.01em] leading-snug text-foreground flex items-center gap-2">
              <Users className="w-[20px] h-[20px]" /> Admin — Team access
            </div>
            <div className="text-[12.5px] text-muted-foreground mt-[2px]">
              Choose what each person on your team can see and do. Changes apply instantly.
            </div>
          </div>
        </div>
      </header>

      <main className="px-[14px] py-[18px] pb-[44px] max-w-[860px] mx-auto flex-1 w-full space-y-[14px]">
        {billing && <BillingCard token={token} billing={billing} />}

        {data.users.length === 0 ? (
          <div className="bg-card rounded-[16px] border border-dashed border-border p-[28px] text-center text-muted-foreground text-[13.5px]">
            No team members yet — ask us to add the first people and they'll appear here.
          </div>
        ) : (
          data.users.map((u) => (
            <UserAccessCard key={u.id} token={token} user={u} features={data.features} />
          ))
        )}

        <div className="bg-muted/40 rounded-[12px] p-[12px] text-[12px] text-muted-foreground flex items-start gap-[8px]">
          <CheckCircle2 className="w-[14px] h-[14px] mt-[1px] shrink-0 text-[var(--gold-dark)]" />
          New people start with the standard access for their role (Admin, Member, or Guest); ticking or unticking any box gives them a custom set.
        </div>

        <div className="pt-4 flex justify-center"><FalkonBadge /></div>
      </main>
    </div>
  );
}
