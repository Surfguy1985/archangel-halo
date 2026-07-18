import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCategorizeBankTransaction,
  getGetBankAnalysisQueryKey,
  getListExpensesQueryKey,
  getListCrewPaymentsQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  useListCrews,
  useListInvoices,
  type BankAnalysisItem,
} from "@workspace/api-client-react";
import { Receipt, HardHat, FileCheck2, CircleDollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

type Kind = "expense" | "crew" | "invoice" | "other";

const KIND_OPTIONS: { kind: Kind; label: string; icon: React.ReactNode }[] = [
  { kind: "expense", label: "Expense", icon: <Receipt className="w-[15px] h-[15px]" /> },
  { kind: "crew", label: "Crew pay", icon: <HardHat className="w-[15px] h-[15px]" /> },
  {
    kind: "invoice",
    label: "Invoice paid",
    icon: <FileCheck2 className="w-[15px] h-[15px]" />,
  },
  {
    kind: "other",
    label: "Other",
    icon: <CircleDollarSign className="w-[15px] h-[15px]" />,
  },
];

const TAB_LABEL: Record<Kind, string> = {
  expense: "Expenses",
  crew: "Crew Pay",
  invoice: "Invoices",
  other: "Transfers & other",
};

export function CategorizeTxnSheet({
  item,
  initialKind,
  onOpenChange,
}: {
  item: BankAnalysisItem | null;
  initialKind: Kind;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const categorize = useCategorizeBankTransaction();
  const { data: crews } = useListCrews();
  const { data: invoices } = useListInvoices();

  const [kind, setKind] = useState<Kind>(initialKind);
  const [category, setCategory] = useState("");
  const [crewId, setCrewId] = useState("");
  const [personName, setPersonName] = useState("");
  const [invoiceId, setInvoiceId] = useState("");

  useEffect(() => {
    if (item) {
      setKind(initialKind);
      setCategory(item.category ?? "");
      setCrewId(item.crewId ?? "");
      setPersonName(item.personName ?? "");
      setInvoiceId(item.invoiceId ?? "");
    }
  }, [item, initialKind]);

  const openInvoices = (invoices ?? []).filter((inv) => inv.status !== "paid");

  const submit = () => {
    if (!item) return;
    categorize.mutate(
      {
        params: { days: 30 },
        data: {
          transactionId: item.transactionId,
          kind,
          category: kind === "expense" ? category.trim() || null : null,
          crewId: kind === "crew" ? crewId || null : null,
          personName: kind === "crew" && !crewId ? personName.trim() || null : null,
          invoiceId: kind === "invoice" ? invoiceId || null : null,
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetBankAnalysisQueryKey({ days: 30 }), updated);
          queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListCrewPaymentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          toast({
            title:
              kind === "other"
                ? "Moved to Transfers & other"
                : `Added under ${TAB_LABEL[kind]}`,
            description:
              kind === "other"
                ? "This one won't be copied into your books."
                : `${item.name} · ${money(item.amount)}`,
          });
          onOpenChange(false);
        },
        onError: (err: any) =>
          toast({
            title: "Couldn't update this transaction",
            description: err?.data?.error ?? "Please try again in a moment.",
            variant: "destructive",
          }),
      },
    );
  };

  const needsInvoice = kind === "invoice" && !invoiceId;

  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[22px] max-h-[85dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display">Categorize transaction</SheetTitle>
        </SheetHeader>
        {item && (
          <div className="flex flex-col gap-[14px] pt-[8px] pb-[10px]">
            <div className="bg-card border border-border rounded-[13px] p-[12px_14px] shadow-[var(--shadow)]">
              <div className="font-semibold text-[14px] truncate">{item.name}</div>
              <div className="text-[12.5px] text-muted-foreground mt-[2px]">
                {money(item.amount)}
                {item.date ? ` · ${item.date}` : ""}
              </div>
            </div>

            <div>
              <div className="text-[12px] font-display font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-[7px]">
                What is this?
              </div>
              <div className="grid grid-cols-2 gap-[8px]">
                {KIND_OPTIONS.map((opt) => (
                  <button
                    key={opt.kind}
                    onClick={() => setKind(opt.kind)}
                    className={`flex items-center gap-[7px] rounded-[13px] border px-[12px] py-[11px] text-[13.5px] font-display font-bold transition-colors ${
                      kind === opt.kind
                        ? "bg-[var(--ink)] text-[var(--paper,#f5f1e8)] border-[var(--ink)]"
                        : "bg-card border-border text-foreground"
                    }`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {kind === "expense" && (
              <input
                className={fieldCls}
                placeholder="Category (e.g. Materials, Fuel, Supplies)"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            )}

            {kind === "crew" && (
              <>
                <select
                  className={fieldCls}
                  value={crewId}
                  onChange={(e) => setCrewId(e.target.value)}
                >
                  <option value="">Someone new (use name below)</option>
                  {(crews ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {!crewId && (
                  <input
                    className={fieldCls}
                    placeholder="Person's name"
                    value={personName}
                    onChange={(e) => setPersonName(e.target.value)}
                  />
                )}
              </>
            )}

            {kind === "invoice" && (
              <>
                <select
                  className={fieldCls}
                  value={invoiceId}
                  onChange={(e) => setInvoiceId(e.target.value)}
                >
                  <option value="">Pick the invoice this deposit paid…</option>
                  {openInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNo} · {money(inv.amount)}
                    </option>
                  ))}
                </select>
                {openInvoices.length === 0 && (
                  <div className="text-[12.5px] text-muted-foreground">
                    No unpaid invoices to match. Create the invoice first, then come back.
                  </div>
                )}
              </>
            )}

            <button
              onClick={submit}
              disabled={categorize.isPending || needsInvoice}
              className="w-full rounded-[13px] bg-[var(--ink)] text-[var(--paper,#f5f1e8)] font-display font-bold text-[14.5px] py-[13px] shadow-[var(--shadow)] disabled:opacity-40 transition-transform active:scale-[0.99]"
            >
              {categorize.isPending
                ? "Saving…"
                : kind === "other"
                  ? "Move to Transfers & other"
                  : `Save & add under ${TAB_LABEL[kind]}`}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
