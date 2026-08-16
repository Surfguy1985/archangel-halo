import { useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Users,
  Send,
  KeyRound,
  Copy,
  RefreshCw,
  Upload,
  Trash2,
  Building,
  Check,
  Plus,
  ExternalLink,
  LayoutGrid,
} from "lucide-react";
import {
  useGetClientAccount,
  getGetClientAccountQueryKey,
  getListClientAccountsQueryKey,
  useUpsertClientAccount,
  useCreateClientUser,
  useUpdateClientUser,
  useDeleteClientUser,
  useResetClientUserPassword,
  useRegenerateDashboardToken,
  useSendClientOnboarding,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import AdminUnitMap from "@/components/AdminUnitMap";
import AdminPropertyHub from "@/components/AdminPropertyHub";

const TIERS = [
  { value: "basic", label: "Basic" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
];

const inputCls = "w-full px-4 py-2.5 rounded-xl bg-white border border-[var(--hairline)] text-sm text-[var(--ink)] placeholder:text-[var(--hairline2)] focus:outline-none focus:border-[var(--secondary)] focus:ring-2 focus:ring-[var(--secondary)]/20 transition-all";
const btnPrimary = "px-5 py-2.5 bg-[var(--gold-light)] text-[var(--ink)] text-sm font-bold rounded-xl hover:bg-[#A3E63D] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 shadow-sm";
const btnGhost = "px-4 py-2.5 text-sm font-bold rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2";

function DarkSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="py-8 border-t border-[var(--hairline)] first:border-0">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h2 className="text-lg font-display font-bold text-[var(--ink)] tracking-tight">{title}</h2>
        {action && <div>{action}</div>}
      </div>
      {children}
    </div>
  );
}

