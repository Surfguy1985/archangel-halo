import { useParams, useLocation } from 'wouter';
import {
  useGetClientAccess,
  getGetClientAccessQueryKey,
  useSetupClientAccess,
  useCreateClientAccessUser,
  useDeleteClientAccessUser,
  useUpdateClientAccessUser,
  useGetClientBoard,
  getGetClientBoardQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useSessionExchange } from '@/hooks/useSessionExchange';
import { LoginDialog } from '@/components/LoginDialog';
import {
  ArrowLeft, Loader2, UserPlus, ShieldCheck, KeyRound, Trash2, Users,
  Copy, Sparkles, Lock,
} from 'lucide-react';
import { useState } from 'react';

// Team management — client admins run their own board: invite logins with
// email + password, delegate roles, and watch seat usage against their plan.

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', member: 'Member', guest: 'Guest' };
const ROLE_DESC: Record<string, string> = {
  admin: 'Full access — manages the team and billing',
  member: 'Works the board — no team admin',
  guest: 'View-only seat',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-[#6e6e73]">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full h-10 rounded-[10px] border border-black/10 bg-white px-3 text-[14px] text-[#1d1d1f] outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20';

export default function TeamPage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useSessionExchange(token);

  const { data: access, isLoading, error } = useGetClientAccess(token, {
    query: { queryKey: getGetClientAccessQueryKey(token) },
  });
  const { data: board } = useGetClientBoard(token, {
    query: { queryKey: getGetClientBoardQueryKey(token) },
  });
  const viewer = board?.viewer;

  const setup = useSetupClientAccess();
  const invite = useCreateClientAccessUser();
  const removeUser = useDeleteClientAccessUser();
  const updateUser = useUpdateClientAccessUser();

  const [loginOpen, setLoginOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'member', password: '', sendEmail: true });
  const [revealed, setRevealed] = useState<{ email: string; password: string } | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetClientAccessQueryKey(token) });
    queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
  };
  const apiError = (err: any, fallback: string) =>
    toast({ title: fallback, description: err?.data?.error ?? 'Please try again.', variant: 'destructive' });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fafafa]">
        <Loader2 className="h-6 w-6 animate-spin text-[#8E8E93]" />
      </div>
    );
  }
  // The roster is admin-only once the board is claimed — a 403 here means
  // "sign in as an admin", not a bad link.
  const needsAdminSignIn = (error as any)?.status === 403;
  if ((error && !needsAdminSignIn) || (!access && !needsAdminSignIn)) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fafafa] text-[14px] text-[#6e6e73]">
        This link isn't valid.
      </div>
    );
  }

  const users = access?.users ?? [];
  const seats = access?.seats ?? { tier: '', userSeats: 0, guestSeats: 0, usedSeats: 0, usedGuestSeats: 0 };
  const isSetupMode = !needsAdminSignIn && users.length === 0;
  const isAdmin = !needsAdminSignIn && viewer?.authenticated && viewer?.role === 'admin' && !!access;
  const seatsFull = seats.usedSeats >= seats.userSeats;
  const guestsFull = seats.usedGuestSeats >= seats.guestSeats;

  // ---- First-time setup: claim the board ----------------------------------
  if (isSetupMode) {
    return (
      <div className="min-h-screen bg-[#fafafa] px-4 py-10">
        <div className="mx-auto max-w-md">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#B4FF44]">
              <Sparkles className="h-6 w-6 text-black" />
            </div>
            <h1 className="text-[22px] font-bold text-[#1d1d1f]">Set up your board</h1>
            <p className="mt-1 text-[13px] text-[#6e6e73]">
              Create the first admin login for {access?.propertyName ?? 'your property'}. You'll use it to sign in,
              invite your team, and assign roles.
            </p>
          </div>
          <form
            className="space-y-3 rounded-[16px] border border-black/[0.06] bg-white p-5 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              setup.mutate(
                { token, data: { name: form.name, email: form.email, password: form.password } },
                {
                  onSuccess: () => {
                    invalidate();
                    toast({ title: 'Board claimed', description: 'Now sign in with your new admin login.' });
                    setLoginOpen(true);
                  },
                  onError: (err: any) => apiError(err, 'Could not set up the board'),
                },
              );
            }}
          >
            <Field label="Your name">
              <input data-testid="input-setup-name" required className={inputCls} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input data-testid="input-setup-email" required type="email" className={inputCls} value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Password (8+ characters)">
              <input data-testid="input-setup-password" required type="password" minLength={8} className={inputCls}
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <button
              data-testid="button-setup-submit"
              type="submit"
              disabled={setup.isPending}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-[#B4FF44] text-[14px] font-bold text-black hover:brightness-95 transition disabled:opacity-50"
            >
              {setup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Create admin login
            </button>
          </form>
        </div>
        <LoginDialog open={loginOpen} onOpenChange={(o) => { setLoginOpen(o); if (!o) setLocation(`/${token}`); }} token={token} />
      </div>
    );
  }

  // ---- Not a signed-in admin ----------------------------------------------
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#fafafa] px-4 py-10">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f5f7]">
            <Lock className="h-6 w-6 text-[#6e6e73]" />
          </div>
          <h1 className="text-[20px] font-bold text-[#1d1d1f]">Admins only</h1>
          <p className="mt-1 text-[13px] text-[#6e6e73]">
            Team management is for board admins. Sign in with an admin login to manage users and seats.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button data-testid="button-team-signin" onClick={() => setLoginOpen(true)}
              className="h-10 rounded-[10px] bg-[#1d1d1f] px-4 text-[13px] font-semibold text-white">Sign in</button>
            <button onClick={() => setLocation(`/${token}`)}
              className="h-10 rounded-[10px] bg-[#f5f5f7] px-4 text-[13px] font-semibold text-[#1d1d1f]">Back to board</button>
          </div>
        </div>
        <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} token={token} onSuccess={invalidate} />
      </div>
    );
  }

  // ---- Admin team management ----------------------------------------------
  const roleFull = (role: string) => (role === 'guest' ? guestsFull : seatsFull);

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="sticky top-0 z-10 flex h-[56px] items-center gap-3 border-b border-black/[0.06] bg-white px-4">
        <button data-testid="button-team-back" onClick={() => setLocation(`/${token}`)}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#f5f5f7] text-[#1d1d1f]">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[#007AFF]" />
          <h1 className="text-[15px] font-bold text-[#1d1d1f]">Team & seats</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-5">
        {/* Seat usage */}
        <div className="mb-5 rounded-[14px] border border-black/[0.06] bg-white p-4" data-testid="seat-usage">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-bold text-[#1d1d1f] capitalize">{seats.tier} plan</p>
              <p className="text-[12px] font-medium text-[#6e6e73]">
                {seats.usedSeats} of {seats.userSeats} seats · {seats.usedGuestSeats} of {seats.guestSeats} guest seats
              </p>
            </div>
            {(seatsFull || guestsFull) && (
              <a
                data-testid="link-upgrade-plan"
                href={`/client/${token}/admin`}
                className="h-9 rounded-[10px] bg-[#B4FF44] px-3.5 text-[13px] font-bold text-black leading-9"
              >
                Upgrade for more seats
              </a>
            )}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#f5f5f7]">
            <div className="h-full rounded-full bg-[#007AFF]" style={{ width: `${Math.min(100, (seats.usedSeats / Math.max(1, seats.userSeats)) * 100)}%` }} />
          </div>
        </div>

        {/* One-time reveal of a generated password */}
        {revealed && (
          <div className="mb-5 rounded-[14px] border border-[#34C759]/30 bg-[#34C759]/5 p-4" data-testid="temp-password-reveal">
            <p className="text-[13px] font-semibold text-[#1d1d1f]">
              Temporary password for {revealed.email} — shown once:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded-[8px] bg-white px-3 py-1.5 text-[14px] font-bold tracking-wide border border-black/10">{revealed.password}</code>
              <button
                className="flex h-8 items-center gap-1 rounded-[8px] bg-[#1d1d1f] px-2.5 text-[12px] font-semibold text-white"
                onClick={() => { navigator.clipboard?.writeText(revealed.password); toast({ title: 'Copied' }); }}
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
              <button className="text-[12px] font-semibold text-[#6e6e73]" onClick={() => setRevealed(null)}>Dismiss</button>
            </div>
          </div>
        )}

        {/* Invite form */}
        <form
          className="mb-6 rounded-[14px] border border-black/[0.06] bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate(
              {
                token,
                data: {
                  name: form.name,
                  email: form.email,
                  role: form.role,
                  password: form.password.trim() || null,
                  sendEmail: form.sendEmail,
                },
              },
              {
                onSuccess: (r) => {
                  invalidate();
                  if (r.tempPassword) setRevealed({ email: r.user.email, password: r.tempPassword });
                  toast({
                    title: `${r.user.name} added`,
                    description: r.emailed ? 'Login details emailed to them.' : undefined,
                  });
                  setForm({ name: '', email: '', role: 'member', password: '', sendEmail: true });
                },
                onError: (err: any) => apiError(err, 'Could not add the user'),
              },
            );
          }}
        >
          <div className="mb-3 flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-[#007AFF]" />
            <h2 className="text-[14px] font-bold text-[#1d1d1f]">Add a team member</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input data-testid="input-invite-name" required className={inputCls} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input data-testid="input-invite-email" required type="email" className={inputCls} value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Role">
              <select data-testid="select-invite-role" className={inputCls} value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {['admin', 'member', 'guest'].map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]} — {ROLE_DESC[r]}</option>
                ))}
              </select>
            </Field>
            <Field label="Password (optional — auto-generated if blank)">
              <input data-testid="input-invite-password" type="text" minLength={8} placeholder="Leave blank to auto-generate"
                className={inputCls} value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px] font-medium text-[#1d1d1f]">
            <input type="checkbox" checked={form.sendEmail}
              onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })} />
            Email them their login details
          </label>
          {roleFull(form.role) && (
            <p className="mt-2 text-[12px] font-semibold text-[#FF3B30]">
              {form.role === 'guest' ? 'Guest seats are full' : 'Seats are full'} — upgrade your plan to add more.
            </p>
          )}
          <button
            data-testid="button-invite-submit"
            type="submit"
            disabled={invite.isPending}
            className="mt-3 flex h-10 items-center gap-2 rounded-[10px] bg-[#1d1d1f] px-4 text-[13px] font-bold text-white disabled:opacity-50"
          >
            {invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Add member
          </button>
        </form>

        {/* User list */}
        <div className="overflow-hidden rounded-[14px] border border-black/[0.06] bg-white divide-y divide-black/[0.05]">
          {users.map((u) => (
            <div key={u.id} className="p-4" data-testid={`team-user-${u.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[#1d1d1f]">
                    {u.name}
                    {viewer?.email === u.email && <span className="ml-1.5 text-[11px] font-bold text-[#007AFF]">You</span>}
                    {!u.active && <span className="ml-1.5 rounded-full bg-[#8E8E93]/10 px-1.5 py-px text-[10px] font-bold text-[#6e6e73]">Deactivated</span>}
                  </p>
                  <p className="truncate text-[12px] font-medium text-[#6e6e73]">{u.email}</p>
                </div>
                <select
                  data-testid={`select-role-${u.id}`}
                  className="h-8 rounded-[8px] border border-black/10 bg-[#f5f5f7] px-2 text-[12px] font-semibold"
                  value={u.role}
                  onChange={(e) =>
                    updateUser.mutate(
                      { token, userId: u.id, data: { role: e.target.value } },
                      { onSuccess: invalidate, onError: (err: any) => apiError(err, 'Could not change the role') },
                    )
                  }
                >
                  {['admin', 'member', 'guest'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  data-testid={`button-toggle-active-${u.id}`}
                  className="h-8 rounded-[8px] bg-[#f5f5f7] px-2.5 text-[12px] font-semibold text-[#1d1d1f]"
                  onClick={() =>
                    updateUser.mutate(
                      { token, userId: u.id, data: { active: !u.active } },
                      { onSuccess: invalidate, onError: (err: any) => apiError(err, 'Could not update the login') },
                    )
                  }
                >
                  {u.active ? 'Deactivate' : 'Reactivate'}
                </button>
                <button
                  data-testid={`button-reset-password-${u.id}`}
                  className="flex h-8 items-center gap-1 rounded-[8px] bg-[#f5f5f7] px-2.5 text-[12px] font-semibold text-[#1d1d1f]"
                  onClick={() => {
                    const pw = window.prompt(`New password for ${u.name} (8+ characters):`);
                    if (!pw) return;
                    updateUser.mutate(
                      { token, userId: u.id, data: { newPassword: pw } },
                      {
                        onSuccess: () => toast({ title: 'Password updated' }),
                        onError: (err: any) => apiError(err, 'Could not reset the password'),
                      },
                    );
                  }}
                >
                  <KeyRound className="h-3 w-3" /> Reset password
                </button>
                {viewer?.email !== u.email && (
                  <button
                    data-testid={`button-delete-user-${u.id}`}
                    className="flex h-8 items-center gap-1 rounded-[8px] bg-[#FF3B30]/10 px-2.5 text-[12px] font-semibold text-[#FF3B30]"
                    onClick={() => {
                      if (!window.confirm(`Remove ${u.name}'s login? This can't be undone.`)) return;
                      removeUser.mutate(
                        { token, userId: u.id },
                        { onSuccess: invalidate, onError: (err: any) => apiError(err, 'Could not remove the login') },
                      );
                    }}
                  >
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
