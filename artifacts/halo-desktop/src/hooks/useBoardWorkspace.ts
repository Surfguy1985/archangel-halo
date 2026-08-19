/**
 * The office's live view of the job board: which layout, which filters, which
 * columns — plus the saved views and custom fields behind them.
 *
 * The working state is a DRAFT. Picking a saved view loads it into the draft;
 * changing a filter makes the draft dirty without touching what's saved, so
 * nobody destroys a shared view by narrowing it for one lookup. The draft is
 * kept in localStorage so a refresh lands you back where you were.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListBoardWorkspace,
  getListBoardWorkspaceQueryKey,
  useCreateBoardView,
  useUpdateBoardView,
  useDeleteBoardView,
  type BoardField,
  type BoardView,
  type JobBoardCard,
} from "@workspace/api-client-react";
import {
  applyFilters,
  applySort,
  columnsFor,
  DEFAULT_COLUMNS,
  groupCards,
  type BoardFilters,
  type BoardSort,
  type GroupBy,
} from "@/lib/boardWorkspace";

export type ViewType = "board" | "list" | "table";

export type BoardDraft = {
  viewType: ViewType;
  filters: BoardFilters;
  sort: BoardSort | null;
  groupBy: GroupBy;
  visibleColumns: string[];
  /** True once someone picks columns by hand — until then new custom fields
   *  join the table automatically instead of hiding behind the Columns menu. */
  columnsTouched?: boolean;
};

const STORAGE_KEY = "jobboard-workspace-draft";

const BLANK_DRAFT: BoardDraft = {
  viewType: "board",
  filters: {},
  sort: null,
  groupBy: "rail",
  visibleColumns: DEFAULT_COLUMNS,
};

function draftFromView(v: BoardView): BoardDraft {
  return {
    viewType: (v.viewType as ViewType) ?? "board",
    filters: (v.filters as BoardFilters) ?? {},
    sort: (v.sort as BoardSort) ?? null,
    groupBy: (v.groupBy as GroupBy) ?? "rail",
    visibleColumns: v.visibleColumns?.length ? v.visibleColumns : DEFAULT_COLUMNS,
    columnsTouched: !!v.visibleColumns?.length,
  };
}

function sameDraft(a: BoardDraft, b: BoardDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useBoardWorkspace(cards: JobBoardCard[]) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useListBoardWorkspace(undefined, {
    query: { queryKey: getListBoardWorkspaceQueryKey() },
  });
  const fields: BoardField[] = useMemo(() => data?.fields ?? [], [data]);
  const views: BoardView[] = useMemo(() => data?.views ?? [], [data]);

  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BoardDraft>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { viewId: string | null; draft: BoardDraft };
        if (parsed?.draft) return { ...BLANK_DRAFT, ...parsed.draft };
      }
    } catch {
      /* private mode or stale shape — fall back to the blank board */
    }
    return BLANK_DRAFT;
  });

  // Restore which saved view was selected, once, on mount.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { viewId: string | null };
        if (parsed?.viewId) setActiveViewId(parsed.viewId);
      }
    } catch {
      /* ignore */
    }
    setRestored(true);
  }, [restored]);

  // First load with no stored draft: fall into the office's default view.
  useEffect(() => {
    if (!restored || activeViewId || !views.length) return;
    let stored = false;
    try {
      stored = !!localStorage.getItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (stored) return;
    const def = views.find((v) => v.isDefault);
    if (def) {
      setActiveViewId(def.id);
      setDraft(draftFromView(def));
    }
  }, [restored, activeViewId, views]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ viewId: activeViewId, draft }));
    } catch {
      /* ignore */
    }
  }, [activeViewId, draft]);

  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const dirty = activeView ? !sameDraft(draft, draftFromView(activeView)) : false;

  const patch = useCallback(
    (p: Partial<BoardDraft>) =>
      setDraft((d) => ({
        ...d,
        ...p,
        columnsTouched: p.visibleColumns ? true : d.columnsTouched,
      })),
    [],
  );
  const setFilters = useCallback(
    (f: BoardFilters | ((prev: BoardFilters) => BoardFilters)) =>
      setDraft((d) => ({
        ...d,
        filters: typeof f === "function" ? f(d.filters) : f,
      })),
    [],
  );

  const selectView = useCallback(
    (id: string | null) => {
      setActiveViewId(id);
      const v = id ? views.find((x) => x.id === id) : null;
      setDraft(v ? draftFromView(v) : BLANK_DRAFT);
    },
    [views],
  );

