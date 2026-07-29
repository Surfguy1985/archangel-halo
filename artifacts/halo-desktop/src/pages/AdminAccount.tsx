import { useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ShieldCheck,
  Users,
  Send,
  KeyRound,
  Copy,
  RefreshCw,
  Upload,
  Trash2,
  Building,
  Check,
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

const TIERS = [
  { value: "basic", label: "Basic" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
];

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-display font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--primary)]";
const btnPrimary =
  "px-5 py-2.5 bg-[var(--gold-light,#B4FF44)] text-black text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50";
const btnGhost =
  "px-4 py-2 text-sm font-bold rounded-xl border border-border hover:bg-muted transition-colors disabled:opacity-50";

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
      <div className="p-8 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
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
    <div className="p-8 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link href="/admin" className="flex items-center gap-2 text-muted-foreground text-sm font-semibold w-fit hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to Admin
      </Link>

      {/* Header */}
      <div className="bg-[var(--ink)] text-white rounded-2xl p-6 flex items-center gap-5">
        {account.logoPath ? (
          <img src={`/api/storage${account.logoPath}`} alt="" className="w-16 h-16 rounded-2xl object-cover bg-white/10" />
        ) : (
          <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center">
            <Building className="w-8 h-8 text-white/50" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-display font-bold truncate">{property.name}</h1>
          <p className="text-white/60 text-sm font-medium truncate">
            {[property.pmcName, property.address, property.city].filter(Boolean).join(" · ") || "—"}
            {property.units ? ` · ${property.units} units` : ""}
          </p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2.5 bg-white/10 text-white text-sm font-bold rounded-xl hover:bg-white/20 transition-colors flex items-center gap-2 disabled:opacity-50"
          data-testid="button-upload-logo"
        >
          <Upload className="w-4 h-4" /> {uploading ? "Uploading…" : account.logoPath ? "Replace logo" : "Upload logo"}
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
        <Link href={`/properties/${property.id}`} className="px-4 py-2.5 text-white/70 hover:text-white text-sm font-bold rounded-xl transition-colors">
          Open property
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Subscription */}
        <Section
          title="Subscription"
          action={
            <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1 ${account.status === "active" ? "bg-[var(--primary)]/15 text-[var(--gold,#4a7000)]" : "bg-muted text-muted-foreground"}`}>
              {account.status}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground col-span-2">Tier</label>
            <div className="col-span-2 flex gap-2">
              {TIERS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setSub({ ...subState, tier: t.value })}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border transition-colors ${subState.tier === t.value ? "bg-[var(--ink)] text-white border-transparent" : "border-border hover:bg-muted"}`}
                  data-testid={`button-tier-${t.value}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">User seats</label>
              <input inputMode="numeric" value={subState.userSeats} onChange={(e) => setSub({ ...subState, userSeats: e.target.value })} className={inputCls} data-testid="input-user-seats" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Guest seats</label>
              <input inputMode="numeric" value={subState.guestSeats} onChange={(e) => setSub({ ...subState, guestSeats: e.target.value })} className={inputCls} data-testid="input-guest-seats" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</label>
              <div className="flex gap-2 mt-1">
                {["active", "paused", "cancelled"].map((s) => (
                  <button key={s} onClick={() => setSub({ ...subState, status: s })} className={`px-4 py-2 rounded-xl text-sm font-bold border capitalize transition-colors ${subState.status === s ? "bg-[var(--ink)] text-white border-transparent" : "border-border hover:bg-muted"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Notes</label>
              <textarea value={subState.notes} onChange={(e) => setSub({ ...subState, notes: e.target.value })} rows={2} className={inputCls} placeholder="Billing arrangements, renewal dates…" />
            </div>
          </div>
          <button onClick={saveSubscription} disabled={upsert.isPending || !sub} className={btnPrimary} data-testid="button-save-subscription">
            {upsert.isPending ? "Saving…" : "Save subscription"}
          </button>
        </Section>

        {/* Onboarding */}
        <Section title="Onboarding">
          <div className="bg-muted rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Their dashboard link</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-background rounded-lg px-3 py-2 truncate">{account.dashboardUrl}</code>
              <button onClick={() => copy(account.dashboardUrl ?? "", "Link")} className={btnGhost} aria-label="Copy link" data-testid="button-copy-dashboard-link">
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={() =>
                  regenToken.mutate({ propertyId }, { onSuccess: () => { refresh(); toast({ title: "New link generated", description: "The old link no longer works." }); }, onError })
                }
                disabled={regenToken.isPending}
                className={btnGhost}
                aria-label="Regenerate link"
                data-testid="button-regenerate-token"
              >
                <RefreshCw className={`w-4 h-4 ${regenToken.isPending ? "animate-spin" : ""}`} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">The client dashboard app goes live in the next build — the link is stable and safe to send now.</p>
          </div>
          <div className="space-y-2">
            <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} className={inputCls} placeholder="client@property.com" data-testid="input-onboarding-to" />
            <textarea value={sendNote} onChange={(e) => setSendNote(e.target.value)} rows={2} className={inputCls} placeholder="Personal note (optional)" />
            <button
              onClick={() =>
                sendOnboarding.mutate(
                  { propertyId, data: { channel: "email", to: sendTo, message: sendNote || null } },
                  {
                    onSuccess: () => { setSendTo(""); setSendNote(""); refresh(); toast({ title: "Onboarding email sent" }); },
                    onError: (err) => { refresh(); onError(err); },
                  },
                )
              }
              disabled={sendOnboarding.isPending || !sendTo.trim()}
              className={`${btnPrimary} w-full flex items-center justify-center gap-2`}
              data-testid="button-send-onboarding"
            >
              <Send className="w-4 h-4" /> {sendOnboarding.isPending ? "Sending…" : "Send onboarding email"}
            </button>
          </div>
          {sends.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sent history</p>
              {sends.slice(0, 5).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-sm font-medium">
                  <span className={`w-2 h-2 rounded-full ${s.status === "sent" ? "bg-[var(--gold-light,#B4FF44)]" : "bg-rose-500"}`} />
                  <span className="truncate">{s.sentTo}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">{new Date(s.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Logins */}
      <Section
        title="Logins"
        action={
          <span className="text-sm font-bold text-muted-foreground flex items-center gap-1.5">
            <Users className="w-4 h-4" />
            {users.filter((u) => u.active && u.role !== "guest").length}/{account.userSeats} seats · {users.filter((u) => u.active && u.role === "guest").length}/{account.guestSeats} guests
          </span>
        }
      >
        {issued && (
          <div className="bg-[var(--ink)] text-white rounded-xl p-4 flex items-center gap-3">
            <KeyRound className="w-5 h-5 text-[var(--gold-light,#B4FF44)] shrink-0" />
            <div className="flex-1 min-w-0 text-sm">
              <b>{issued.email}</b> — temp password <code className="bg-white/10 rounded px-2 py-0.5">{issued.tempPassword}</code>
              {issued.emailed ? " (emailed to them)" : " — copy it now, it won't be shown again"}
            </div>
            <button onClick={() => copy(issued.tempPassword, "Password")} className="px-3 py-1.5 bg-white/10 rounded-lg text-sm font-bold hover:bg-white/20">
              <Copy className="w-4 h-4" />
            </button>
            <button onClick={() => setIssued(null)} className="px-3 py-1.5 text-white/60 hover:text-white text-sm font-bold">Done</button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className={inputCls} placeholder="Name" data-testid="input-new-user-name" />
          <input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className={inputCls} placeholder="Email" data-testid="input-new-user-email" />
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className={inputCls}>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="guest">Guest</option>
          </select>
          <button
            onClick={() =>
              createUser.mutate(
                { propertyId, data: { name: newUser.name, email: newUser.email, role: newUser.role, sendEmail: newUser.sendEmail } },
                {
                  onSuccess: (r) => {
                    setIssued({ email: r.user.email, tempPassword: r.tempPassword, emailed: r.emailed });
                    setNewUser({ name: "", email: "", role: "member", sendEmail: true });
                    refresh();
                  },
                  onError,
                },
              )
            }
            disabled={createUser.isPending || !newUser.name.trim() || !newUser.email.trim()}
            className={btnPrimary}
            data-testid="button-create-user"
          >
            {createUser.isPending ? "Creating…" : "Create login"}
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <input type="checkbox" checked={newUser.sendEmail} onChange={(e) => setNewUser({ ...newUser, sendEmail: e.target.checked })} className="accent-[var(--gold-light,#B4FF44)]" />
          Email the login details to them
        </label>

        {users.length === 0 ? (
          <p className="text-muted-foreground text-sm font-medium">No logins yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-3" data-testid={`row-user-${u.id}`}>
                <div className="flex-1 min-w-0">
                  <p className={`font-bold text-sm truncate ${u.active ? "" : "line-through text-muted-foreground"}`}>{u.name}</p>
                  <p className="text-muted-foreground text-xs truncate">{u.email}</p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2.5 py-1 bg-muted text-muted-foreground capitalize">{u.role}</span>
                <button
                  onClick={() =>
                    resetPassword.mutate(
                      { id: u.id, data: { sendEmail: true } },
                      { onSuccess: (r) => { setIssued({ email: r.user.email, tempPassword: r.tempPassword, emailed: r.emailed }); refresh(); }, onError },
                    )
                  }
                  disabled={resetPassword.isPending}
                  className={btnGhost}
                  data-testid={`button-reset-password-${u.id}`}
                >
                  <KeyRound className="w-4 h-4" />
                </button>
                <button
                  onClick={() => updateUser.mutate({ id: u.id, data: { active: !u.active } }, { onSuccess: refresh, onError })}
                  disabled={updateUser.isPending}
                  className={`${btnGhost} ${u.active ? "" : "text-[var(--gold,#4a7000)]"}`}
                  data-testid={`button-toggle-active-${u.id}`}
                >
                  {u.active ? "Deactivate" : "Activate"}
                </button>
                {confirmDeleteId === u.id ? (
                  <button
                    onClick={() => deleteUser.mutate({ id: u.id }, { onSuccess: () => { setConfirmDeleteId(null); refresh(); }, onError })}
                    className="px-3 py-2 bg-rose-600 text-white rounded-xl text-sm font-bold"
                  >
                    Confirm
                  </button>
                ) : (
                  <button onClick={() => setConfirmDeleteId(u.id)} className={`${btnGhost} text-rose-600`} aria-label="Delete login">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Overview & services */}
      <Section
        title="Property overview & services"
        action={
          <button
            onClick={() =>
              upsert.mutate(
                { propertyId, data: { servicesOverview: overviewDraft ?? account.servicesOverview ?? "" } },
                { onSuccess: () => { setOverviewDraft(null); refresh(); toast({ title: "Overview saved" }); }, onError },
              )
            }
            disabled={upsert.isPending || overviewDraft == null}
            className={btnGhost}
            data-testid="button-save-overview"
          >
            <Check className="w-4 h-4" />
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Services on their price list</p>
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground font-medium">None yet — manage it on the property page.</p>
            ) : (
              <ul className="space-y-1.5 text-sm font-medium">
                {services.map((s) => (
                  <li key={String(s.id)} className="flex justify-between gap-3">
                    <span className="truncate">{String(s.service)}</span>
                    <span className="text-muted-foreground tabular-nums shrink-0">${Number(s.rate).toLocaleString()}{s.unit ? `/${String(s.unit)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Property contacts</p>
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground font-medium">No contacts on file.</p>
            ) : (
              <ul className="space-y-1.5 text-sm font-medium">
                {contacts.map((c) => (
                  <li key={String(c.id)} className="truncate">
                    {String(c.name)}
                    {c.role ? <span className="text-muted-foreground"> · {String(c.role)}</span> : null}
                    {c.email ? <span className="text-muted-foreground"> · {String(c.email)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground mt-2">Edit info & contacts from the <Link href={`/properties/${property.id}`} className="underline">property page</Link>.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
