/**
 * The job board's control bar: saved views, layout switch, search, filters,
 * grouping and columns.
 *
 * Modelled on the Linear/ClickUp pattern — saved views as tabs, everything else
 * as a compact right-hand toolbar — but the filter surface is written in the
 * office's language ("Needs PO", "No crew"), not generic field/operator/value
 * builders nobody fills in twice.
 */

import { useMemo, useState } from "react";
import type { BoardField, BoardView, JobBoardCard } from "@workspace/api-client-react";
import type { BoardDraft, ViewType } from "@/hooks/useBoardWorkspace";
import {
  FLAGS,
  RAIL_LABELS,
  filterCount,
  type BoardFilters,
  type ColumnDef,
  type FlagKey,
  type GroupBy,
  type JobRailKey,
} from "@/lib/boardWorkspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Columns3,
  Group,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Table2,
  X,
} from "lucide-react";

const LAYOUTS: { key: ViewType; label: string; icon: typeof LayoutGrid }[] = [
  { key: "board", label: "Board", icon: LayoutGrid },
  { key: "list", label: "List", icon: List },
  { key: "table", label: "Table", icon: Table2 },
];

const GROUPS: { key: GroupBy; label: string }[] = [
  { key: "rail", label: "Status" },
  { key: "property", label: "Property" },
  { key: "crew", label: "Crew" },
  { key: "none", label: "Nothing" },
];

function toggle<T>(list: T[] | undefined, value: T): T[] {
  const cur = list ?? [];
  return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
}

