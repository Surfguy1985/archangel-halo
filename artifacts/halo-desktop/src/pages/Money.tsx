import { useEffect, useMemo, useState} from "react";
import { useLocation, useSearch} from "wouter";
import { useQueryClient} from "@tanstack/react-query";
import {
  useGetMoneySummary,
  useListInvoices,
  useListExpenses,
  useListCrewPayments,
  useRemindInvoice,
  useUpdateCrewPayment,
  useListJobs,
  getListJobsQueryKey,
  usePayExpenseBill,
  useApproveExpense,
  useRejectExpense,
  getListExpensesQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  getListCrewPaymentsQueryKey,
  type Invoice,
} from "@workspace/api-client-react";
import { Skeleton} from "@/components/ui/skeleton";
import { Card, CardContent} from "@/components/ui/card";
import { Button} from "@/components/ui/button";
import { Badge} from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  Plus,
  Download,
  ChevronRight,
  Send,
  BellRing,
  CreditCard,
  Check,
  Building2,
  Smartphone,
  FileUp,
  Paperclip,
  Landmark,
  ThumbsUp,
  ThumbsDown,
  ScanLine,
  MoreHorizontal,
  Search,
  ChevronDown,
  Pencil,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast} from "@/hooks/use-toast";
import { exportCsv} from "@/lib/exportCsv";
import {
  RecordPaymentDialog,
  AddExpenseDialog,
  AddCrewPaymentDialog,
} from "@/components/MoneyDialogs";
import { SendInvoiceDialog} from "@/components/SendInvoiceDialog";
import { ScanCheckDialog} from "@/components/ScanCheckDialog";
import { BankTab} from "@/components/BankTab";
import { ZellePayDialog} from "@/components/ZellePayDialog";
import { BusinessInfoDialog} from "@/components/BusinessInfoDialog";
import { BusinessReportTab} from "@/components/BusinessReportTab";
import { BooksTab} from "@/components/BooksTab";
import { CheckFilesTab} from "@/components/CheckFilesTab";
import { Link} from "wouter";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0});

const todayLocal = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric"});
};

const statusColor: Record<string, string> = {
  paid: "bg-[var(--primary)] text-black",
  past_due: "bg-rose-100 text-rose-900",
  sent: "bg-[var(--secondary)] text-white",
  draft: "bg-gray-100 text-gray-800",
};
const statusLabel: Record<string, string> = {
  paid: "Paid",
  past_due: "Past due",
  sent: "Pending",
  draft: "Draft",
};

type InvoiceFilter = "all" | "sent" | "past_due" | "paid" | "draft";

const invoiceFilters: { key: InvoiceFilter; label: string}[] = [
  { key: "all", label: "All"},
  { key: "sent", label: "Pending"},
  { key: "past_due", label: "Overdue"},
  { key: "paid", label: "Paid"},
  { key: "draft", label: "Drafts"},
];