export default function AdminAccount() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetClientAccount(propertyId);

  const upsert = useUpsertClientAccount();
  const createUser = useCreateClientUser();
  const updateUser = useUpdateClientUser();
  const deleteUser = useDeleteClientUser();
  const resetPassword = useResetClientUserPassword();
  const regenToken = useRegenerateDashboardToken();
  const sendOnboarding = useSendClientOnboarding();

  const [sub, setSub] = useState<{
    tier: string;
    userSeats: string;
    guestSeats: string;
    status: string;
    notes: string;
    billingDay: string;
    billingContactName: string;
    billingContactEmail: string;
    billingContactPhone: string;
    paymentMethodType: string;
    paymentLast4: string;
  } | null>(null);
  const [overviewDraft, setOverviewDraft] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "member", sendEmail: true });
  const [issued, setIssued] = useState<{ email: string; tempPassword: string; emailed: boolean } | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendNote, setSendNote] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetClientAccountQueryKey(propertyId) });
    queryClient.invalidateQueries({ queryKey: getListClientAccountsQueryKey() });
  };
  const onError = (err: Error) =>
    toast({ title: "That didn't save", description: err.message, variant: "destructive" });

  if (isLoading || !data) {
    return (
      <div className="theme-light p-8 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48 rounded-xl bg-[var(--muted)]" />
        <Skeleton className="h-64 rounded-[24px] bg-[var(--muted)]" />
      </div>
    );
  }

  const { account, users, sends, property, contacts, services } = data;
  
  const subState = sub ?? {
    tier: account.tier,
    userSeats: String(account.userSeats),
    guestSeats: String(account.guestSeats),
    status: account.status,
    notes: account.notes ?? "",
    billingDay: String(account.billingDay ?? 1),
    billingContactName: account.billingContact?.name ?? "",
    billingContactEmail: account.billingContact?.email ?? "",
    billingContactPhone: account.billingContact?.phone ?? "",
    paymentMethodType: account.paymentMethod?.methodType ?? "card",
    paymentLast4: account.paymentMethod?.last4 ?? "",
  };

  const saveSubscription = () =>
    upsert.mutate(
      {
        propertyId,
        data: {
          tier: subState.tier,
          userSeats: Number(subState.userSeats) || 0,
          guestSeats: Number(subState.guestSeats) || 0,
          status: subState.status,
          notes: subState.notes || null,
          billingDay: Number(subState.billingDay) || 1,
          billingContact: {
            name: subState.billingContactName,
            email: subState.billingContactEmail,
            phone: subState.billingContactPhone,
          },
          paymentMethod: subState.paymentLast4 ? {
            methodType: subState.paymentMethodType,
            last4: subState.paymentLast4,
            payerName: subState.billingContactName || "Client",
          } : null,
        },
      },
      {
        onSuccess: () => {
          setSub(null);
          refresh();
          toast({ title: "Subscription saved" });
        },
        onError,
      },
    );

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const res = await fetch(`/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) throw new Error("Couldn't start the upload");
      const { uploadURL, objectPath } = (await res.json()) as { uploadURL: string; objectPath: string };
      const put = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error("Upload failed");
      upsert.mutate(
        { propertyId, data: { logoPath: objectPath } },
        { onSuccess: () => { refresh(); toast({ title: "Logo updated" }); }, onError },
      );
    } catch (e) {
      toast({ title: "Logo upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  };

  return (
    <div className="theme-light p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <Link href="/admin" className="inline-flex items-center gap-2 text-[var(--ink2)] text-sm font-bold hover:text-[var(--ink)] transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Accounts
      </Link>

      <div className="cl-panel rounded-[24px] p-6 lg:p-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center gap-6 mb-8 pb-8 border-b border-[var(--hairline)]">
          <div className="w-20 h-20 rounded-2xl bg-[var(--muted)] border border-[var(--hairline)] flex items-center justify-center shrink-0 overflow-hidden relative">
            {account.logoPath ? (
              <img src={`/api/storage${account.logoPath}`} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <Building className="w-8 h-8 text-[var(--hairline2)]" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-display font-bold text-[var(--ink)] truncate tracking-tight">{property.name}</h1>
            <p className="text-[var(--ink2)] text-sm mt-1 truncate">
              {[property.pmcName, property.address, property.city].filter(Boolean).join(" · ") || "—"}
              {property.units ? ` · ${property.units} units` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
             <button onClick={() => fileRef.current?.click()} disabled={uploading} className={btnGhost} data-testid="button-upload-logo">
               <Upload className="w-4 h-4" /> {uploading ? "Uploading…" : "Logo"}
             </button>
             <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadLogo(f);
                  e.target.value = "";
                }}
              />
             <a href={account.dashboardUrl ?? "#"} target="_blank" rel="noreferrer" className={btnGhost} data-testid="link-client-board" title="Open the client-facing dashboard in a new tab">
               <ExternalLink className="w-4 h-4" /> Client board
             </a>
             <Link href={`/admin/${property.id}/board`} className="px-4 py-2.5 text-sm font-bold rounded-xl bg-[var(--secondary)] text-white hover:bg-[var(--ink)] transition-colors inline-flex items-center justify-center gap-2 shadow-sm" data-testid="link-office-board" title="Open this client's board in the office view">
               <LayoutGrid className="w-4 h-4" /> Office view
             </Link>
             <Link href={`/properties/${property.id}`} className={btnGhost}>
               <Building className="w-4 h-4" /> Property
             </Link>
          </div>
        </div>

        {/* Sections */}
        
        <DarkSection 
          title="Subscription & Billing" 
          action={
            <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1 ${account.status === "active" ? "bg-[#EAFFC7] text-[#3D6B00] border border-[#B4FF44]" : "bg-[var(--muted)] text-[var(--ink2)] border border-[var(--hairline)]"}`}>
              {account.status}
            </span>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white/80 border-b border-white/5 pb-2">Plan Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 block">Tier</label>
                  <div className="flex gap-2">
                    {TIERS.map((t) => (
                      <button
                        key={t.value}
                        onClick={() => setSub({ ...subState, tier: t.value })}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-colors ${subState.tier === t.value ? "bg-[var(--gold-light)] text-[var(--ink)] border-transparent shadow-sm" : "bg-white border-[var(--hairline)] text-[var(--ink2)] hover:bg-[var(--muted)] hover:text-[var(--ink)]"}`}
                        data-testid={`button-tier-${t.value}`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 block">User seats</label>
                  <input inputMode="numeric" value={subState.userSeats} onChange={(e) => setSub({ ...subState, userSeats: e.target.value })} className={inputCls} data-testid="input-user-seats" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 block">Guest seats</label>
                  <input inputMode="numeric" value={subState.guestSeats} onChange={(e) => setSub({ ...subState, guestSeats: e.target.value })} className={inputCls} data-testid="input-guest-seats" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 block">Status</label>
                  <div className="flex gap-2">
                    {["active", "paused", "cancelled"].map((s) => (
                      <button key={s} onClick={() => setSub({ ...subState, status: s })} className={`flex-1 py-2.5 rounded-xl text-sm font-bold border capitalize transition-colors ${subState.status === s ? "bg-[var(--secondary)] text-white border-transparent shadow-sm" : "bg-white border-[var(--hairline)] text-[var(--ink2)] hover:bg-[var(--muted)] hover:text-[var(--ink)]"}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 block">Notes</label>
                  <textarea value={subState.notes} onChange={(e) => setSub({ ...subState, notes: e.target.value })} rows={2} className={inputCls} placeholder="Renewal dates…" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white/80 border-b border-white/5 pb-2">Billing & Payment</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 flex gap-4">
                  <div className="flex-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 block">Billing Contact</label>
                    <input value={subState.billingContactName} onChange={(e) => setSub({...subState, billingContactName: e.target.value})} className={inputCls} placeholder="Name" />
                  </div>
                  <div className="w-24">
                    <label className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 block">Bill Day</label>
                    <input type="number" min="1" max="28" value={subState.billingDay} onChange={(e) => setSub({...subState, billingDay: e.target.value})} className={inputCls} placeholder="1-28" />
                  </div>
                </div>
                <div className="col-span-2">
                  <input value={subState.billingContactEmail} onChange={(e) => setSub({...subState, billingContactEmail: e.target.value})} className={inputCls} placeholder="Email" />
                </div>
                <div className="col-span-2">
                  <input value={subState.billingContactPhone} onChange={(e) => setSub({...subState, billingContactPhone: e.target.value})} className={inputCls} placeholder="Phone" />
                </div>
                
                <div className="col-span-2 mt-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 block">Payment Method <span className="lowercase normal-case text-white/30 font-medium">(Display Only)</span></label>
                  <div className="flex gap-2">
                    <select value={subState.paymentMethodType} onChange={(e) => setSub({...subState, paymentMethodType: e.target.value})} className={`${inputCls} w-1/3 appearance-none`}>
                      <option value="card">Card</option>
                      <option value="ach">ACH</option>
                    </select>
                    <input value={subState.paymentLast4} onChange={(e) => setSub({...subState, paymentLast4: e.target.value})} className={`${inputCls} flex-1 font-mono`} placeholder="Last 4 digits" maxLength={4} />
                  </div>
                  <p className="text-[10px] text-white/30 mt-2 font-medium">For offline record keeping. Never enter full card numbers.</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-8 flex flex-col md:flex-row md:items-center justify-between gap-6 border-t border-white/5 pt-8">
            <div className="flex items-center gap-4">
              <button
                role="switch"
                aria-checked={account.notifyNewCards ?? true}
                onClick={() => upsert.mutate({ propertyId, data: { notifyNewCards: !(account.notifyNewCards ?? true) } }, { onSuccess: refresh })}
                className={`relative w-12 h-6 rounded-full transition-colors ${(account.notifyNewCards ?? true) ? "bg-[var(--gold-light)]" : "bg-white/20"} disabled:opacity-50`}
                data-testid="switch-notify-new-cards"
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${(account.notifyNewCards ?? true) ? "translate-x-6" : ""}`} />
              </button>
              <div>
                <p className="text-sm font-bold text-white">New-card email pings</p>
                <p className="text-xs text-white/40 mt-0.5">Digest emails when new cards land.</p>
              </div>
            </div>
            <button onClick={saveSubscription} disabled={upsert.isPending || !sub} className={btnPrimary} data-testid="button-save-subscription">
              <Check className="w-4 h-4" /> {upsert.isPending ? "Saving…" : "Save subscription"}
            </button>
          </div>
        </DarkSection>

        <DarkSection title="Onboarding & Logins">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white/80 border-b border-white/5 pb-2">Client Dashboard Link</h3>
              <div className="cl-subpanel rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-[var(--secondary)] text-white rounded-lg px-3 py-2.5 truncate border border-[var(--hairline)] font-mono">{account.dashboardUrl}</code>
                  <button onClick={() => copy(account.dashboardUrl ?? "", "Link")} className={btnGhost} aria-label="Copy link" data-testid="button-copy-dashboard-link">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button onClick={() => regenToken.mutate({propertyId}, {onSuccess: () => { refresh(); toast({ title: "New link generated", description: "The old link no longer works." }); }, onError})} disabled={regenToken.isPending} className={btnGhost} data-testid="button-regenerate-token">
                    <RefreshCw className={`w-4 h-4 ${regenToken.isPending ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <div className="space-y-3 pt-2">
                  <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} className={inputCls} placeholder="client@property.com" data-testid="input-onboarding-to" />
                  <textarea value={sendNote} onChange={(e) => setSendNote(e.target.value)} rows={2} className={inputCls} placeholder="Personal note (optional)" />
                  <button onClick={() => sendOnboarding.mutate({ propertyId, data: { channel: "email", to: sendTo, message: sendNote || null } }, { onSuccess: () => { setSendTo(""); setSendNote(""); refresh(); toast({ title: "Onboarding email sent" }); }, onError: (err) => { refresh(); onError(err); } })} disabled={sendOnboarding.isPending || !sendTo.trim()} className={`${btnPrimary} w-full`} data-testid="button-send-onboarding">
                    <Send className="w-4 h-4" /> Send email
                  </button>
                </div>
                {sends.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Sent history</p>
                    {sends.slice(0, 5).map((s) => (
                      <div key={s.id} className="flex items-center gap-2 text-xs font-medium text-white/60">
                        <span className={`w-2 h-2 rounded-full ${s.status === "sent" ? "bg-[#65A30D]" : "bg-[#EF4444]"}`} />
                        <span className="truncate flex-1">{s.sentTo}</span>
                        <span className="shrink-0 text-white/30">{new Date(s.createdAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <h3 className="text-sm font-bold text-white/80">Logins</h3>
                <span className="text-xs font-bold text-white/40 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  {users.filter(u => u.active && u.role !== 'guest').length}/{account.userSeats} users · {users.filter(u => u.active && u.role === 'guest').length}/{account.guestSeats} guests
                </span>
              </div>
              
              <div className="flex flex-col gap-3 cl-subpanel rounded-xl p-4">
                <div className="flex gap-2">
                  <input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className={inputCls} placeholder="Name" data-testid="input-new-user-name" />
                  <input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className={inputCls} placeholder="Email" data-testid="input-new-user-email" />
                </div>
                <div className="flex gap-2">
                  <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className={`${inputCls} flex-1 appearance-none`}>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="guest">Guest</option>
                  </select>
                  <button onClick={() => createUser.mutate({ propertyId, data: { name: newUser.name, email: newUser.email, role: newUser.role, sendEmail: newUser.sendEmail } }, { onSuccess: (r) => { setIssued({ email: r.user.email, tempPassword: r.tempPassword, emailed: r.emailed }); setNewUser({ name: "", email: "", role: "member", sendEmail: true }); refresh(); }, onError })} disabled={createUser.isPending || !newUser.name.trim() || !newUser.email.trim()} className={`${btnPrimary} px-5`} data-testid="button-create-user">
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-white/60 mt-1 cursor-pointer w-fit">
                  <input type="checkbox" checked={newUser.sendEmail} onChange={(e) => setNewUser({ ...newUser, sendEmail: e.target.checked })} className="accent-[var(--gold-light)]" />
                  Email login details
                </label>
              </div>

              {issued && (
                <div className="bg-[#EAFFC7] border border-[#B4FF44] text-[var(--ink)] rounded-xl p-4 flex items-center gap-4 shadow-sm">
                  <KeyRound className="w-6 h-6 shrink-0 text-[#3D6B00]" />
                  <div className="flex-1 min-w-0 text-xs">
                    <b>{issued.email}</b><br/>Temp password: <code className="bg-[var(--secondary)] rounded px-1.5 py-0.5 mt-1 inline-block text-white font-mono">{issued.tempPassword}</code>
                  </div>
                  <button onClick={() => copy(issued.tempPassword, "Password")} className="p-2 bg-white/70 rounded-lg hover:bg-white transition-colors text-[var(--ink)]" aria-label="Copy">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button onClick={() => setIssued(null)} className="px-3 py-2 text-[#3D6B00] hover:text-[var(--ink)] text-xs font-bold transition-colors">Done</button>
                </div>
              )}

              {users.length === 0 ? (
                <p className="text-white/30 text-sm py-4">No logins yet.</p>
              ) : (
                <div className="space-y-1">
                  {users.map(u => (
                    <div key={u.id} className="flex items-center gap-3 py-3 border-b border-white/5 last:border-0 group" data-testid={`row-user-${u.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-sm text-white truncate transition-opacity ${!u.active && "opacity-40 line-through"}`}>{u.name}</p>
                        <p className="text-white/40 text-xs truncate mt-0.5">{u.email}</p>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2.5 py-1 bg-[var(--muted)] text-[var(--ink2)] border border-[var(--hairline)] shrink-0">{u.role}</span>
                      
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => resetPassword.mutate({ id: u.id, data: { sendEmail: true } }, { onSuccess: (r) => { setIssued({ email: r.user.email, tempPassword: r.tempPassword, emailed: r.emailed }); refresh(); }, onError })} disabled={resetPassword.isPending} className="text-[var(--hairline2)] hover:text-[var(--ink)] transition-colors p-1.5" title="Reset password" data-testid={`button-reset-password-${u.id}`}>
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button onClick={() => updateUser.mutate({ id: u.id, data: { active: !u.active } }, { onSuccess: refresh, onError })} disabled={updateUser.isPending} className="text-[var(--hairline2)] hover:text-[#3D6B00] transition-colors p-1.5" title={u.active ? "Deactivate" : "Activate"} data-testid={`button-toggle-active-${u.id}`}>
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        {confirmDeleteId === u.id ? (
                          <button onClick={() => deleteUser.mutate({ id: u.id }, { onSuccess: () => { setConfirmDeleteId(null); refresh(); }, onError })} className="text-xs bg-[#EF4444] hover:bg-[#DC2626] transition-colors text-white px-3 py-1.5 rounded-lg font-bold ml-1">Confirm</button>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(u.id)} className="text-[var(--hairline2)] hover:text-[#B91C1C] transition-colors p-1.5" aria-label="Delete login">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DarkSection>

        <DarkSection 
          title="Overview & Services" 
          action={
            <button onClick={() => upsert.mutate({ propertyId, data: { servicesOverview: overviewDraft ?? account.servicesOverview ?? "" } }, { onSuccess: () => { setOverviewDraft(null); refresh(); toast({ title: "Overview saved" }); }, onError })} disabled={upsert.isPending || overviewDraft == null} className={btnGhost} data-testid="button-save-overview">
              <Check className="w-4 h-4" /> Save
            </button>
          }
        >
          <textarea
            value={overviewDraft ?? account.servicesOverview ?? ""}
            onChange={(e) => setOverviewDraft(e.target.value)}
            rows={3}
            className={inputCls}
            placeholder="What we do for this property — shows on their dashboard."
            data-testid="input-services-overview"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-3 border-b border-white/5 pb-2">Services on their price list</p>
              {services.length === 0 ? (
                <p className="text-sm text-white/30">None yet — manage it on the property page.</p>
              ) : (
                <ul className="space-y-2 text-sm font-medium">
                  {services.map((s) => (
                    <li key={String(s.id)} className="flex items-center justify-between gap-3 text-[var(--ink)] bg-[#F8FAFC] px-3 py-2 rounded-lg border border-[var(--hairline)]">
                      <span className="truncate">{String(s.service)}</span>
                      <span className="text-[var(--ink2)] font-mono text-xs shrink-0 tabular-nums">${Number(s.rate).toLocaleString()}{s.unit ? `/${String(s.unit)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-3 border-b border-white/5 pb-2">Property contacts</p>
              {contacts.length === 0 ? (
                <p className="text-sm text-white/30">No contacts on file.</p>
              ) : (
                <ul className="space-y-2 text-sm font-medium">
                  {contacts.map((c) => (
                    <li key={String(c.id)} className="truncate text-[var(--ink)] bg-[#F8FAFC] px-3 py-2 rounded-lg border border-[var(--hairline)]">
                      {String(c.name)}
                      {c.role ? <span className="text-[var(--ink2)] font-normal"> · {String(c.role)}</span> : null}
                      {c.email ? <span className="text-[var(--ink2)] font-normal"> · {String(c.email)}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-[var(--ink2)] mt-4 font-medium">Edit info & contacts from the <Link href={`/properties/${property.id}`} className="text-[#3D6B00] font-bold hover:underline">property page</Link>.</p>
            </div>
          </div>
        </DarkSection>

      </div>

      {/* Light-themed components below the island */}
      <AdminUnitMap propertyId={propertyId} />
      <AdminPropertyHub propertyId={propertyId} />
    </div>
  );
}
