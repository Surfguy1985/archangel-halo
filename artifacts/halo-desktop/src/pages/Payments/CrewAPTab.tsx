import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCrewInvoiceQueue,
  useReviewCrewInvoice,
  CrewInvoiceQueueItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Clock,
  Search,
  ScanLine,
} from "lucide-react";
import { ScanInvoiceDialog } from "./ScanInvoiceDialog";

// ─── helpers ────────────────────────────────────────────────────────────────

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function ageDays(createdAt?: string | null): number {
  if (!createdAt) return 0;
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "submitted", label: "Needs Review" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "needs_corrections", label: "Sent Back" },
] as const;

type StatusFilter = "" | "submitted" | "approved" | "needs_corrections" | "paid";

function StatusBadge({ status }: { status: string }) {
  if (status === "submitted")
    return (
      <Badge className="bg-blue-100 text-blue-800 border-none hover:bg-blue-100 text-[10px] rounded-full shadow-none">
        Needs Review
      </Badge>
    );
  if (status === "approved")
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-none hover:bg-emerald-100 text-[10px] rounded-full shadow-none">
        Approved
      </Badge>
    );
  if (status === "paid")
    return (
      <Badge className="bg-black/[0.06] text-muted-foreground border-none hover:bg-black/[0.06] text-[10px] rounded-full shadow-none">
        Paid
      </Badge>
    );
  if (status === "needs_corrections")
    return (
      <Badge className="bg-red-100 text-red-800 border-none hover:bg-red-100 text-[10px] rounded-full shadow-none">
        Sent Back
      </Badge>
    );
  return <Badge className="text-[10px] rounded-full shadow-none">{status}</Badge>;
}

// ─── Summary strip ───────────────────────────────────────────────────────────

function SummaryStrip({ invoices }: { invoices: CrewInvoiceQueueItem[] }) {
  const needsReview = invoices.filter((i) => i.status === "submitted");
  const approved = invoices.filter((i) => i.status === "approved");

  const awaitingApproval = needsReview.reduce((s, i) => s + i.total, 0);
  const approvedUnpaid = approved.reduce((s, i) => s + i.total, 0);

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-white border border-border rounded-2xl p-5">
        <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
          Needs Review
        </div>
        <div className="text-2xl font-display font-bold text-[var(--secondary)]">
          {needsReview.length}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{money(awaitingApproval)} pending</div>
      </div>
      <div className="bg-white border border-border rounded-2xl p-5">
        <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
          Approved — Unpaid
        </div>
        <div className="text-2xl font-display font-bold text-[var(--secondary)]">
          {approved.length}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{money(approvedUnpaid)} owed</div>
      </div>
      <div className="bg-white border border-border rounded-2xl p-5">
        <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
          Overdue (&gt;3 days)
        </div>
        <div className="text-2xl font-display font-bold text-amber-600">
          {
            invoices.filter(
              (i) => i.status === "submitted" && ageDays(i.createdAt) > 3,
            ).length
          }
        </div>
        <div className="text-xs text-muted-foreground mt-1">waiting &gt; 3 days</div>
      </div>
    </div>
  );
}

// ─── Send-back dialog ────────────────────────────────────────────────────────