function SummaryCards() {
  const { data: summary, isLoading} = useGetMoneySummary();
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {Array.from({ length: 4}).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-none" />
        ))}
      </div>
    );
 }
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      <Card className="bg-[var(--primary)] text-black border-none shadow-sm rounded-2xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4 opacity-90 text-black">
            <ArrowDownRight className="w-5 h-5" />
            <span className="font-semibold text-sm">Landing (Owed)</span>
          </div>
          <div className="text-4xl font-display font-bold">
            {money(summary?.landing ?? 0)}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-rose-100 text-rose-900 border-none shadow-sm rounded-2xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4 opacity-90 text-rose-900">
            <AlertCircle className="w-5 h-5" />
            <span className="font-semibold text-sm">At Risk</span>
          </div>
          <div className="text-4xl font-display font-bold">
            {money(summary?.atRisk ?? 0)}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[var(--secondary)] text-white border-none shadow-sm rounded-2xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4 text-white/80">
            <ArrowUpRight className="w-5 h-5" />
            <span className="font-semibold text-sm">MTD Revenue</span>
          </div>
          <div className="text-4xl font-display font-bold text-white">
            {money(summary?.mtd ?? 0)}
          </div>
          <div className="mt-2 text-sm font-medium text-[var(--primary)]">
            {summary?.marginPct}% {summary?.bankConnected ? "Cash margin" : "Margin"}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[var(--secondary)] text-white border-none shadow-sm rounded-2xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4 text-white/80">
            <CreditCard className="w-5 h-5" />
            <span className="font-semibold text-sm">
              {summary?.bankConnected ? "Spent MTD" : "Collected MTD"}
            </span>
          </div>
          <div className="text-4xl font-display font-bold text-white">
            {money(
              summary?.bankConnected
                ? summary?.spentMtd ?? 0
                : summary?.collectedMtd ?? 0,
            )}
          </div>
          {summary?.bankConnected && (
            <div className="mt-2 text-xs text-white/60">
              From bank transactions
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AgingReceivables() {
  const { data: summary} = useGetMoneySummary();
  if (!summary) return null;
  return (
    <div>
      <h2 className="text-xl font-display font-bold mb-4 text-[var(--secondary)]">Aging Receivables</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summary.aging.map((bucket, i) => (
          <div key={i} className="p-4 bg-white border border-border">
            <div
              className="h-1.5 rounded-full mb-3"
              style={{ backgroundColor: bucket.color || "var(--muted)"}}
            />
            <span className="text-sm font-medium text-muted-foreground">{bucket.label}</span>
            <div
              className={`font-mono font-bold text-lg mt-1 ${bucket.color ? "text-destructive" : "text-[var(--secondary)]"}`}
            >
              {money(bucket.value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InvoiceStatusBadge({ inv}: { inv: Invoice}) {
  return (
    <span
      className={`text-xs font-bold px-3 py-1 rounded-full shrink-0 ${statusColor[inv.status] || statusColor.draft}`}
    >
      {statusLabel[inv.status] || inv.status}
      {inv.status === "past_due" && inv.daysLate ?` · ${inv.daysLate}d` : ""}
    </span>
  );
}

function InvoiceBrowser({ invoices }: { invoices: Invoice[] }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { data: jobs } = useListJobs(undefined, {
    query: { enabled: open, queryKey: getListJobsQueryKey() },
  });

  const jobById = useMemo(() => {
    const m = new Map<string, { unitNo: string | null; description: string | null; jobNo: string }>();
    for (const j of jobs ?? []) m.set(j.id, { unitNo: j.unitNo ?? null, description: j.description ?? null, jobNo: j.jobNo });
    return m;
  }, [jobs]);

  const grouped = useMemo(() => {
    const props = new Map<string, { name: string; jobs: Map<string, Invoice[]> }>();
    for (const inv of invoices) {
      const pid = inv.propertyId || "unknown";
      let p = props.get(pid);
      if (!p) {
        p = { name: inv.propertyName || "Unknown property", jobs: new Map() };
        props.set(pid, p);
      }
      const jid = inv.jobId || "none";
      const list = p.jobs.get(jid);
      if (list) list.push(inv);
      else p.jobs.set(jid, [inv]);
    }
    return [...props.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [invoices]);

  const q = search.trim().toLowerCase();
  const visible = q ? grouped.filter(([, p]) => p.name.toLowerCase().includes(q)) : grouped;

  return (
    <div className="bg-white rounded-2xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="button-invoice-browser-toggle"
        className="w-full flex items-center justify-between gap-3 px-6 py-3.5 hover:bg-black/5 transition-colors"
      >
        <span className="flex items-center gap-2 font-bold text-sm text-foreground">
          <Search className="w-4 h-4 text-muted-foreground" />
          Find invoices by property
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {invoices.length} invoice{invoices.length === 1 ? "" : "s"} across {grouped.length}{" "}
          propert{grouped.length === 1 ? "y" : "ies"}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-border">
          <div className="px-6 py-3 border-b border-border bg-black/5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search properties…"
              data-testid="input-invoice-browser-search"
              className="w-full max-w-md px-4 py-2 rounded-full border border-border bg-white text-sm outline-none focus:border-[var(--primary)]"
            />
          </div>

          {visible.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              No properties match "{search}".
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[32rem] overflow-y-auto">
              {visible.map(([pid, prop]) => {
                const isOpen = expanded[pid] ?? !!q;
                const invCount = [...prop.jobs.values()].reduce((n, l) => n + l.length, 0);
                return (
                  <div key={pid}>
                    <button
                      onClick={() => setExpanded((e) => ({ ...e, [pid]: !isOpen }))}
                      data-testid={`button-browser-property-${pid}`}
                      className="w-full flex items-center justify-between gap-3 px-6 py-3 hover:bg-black/5 transition-colors"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-display font-bold text-base truncate">{prop.name}</span>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                        {invCount} invoice{invCount === 1 ? "" : "s"}
                        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </span>
                    </button>

                    {isOpen && (
                      <div className="pb-2">
                        {[...prop.jobs.entries()].map(([jid, invs]) => {
                          const job = jid !== "none" ? jobById.get(jid) : undefined;
                          const header =
                            jid === "none"
                              ? "No job linked"
                              : job
                                ? `${job.jobNo}${job.unitNo ? ` · Unit ${job.unitNo}` : ""}${job.description ? ` — ${job.description}` : ""}`
                                : "Job";
                          return (
                            <div key={jid} className="px-6">
                              <div className="pl-6 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
                                {header}
                              </div>
                              {invs.map((inv) => (
                                <button
                                  key={inv.id}
                                  type="button"
                                  onClick={() => navigate(`/invoices/${inv.id}`)}
                                  data-testid={`row-browser-invoice-${inv.id}`}
                                  className="group w-full flex items-center justify-between gap-3 pl-10 pr-2 py-2 rounded-lg cursor-pointer hover:bg-black/5 transition-colors text-left"
                                >
                                  <span className="flex items-center gap-2 min-w-0 text-sm">
                                    <span className="font-mono text-xs text-muted-foreground">{inv.invoiceNo}</span>
                                    <span className="font-bold tabular-nums">{money(inv.amount)}</span>
                                    <span className="text-xs text-muted-foreground truncate">
                                      {inv.dueAt ? `Due ${fmtDate(inv.dueAt)}` : inv.sentAt ? `Sent ${fmtDate(inv.sentAt)}` : "Not sent"}
                                    </span>
                                  </span>
                                  <span className="flex items-center gap-2 shrink-0">
                                    <InvoiceStatusBadge inv={inv} />
                                    {inv.status === "draft" && (
                                      <span className="flex items-center gap-1 text-xs font-semibold text-[var(--secondary)] opacity-70 group-hover:opacity-100">
                                        <Pencil className="w-3 h-3" /> Edit &amp; send
                                      </span>
                                    )}
                                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-[var(--primary)]" />
                                  </span>
                                </button>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Invoices() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast} = useToast();
  const { data: invoices, isLoading} = useListInvoices();
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [payInvoice, setInvoiceToPay] = useState<Invoice | null>(null);
  const [sendInvoice, setInvoiceToSend] = useState<Invoice | null>(null);
  const [businessOpen, setBusinessOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const remind = useRemindInvoice();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey()});
 };

  const sorted = useMemo(
    () =>
      [...(invoices ?? [])].sort(
        (a, b) =>
          new Date(b.sentAt || b.dueAt || 0).getTime() -
          new Date(a.sentAt || a.dueAt || 0).getTime(),
      ),
    [invoices],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sorted.length};
    for (const inv of sorted) c[inv.status] = (c[inv.status] ?? 0) + 1;
    return c;
 }, [sorted]);

  const filtered = filter === "all" ? sorted : sorted.filter((i) => i.status === filter);

  // Organized view: one clickable dropdown per property, newest activity first.
  // The single most-recent invoice flashes lime so new arrivals are unmissable.
  const newestId = useMemo(() => {
    let best: Invoice | null = null;
    for (const inv of filtered) {
      const t = new Date(inv.sentAt ?? inv.dueAt ?? inv.paidAt ?? 0).getTime();
      const bt = best ? new Date(best.sentAt ?? best.dueAt ?? best.paidAt ?? 0).getTime() : -1;
      if (t > bt) best = inv;
    }
    return best?.id ?? null;
  }, [filtered]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: Invoice[] }>();
    for (const inv of filtered) {
      const key = inv.propertyId ?? inv.propertyName ?? "none";
      const g = map.get(key) ?? { key, label: inv.propertyName || "No property", items: [] };
      g.items.push(inv);
      map.set(key, g);
    }
    // Groups ordered by their newest invoice, so fresh activity floats up.
    const stamp = (i: Invoice) => new Date(i.sentAt ?? i.dueAt ?? i.paidAt ?? 0).getTime();
    return [...map.values()].sort(
      (a, b) => Math.max(...b.items.map(stamp)) - Math.max(...a.items.map(stamp)),
    );
  }, [filtered]);

  // null = automatic (only the group holding the newest invoice starts open);
  // once the user clicks, their choices win — but a filter switch changes the
  // whole grouping, so it resets back to automatic or groups can all vanish.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean> | null>(null);
  useEffect(() => setOpenGroups(null), [filter]);
  const newestGroupKey = groups.find((g) => g.items.some((i) => i.id === newestId))?.key;
  const isGroupOpen = (key: string) =>
    // Groups the user hasn't touched (including ones that appear later from a
    // refetch) keep the automatic rule, so the newest invoice stays visible.
    openGroups && key in openGroups ? !!openGroups[key] : newestGroupKey === key;
  const toggleGroup = (key: string) =>
    setOpenGroups((cur) => {
      const base =
        cur ??
        Object.fromEntries(groups.map((g) => [g.key, isGroupOpen(g.key)]));
      return { ...base, [key]: !base[key] };
    });

  const onExport = () => {
    exportCsv(
     `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { key: "invoiceNo", label: "Invoice #"},
        { key: "propertyName", label: "Property"},
        { key: "amount", label: "Amount"},
        { key: "status", label: "Status"},
        { key: "sentAt", label: "Sent"},
        { key: "dueAt", label: "Due"},
        { key: "paidAt", label: "Paid"},
      ],
      sorted.map((inv) => ({
        invoiceNo: inv.invoiceNo,
        propertyName: inv.propertyName || "",
        amount: inv.amount,
        status: statusLabel[inv.status] || inv.status,
        sentAt: fmtDate(inv.sentAt),
        dueAt: fmtDate(inv.dueAt),
        paidAt: fmtDate(inv.paidAt),
     })),
    );
 };

  return (
    <div className="space-y-4">
      <InvoiceBrowser invoices={sorted} />
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {invoiceFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-colors ${
                filter === f.key
                  ? "bg-[var(--primary)] text-black shadow-sm"
                  : "bg-[var(--secondary)] text-white hover:opacity-90"
             }`}
            >
              {f.label}
              <span className="ml-1.5 opacity-60 tabular-nums">
                {f.key === "all" ? counts.all : counts[f.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScanOpen(true)}
            data-testid="button-open-scan-check"
            className="rounded-full text-[var(--secondary)] border-border px-4"
          >
            <ScanLine className="w-4 h-4 mr-1.5" /> Scan check
          </Button>
          <Button size="sm" onClick={() => navigate("/invoices/new")} className="bg-[var(--primary)] hover:opacity-90 text-black rounded-full px-4 font-bold">
            <Plus className="w-4 h-4 mr-1.5" /> New invoice
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="px-3 rounded-full border-border"
                aria-label="More actions"
                data-testid="button-invoices-overflow"
              >
                <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-none">
              <DropdownMenuItem onSelect={() => setBusinessOpen(true)}>
                <Building2 className="w-4 h-4 mr-2" /> Business info
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onExport} disabled={!sorted.length}>
                <Download className="w-4 h-4 mr-2" /> Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border text-muted-foreground bg-white rounded-2xl">
          No invoices in this view.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const open = isGroupOpen(g.key);
            const unpaid = g.items.filter((i) => i.status !== "paid" && i.status !== "cancelled").length;
            return (
              <div key={g.key} className="bg-white rounded-2xl border border-border overflow-hidden" data-testid={`invoice-group-${g.key}`}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  className="w-full grid grid-cols-[1fr_auto_auto] items-center gap-4 px-6 py-4 text-left hover:bg-black/5 transition-colors"
                  data-testid={`invoice-group-toggle-${g.key}`}
                >
                  <div className="min-w-0 flex items-center gap-2.5">
                    <ChevronRight className={`w-5 h-5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-bold text-xl text-foreground truncate">{g.label}</span>
                        {g.items.some((i) => i.id === newestId) && (
                          <span className="shrink-0 rounded-full bg-[var(--gold-light)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">New</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {g.items.length} invoice{g.items.length === 1 ? "" : "s"}
                        {unpaid > 0 ? ` · ${unpaid} open` : " · all settled"}
                      </span>
                    </div>
                  </div>
                  <div className="w-32 text-right">
                    <span className="font-display font-bold text-xl tabular-nums text-foreground">
                      {money(g.items.reduce((s, i) => s + (i.amount ?? 0), 0))}
                    </span>
                  </div>
                  <div className="w-40 pl-4 text-right text-xs font-bold text-muted-foreground">
                    {open ? "Hide" : "Show"}
                  </div>
                </button>

                {open && (
                  <div className="flex flex-col divide-y divide-border border-t border-border">
                    {g.items.map((inv) => {
                      const isNew = inv.id === newestId;
                      return (
                        <div
                          key={inv.id}
                          onClick={() => navigate(`/invoices/${inv.id}`)}
                          className={`group grid grid-cols-[1fr_auto_auto] items-center gap-4 px-6 py-4 cursor-pointer hover:bg-black/5 transition-colors ${isNew ? "card-move-flash m-2 rounded-2xl border-2 border-[var(--gold-light)] bg-[var(--gold-light)]/10" : ""}`}
                          data-testid={`invoice-row-${inv.id}`}
                        >
                          <div className="min-w-0 pl-7">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-bold text-foreground">{inv.invoiceNo}</span>
                              {isNew && (
                                <span className="rounded-full bg-[var(--gold-light)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">Newest</span>
                              )}
                            </div>
                            <span className="block mt-1 text-xs text-muted-foreground">
                              {[
                                inv.sentAt ? `Sent ${fmtDate(inv.sentAt)}` : null,
                                inv.dueAt ? `Due ${fmtDate(inv.dueAt)}` : null,
                                inv.paidAt ? `Paid ${fmtDate(inv.paidAt)}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Not sent yet"}
                            </span>
                          </div>

                          <div className="w-32 text-right">
                            <span className="font-display font-bold text-xl tabular-nums text-foreground">
                              {money(inv.amount)}
                            </span>
                          </div>

                          <div className="w-40 pl-4 flex items-center justify-between">
                            <InvoiceStatusBadge inv={inv} />
                            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-[var(--primary)] transition-colors" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <RecordPaymentDialog
        open={!!payInvoice}
        onOpenChange={(o) => !o && setInvoiceToPay(null)}
        invoice={payInvoice}
      />
      <SendInvoiceDialog
        open={!!sendInvoice}
        onOpenChange={(o) => !o && setInvoiceToSend(null)}
        invoice={sendInvoice}
      />
      <BusinessInfoDialog open={businessOpen} onOpenChange={setBusinessOpen} />
      <ScanCheckDialog open={scanOpen} onOpenChange={setScanOpen} />
    </div>
  );
}

function Expenses() {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: expenses, isLoading} = useListExpenses();
  const [addOpen, setAddOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const payBill = usePayExpenseBill();
  const approve = useApproveExpense();
  const reject = useRejectExpense();

  const invalidateExpenseViews = () => {
    queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey()});
    queryClient.invalidateQueries({ queryKey: ["/accounting"]});
 };

  const doPay = (id: string, vendor: string | null | undefined) =>
    payBill.mutate(
      { id},
      {
        onSuccess: () => {
          invalidateExpenseViews();
          toast({ title:`Paid ${vendor || "bill"}`});
       },
        onError: () => toast({ title: "Couldn't mark that bill paid", variant: "destructive"}),
     },
    );

  const doApprove = (id: string, vendor: string | null | undefined) =>
    approve.mutate(
      { id},
      {
        onSuccess: () => {
          invalidateExpenseViews();
          toast({ title:`Approved ${vendor || "expense"} — it's on the books now`});
       },
        onError: () => toast({ title: "Couldn't approve that expense", variant: "destructive"}),
     },
    );

  const doReject = (id: string, vendor: string | null | undefined) =>
    reject.mutate(
      { id},
      {
        onSuccess: () => {
          invalidateExpenseViews();
          toast({ title:`Rejected ${vendor || "expense"} — it won't count in your numbers`});
       },
        onError: () => toast({ title: "Couldn't reject that expense", variant: "destructive"}),
     },
    );

  const sorted = useMemo(
    () =>
      [...(expenses ?? [])].sort(
        (a, b) => new Date(b.spentOn || 0).getTime() - new Date(a.spentOn || 0).getTime(),
      ),
    [expenses],
  );

  const total = sorted
    .filter((e) => e.approvalStatus !== "rejected")
    .reduce((s, e) => s + e.amount, 0);
  const pendingCount = sorted.filter((e) => e.approvalStatus === "pending").length;

  const onExport = () => {
    exportCsv(
     `expenses-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { key: "vendor", label: "Vendor"},
        { key: "category", label: "Category"},
        { key: "amount", label: "Amount"},
        { key: "spentOn", label: "Date"},
        { key: "source", label: "Source"},
      ],
      sorted.map((e) => ({
        vendor: e.vendor || "",
        category: e.category || "",
        amount: e.amount,
        spentOn: fmtDate(e.spentOn),
        source: e.source || "",
     })),
    );
 };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          {sorted.length} expense{sorted.length === 1 ? "" : "s"} ·{" "}
          <span className="font-semibold text-[var(--ink)]">{money(total)}</span> total
          {pendingCount > 0 && (
            <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--gold-light)]/15 text-[var(--gold-dark)]">
              {pendingCount} awaiting approval
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setBillOpen(true)} data-testid="button-upload-bill">
            <FileUp className="w-4 h-4 mr-1.5" /> Upload bill
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Log expense
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="px-2"
                aria-label="More actions"
                data-testid="button-expenses-overflow"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={onExport} disabled={!sorted.length}>
                <Download className="w-4 h-4 mr-2" /> Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : sorted.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground">
          No expenses logged yet.
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm divide-y divide-border">
          {sorted.map((e) => {
            const isPending = e.approvalStatus === "pending";
            const isRejected = e.approvalStatus === "rejected";
            return (
              <div key={e.id} className={`flex items-center gap-4 p-4 ${isRejected ? "opacity-50" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[var(--ink)] truncate flex items-center gap-1.5">
                    {e.vendor || e.category || "Expense"}
                    {e.unitNo && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--ink)]/8 text-[var(--ink)] shrink-0" data-testid={`expense-unit-${e.id}`}>
                        Unit {e.unitNo}
                      </span>
                    )}
                    {e.receiptPath && (
                      <a
                        href={`/api/storage${e.receiptPath}`}
                        target="_blank"
                        rel="noreferrer"
                        title="View receipt"
                        className="text-[var(--gold-dark)] hover:opacity-70 shrink-0"
                        data-testid={`link-receipt-${e.id}`}
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {[e.category, fmtDate(e.spentOn), e.source].filter(Boolean).join(" · ")}
                    {e.paymentStatus === "open" && e.dueDate ?` · due ${fmtDate(e.dueDate)}` : ""}
                  </div>
                  {e.bankTxnLabel && (
                    <div className="text-[11px] text-emerald-700 truncate mt-0.5 flex items-center gap-1">
                      <Landmark className="w-3 h-3 shrink-0" /> Matched: {e.bankTxnLabel}
                    </div>
                  )}
                </div>
                {isPending && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--gold-light)]/15 text-[var(--gold-dark)] shrink-0">
                    Needs approval
                  </span>
                )}
                {isRejected && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/10 text-muted-foreground shrink-0">
                    Rejected
                  </span>
                )}
                {!isPending && !isRejected && e.paymentStatus === "open" && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 shrink-0">
                    Unpaid bill
                  </span>
                )}
                <div className="font-display font-semibold tabular-nums text-[var(--ink)] shrink-0">
                  {money(e.amount)}
                </div>
                {isPending ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      className="h-7"
                      disabled={approve.isPending || reject.isPending}
                      onClick={() => doApprove(e.id, e.vendor)}
                      data-testid={`button-approve-${e.id}`}
                    >
                      <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      disabled={approve.isPending || reject.isPending}
                      onClick={() => doReject(e.id, e.vendor)}
                      data-testid={`button-reject-${e.id}`}
                    >
                      <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                ) : !isRejected && e.paymentStatus === "open" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0"
                    disabled={payBill.isPending}
                    onClick={() => doPay(e.id, e.vendor)}
                    data-testid={`button-pay-bill-${e.id}`}
                  >
                    Mark paid
                  </Button>
                ) : null}
              </div>
            );
         })}
        </div>
      )}

      <AddExpenseDialog open={addOpen} onOpenChange={setAddOpen} />
      <AddExpenseDialog open={billOpen} onOpenChange={setBillOpen} billMode />
    </div>
  );
}

function CrewPay() {
  const queryClient = useQueryClient();
  const { data: payments, isLoading} = useListCrewPayments();
  const [addOpen, setAddOpen] = useState(false);
  const markPaid = useUpdateCrewPayment();
  const { toast} = useToast();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCrewPaymentsQueryKey()});

  type Payment = NonNullable<typeof payments>[number];
  const [zellePayment, setZellePayment] = useState<Payment | null>(null);

  const { data: jobs } = useListJobs(undefined, {
    query: { queryKey: getListJobsQueryKey() },
  });
  const jobById = useMemo(() => {
    const m = new Map<
      string,
      { jobNo: string; propertyId: string; propertyName: string; unitNo: string | null; service: string }
    >();
    for (const j of jobs ?? [])
      m.set(j.id, {
        jobNo: j.jobNo,
        propertyId: j.propertyId ?? "unknown",
        propertyName: j.propertyName || "Unknown property",
        unitNo: j.unitNo ?? null,
        service: j.category || j.description || "General work",
      });
    return m;
  }, [jobs]);

  // Ledger: property → job (unit / service) → crew payment rows.
  const ledger = useMemo(() => {
    type JobGroup = {
      label: string;
      unitNo: string | null;
      service: string;
      items: Payment[];
    };
    const props = new Map<string, { name: string; jobs: Map<string, JobGroup> }>();
    for (const p of payments ?? []) {
      const job = p.jobId ? jobById.get(p.jobId) : undefined;
      const pid = job?.propertyId ?? "none";
      const pname = job?.propertyName ?? "Not tied to a job";
      let prop = props.get(pid);
      if (!prop) {
        prop = { name: pname, jobs: new Map() };
        props.set(pid, prop);
      }
      const jid = p.jobId && job ? p.jobId : "none";
      let jg = prop.jobs.get(jid);
      if (!jg) {
        jg = {
          label: job ? job.jobNo : "General payments",
          unitNo: job?.unitNo ?? null,
          service: job?.service ?? "",
          items: [],
        };
        prop.jobs.set(jid, jg);
      }
      jg.items.push(p);
    }
    const arr = Array.from(props.entries()).sort((a, b) => {
      if (a[0] === "none") return 1;
      if (b[0] === "none") return -1;
      return a[1].name.localeCompare(b[1].name);
    });
    // crew rows inside each job sorted by crew name
    for (const [, prop] of arr)
      for (const jg of prop.jobs.values())
        jg.items.sort((a, b) => (a.crewName || "").localeCompare(b.crewName || ""));
    return arr;
  }, [payments, jobById]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Record crew payment
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !payments || payments.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground">
          No crew payments yet.
        </div>
      ) : (
        <div className="space-y-4">
          {ledger.map(([pid, prop]) => {
            const allItems = [...prop.jobs.values()].flatMap((jg) => jg.items);
            const pendingTotal = allItems
              .filter((p) => p.status !== "completed")
              .reduce((s, p) => s + p.amount, 0);
            const paidTotal = allItems
              .filter((p) => p.status === "completed")
              .reduce((s, p) => s + p.amount, 0);
            return (
              <div key={pid} className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-5 py-3 bg-[var(--secondary)] text-white">
                  <span className="flex items-center gap-2 font-display font-bold truncate">
                    <Building2 className="w-4 h-4 shrink-0 opacity-70" />
                    {prop.name}
                  </span>
                  <span className="flex items-center gap-4 text-xs font-bold tabular-nums shrink-0">
                    {pendingTotal > 0 && <span className="text-rose-300">{money(pendingTotal)} owed</span>}
                    <span className="opacity-70">{money(paidTotal)} paid</span>
                  </span>
                </div>
                <div className="hidden md:grid grid-cols-[1fr_70px_150px_100px_100px_100px_220px] gap-2 px-5 py-2 border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground bg-black/5">
                  <span>Job / Service</span>
                  <span>Unit</span>
                  <span>Crew</span>
                  <span>Date</span>
                  <span className="text-right">Amount</span>
                  <span>Status</span>
                  <span />
                </div>
                {[...prop.jobs.entries()].map(([jid, jg]) => (
                  <div key={jid} className="border-b border-border last:border-b-0">
                    {jg.items.map((p, i) => {
                      const isDone = p.status === "completed";
                      const dateStr = p.paidAt
                        ? `Paid ${fmtDate(p.paidAt)}`
                        : p.dueOn
                          ? `Due ${fmtDate(p.dueOn)}`
                          : null;
                      return (
                        <div
                          key={p.id}
                          className="grid grid-cols-1 md:grid-cols-[1fr_70px_150px_100px_100px_100px_220px] gap-2 items-center px-5 py-3"
                        >
                          <div className="min-w-0">
                            {i === 0 ? (
                              <>
                                <div className="font-semibold text-sm truncate">{jg.label}</div>
                                {jg.service && (
                                  <div className="text-xs text-muted-foreground truncate">{jg.service}</div>
                                )}
                              </>
                            ) : (
                              <div className="text-xs text-muted-foreground pl-3">〃</div>
                            )}
                          </div>
                          <div className="text-sm font-semibold tabular-nums">
                            {jg.unitNo || <span className="text-muted-foreground">—</span>}
                          </div>
                          <div className="text-sm font-semibold truncate">{p.crewName || "Unassigned crew"}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.paidAt
                              ? fmtDate(p.paidAt)
                              : p.dueOn
                                ? `Due ${fmtDate(p.dueOn)}`
                                : fmtDate(p.createdAt)}
                          </div>
                          <div className="font-display font-bold tabular-nums text-right text-[var(--ink)]">
                            {money(p.amount)}
                          </div>
                          <div>
                            <Badge variant={isDone ? "secondary" : "destructive"} className="text-[10px]">
                              {isDone ? "Paid" : "Pending"}
                            </Badge>
                            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                              {[p.method, dateStr, p.note].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            {!isDone && (
                              <Button size="sm" onClick={() => setZellePayment(p)}>
                                <Smartphone className="w-4 h-4 mr-1.5" /> Pay via Zelle
                              </Button>
                            )}
                            {!isDone && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  markPaid.mutate(
                                    {
                                      id: p.id,
                                      data: {
                                        status: "completed",
                                        paidAt: todayLocal(),
                                     },
                                   },
                                    {
                                      onSuccess: () => {
                                        invalidate();
                                        toast({ title: "Marked paid"});
                                     },
                                   },
                                  )
                               }
                                disabled={markPaid.isPending}
                              >
                                <Check className="w-4 h-4 mr-1.5" /> Mark paid
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                   })}
                  </div>
                ))}
              </div>
            );
         })}
        </div>
      )}

      <AddCrewPaymentDialog open={addOpen} onOpenChange={setAddOpen} />
      <ZellePayDialog
        open={!!zellePayment}
        onOpenChange={(o) => {
          if (!o) setZellePayment(null);
       }}
        payment={zellePayment}
      />
    </div>
  );
}

const MONEY_TABS = ["invoices", "checks", "expenses", "crew", "bank", "aging", "report", "books"];

export default function Money() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const urlTab = new URLSearchParams(search).get("tab");
  const [tab, setTab] = useState(
    urlTab && MONEY_TABS.includes(urlTab) ? urlTab : "invoices",
  );
  useEffect(() => {
    if (urlTab && MONEY_TABS.includes(urlTab)) setTab(urlTab);
 }, [urlTab]);
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 min-h-[100dvh] bg-[var(--background)]">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">Money</h1>
          <p className="text-muted-foreground mt-1">Financial overview and invoicing</p>
        </div>
        <Link href="/money/payments">
          <Button variant="default" className="bg-[var(--secondary)] text-white hover:bg-[var(--secondary)]/90 gap-2 rounded-xl font-bold px-6 py-6 h-auto text-base">
            Pay Hub <ArrowUpRight className="w-5 h-5 text-[var(--primary)]" />
          </Button>
        </Link>
      </header>

      <div data-tour="money-summary">
        <SummaryCards />
      </div>

      <Tabs value={tab} onValueChange={(t) => { setTab(t); setLocation(`/money?tab=${t}`);}} className="space-y-6">
        <TabsList data-tour="money-tabs" className="bg-white border border-border shadow-sm p-1 rounded-none flex flex-wrap h-auto gap-1">
          <TabsTrigger value="invoices" className="rounded-none font-bold text-xs data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white data-[state=active]:shadow-none">Invoices</TabsTrigger>
          <TabsTrigger value="checks" data-testid="tab-checks" className="rounded-none font-bold text-xs data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white data-[state=active]:shadow-none">Checks</TabsTrigger>
          <TabsTrigger value="expenses" className="rounded-none font-bold text-xs data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white data-[state=active]:shadow-none">Expenses</TabsTrigger>
          <TabsTrigger value="crew" className="rounded-none font-bold text-xs data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white data-[state=active]:shadow-none">Crew Pay</TabsTrigger>
          <TabsTrigger value="bank" className="rounded-none font-bold text-xs data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white data-[state=active]:shadow-none">Bank</TabsTrigger>
          <TabsTrigger value="aging" className="rounded-none font-bold text-xs data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white data-[state=active]:shadow-none">Aging</TabsTrigger>
          <TabsTrigger value="report" data-testid="tab-report" className="rounded-none font-bold text-xs data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white data-[state=active]:shadow-none">Report</TabsTrigger>
          <TabsTrigger value="books" data-testid="tab-books" className="rounded-none font-bold text-xs data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white data-[state=active]:shadow-none">Books</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <Invoices />
        </TabsContent>
        <TabsContent value="checks">
          <CheckFilesTab />
        </TabsContent>
        <TabsContent value="expenses">
          <Expenses />
        </TabsContent>
        <TabsContent value="crew">
          <CrewPay />
        </TabsContent>
        <TabsContent value="bank">
          <BankTab />
        </TabsContent>
        <TabsContent value="books">
          <BooksTab />
        </TabsContent>
        <TabsContent value="aging">
          <AgingReceivables />
        </TabsContent>
        <TabsContent value="report">
          <BusinessReportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
