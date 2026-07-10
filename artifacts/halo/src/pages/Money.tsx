import { useGetMoneySummary } from "@workspace/api-client-react";

export default function Money() {
  const { data: money, isLoading } = useGetMoneySummary();

  if (isLoading || !money) {
    return (
      <div className="animate-pulse space-y-4 pt-4">
        <div className="h-4 bg-muted rounded w-1/3"></div>
        <div className="h-48 bg-card rounded-[16px]"></div>
      </div>
    );
  }

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="text-[13px] text-muted-foreground mb-[14px]">Cash radar. Computed live, never typed.</div>
      
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[18px_16px] mb-[10px]">
        <div className="font-display font-bold text-[38px] tracking-[-0.02em] tabular-nums leading-none">
          ${money.landing.toLocaleString()}
        </div>
        <div className="text-[12.5px] text-muted-foreground mt-[5px]">Landing this week</div>
        
        <div className="mt-[20px] pt-[16px] border-t border-border flex gap-[20px]">
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.1em]">At Risk</div>
            <div className="font-display font-bold text-[18px] text-destructive tabular-nums mt-[2px]">${money.atRisk.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.1em]">MTD Rev</div>
            <div className="font-display font-bold text-[18px] tabular-nums mt-[2px]">${money.mtd.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.1em]">Margin</div>
            <div className="font-display font-bold text-[18px] tabular-nums mt-[2px]">{money.marginPct}%</div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[16px] mb-[10px]">
        <div className="font-display font-semibold text-[13px] tracking-[0.15em] uppercase text-muted-foreground mb-[12px]">Aging Accounts</div>
        <div className="flex gap-[5px]">
          {money.aging.map((b, i) => (
            <div key={i} className="flex-1 text-center">
              <div className="h-[8px] rounded-[4px] mb-[5px]" style={{ backgroundColor: b.color || 'var(--muted)' }} />
              <span className="text-[10.5px] text-muted-foreground">{b.label}</span>
              <b className="block text-[12.5px] font-display tabular-nums mt-[2px]">${b.value.toLocaleString()}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
