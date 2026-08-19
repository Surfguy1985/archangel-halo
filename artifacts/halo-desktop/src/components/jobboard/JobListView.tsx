/**
 * List view — one line per job, grouped. Denser than the board, calmer than the
 * table: the scan view for "what's actually on my plate today".
 */

import type { BoardField } from "@workspace/api-client-react";
import type { CardGroup, JobRailKey } from "@/lib/boardWorkspace";
import { RAIL_LABELS, customValue, railOf } from "@/lib/boardWorkspace";
import { CustomFieldPill } from "./CustomFieldCell";
import { EmptyResult } from "./JobTableView";
import { AlertTriangle, ChevronRight, User } from "lucide-react";

const RAIL_DOT: Record<JobRailKey, string> = {
  requested: "bg-[var(--gold-light)]",
  in_progress: "bg-sky-400",
  done: "bg-emerald-400",
  billing: "bg-stone-300",
  alert: "bg-[#DC2626]",
};

function money(n: number | null | undefined): string | null {
  if (n == null) return null;
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function JobListView({
  groups,
  fields,
  onOpen,
  showGroupHeaders,
}: {
  groups: CardGroup[];
  fields: BoardField[];
  onOpen: (jobId: string) => void;
  showGroupHeaders: boolean;
}) {
  const onCard = fields.filter((f) => f.showOnCard);
  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  if (total === 0) return <EmptyResult />;

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key} data-testid={`list-group-${g.key}`}>
          {showGroupHeaders && (
            <div className="mb-2 flex items-center gap-2 px-1">
              <h2 className="font-display text-sm font-bold tracking-tight text-[var(--ink)]">
                {g.label}
              </h2>
              <span className="font-mono text-xs text-muted-foreground">{g.cards.length}</span>
            </div>
          )}
          <div className="overflow-hidden rounded-2xl border border-[var(--hairline)] bg-white">
            {g.cards.map((card) => {
              const rail = railOf(card);
              const amount = money(card.invoice?.total ?? card.job.lineTotal ?? null);
              return (
                <button
                  key={card.job.id}
                  type="button"
                  onClick={() => onOpen(card.job.id)}
                  className="flex w-full items-center gap-3 border-b border-[var(--hairline)]/60 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--gold-light)]/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9DB40F]"
                  data-testid={`list-row-${card.job.id}`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${RAIL_DOT[rail]}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-bold text-[var(--ink)]">
                        {card.job.propertyName || "Unknown property"}
                      </span>
                      {card.job.unitNo && (
                        <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                          Unit {card.job.unitNo}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {card.job.jobNo}
                      </span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="truncate">
                        {(card.job.services ?? []).join(", ") || card.job.category || "Work"}
                      </span>
                      {card.job.crewLeaderName ? (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {card.job.crewLeaderName}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-700">
                          <AlertTriangle className="h-3 w-3" /> No crew
                        </span>
                      )}
                      {!card.job.poNumber && rail === "done" && (
                        <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                          PO needed
                        </span>
                      )}
                      {onCard.map((f) => (
                        <CustomFieldPill key={f.id} field={f} value={customValue(card, f.key)} />
                      ))}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {amount && (
                      <span className="block text-sm font-semibold tabular-nums text-[var(--ink)]">
                        {amount}
                      </span>
                    )}
                    <span className="block text-[11px] text-muted-foreground">
                      {RAIL_LABELS[rail]}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
