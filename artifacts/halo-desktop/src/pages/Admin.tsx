import { Link, useLocation } from "wouter";
import { ShieldCheck, Users, Send, Building, LayoutGrid } from "lucide-react";
import { useListClientAccounts } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";

const TIER_LABEL: Record<string, string> = {
  basic: "Basic",
  pro: "Pro",
  enterprise: "Enterprise",
};

export default function Admin() {
  const { data: accounts, isLoading } = useListClientAccounts();
  const [, navigate] = useLocation();

  return (
    <div className="theme-light p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="cl-panel rounded-[24px] p-6 lg:p-8 flex flex-col min-h-[60vh]">
        <header className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-xl bg-[var(--gold-light)] text-[var(--ink)] flex items-center justify-center shrink-0 shadow-sm">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-[var(--ink)] tracking-tight">Accounts</h1>
            <p className="text-[var(--ink2)] text-sm mt-0.5">Subscription back office — every active property as a managed account</p>
          </div>
        </header>

        {isLoading ? (
          <div className="space-y-4 flex-1">
             <Skeleton className="h-16 w-full rounded-xl bg-[var(--muted)]" />
             <Skeleton className="h-16 w-full rounded-xl bg-[var(--muted)]" />
             <Skeleton className="h-16 w-full rounded-xl bg-[var(--muted)]" />
          </div>
        ) : !accounts || accounts.length === 0 ? (
          <div className="py-20 text-center text-[var(--ink2)] text-sm flex-1">
            No active properties yet — add a property first, then manage its subscription here.
          </div>
        ) : (
          <div className="flex flex-col flex-1">
            <div className="grid grid-cols-[56px_1fr_1fr_100px_120px_130px] gap-4 pb-3 border-b border-[var(--hairline)] text-[var(--ink2)] text-xs font-bold uppercase tracking-wider px-4">
               <div></div>
               <div>Property</div>
               <div>Location</div>
               <div>Status</div>
               <div className="text-right">Seats</div>
               <div className="text-right">Board</div>
            </div>
            <div className="flex flex-col mt-2">
              {accounts.map((a, i) => (
                <Link
                  key={a.propertyId}
                  href={`/admin/${a.propertyId}`}
                  className={`group grid grid-cols-[56px_1fr_1fr_100px_120px_130px] gap-4 items-center py-3 border-b border-[var(--hairline)] transition-colors px-4 rounded-xl ${i % 2 === 1 ? "bg-[#F8FAFC]" : ""} hover:bg-[#EEF2F7]`}
                  data-testid={`card-account-${a.propertyId}`}
                >
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-[var(--muted)] border border-[var(--hairline)] relative flex items-center justify-center shrink-0">
                    {a.logoPath ? (
                      <img src={`/api/storage${a.logoPath}`} alt="" className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    ) : (
                      <Building className="w-5 h-5 text-[var(--hairline2)]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-[var(--ink)] truncate text-sm group-hover:text-[var(--secondary)] transition-colors">{a.propertyName}</div>
                    <div className="text-[10px] text-[var(--ink2)] mt-1 font-semibold uppercase tracking-wide">{TIER_LABEL[a.tier] ?? a.tier}</div>
                  </div>
                  <div className="text-[var(--ink2)] text-sm truncate">
                    {[a.pmcName, a.city].filter(Boolean).join(" · ") || "—"}
                  </div>
                  <div>
                    <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      a.status === 'active' ? 'bg-[#EAFFC7] text-[#3D6B00] border border-[#B4FF44]' : 'bg-[var(--muted)] text-[var(--ink2)] border border-[var(--hairline)]'
                    }`}>
                      {a.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-4 text-[var(--ink2)] text-xs">
                    <span className="flex items-center gap-1.5 tabular-nums" title="User seats">
                      <Users className="w-3.5 h-3.5" /> {a.userSeatsUsed}/{a.userSeats}
                    </span>
                    <span className={`flex items-center ${a.onboardingStatus === 'sent' ? 'text-[#3D6B00]' : 'text-[var(--hairline2)]'}`} title={a.onboardingStatus === 'sent' ? 'Onboarded' : 'Not onboarded'}>
                      <Send className="w-3.5 h-3.5" />
                    </span>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      title="Open this client's board"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/admin/${a.propertyId}/board`);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-[var(--secondary)] text-white text-xs font-bold hover:bg-[var(--ink)] transition-colors shadow-sm"
                      data-testid={`link-account-board-${a.propertyId}`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" /> View board
                    </button>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
