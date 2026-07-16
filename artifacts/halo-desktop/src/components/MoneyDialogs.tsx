import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRecordPayment,
  useCreateExpense,
  useCreateCrewPayment,
  useListProperties,
  useListCrews,
  getListInvoicesQueryKey,
  getGetInvoiceQueryKey,
  getGetMoneySummaryQueryKey,
  getListExpensesQueryKey,
  getListCrewPaymentsQueryKey,
  getGetPropertyQueryKey,
  type Invoice,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function todayLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const record = useRecordPayment();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("check");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && invoice) {
      setAmount(String(invoice.amount));
      setMethod("check");
      setError(null);
    }
  }, [open, invoice]);

  const submit = () => {
    if (!invoice) return;
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    record.mutate(
      { data: { invoiceId: invoice.id, amount: amountNum, method: method || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoice.id) });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          onOpenChange(false);
          toast({
            title: "Payment recorded",
            description: `${invoice.invoiceNo} marked paid.`,
          });
        },
        onError: (err: unknown) => {
          setError(
            (err as { data?: { error?: string } })?.data?.error ||
              "Couldn't record payment.",
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {invoice ? `${invoice.invoiceNo} · ${invoice.propertyName || "—"}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount</Label>
            <Input
              id="pay-amount"
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="ach">ACH / Bank transfer</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={record.isPending}>
            {record.isPending ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddExpenseDialog({
  open,
  onOpenChange,
  propertyId: fixedPropertyId,
  jobId: fixedJobId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId?: string;
  jobId?: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateExpense();
  const { data: properties } = useListProperties();
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setVendor("");
      setCategory("");
      setAmount("");
      setPropertyId(fixedPropertyId ?? "");
      setError(null);
    }
  }, [open, fixedPropertyId]);

  const submit = () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    create.mutate(
      {
        data: {
          amount: amountNum,
          vendor: vendor.trim() || undefined,
          category: category.trim() || undefined,
          propertyId: (fixedPropertyId ?? propertyId) || undefined,
          jobId: fixedJobId || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          if (propertyId) {
            queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          }
          onOpenChange(false);
          toast({ title: "Expense logged" });
        },
        onError: (err: unknown) => {
          setError(
            (err as { data?: { error?: string } })?.data?.error ||
              "Couldn't log expense.",
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log expense</DialogTitle>
          <DialogDescription>Record a cost against the business.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="exp-vendor">Vendor</Label>
            <Input
              id="exp-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Home Depot"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="exp-category">Category</Label>
              <Input
                id="exp-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Materials"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-amount">Amount</Label>
              <Input
                id="exp-amount"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          {fixedPropertyId ? (
            <div className="space-y-1.5">
              <Label>Property</Label>
              <div className="text-sm font-medium py-2 px-3 rounded-md border border-border bg-black/[0.03]">
                {(properties ?? []).find((p) => p.id === fixedPropertyId)?.name ?? "This property"}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Property (optional)</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger>
                  <SelectValue placeholder="No property" />
                </SelectTrigger>
                <SelectContent>
                  {(properties ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Log expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddCrewPaymentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCrewPayment();
  const { data: crews } = useListCrews();
  const [crewId, setCrewId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("check");
  const [status, setStatus] = useState("pending");
  const [note, setNote] = useState("");
  const [dueOn, setDueOn] = useState(todayLocal());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCrewId("");
      setAmount("");
      setMethod("check");
      setStatus("pending");
      setNote("");
      setDueOn(todayLocal());
      setError(null);
    }
  }, [open]);

  const submit = () => {
    if (!crewId) {
      setError("Select a crew.");
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    create.mutate(
      {
        data: {
          crewId,
          amount: amountNum,
          method: method || undefined,
          status,
          note: note.trim() || undefined,
          dueOn: status === "completed" ? undefined : dueOn || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrewPaymentsQueryKey() });
          onOpenChange(false);
          toast({ title: "Crew payment recorded" });
        },
        onError: (err: unknown) => {
          setError(
            (err as { data?: { error?: string } })?.data?.error ||
              "Couldn't record crew payment.",
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record crew payment</DialogTitle>
          <DialogDescription>Pay or schedule a payout to a crew.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Crew</Label>
            <Select value={crewId} onValueChange={setCrewId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a crew" />
              </SelectTrigger>
              <SelectContent>
                {(crews ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="crew-amount">Amount</Label>
              <Input
                id="crew-amount"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="ach">ACH / Bank transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {status !== "completed" && (
              <div className="space-y-1.5">
                <Label htmlFor="crew-due">Due on</Label>
                <Input
                  id="crew-due"
                  type="date"
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crew-note">Note (optional)</Label>
            <Input
              id="crew-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Job reference, etc."
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