const columns = useMemo(() => columnsFor(fields), [fields]);
  // Until the office curates the column list, show everything they've defined.
  const visibleColumns = useMemo(
    () =>
      draft.columnsTouched
        ? draft.visibleColumns
        : [...DEFAULT_COLUMNS, ...fields.map((f) => `cf:${f.key}`)],
    [draft.columnsTouched, draft.visibleColumns, fields],
  );

  const createView = useCreateBoardView();
  const updateView = useUpdateBoardView();
  const removeView = useDeleteBoardView();
  const refreshViews = () =>
    queryClient.invalidateQueries({ queryKey: getListBoardWorkspaceQueryKey() });

  const saveAs = useCallback(
    (name: string, onDone?: (v: BoardView) => void) =>
      createView.mutate(
        {
          data: {
            name,
            viewType: draft.viewType,
            filters: draft.filters,
            sort: draft.sort,
            groupBy: draft.groupBy,
            visibleColumns,
          },
        },
        {
          onSuccess: (v) => {
            setActiveViewId(v.id);
            // Adopt exactly what was stored, or the view reads as unsaved the
            // moment it's created (the column list is resolved, not raw).
            setDraft(draftFromView(v));
            refreshViews();
            onDone?.(v);
          },
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, visibleColumns, createView],
  );

  const saveActive = useCallback(
    (onDone?: () => void) => {
      if (!activeView) return;
      updateView.mutate(
        {
          id: activeView.id,
          data: {
            viewType: draft.viewType,
            filters: draft.filters,
            sort: draft.sort,
            groupBy: draft.groupBy,
            visibleColumns,
          },
        },
        {
          onSuccess: (v) => {
            setDraft(draftFromView(v));
            refreshViews();
            onDone?.();
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeView, draft, visibleColumns, updateView],
  );

  const renameView = useCallback(
    (id: string, name: string) =>
      updateView.mutate({ id, data: { name } }, { onSuccess: refreshViews }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateView],
  );

  const makeDefault = useCallback(
    (id: string) =>
      updateView.mutate({ id, data: { isDefault: true } }, { onSuccess: refreshViews }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateView],
  );

  const deleteView = useCallback(
    (id: string) =>
      removeView.mutate(
        { id },
        {
          onSuccess: () => {
            if (activeViewId === id) selectView(null);
            refreshViews();
          },
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removeView, activeViewId, selectView],
  );

  const revert = useCallback(() => {
    if (activeView) setDraft(draftFromView(activeView));
    else setDraft(BLANK_DRAFT);
  }, [activeView]);

  const filtered = useMemo(() => applyFilters(cards, draft.filters), [cards, draft.filters]);
  const sorted = useMemo(
    () => applySort(filtered, draft.sort, columns),
    [filtered, draft.sort, columns],
  );
  const groups = useMemo(() => groupCards(sorted, draft.groupBy), [sorted, draft.groupBy]);

  return {
    isLoading,
    fields,
    views,
    activeView,
    activeViewId,
    dirty,
    draft,
    patch,
    setFilters,
    selectView,
    saveAs,
    saveActive,
    renameView,
    makeDefault,
    deleteView,
    revert,
    savingView: createView.isPending || updateView.isPending,
    columns,
    /** Columns the table should render, custom fields included. */
    visibleColumns,
    /** Cards after filters (unsorted, ungrouped) — what the board rails render. */
    filtered,
    /** Cards after filters + sort. */
    sorted,
    /** Cards after filters + sort + grouping. */
    groups,
  };
}