function CheckRow({
  checked,
  onChange,
  label,
  hint,
  testId,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <label
      className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
      data-testid={testId}
    >
      <Checkbox checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-[var(--ink)]">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function BoardViewBar({
  cards,
  fields,
  views,
  activeView,
  activeViewId,
  dirty,
  draft,
  columns,
  visibleColumns,
  shown,
  total,
  patch,
  setFilters,
  selectView,
  saveAs,
  saveActive,
  revert,
  deleteView,
  makeDefault,
  savingView,
  onManageFields,
}: {
  cards: JobBoardCard[];
  fields: BoardField[];
  views: BoardView[];
  activeView: BoardView | null;
  activeViewId: string | null;
  dirty: boolean;
  draft: BoardDraft;
  columns: ColumnDef[];
  visibleColumns: string[];
  shown: number;
  total: number;
  patch: (p: Partial<BoardDraft>) => void;
  setFilters: (f: BoardFilters | ((prev: BoardFilters) => BoardFilters)) => void;
  selectView: (id: string | null) => void;
  saveAs: (name: string) => void;
  saveActive: () => void;
  revert: () => void;
  deleteView: (id: string) => void;
  makeDefault: (id: string) => void;
  savingView: boolean;
  onManageFields: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");

  const properties = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cards)
      if (c.job.propertyId && !m.has(c.job.propertyId))
        m.set(c.job.propertyId, c.job.propertyName || "Unknown property");
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [cards]);

  const crews = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cards) {
      const id = c.job.crewLeaderId ?? "none";
      if (!m.has(id)) m.set(id, c.job.crewLeaderName || "Unassigned");
    }
    return [...m]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : a.name.localeCompare(b.name)));
  }, [cards]);

  const services = useMemo(() => {
    const s = new Set<string>();
    for (const c of cards) for (const v of c.job.services ?? []) s.add(v);
    return [...s].sort();
  }, [cards]);

  const activeFilters = filterCount(draft.filters);
  const f = draft.filters;

  return (
    <div className="shrink-0 space-y-3">
      {/* Saved views */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        <button
          type="button"
          onClick={() => selectView(null)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
            activeViewId === null
              ? "bg-[var(--ink)] text-white"
              : "text-muted-foreground hover:bg-muted"
          }`}
          data-testid="view-tab-all"
        >
          All work
        </button>
        {views.map((v) => (
          <div key={v.id} className="group relative shrink-0">
            <button
              type="button"
              onClick={() => selectView(v.id)}
              className={`flex items-center gap-1.5 rounded-full py-1.5 pl-3 pr-7 text-sm font-semibold transition-colors ${
                activeViewId === v.id
                  ? "bg-[var(--ink)] text-white"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              data-testid={`view-tab-${v.id}`}
            >
              {v.isDefault && <Star className="h-3 w-3 fill-current" aria-label="Default view" />}
              {v.name}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
                    activeViewId === v.id ? "text-white/70 hover:text-white" : "text-muted-foreground"
                  }`}
                  aria-label={`${v.name} options`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => makeDefault(v.id)}>
                  <Star className="mr-2 h-4 w-4" /> Make it the default
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600"
                  onClick={() => deleteView(v.id)}
                >
                  <X className="mr-2 h-4 w-4" /> Delete view
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}

        {naming ? (
          <form
            className="flex shrink-0 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              saveAs(name);
              setNewName("");
              setNaming(false);
            }}
          >
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="View name"
              className="h-8 w-40 rounded-full bg-white text-sm"
              data-testid="new-view-name"
            />
            <Button
              type="submit"
              size="sm"
              disabled={savingView}
              className="h-8 rounded-full bg-[var(--gold-light)] text-black hover:bg-[var(--gold-light)]/90"
            >
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-full"
              onClick={() => setNaming(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
            data-testid="new-view"
          >
            <Plus className="h-3.5 w-3.5" /> View
          </button>
        )}

        {dirty && activeView && (
          <div className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-amber-50 py-1 pl-3 pr-1 text-xs text-amber-900">
            Unsaved changes
            <Button
              size="sm"
              variant="ghost"
              className="h-6 rounded-full px-2 text-xs hover:bg-amber-100"
              onClick={revert}
            >
              Revert
            </Button>
            <Button
              size="sm"
              className="h-6 rounded-full bg-[var(--ink)] px-2.5 text-xs text-white hover:bg-[var(--ink)]/90"
              disabled={savingView}
              onClick={() => saveActive()}
              data-testid="save-view"
            >
              Save
            </Button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-[var(--hairline)] bg-white p-0.5">
          {LAYOUTS.map((l) => {
            const Icon = l.icon;
            const on = draft.viewType === l.key;
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => patch({ viewType: l.key })}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                  on ? "bg-[var(--ink)] text-white shadow-sm" : "text-muted-foreground hover:text-[var(--ink)]"
                }`}
                aria-pressed={on}
                data-testid={`layout-${l.key}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {l.label}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={f.search ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="Search jobs, units, POs…"
            className="h-8 w-60 rounded-full border-[var(--hairline)] bg-white pl-8 text-sm shadow-none"
            data-testid="board-search"
          />
          {f.search && (
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, search: "" }))}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-[var(--ink)]"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={`h-8 gap-1.5 rounded-full border-[var(--hairline)] bg-white text-xs font-semibold shadow-none ${
                activeFilters ? "text-[var(--ink)]" : "text-muted-foreground"
              }`}
              data-testid="filter-button"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filter
              {activeFilters > 0 && (
                <span className="ml-0.5 rounded-full bg-[var(--gold-light)] px-1.5 text-[10px] font-bold text-black">
                  {activeFilters}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0">
            <ScrollArea className="max-h-[26rem]">
              <div className="space-y-4 p-3">
                <section>
                  <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Needs attention
                  </p>
                  {FLAGS.map((flag) => (
                    <CheckRow
                      key={flag.key}
                      checked={(f.flags ?? []).includes(flag.key)}
                      onChange={() =>
                        setFilters((prev) => ({
                          ...prev,
                          flags: toggle<FlagKey>(prev.flags, flag.key),
                        }))
                      }
                      label={flag.label}
                      hint={flag.hint}
                      testId={`filter-flag-${flag.key}`}
                    />
                  ))}
                </section>

                <section>
                  <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Status
                  </p>
                  {(Object.keys(RAIL_LABELS) as JobRailKey[]).map((r) => (
                    <CheckRow
                      key={r}
                      checked={(f.rails ?? []).includes(r)}
                      onChange={() =>
                        setFilters((prev) => ({ ...prev, rails: toggle<JobRailKey>(prev.rails, r) }))
                      }
                      label={RAIL_LABELS[r]}
                      testId={`filter-rail-${r}`}
                    />
                  ))}
                </section>

                {properties.length > 1 && (
                  <section>
                    <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Property
                    </p>
                    {properties.map((p) => (
                      <CheckRow
                        key={p.id}
                        checked={(f.propertyIds ?? []).includes(p.id)}
                        onChange={() =>
                          setFilters((prev) => ({
                            ...prev,
                            propertyIds: toggle(prev.propertyIds, p.id),
                          }))
                        }
                        label={p.name}
                      />
                    ))}
                  </section>
                )}

                {crews.length > 1 && (
                  <section>
                    <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Crew
                    </p>
                    {crews.map((c) => (
                      <CheckRow
                        key={c.id}
                        checked={(f.crewIds ?? []).includes(c.id)}
                        onChange={() =>
                          setFilters((prev) => ({ ...prev, crewIds: toggle(prev.crewIds, c.id) }))
                        }
                        label={c.name}
                      />
                    ))}
                  </section>
                )}

                {services.length > 0 && (
                  <section>
                    <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Work type
                    </p>
                    {services.map((s) => (
                      <CheckRow
                        key={s}
                        checked={(f.services ?? []).includes(s)}
                        onChange={() =>
                          setFilters((prev) => ({ ...prev, services: toggle(prev.services, s) }))
                        }
                        label={s}
                      />
                    ))}
                  </section>
                )}

                {fields
                  .filter((field) => field.type === "select" || field.type === "checkbox")
                  .map((field) => (
                    <section key={field.id}>
                      <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {field.label}
                      </p>
                      {field.type === "checkbox" ? (
                        <CheckRow
                          checked={(f.custom?.[field.key] as boolean) === true}
                          onChange={() =>
                            setFilters((prev) => {
                              const custom = { ...(prev.custom ?? {}) };
                              if (custom[field.key] === true) delete custom[field.key];
                              else custom[field.key] = true;
                              return { ...prev, custom };
                            })
                          }
                          label={`Checked`}
                        />
                      ) : (
                        (field.options ?? []).map((o) => {
                          const cur = (f.custom?.[field.key] as string[] | undefined) ?? [];
                          return (
                            <CheckRow
                              key={o.value}
                              checked={cur.includes(o.value)}
                              onChange={() =>
                                setFilters((prev) => {
                                  const custom = { ...(prev.custom ?? {}) };
                                  const next = toggle(
                                    (custom[field.key] as string[] | undefined) ?? [],
                                    o.value,
                                  );
                                  if (next.length) custom[field.key] = next;
                                  else delete custom[field.key];
                                  return { ...prev, custom };
                                })
                              }
                              label={o.label}
                            />
                          );
                        })
                      )}
                    </section>
                  ))}
              </div>
            </ScrollArea>
            {activeFilters > 0 && (
              <div className="border-t border-[var(--hairline)] p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full rounded-lg text-xs"
                  onClick={() => setFilters({})}
                  data-testid="clear-filters"
                >
                  Clear all filters
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {draft.viewType !== "board" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full border-[var(--hairline)] bg-white text-xs font-semibold text-muted-foreground shadow-none"
                data-testid="group-button"
              >
                <Group className="h-3.5 w-3.5" />
                Group: {GROUPS.find((g) => g.key === draft.groupBy)?.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {GROUPS.map((g) => (
                <DropdownMenuItem key={g.key} onClick={() => patch({ groupBy: g.key })}>
                  {g.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {draft.viewType === "table" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full border-[var(--hairline)] bg-white text-xs font-semibold text-muted-foreground shadow-none"
                data-testid="columns-button"
              >
                <Columns3 className="h-3.5 w-3.5" />
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              <ScrollArea className="max-h-80">
                {columns.map((col) => (
                  <CheckRow
                    key={col.key}
                    checked={visibleColumns.includes(col.key)}
                    onChange={() =>
                      patch({
                        visibleColumns: visibleColumns.includes(col.key)
                          ? visibleColumns.filter((k) => k !== col.key)
                          : [...visibleColumns, col.key],
                      })
                    }
                    label={col.label}
                    testId={`column-${col.key}`}
                  />
                ))}
              </ScrollArea>
            </PopoverContent>
          </Popover>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-full border-[var(--hairline)] bg-white text-xs font-semibold text-muted-foreground shadow-none"
          onClick={onManageFields}
          data-testid="manage-fields"
        >
          <Plus className="h-3.5 w-3.5" />
          Fields
        </Button>

        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
          {shown === total ? `${total} jobs` : `${shown} of ${total}`}
        </span>
      </div>
    </div>
  );
}
