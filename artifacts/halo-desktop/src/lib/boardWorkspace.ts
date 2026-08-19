/**
 * Job board workspace engine — rails, columns, filters, sorting, grouping.
 *
 * Pure functions over the board cards the server already sends. Everything the
 * office can configure (custom fields, saved views) is layered here rather than
 * in the query, because /job-board returns the whole board in one shot and the
 * office needs instant switching between views, not a round trip per filter.
 *
 * Deliberately free of desktop-only imports so the client board and dispatch
 * board can adopt the same engine when they move to saved views.
 */

import type { BoardField, JobBoardCard } from "@workspace/api-client-react";

export type JobRailKey = "requested" | "in_progress" | "done" | "billing" | "alert";

export const RAIL_LABELS: Record<JobRailKey, string> = {
  requested: "Requested",
  in_progress: "In progress",
  done: "Done",
  billing: "Billing",
  alert: "Alerts",
};

/**
 * Which rail a card sits in. This is the ONE definition — the board, the list
 * and the table all read it, so a card can never appear in two places.
 *
 * Mirrors the server's own lane derivation (routes/clientCms.ts vendorRail).
 */
export function railOf(card: JobBoardCard): JobRailKey {
  // A pending client change order pulls the card back to Requested until the
  // office reviews upcharges and reopens it — mirrored on the client board.
  if (card.job.changeOrderStatus === "requested") return "requested";
  const board = card.job.boardStatus || "active";
  if (board === "manual_check") return "alert"; // failed AI check — needs a manual look
  if (board === "pay_alert") return "alert"; // crew paid — clear each row to history
  if (board === "reopened") return "alert"; // lost its crew — needs the office
  // Client reported the check as sent but we haven't verified it yet.
  if (
    card.invoice?.clientPaidReportedAt &&
    !card.invoice.paidAt &&
    card.invoice.status !== "paid"
  )
    return "alert";
  if (board === "billing") return "billing";
  if (card.job.status === "complete" || card.job.status === "paid") return "billing";
  if (board === "completed") return "done";
  if (board === "filled") return "in_progress";
  return "requested";
}

// ---------------------------------------------------------------------------
// Flags — the saved conditions the office actually asks for out loud
// ---------------------------------------------------------------------------
export type FlagKey =
  | "needsPo"
  | "unassigned"
  | "overdue"
  | "changeOrder"
  | "unpaidInvoice"
  | "noInvoice"
  | "hasPhotos";

export const FLAGS: { key: FlagKey; label: string; hint: string; test: (c: JobBoardCard) => boolean }[] = [
  {
    key: "needsPo",
    label: "Needs PO",
    hint: "Finished work that can't be billed until the client sends a PO",
    test: (c) => !c.job.poNumber,
  },
  {
    key: "unassigned",
    label: "No crew",
    hint: "Nobody is on it yet",
    test: (c) => !c.job.crewLeaderId,
  },
  {
    key: "overdue",
    label: "Past due",
    hint: "Scheduled or flex-due date has passed and the work isn't done",
    test: (c) => {
      const due = c.job.flexDueBy || c.job.scheduledOn;
      if (!due) return false;
      if (c.job.status === "complete" || c.job.status === "paid") return false;
      return due < todayLocal();
    },
  },
  {
    key: "changeOrder",
    label: "Change order",
    hint: "Client asked for a change and it's waiting on the office",
    test: (c) => c.job.changeOrderStatus === "requested",
  },
  {
    key: "unpaidInvoice",
    label: "Unpaid invoice",
    hint: "Invoice is out and the money hasn't landed",
    test: (c) => !!c.invoice && !c.invoice.paidAt && c.invoice.status !== "paid",
  },
  {
    key: "noInvoice",
    label: "Not invoiced",
    hint: "No invoice attached to the job yet",
    test: (c) => !c.invoice,
  },
  {
    key: "hasPhotos",
    label: "Has photos",
    hint: "Crew evidence is attached",
    test: (c) => (c.photos?.length ?? 0) > 0,
  },
];

