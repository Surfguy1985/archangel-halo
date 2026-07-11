import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePlaidLink } from "react-plaid-link";
import {
  useGetBankStatus,
  useCreatePlaidLinkToken,
  useExchangePlaidPublicToken,
  useListBankAccounts,
  useListBankTransactions,
  useDisconnectBank,
  getGetBankStatusQueryKey,
  getListBankAccountsQueryKey,
  getListBankTransactionsQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Landmark, RefreshCw, Unlink, Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function errMessage(err: unknown): string {
  const anyErr = err as { data?: { error?: string }; message?: string };
  return anyErr?.data?.error || anyErr?.message || "Something went wrong";
}

function PlaidLauncher({
  token,
  onDone,
  onExit,
}: {
  token: string;
  onDone: (publicToken: string, institutionName: string | null) => void;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken: string, metadata: { institution?: { name?: string } | null }) => {
      onDone(publicToken, metadata.institution?.name ?? null);
    },
    onExit: () => onExit(),
  });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return null;
}

function ConnectCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createToken = useCreatePlaidLinkToken();
  const exchange = useExchangePlaidPublicToken();
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const start = () => {
    createToken.mutate(undefined, {
      onSuccess: (data) => setLinkToken(data.linkToken),
      onError: (err) =>
        toast({
          title: "Couldn't start bank connection",
          description: errMessage(err),
          variant: "destructive",
        }),
    });
  };

  const onDone = (publicToken: string, institutionName: string | null) => {
    setLinkToken(null);
    exchange.mutate(
      { data: { publicToken, institutionName } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBankStatusQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListBankAccountsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
          toast({ title: "Bank connected" });
        },
        onError: (err) =>
          toast({
            title: "Bank connection failed",
            description: errMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="p-12 text-center border border-dashed border-border rounded-xl space-y-4">
      <Landmark className="w-10 h-10 mx-auto text-muted-foreground" />
      <div>
        <div className="font-display font-bold text-lg text-[var(--ink)]">
          Connect your business bank
        </div>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Securely link your bank through Plaid to see live account balances and recent
          transactions right here.
        </p>
      </div>
      <Button onClick={start} disabled={createToken.isPending || exchange.isPending}>
        <Landmark className="w-4 h-4 mr-1.5" />
        {createToken.isPending
          ? "Starting…"
          : exchange.isPending
            ? "Finishing…"
            : "Connect bank"}
      </Button>
      {linkToken && (
        <PlaidLauncher token={linkToken} onDone={onDone} onExit={() => setLinkToken(null)} />
      )}
    </div>
  );
}

function ConnectedView({ institutionName }: { institutionName: string | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const accounts = useListBankAccounts();
  const transactions = useListBankTransactions({ days: 30 });
  const disconnect = useDisconnectBank();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListBankAccountsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
  };

  const onDisconnect = () => {
    if (!window.confirm("Disconnect this bank? You can reconnect at any time.")) return;
    disconnect.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBankStatusQueryKey() });
        queryClient.removeQueries({ queryKey: getListBankAccountsQueryKey() });
        queryClient.removeQueries({ queryKey: getListBankTransactionsQueryKey() });
        toast({ title: "Bank disconnected" });
      },
      onError: (err) =>
        toast({
          title: "Couldn't disconnect",
          description: errMessage(err),
          variant: "destructive",
        }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Landmark className="w-4 h-4" />
          <span>
            Connected to{" "}
            <span className="font-semibold text-[var(--ink)]">
              {institutionName || "your bank"}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={accounts.isFetching || transactions.isFetching}
          >
            <RefreshCw
              className={`w-4 h-4 mr-1.5 ${accounts.isFetching || transactions.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={onDisconnect} disabled={disconnect.isPending}>
            <Unlink className="w-4 h-4 mr-1.5" /> Disconnect
          </Button>
        </div>
      </div>

      {accounts.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : accounts.isError ? (
        <div className="p-6 border border-destructive/40 bg-destructive/5 rounded-xl text-sm text-destructive">
          Couldn't load balances: {errMessage(accounts.error)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(accounts.data ?? []).map((a) => (
            <div key={a.accountId} className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm text-[var(--ink)] truncate">
                  {a.name}
                  {a.mask ? ` ••${a.mask}` : ""}
                </span>
              </div>
              <div className="text-2xl font-mono font-bold tracking-tight text-[var(--ink)]">
                {a.availableBalance != null
                  ? money(a.availableBalance)
                  : a.currentBalance != null
                    ? money(a.currentBalance)
                    : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {a.availableBalance != null ? "Available" : "Current"}
                {a.availableBalance != null &&
                  a.currentBalance != null &&
                  a.currentBalance !== a.availableBalance && (
                    <> · {money(a.currentBalance)} current</>
                  )}
                {a.subtype ? ` · ${a.subtype}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="font-display font-bold text-[var(--ink)] mb-2">
          Recent transactions <span className="text-muted-foreground font-normal text-sm">(30 days)</span>
        </div>
        {transactions.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : transactions.isError ? (
          <div className="p-6 border border-destructive/40 bg-destructive/5 rounded-xl text-sm text-destructive">
            Couldn't load transactions: {errMessage(transactions.error)}
          </div>
        ) : (transactions.data ?? []).length === 0 ? (
          <div className="p-8 text-center border border-dashed border-border rounded-xl text-muted-foreground text-sm">
            No transactions in the last 30 days.
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border shadow-sm divide-y divide-border">
            {(transactions.data ?? []).map((t) => (
              <div key={t.transactionId} className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[var(--ink)] truncate">
                    {t.merchantName || t.name}
                    {t.pending && (
                      <Badge variant="secondary" className="ml-2 text-[10px] uppercase">
                        Pending
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {[fmtDate(t.date), t.category?.toLowerCase()].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div
                  className={`font-display font-semibold tabular-nums shrink-0 ${
                    t.amount < 0 ? "text-[#3c7a4e]" : "text-[var(--ink)]"
                  }`}
                >
                  {t.amount < 0 ? `+${money(Math.abs(t.amount))}` : `-${money(t.amount)}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function BankTab() {
  const { data: status, isLoading } = useGetBankStatus();

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!status?.connected) return <ConnectCard />;
  return <ConnectedView institutionName={status.institutionName ?? null} />;
}