function SendBackDialog({
  invoice,
  open,
  onOpenChange,
  onInvalidate,
}: {
  invoice: CrewInvoiceQueueItem;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onInvalidate: () => void;
}) {
  const [note, setNote] = useState("");
  const review = useReviewCrewInvoice();
  const { toast } = useToast();

  const handleSend = () => {
    if (!note.trim()) return;
    review.mutate(
      { id: invoice.id, data: { action: "send_back", note } },
      {
        onSuccess: () => {
          onInvalidate();
          toast({ title: "Invoice sent back for corrections" });
          onOpenChange(false);
          setNote("");
        },
        onError: (err) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] border-none shadow-xl rounded-3xl bg-[var(--background)]">
        <DialogHeader>
          <DialogTitle className="text-xl font-display font-bold text-[var(--secondary)] flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> Send back for corrections
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Crew <strong>{invoice.crewName}</strong> will see this note and must resubmit.
          </p>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Note (required)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What needs to be corrected?"
              className="rounded-xl border-border bg-white h-11"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full px-6">
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!note.trim() || review.isPending}
            className="rounded-full bg-amber-500 text-white font-bold hover:bg-amber-600 px-6"
          >
            {review.isPending ? "Sending…" : "Send back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invoice row ─────────────────────────────────────────────────────────────

function InvoiceRow({
  inv,
  onInvalidate,
}: {
  inv: CrewInvoiceQueueItem;
  onInvalidate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const review = useReviewCrewInvoice();
  const { toast } = useToast();
  const age = ageDays(inv.createdAt);
  const isOverdue = inv.status === "submitted" && age > 3;

  const handleAction = (action: "approve" | "mark_paid") => {
    review.mutate(
      { id: inv.id, data: { action } },
      {
        onSuccess: () => {
          onInvalidate();
          toast({
            title:
              action === "approve"
                ? "Invoice approved"
                : "Invoice marked paid",
          });
        },
        onError: (err) =>
          toast({ title: "Action failed", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <>
      <div
        className={`group ${isOverdue ? "bg-amber-50/60" : "bg-white hover:bg-[var(--background)]"} transition-colors`}
        data-testid={`row-ap-${inv.id}`}
      >
        {/* Main row */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full text-left p-4 flex items-center gap-4"
          aria-expanded={expanded}
        >
          <span className="text-muted-foreground shrink-0">
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </span>

          {/* Crew + job */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-semibold text-[var(--secondary)] text-sm">{inv.crewName}</span>
              <StatusBadge status={inv.status} />
              {isOverdue && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
                  <Clock className="w-3 h-3" /> {age}d
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {inv.jobLabel || inv.propertyAddress || "—"}
              {inv.invoiceNo ? ` · #${inv.invoiceNo}` : ""}
              {" · "}
              {inv.items.length} line item{inv.items.length !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Date */}
          <div className="text-xs text-muted-foreground shrink-0 hidden sm:block w-24 text-right">
            {inv.createdAt
              ? new Date(inv.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              : "—"}
          </div>

          {/* Amount */}
          <div className="font-display font-bold text-base tabular-nums text-[var(--secondary)] shrink-0 w-28 text-right">
            {money(inv.total)}
          </div>

          {/* Actions — only for actionable statuses */}
          {(inv.status === "submitted" || inv.status === "approved") && (
            <div
              className="flex items-center gap-1.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {inv.status === "submitted" && (
                <>
                  <button
                    type="button"
                    onClick={() => handleAction("approve")}
                    disabled={review.isPending}
                    className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors disabled:opacity-50"
                    data-testid={`btn-approve-${inv.id}`}
                  >
                    <CheckCircle2 className="w-3 h-3 inline mr-1" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendBackOpen(true)}
                    disabled={review.isPending}
                    className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-50"
                    data-testid={`btn-sendback-${inv.id}`}
                  >
                    Send Back
                  </button>
                </>
              )}
              {inv.status === "approved" && (
                <button
                  type="button"
                  onClick={() => handleAction("mark_paid")}
                  disabled={review.isPending}
                  className="px-3 py-1 rounded-full text-xs font-bold bg-[var(--secondary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  data-testid={`btn-paid-${inv.id}`}
                >
                  Mark Paid
                </button>
              )}
            </div>
          )}
        </button>

        {/* Expanded line items */}
        {expanded && (
          <div className="border-t border-border bg-[var(--background)] px-6 pb-4 pt-3">
            {inv.adminNote && (
              <div className="mb-3 text-sm italic text-[var(--secondary)] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                "{inv.adminNote}"
              </div>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left pb-2 font-medium">Date</th>
                  <th className="text-left pb-2 font-medium">Unit</th>
                  <th className="text-left pb-2 font-medium">Work</th>
                  <th className="text-right pb-2 font-medium">Qty</th>
                  <th className="text-right pb-2 font-medium">Rate</th>
                  <th className="text-right pb-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inv.items.map((it) => (
                  <tr key={it.id} className="text-[var(--secondary)]">
                    <td className="py-2">{it.dateOfWork}</td>
                    <td className="py-2">{it.unitNo || "—"}</td>
                    <td className="py-2 max-w-[200px] truncate">{it.typeOfWork}</td>
                    <td className="py-2 text-right tabular-nums">{it.qty}</td>
                    <td className="py-2 text-right tabular-nums">{money(it.unitPrice)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold">{money(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-bold text-[var(--secondary)]">
                  <td colSpan={5} className="pt-2 text-right">Total</td>
                  <td className="pt-2 text-right tabular-nums">{money(inv.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <SendBackDialog
        invoice={inv}
        open={sendBackOpen}
        onOpenChange={setSendBackOpen}
        onInvalidate={onInvalidate}
      />
    </>
  );
}

// ─── Main tab ────────────────────────────────────────────────────────────────

export function CrewAPTab() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [search, setSearch] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const qc = useQueryClient();

  // Fetch — pass server-side status filter; do client-side search to avoid debounce complexity
  const { data: raw, isLoading } = useGetCrewInvoiceQueue(
    statusFilter ? { status: statusFilter } : undefined,
  );

  // Client-side search on top of server-side status filter
  const invoices = useMemo(() => {
    if (!raw) return [];
    const q = search.trim().toLowerCase();
    return q ? raw.filter((i) => i.crewName.toLowerCase().includes(q)) : raw;
  }, [raw, search]);

  // Invalidate ALL cached queue variants so every filter view and summary strip
  // stays consistent — the row may have moved to a different status bucket.
  const handleInvalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/crew-invoice-queue"] });
  };

  return (
    <>
    <ScanInvoiceDialog open={scanOpen} onOpenChange={setScanOpen} />
    <div className="space-y-6">
      {/* Header with scan button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          All crew invoices submitted through the portal or scanned by the office.
        </p>
        <Button
          onClick={() => setScanOpen(true)}
          className="rounded-full bg-[var(--secondary)] text-white font-bold text-xs px-5 hover:opacity-90 flex items-center gap-2"
          data-testid="btn-scan-invoice"
        >
          <ScanLine className="w-4 h-4" /> Scan invoice
        </Button>
      </div>

      {/* Summary strip */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl bg-muted" />
          ))}
        </div>
      ) : (
        <SummaryStrip invoices={raw ?? []} />
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value as StatusFilter)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                statusFilter === f.value
                  ? "bg-[var(--secondary)] text-white"
                  : "bg-white border border-border text-muted-foreground hover:border-[var(--secondary)] hover:text-[var(--secondary)]"
              }`}
              data-testid={`filter-${f.value || "all"}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative sm:ml-auto w-full sm:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search crew…"
            className="pl-8 h-9 rounded-full border-border bg-white text-xs"
          />
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl bg-muted" />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-2xl bg-white text-muted-foreground text-sm">
          {search || statusFilter
            ? "No invoices match your filters."
            : "No crew invoices yet. They appear here once crews submit through their portal."}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-border shadow-sm divide-y divide-border overflow-hidden">
          {invoices.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} onInvalidate={handleInvalidate} />
          ))}
        </div>
      )}
    </div>
    </>
  );
}