/** Local YYYY-MM-DD — never toISOString, which shifts the day by the offset. */
export function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
export type BoardFilters = {
  search?: string | null;
  propertyIds?: string[];
  rails?: JobRailKey[];
  crewIds?: string[];
  services?: string[];
  flags?: FlagKey[];
  /** Custom field key -> accepted values (select) or true (checkbox/any value). */
  custom?: Record<string, unknown>;
};

export const EMPTY_FILTERS: BoardFilters = {};

export function filterCount(f: BoardFilters | null | undefined): number {
  if (!f) return 0;
  return (
    (f.search?.trim() ? 1 : 0) +
    (f.propertyIds?.length ? 1 : 0) +
    (f.rails?.length ? 1 : 0) +
    (f.crewIds?.length ? 1 : 0) +
    (f.services?.length ? 1 : 0) +
    (f.flags?.length ?? 0) +
    Object.keys(f.custom ?? {}).length
  );
}

function haystack(c: JobBoardCard): string {
  return [
    c.job.jobNo,
    c.job.woNo,
    c.job.poNumber,
    c.job.propertyName,
    c.job.unitNo ? `unit ${c.job.unitNo}` : null,
    c.job.description,
    c.job.category,
    c.job.crewLeaderName,
    c.job.services?.join(" "),
    c.invoice?.invoiceNo,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function applyFilters(cards: JobBoardCard[], f: BoardFilters | null | undefined): JobBoardCard[] {
  if (!f) return cards;
  const search = f.search?.trim().toLowerCase() ?? "";
  const flagTests = (f.flags ?? [])
    .map((k) => FLAGS.find((x) => x.key === k))
    .filter(Boolean) as (typeof FLAGS)[number][];
  return cards.filter((c) => {
    if (search && !haystack(c).includes(search)) return false;
    if (f.propertyIds?.length && !f.propertyIds.includes(c.job.propertyId ?? "unknown")) return false;
    if (f.rails?.length && !f.rails.includes(railOf(c))) return false;
    if (f.crewIds?.length) {
      const crew = c.job.crewLeaderId ?? "none";
      if (!f.crewIds.includes(crew)) return false;
    }
    if (f.services?.length) {
      const svc = c.job.services ?? [];
      if (!f.services.some((s) => svc.includes(s))) return false;
    }
    // Flags stack as AND: "needs PO" + "past due" means both, which is what
    // someone means when they add a second chip.
    for (const flag of flagTests) if (!flag.test(c)) return false;
    for (const [key, want] of Object.entries(f.custom ?? {})) {
      const have = customValue(c, key);
      if (Array.isArray(want)) {
        if (!want.length) continue;
        if (!want.map(String).includes(String(have ?? ""))) return false;
      } else if (typeof want === "boolean") {
        if (Boolean(have) !== want) return false;
      } else if (want != null && String(want) !== String(have ?? "")) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Custom field values
// ---------------------------------------------------------------------------
export function customValue(card: JobBoardCard, key: string): unknown {
  const bag = card.job.customFields as Record<string, unknown> | null | undefined;
  return bag?.[key] ?? null;
}

export function formatCustom(value: unknown, field: BoardField): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.type) {
    case "money":
      return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    case "checkbox":
      return value ? "Yes" : "No";
    case "select": {
      const opt = (field.options ?? []).find((o) => o.value === String(value));
      return opt?.label ?? String(value);
    }
    default:
      return String(value);
  }
}

/** The colour a select option carries, for the pill in board/table views. */
export function customColor(value: unknown, field: BoardField): string | null {
  if (field.type !== "select" || value == null) return null;
  return (field.options ?? []).find((o) => o.value === String(value))?.color ?? null;
}

// ---------------------------------------------------------------------------
// Columns — the table/list vocabulary. Custom fields append as "cf:<key>".
// ---------------------------------------------------------------------------
export type ColumnAlign = "left" | "right";
export type ColumnDef = {
  key: string;
  label: string;
  align?: ColumnAlign;
  width?: string;
  /** Display text. */
  text: (c: JobBoardCard) => string;
  /** Sort key — numbers sort numerically, strings lexically, null goes last. */
  sortValue?: (c: JobBoardCard) => string | number | null;
};

function money(n: number | null | undefined): string {
  if (n == null) return "";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export const BUILTIN_COLUMNS: ColumnDef[] = [
  {
    key: "job",
    label: "Job",
    width: "minmax(180px,1.4fr)",
    text: (c) => c.job.jobNo,
    sortValue: (c) => c.job.jobNo,
  },
  {
    key: "property",
    label: "Property",
    width: "minmax(160px,1.2fr)",
    text: (c) => c.job.propertyName ?? "",
    sortValue: (c) => c.job.propertyName ?? null,
  },
  {
    key: "unit",
    label: "Unit",
    width: "80px",
    text: (c) => c.job.unitNo ?? "",
    sortValue: (c) => c.job.unitNo ?? null,
  },
  {
    key: "rail",
    label: "Status",
    width: "120px",
    text: (c) => RAIL_LABELS[railOf(c)],
    sortValue: (c) => RAIL_LABELS[railOf(c)],
  },
  {
    key: "crew",
    label: "Crew",
    width: "minmax(120px,1fr)",
    text: (c) => c.job.crewLeaderName ?? "",
    sortValue: (c) => c.job.crewLeaderName ?? null,
  },
  {
    key: "services",
    label: "Work",
    width: "minmax(140px,1fr)",
    text: (c) => (c.job.services ?? []).join(", ") || (c.job.category ?? ""),
    sortValue: (c) => (c.job.services ?? [])[0] ?? null,
  },
  {
    key: "scheduled",
    label: "Scheduled",
    width: "110px",
    text: (c) => c.job.scheduledOn ?? "",
    sortValue: (c) => c.job.scheduledOn ?? null,
  },
  {
    key: "due",
    label: "Due",
    width: "110px",
    text: (c) => c.job.flexDueBy ?? "",
    sortValue: (c) => c.job.flexDueBy ?? null,
  },
  {
    key: "po",
    label: "PO",
    width: "110px",
    text: (c) => c.job.poNumber ?? "",
    sortValue: (c) => c.job.poNumber ?? null,
  },
  {
    key: "invoice",
    label: "Invoice",
    width: "120px",
    text: (c) => c.invoice?.invoiceNo ?? "",
    sortValue: (c) => c.invoice?.invoiceNo ?? null,
  },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    width: "110px",
    text: (c) => money(c.invoice?.total ?? c.job.lineTotal ?? null),
    sortValue: (c) => c.invoice?.total ?? c.job.lineTotal ?? null,
  },
  {
    key: "margin",
    label: "Margin",
    align: "right",
    width: "90px",
    // marginPct is a FRACTION on the wire (0.25 = 25%).
    text: (c) => (c.job.marginPct == null ? "" : `${Math.round(c.job.marginPct * 100)}%`),
    sortValue: (c) => c.job.marginPct ?? null,
  },
  {
    key: "photos",
    label: "Photos",
    align: "right",
    width: "80px",
    text: (c) => String(c.photos?.length ?? 0),
    sortValue: (c) => c.photos?.length ?? 0,
  },
  {
    key: "created",
    label: "Created",
    width: "110px",
    text: (c) => (c.job.createdAt ? c.job.createdAt.slice(0, 10) : ""),
    sortValue: (c) => c.job.createdAt ?? null,
  },
];

export const DEFAULT_COLUMNS = [
  "job",
  "property",
  "unit",
  "rail",
  "crew",
  "services",
  "due",
  "po",
  "amount",
];

export function columnsFor(fields: BoardField[]): ColumnDef[] {
  return [
    ...BUILTIN_COLUMNS,
    ...fields.map<ColumnDef>((f) => ({
      key: `cf:${f.key}`,
      label: f.label,
      align: f.type === "money" || f.type === "number" ? "right" : "left",
      width: "minmax(120px,1fr)",
      text: (c) => formatCustom(customValue(c, f.key), f),
      sortValue: (c) => {
        const v = customValue(c, f.key);
        if (v == null || v === "") return null;
        if (f.type === "number" || f.type === "money") return Number(v);
        if (f.type === "checkbox") return v ? 1 : 0;
        return String(v);
      },
    })),
  ];
}

// ---------------------------------------------------------------------------
// Sorting & grouping
// ---------------------------------------------------------------------------
export type BoardSort = { key: string; dir: "asc" | "desc" };
export type GroupBy = "rail" | "property" | "crew" | "none";

export function applySort(
  cards: JobBoardCard[],
  sort: BoardSort | null | undefined,
  columns: ColumnDef[],
): JobBoardCard[] {
  if (!sort) return cards;
  const col = columns.find((c) => c.key === sort.key);
  if (!col) return cards;
  const get = col.sortValue ?? ((c: JobBoardCard) => col.text(c));
  const dir = sort.dir === "desc" ? -1 : 1;
  return [...cards].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    // Blanks always sink, in both directions — an empty cell is not "smallest",
    // it's "unknown", and burying it keeps the useful rows on top.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
  });
}

export type CardGroup = { key: string; label: string; cards: JobBoardCard[] };

export function groupCards(cards: JobBoardCard[], groupBy: GroupBy): CardGroup[] {
  if (groupBy === "none") return [{ key: "all", label: "All work", cards }];
  const buckets = new Map<string, CardGroup>();
  const push = (key: string, label: string, card: JobBoardCard) => {
    const g = buckets.get(key) ?? { key, label, cards: [] };
    g.cards.push(card);
    buckets.set(key, g);
  };
  for (const c of cards) {
    if (groupBy === "rail") push(railOf(c), RAIL_LABELS[railOf(c)], c);
    else if (groupBy === "property")
      push(c.job.propertyId ?? "unknown", c.job.propertyName || "Unknown property", c);
    else push(c.job.crewLeaderId ?? "none", c.job.crewLeaderName || "Unassigned", c);
  }
  const order: JobRailKey[] = ["requested", "in_progress", "done", "billing", "alert"];
  const out = [...buckets.values()];
  if (groupBy === "rail") {
    out.sort((a, b) => order.indexOf(a.key as JobRailKey) - order.indexOf(b.key as JobRailKey));
  } else {
    // Unassigned sinks; everything else alphabetical.
    out.sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return a.label.localeCompare(b.label);
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drag between rails
// ---------------------------------------------------------------------------
export type MovePlan =
  | { kind: "board-status"; boardStatus: "completed" | "manual_check" }
  | { kind: "complete" }
  | { kind: "blocked"; reason: string };

/**
 * What dropping a card on a rail should do.
 *
 * The rails are not free-form columns — entry into In progress is earned by
 * assigning a crew, and entry into Billing is gated on the client PO and the
 * work checklist (the server enforces both). Rather than let a drag fail
 * silently, moves that aren't a status flip come back as `blocked` with the
 * reason, so the board can say what's actually missing.
 */
export function planMove(card: JobBoardCard, to: JobRailKey): MovePlan {
  const from = railOf(card);
  if (from === to) return { kind: "blocked", reason: "" };
  switch (to) {
    case "done":
      return { kind: "board-status", boardStatus: "completed" };
    case "alert":
      return { kind: "board-status", boardStatus: "manual_check" };
    case "billing": {
      if (!card.job.poNumber)
        return {
          kind: "blocked",
          reason: "Billing needs the client PO first — open the card to add it.",
        };
      const items = card.lineItems ?? [];
      if (items.length > 0 && !items.every((li) => li.completedAt))
        return {
          kind: "blocked",
          reason: "The crew still has open items on the work checklist.",
        };
      return { kind: "complete" };
    }
    case "in_progress":
      return {
        kind: "blocked",
        reason: card.job.crewLeaderId
          ? "The crew has to accept and start the job — it moves here on its own."
          : "Assign or broadcast a crew — the card moves here when someone takes it.",
      };
    case "requested":
      return {
        kind: "blocked",
        reason: "Work already underway can't be sent back to Requested. Open the card to reopen it.",
      };
    default:
      return { kind: "blocked", reason: "" };
  }
}
