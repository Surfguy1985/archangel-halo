/**
 * Table view — every job as a row, every column sortable, custom fields
 * editable in place. This is the view for working a list down: filter to
 * "needs PO", then fill the column without opening a single card.
 */

import type { BoardField } from "@workspace/api-client-react";
import type { CardGroup, ColumnDef, JobRailKey } from "@/lib/boardWorkspace";
import { RAIL_LABELS, customValue, railOf } from "@/lib/boardWorkspace";
import type { BoardSort } from "@/lib/boardWorkspace";
import { CustomFieldCell } from "./CustomFieldCell";
import { ArrowDown, ArrowUp, ChevronsUpDown, ClipboardList } from "lucide-react";

const RAIL_DOT: Record<JobRailKey, string> = {
  requested: "bg-[var(--gold-light)]",
  in_progress: "bg-sky-400",
  done: "bg-emerald-400",
  billing: "bg-stone-300",
  alert: "bg-[#DC2626]",
};

export function JobTableView({
  groups,
  columns,
  visibleColumns,
  fields,
  sort,
  onSort,
  onOpen,
  showGroupHeaders,
}: {
  groups: CardGroup[];
  columns: ColumnDef[];
  visibleColumns: string[];
  fields: BoardField[];
  sort: BoardSort | null;
  onSort: (s: BoardSort | null) => void;
  onOpen: (jobId: string) => void;
  showGroupHeaders: boolean;
}) {
  const cols = visibleColumns
    .map((k) => columns.find((c) => c.key === k))
    .filter(Boolean) as ColumnDef[];
  const template = cols.map((c) => c.width ?? "minmax(120px,1fr)").join(" ");
  const total = groups.reduce((n, g) => n + g.cards.length, 0);

  const cycle = (key: string) => {
    if (sort?.key !== key) onSort({ key, dir: "asc" });
    else if (sort.dir === "asc") onSort({ key, dir: "desc" });
    else onSort(null);
  };

  if (!cols.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--hairline)] px-4 py-10 text-center text-sm text-muted-foreground">
        Every column is hidden. Use <span className="font-semibold">Columns</span> to bring some back.
      </div>
    );
  }

  if (total === 0) return <EmptyResult />;

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--hairline)] bg-white">
      <div className="min-w-full" style={{ minWidth: "min-content" }}>
        {/* Header */}
        <div
          className="sticky top-0 z-10 grid gap-px border-b border-[var(--hairline)] bg-[var(--paper,#FAFAF7)]"
          style={{ gridTemplateColumns: template }}
          role="row"
        >
          {cols.map((c) => {
            const active = sort?.key === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => cycle(c.key)}
                className={`flex items-center gap-1 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide transition-colors hover:text-[var(--ink)] ${
                  c.align === "right" ? "justify-end" : "justify-start"
                } ${active ? "text-[var(--ink)]" : "text-muted-foreground"}`}
                data-testid={`sort-${c.key}`}
              >
                {c.label}
                {active ? (
                  sort!.dir === "asc" ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )
                ) : (
                  <ChevronsUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-40" />
                )}
              </button>
            );
          })}
        </div>

        {groups.map((g) => (
          <div key={g.key}>
            {showGroupHeaders && (
              <div className="flex items-center gap-2 border-b border-[var(--hairline)] bg-[var(--paper,#FAFAF7)]/60 px-3 py-1.5">
                <span className="text-xs font-bold text-[var(--ink)]">{g.label}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{g.cards.length}</span>
              </div>
            )}
            {g.cards.map((card) => (
              <div
                key={card.job.id}
                className="group grid items-center gap-px border-b border-[var(--hairline)]/60 transition-colors last:border-b-0 hover:bg-[var(--gold-light)]/5"
                style={{ gridTemplateColumns: template }}
                data-testid={`table-row-${card.job.id}`}
              >
                {cols.map((c) => {
                  const cfKey = c.key.startsWith("cf:") ? c.key.slice(3) : null;
                  const field = cfKey ? fields.find((f) => f.key === cfKey) : null;
                  if (field) {
                    return (
                      <div key={c.key} className="px-2 py-1.5">
                        <CustomFieldCell
                          jobId={card.job.id}
                          field={field}
                          value={customValue(card, field.key)}
                        />
                      </div>
                    );
                  }
                  const text = c.text(card);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => onOpen(card.job.id)}
                      className={`flex min-w-0 items-center gap-1.5 px-3 py-2 text-xs text-[var(--ink)] ${
                        c.align === "right" ? "justify-end tabular-nums" : "justify-start"
                      }`}
                    >
                      {c.key === "rail" && (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${RAIL_DOT[railOf(card)]}`}
                          aria-hidden
                        />
                      )}
                      <span
                        className={`truncate ${c.key === "job" ? "font-semibold" : ""} ${
                          !text ? "text-muted-foreground/50" : ""
                        }`}
                      >
                        {text || "—"}
                      </span>
                      {c.key === "job" && card.job.unitNo && (
                        <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                          {card.job.unitNo}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyResult() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--hairline)] bg-card px-4 py-16 text-center">
      <ClipboardList className="mb-3 h-10 w-10 text-border" />
      <p className="text-sm font-semibold text-[var(--ink)]">Nothing matches this view</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Loosen a filter, or clear them all to see the whole board again.
      </p>
    </div>
  );
}

export { RAIL_LABELS };
