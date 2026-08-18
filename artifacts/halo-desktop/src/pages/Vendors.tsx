import { useMemo, useState } from "react";
import {
  useListVendors,
  useListPurchaseOrders,
  type Vendor,
} from "@workspace/api-client-react";
import {
  Plus,
  Search,
  Pencil,
  Download,
  ShieldCheck,
  ShieldAlert,
  Clock3,
  Truck,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Home,
  Timer,
  ListOrdered,
  Receipt,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { VendorDialog } from "@/components/VendorDialogs";
import { PriceListDialog } from "@/components/PriceListDialog";
import { exportCsv } from "@/lib/exportCsv";

/* ----------------------------------------------------------- date helpers */

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function daysUntil(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  const target = new Date(y!, m! - 1, d!);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}
function fmtYmd(ymd: string) {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ------------------------------------------------------------ vendor kind */

const isInHouse = (v: Vendor) => v.vendorType === "in_house";
const isContracted = (v: Vendor) => (v.contractStatus ?? "contracted") !== "inactive";

/* ------------------------------------------------------------ COI status */

type CoiStatus = "compliant" | "expiring" | "lapsed";

function coiStatus(v: Vendor): CoiStatus {
  if (!v.coiExpiresOn) return "lapsed";
  const days = daysUntil(v.coiExpiresOn);
  if (days < 0) return "lapsed";
  if (days <= 30) return "expiring";
  return "compliant";
}

function StatusBadge({ vendor }: { vendor: Vendor }) {
  const status = coiStatus(vendor);
  if (status === "compliant") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
        <ShieldCheck className="w-3.5 h-3.5" /> Compliant
      </span>
    );
  }
  if (status === "expiring") {
    const days = daysUntil(vendor.coiExpiresOn!);
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
        <Clock3 className="w-3.5 h-3.5" />
        {days === 0 ? "Expires today" : `Expires in ${days}d`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
      <ShieldAlert className="w-3.5 h-3.5" />
      {vendor.coiExpiresOn ? "COI lapsed" : "No COI on file"}
    </span>
  );
}

/* --------------------------------------------------------------- metrics */

/**
 * A missing average is stated, never faked. "0.0d" and "—" both read like
 * measurements — the office has to be able to tell "they're instant" from
 * "we've never measured them".
 */
function MetricCell({
  days,
  samples,
  noun,
}: {
  days: number | null | undefined;
  samples: number | null | undefined;
  noun: string;
}) {
  if (days == null) {
    return (
      <span className="text-xs text-muted-foreground italic">No data yet</span>
    );
  }
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="font-semibold text-[var(--ink)]">{days.toFixed(1)}d</span>
      <span className="text-[11px] text-muted-foreground">
        {samples ?? 0} {noun}
        {(samples ?? 0) === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function metricCsv(days: number | null | undefined, samples: number | null | undefined) {
  return days == null ? "No data yet" : `${days.toFixed(1)} (${samples ?? 0})`;
}

/* ------------------------------------------------------------------ page */

type ContractFilter = "contracted" | "inactive" | "all";
type CoiFilter = "all" | CoiStatus;
type SortKey = "name" | "trade" | "coi" | "turn" | "po";

export default function Vendors() {
  const { data: vendors, isLoading, isError, refetch } = useListVendors();
  const { data: pos } = useListPurchaseOrders();

  const [query, setQuery] = useState("");
  const [contractFilter, setContractFilter] = useState<ContractFilter>("contracted");
  const [coiFilter, setCoiFilter] = useState<CoiFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [priceListOpen, setPriceListOpen] = useState(false);
  const [priceListVendor, setPriceListVendor] = useState<Vendor | null>(null);
  const [editing, setEditing] = useState<Vendor | null>(null);

  const openPoCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const po of pos ?? []) {
      if (po.vendorId && po.status !== "received") {
        map.set(po.vendorId, (map.get(po.vendorId) ?? 0) + 1);
      }
    }
    return map;
  }, [pos]);

  const counts = useMemo(() => {
    const all = vendors ?? [];
    const contracted = all.filter(isContracted);
    return {
      all: all.length,
      contracted: contracted.length,
      inactive: all.length - contracted.length,
      compliant: contracted.filter((v) => coiStatus(v) === "compliant").length,
      expiring: contracted.filter((v) => coiStatus(v) === "expiring").length,
      lapsed: contracted.filter((v) => coiStatus(v) === "lapsed").length,
    };
  }, [vendors]);

  const visible = useMemo(() => {
    let list = vendors ?? [];
    if (contractFilter === "contracted") list = list.filter(isContracted);
    else if (contractFilter === "inactive") list = list.filter((v) => !isContracted(v));
    if (coiFilter !== "all") list = list.filter((v) => coiStatus(v) === coiFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((v) =>
        [v.name, v.trade, v.email, v.phone]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q)),
      );
    }
    const dir = sortDir;
    return [...list].sort((a, b) => {
      // Our own organization is not one vendor among many — it stays on top
      // whatever the sort says.
      if (isInHouse(a) !== isInHouse(b)) return isInHouse(a) ? -1 : 1;
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      if (sortKey === "trade")
        return (a.trade ?? "\uffff").localeCompare(b.trade ?? "\uffff") * dir;
      if (sortKey === "turn" || sortKey === "po") {
        // Unmeasured vendors sort last in both directions — an absent average
        // is not "fast".
        const av = (sortKey === "turn" ? a.avgTurnDays : a.avgPoDays) ?? null;
        const bv = (sortKey === "turn" ? b.avgTurnDays : b.avgPoDays) ?? null;
        if (av == null && bv == null) return a.name.localeCompare(b.name);
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * dir;
      }
      // COI: soonest expiry first; missing dates last
      const av = a.coiExpiresOn ?? "9999-99-99";
      const bv = b.coiExpiresOn ?? "9999-99-99";
      return av.localeCompare(bv) * dir;
    });
  }, [vendors, contractFilter, coiFilter, query, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey !== col ? (
      <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />
    ) : sortDir === 1 ? (
      <ArrowUp className="w-3.5 h-3.5" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5" />
    );

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (v: Vendor) => {
    setEditing(v);
    setDialogOpen(true);
  };
  const openRates = (v: Vendor, e: React.MouseEvent) => {
    e.stopPropagation();
    setPriceListVendor(v);
    setPriceListOpen(true);
  };

  const doExport = () => {
    exportCsv(
      `vendors-${todayLocal()}.csv`,
      [
        { key: "name", label: "Name" },
        { key: "type", label: "Type" },
        { key: "contract", label: "Contract" },
        { key: "trade", label: "Trade" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
        { key: "avgTurn", label: "Avg turn (days)" },
        { key: "avgPo", label: "Avg PO (days)" },
        { key: "coiExpiresOn", label: "COI expires" },
        { key: "status", label: "Status" },
        { key: "openPos", label: "Open POs" },
      ],
      visible.map((v) => ({
        name: v.name,
        type: isInHouse(v) ? "In-house" : "Subcontractor",
        contract: isContracted(v) ? "Contracted" : "Inactive",
        trade: v.trade ?? "",
        email: v.email ?? "",
        phone: v.phone ?? "",
        avgTurn: metricCsv(v.avgTurnDays, v.avgTurnSamples),
        avgPo: metricCsv(v.avgPoDays, v.avgPoSamples),
        coiExpiresOn: v.coiExpiresOn ?? "",
        status:
          coiStatus(v) === "compliant"
            ? "Compliant"
            : coiStatus(v) === "expiring"
              ? "Expiring soon"
              : "Lapsed",
        openPos: openPoCount.get(v.id) ?? 0,
      })),
    );
  };

  const contractFilters: { key: ContractFilter; label: string; count: number }[] = [
    { key: "contracted", label: "Contracted", count: counts.contracted },
    { key: "inactive", label: "Inactive", count: counts.inactive },
    { key: "all", label: "All", count: counts.all },
  ];

  const coiFilters: { key: CoiFilter; label: string; count: number }[] = [
    { key: "all", label: "Any COI", count: counts.contracted },
    { key: "compliant", label: "Compliant", count: counts.compliant },
    { key: "expiring", label: "Expiring soon", count: counts.expiring },
    { key: "lapsed", label: "Lapsed", count: counts.lapsed },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)]">
            Vendors
          </h1>
          <p className="text-muted-foreground">
            Who we're contracted with, what they charge, and how fast they move.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setPriceListVendor(null); setPriceListOpen(true); }}
            data-testid="button-price-list"
            className="inline-flex items-center gap-2 px-4 h-9 text-sm font-semibold border border-border rounded-md bg-card hover:bg-black/5 transition-colors"
          >
            <ListOrdered className="w-4 h-4" /> Price list
          </button>
          <button
            onClick={doExport}
            disabled={!visible.length}
            className="inline-flex items-center gap-2 px-4 h-9 text-sm font-semibold border border-border rounded-md bg-card hover:bg-black/5 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={openAdd}
            className="btn-gold inline-flex items-center gap-1.5 px-4 h-9 text-sm"
            data-testid="button-add-vendor"
          >
            <Plus className="w-4 h-4" strokeWidth={2.4} /> Add vendor
          </button>
        </div>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Contracted"
          value={counts.contracted}
          icon={<Truck className="w-5 h-5 text-[var(--gold)]" />}
        />
        <SummaryCard
          label="Compliant"
          value={counts.compliant}
          icon={<ShieldCheck className="w-5 h-5 text-green-700" />}
        />
        <SummaryCard
          label="Expiring ≤ 30 days"
          value={counts.expiring}
          icon={<Clock3 className="w-5 h-5 text-amber-600" />}
        />
        <SummaryCard
          label="Lapsed / no COI"
          value={counts.lapsed}
          icon={<ShieldAlert className="w-5 h-5 text-red-700" />}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, trade, or contact…"
            data-testid="input-vendor-search"
            className="w-full bg-card border border-[var(--hairline)] rounded-full py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/20"
          />
        </div>
        <div className="flex gap-1.5">
          {contractFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => setContractFilter(f.key)}
              data-testid={`filter-contract-${f.key}`}
              className={`px-3 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                contractFilter === f.key
                  ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                  : "bg-card text-muted-foreground border-[var(--hairline)] hover:text-foreground"
              }`}
            >
              {f.label}
              <span className="ml-1.5 opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {coiFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => setCoiFilter(f.key)}
              data-testid={`filter-coi-${f.key}`}
              className={`px-3 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                coiFilter === f.key
                  ? "bg-[var(--gold-light)] text-black border-[var(--gold-light)]"
                  : "bg-card text-muted-foreground border-[var(--hairline)] hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : isError ? (
        <div className="text-center py-12 bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          <p className="text-muted-foreground mb-3">Couldn't load vendors.</p>
          <button
            onClick={() => refetch()}
            className="text-sm font-semibold text-[var(--gold)] hover:opacity-80 transition-opacity"
          >
            Try again
          </button>
        </div>
      ) : !vendors?.length ? (
        <div className="text-center py-16 bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          <Truck className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="font-display font-bold text-lg text-[var(--ink)] mb-1">
            No vendors yet
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Add the first company you're contracted with.
          </p>
          <button
            onClick={openAdd}
            className="btn-gold inline-flex items-center gap-1.5 px-4 h-9 text-sm"
          >
            <Plus className="w-4 h-4" strokeWidth={2.4} /> Add vendor
          </button>
        </div>
      ) : !visible.length ? (
        <div className="text-center py-12 text-muted-foreground bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          No vendors match this view.
        </div>
      ) : (
        <div className="bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--paper)] border-b border-[var(--hairline)]">
              <tr>
                <Th onClick={() => toggleSort("name")}>
                  Name <SortIcon col="name" />
                </Th>
                <Th onClick={() => toggleSort("trade")}>
                  Trade <SortIcon col="trade" />
                </Th>
                <Th>Contact</Th>
                <Th onClick={() => toggleSort("turn")}>
                  Avg turn <SortIcon col="turn" />
                </Th>
                <Th onClick={() => toggleSort("po")}>
                  Avg PO <SortIcon col="po" />
                </Th>
                <Th className="text-center">Open POs</Th>
                <Th onClick={() => toggleSort("coi")}>
                  COI expires <SortIcon col="coi" />
                </Th>
                <Th className="text-right">Status</Th>
                <Th className="w-12"> </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {visible.map((v) => (
                <tr
                  key={v.id}
                  data-testid={`row-vendor-${v.id}`}
                  className={`transition-colors cursor-pointer ${
                    isInHouse(v)
                      ? "bg-[var(--gold-light)]/12 hover:bg-[var(--gold-light)]/20"
                      : "hover:bg-black/[0.02]"
                  }`}
                  onClick={() => openEdit(v)}
                >
                  <td className="px-6 py-4 font-semibold text-[var(--ink)]">
                    <div className="flex items-center gap-2">
                      {isInHouse(v) ? (
                        <Home className="w-4 h-4 text-[var(--gold)] shrink-0" />
                      ) : null}
                      <span>{v.name}</span>
                      {isInHouse(v) ? (
                        <span className="px-2 py-0.5 rounded-full bg-[var(--ink)] text-white text-[10px] font-bold uppercase tracking-[0.06em]">
                          In-house
                        </span>
                      ) : null}
                      {!isContracted(v) ? (
                        <span className="px-2 py-0.5 rounded-full bg-black/[0.06] text-muted-foreground text-[10px] font-bold uppercase tracking-[0.06em]">
                          Inactive
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {v.trade || "—"}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {[v.email, v.phone].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-6 py-4" data-testid={`text-turn-${v.id}`}>
                    <MetricCell days={v.avgTurnDays} samples={v.avgTurnSamples} noun="job" />
                  </td>
                  <td className="px-6 py-4" data-testid={`text-po-${v.id}`}>
                    <MetricCell days={v.avgPoDays} samples={v.avgPoSamples} noun="PO" />
                  </td>
                  <td className="px-6 py-4 text-center text-muted-foreground">
                    {openPoCount.get(v.id) || "—"}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                    {v.coiExpiresOn ? fmtYmd(v.coiExpiresOn) : "—"}
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <StatusBadge vendor={v} />
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => openRates(v, e)}
                        aria-label={`Rate sheet for ${v.name}`}
                        title="Rate sheet"
                        className="w-8 h-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 transition-colors"
                      >
                        <Receipt className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(v);
                        }}
                        aria-label={`Edit ${v.name}`}
                        className="w-8 h-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Timer className="w-3.5 h-3.5" />
        Avg turn is job start to completion; avg PO is order to received. Both
        are measured from work attributed to that vendor.
      </p>

      <VendorDialog open={dialogOpen} onOpenChange={setDialogOpen} vendor={editing} />
      <PriceListDialog
        open={priceListOpen}
        onOpenChange={(open) => {
          setPriceListOpen(open);
          if (!open) setPriceListVendor(null);
        }}
        vendor={priceListVendor}
      />
    </div>
  );
}

function Th({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <th
      className={`px-6 py-3 font-semibold text-muted-foreground   text-xs ${
        onClick ? "cursor-pointer select-none hover:text-foreground transition-colors" : ""
      } ${className}`}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">{children}</span>
    </th>
  );
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-5 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-black/[0.03] grid place-items-center shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-2xl font-display font-bold text-[var(--ink)] leading-none">
          {value}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </div>
    </div>
  );
}
