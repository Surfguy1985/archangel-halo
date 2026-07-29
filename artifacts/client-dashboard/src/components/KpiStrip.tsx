import { AlertCircle, CheckCircle, Clock, DollarSign, Calendar, Map as MapIcon } from 'lucide-react';
import {
  useGetClientBoardKpis,
  getGetClientBoardKpisQueryKey,
} from '@workspace/api-client-react';

interface KpiStripProps {
  token: string;
  onOpenBirdseye?: () => void;
}

export function KpiStrip({ token, onOpenBirdseye }: KpiStripProps) {
  const { data: kpis, isLoading } = useGetClientBoardKpis(token, {
    query: {
      queryKey: getGetClientBoardKpisQueryKey(token),
      refetchInterval: 4000,
    },
  });

  if (isLoading || !kpis) {
    return (
      <div className="bg-card border-b border-card-border px-6 py-4">
        <div className="flex gap-6 animate-pulse">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex-1">
              <div className="h-3 bg-muted rounded w-20 mb-2" />
              <div className="h-6 bg-muted rounded w-12" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    {
      label: 'Units',
      value: kpis.unitsTotal || 0,
      detail: `${kpis.unitsOk || 0} OK / ${kpis.unitsAttention || 0} attention / ${
        kpis.unitsUrgent || 0
      } urgent`,
      icon: CheckCircle,
      color: 'text-foreground',
    },
    {
      label: 'Open Jobs',
      value: kpis.openJobs || 0,
      detail: kpis.scheduledJobs ? `${kpis.scheduledJobs} scheduled` : undefined,
      icon: Clock,
      color: 'text-foreground',
    },
    {
      label: 'Pending Requests',
      value: kpis.pendingRequests || 0,
      icon: AlertCircle,
      color: kpis.pendingRequests > 0 ? 'text-gold' : 'text-muted-foreground',
    },
    {
      label: 'Outstanding',
      value: `$${(kpis.invoicesOutstanding || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      detail:
        kpis.invoicesOverdue > 0
          ? `$${(kpis.invoicesOverdue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} overdue`
          : undefined,
      icon: DollarSign,
      color: kpis.invoicesOverdue > 0 ? 'text-destructive' : 'text-foreground',
    },
    {
      label: 'Paid (30d)',
      value: `$${(kpis.paidLast30 || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: DollarSign,
      color: 'text-muted-foreground',
    },
  ];

  if (kpis.nextVisit) {
    stats.push({
      label: 'Next Visit',
      value: kpis.nextVisit,
      icon: Calendar,
      color: 'text-foreground',
    });
  }

  return (
    <div className="bg-card border-b border-card-border px-6 py-4" data-testid="kpi-strip">
      <div className="flex gap-6 overflow-x-auto">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <div
              key={idx}
              className="flex items-start gap-3 min-w-[140px]"
              data-testid={`kpi-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${stat.color}`} />
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                  {stat.label}
                </div>
                <div className="text-xl font-bold text-foreground tabular-nums">
                  {stat.value}
                </div>
                {stat.detail && (
                  <div className="text-xs text-muted-foreground mt-0.5">{stat.detail}</div>
                )}
              </div>
            </div>
          );
        })}
        {onOpenBirdseye && (
          <div className="ml-auto pl-6 border-l border-border flex items-center">
            <button
              onClick={onOpenBirdseye}
              className="flex items-center gap-2 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors uppercase tracking-wider"
            >
              <MapIcon className="w-5 h-5" />
              Live Birdseye
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
