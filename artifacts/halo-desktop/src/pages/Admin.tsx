import { Link } from "wouter";
import { ShieldCheck, Users, Send, Building } from "lucide-react";
import { useListClientAccounts } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";

const TIER_LABEL: Record<string, string> = {
  basic: "Basic",
  pro: "Pro",
  enterprise: "Enterprise",
};

export default function Admin() {
  const { data: accounts, isLoading } = useListClientAccounts();

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-[var(--ink)] text-[var(--primary)] flex items-center justify-center">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold">Admin</h1>
          <p className="text-muted-foreground text-sm font-medium">
            Subscription back office — every active property as a managed account
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : !accounts || accounts.length === 0 ? (
        <div className="bg-card rounded-2xl p-10 text-center text-muted-foreground font-medium">
          No active properties yet — add a property first, then manage its
          subscription here.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accounts.map((a) => (
            <Link
              key={a.propertyId}
              href={`/admin/${a.propertyId}`}
              className="block bg-[var(--ink)] text-white rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
              data-testid={`card-account-${a.propertyId}`}
            >
              <div className="flex items-start gap-4">
                {a.logoPath ? (
                  <img
                    src={`/api/storage${a.logoPath}`}
                    alt=""
                    className="w-12 h-12 rounded-xl object-cover bg-white/10"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
                    <Building className="w-6 h-6 text-white/50" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-display font-bold truncate">
                    {a.propertyName}
                  </h3>
                  <p className="text-white/60 text-sm font-medium truncate">
                    {[a.pmcName, a.city].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1 ${
                    a.status === "active"
                      ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                      : "bg-white/10 text-white/60"
                  }`}
                >
                  {TIER_LABEL[a.tier] ?? a.tier}
                  {a.status !== "active" ? ` · ${a.status}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-5 mt-5 text-sm text-white/70 font-medium">
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  {a.userSeatsUsed}/{a.userSeats} seats
                </span>
                <span>{a.guestSeats} guest</span>
                <span
                  className={`ml-auto flex items-center gap-1.5 ${
                    a.onboardingStatus === "sent"
                      ? "text-[var(--primary)]"
                      : "text-white/50"
                  }`}
                >
                  <Send className="w-4 h-4" />
                  {a.onboardingStatus === "sent" ? "Onboarded" : "Not onboarded"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
