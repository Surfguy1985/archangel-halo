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
import { Landmark, Plus, RefreshCw, Unlink, Wallet } from "lucide-react";
import type { ConnectedBank } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { BankAnalysisSection } from "./BankAnalysisSection";

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
    <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[28px_20px] text-center">
      <Landmark className="w-[34px] h-[34px] mx-auto text-muted-foreground mb-[12px]" />
      <div className="font-display font-bold text-[17px]">Connect your business bank</div>
      <p className="text-[13px] text-muted-foreground mt-[6px] mb-[18px]">
        Securely link your bank through Plaid to see live balances and recent
        transactions right here.
      </p>
      <button
        onClick={start}
        disabled={createToken.isPending || exchange.isPending}
        className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_4px_14px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
      >
        <Landmark className="w-[16px] h-[16px]" />
        {createToken.isPending
          ? "Starting…"
          : exchange.isPending
            ? "Finishing…"
            : "Connect bank"}
      </button>
      {linkToken && (
        <PlaidLauncher token={linkToken} onDone={onDone} onExit={() => setLinkToken(null)} />
      )}
    </div>
  );
}

function ConnectedView({ banks }: { banks: ConnectedBank[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const accounts = useListBankAccounts();
  const transactions = useListBankTransactions({ days: 30 });
  const disconnect = useDisconnectBank();
  const createToken = useCreatePlaidLinkToken();
  const exchange = useExchangePlaidPublicToken();
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const busy = accounts.isFetching || transactions.isFetching;
  const multiBank = banks.length > 1;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetBankStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListBankAccountsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListBankAccountsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
  };

  const addBank = () => {
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

  const onAddDone = (publicToken: string, institutionName: string | null) => {
    setLinkToken(null);
    exchange.mutate(
      { data: { publicToken, institutionName } },
      {
        onSuccess: () => {
          invalidateAll();
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

  const onDisconnect = (bank: ConnectedBank) => {
    const label = bank.institutionName || "this bank";
    if (!window.confirm(`Disconnect ${label}? You can reconnect at any time.`)) return;
    disconnect.mutate(
      { params: { bankId: bank.id } },
      {
        onSuccess: () => {
          invalidateAll();
          toast({ title: "Bank disconnected" });
        },
        onError: (err) =>
          toast({
            title: "Couldn't disconnect",
            description: errMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
        {banks.map((b, idx) => (
          <div
            key={b.id}
            className={`flex items-center gap-[8px] py-[10px] ${idx !== 0 ? "border-t border-border" : ""}`}
          >
            <Landmark className="w-[14px] h-[14px] shrink-0 text-muted-foreground" />
            <span className="flex-1 min-w-0 truncate text-[13.5px] font-semibold text-[var(--ink)]">
              {b.institutionName || "Bank"}
            </span>
            <button
              onClick={() => onDisconnect(b)}
              disabled={disconnect.isPending}
              aria-label={`Disconnect ${b.institutionName || "bank"}`}
              className="shrink-0 inline-flex items-center gap-[5px] rounded-[10px] px-[9px] py-[6px] text-[12px] font-display font-bold bg-background border border-border disabled:opacity-40 transition-transform active:scale-[0.98]"
            >
              <Unlink className="w-[13px] h-[13px]" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-[8px]">
        <button
          onClick={addBank}
          disabled={createToken.isPending || exchange.isPending}
          className="flex-1 inline-flex items-center justify-center gap-[6px] rounded-[12px] py-[10px] text-[13px] font-display font-bold text-black bg-[var(--gold-light)] shadow-[var(--shadow)] disabled:opacity-50 transition-transform active:scale-[0.98]"
        >
          <Plus className="w-[14px] h-[14px]" />
          {createToken.isPending
            ? "Starting…"
            : exchange.isPending
              ? "Finishing…"
              : "Add another bank"}
        </button>
        <button
          onClick={refresh}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-[5px] rounded-[12px] px-[12px] py-[10px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] disabled:opacity-40 transition-transform active:scale-[0.98]"
        >
          <RefreshCw className={`w-[13px] h-[13px] ${busy ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      {linkToken && (
        <PlaidLauncher token={linkToken} onDone={onAddDone} onExit={() => setLinkToken(null)} />
      )}

      {accounts.isLoading ? (
        <div className="animate-pulse h-[92px] bg-card rounded-[16px]" />
      ) : accounts.isError ? (
        <div className="rounded-[16px] border border-destructive/40 bg-destructive/5 p-[14px] text-[13px] text-destructive">
          Couldn't load balances: {errMessage(accounts.error)}
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {(accounts.data ?? []).map((a) => (
            <div key={a.accountId} className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px_16px]">
              <div className="flex items-center gap-[7px] mb-[8px]">
                <Wallet className="w-[14px] h-[14px] text-muted-foreground" />
                <span className="font-semibold text-[13.5px] truncate">
                  {a.name}
                  {a.mask ? ` ••${a.mask}` : ""}
                </span>
                {multiBank && a.institutionName && (
                  <span className="ml-auto shrink-0 text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full bg-[var(--gold-tint)] text-[var(--gold-dark)]">
                    {a.institutionName}
                  </span>
                )}
              </div>
              <div className="font-display font-bold text-[26px] tracking-[-0.02em] tabular-nums leading-none">
                {a.availableBalance != null
                  ? money(a.availableBalance)
                  : a.currentBalance != null
                    ? money(a.currentBalance)
                    : "—"}
              </div>
              <div className="text-[11.5px] text-muted-foreground mt-[5px]">
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

      <BankAnalysisSection />

      <div>
        <div className="font-display font-semibold text-[13px] tracking-[0.15em] uppercase text-muted-foreground mb-[8px] mt-[4px]">
          Recent transactions <span className="normal-case tracking-normal font-normal">(30 days)</span>
        </div>
        {transactions.isLoading ? (
          <div className="animate-pulse h-[180px] bg-card rounded-[16px]" />
        ) : transactions.isError ? (
          <div className="rounded-[16px] border border-destructive/40 bg-destructive/5 p-[14px] text-[13px] text-destructive">
            Couldn't load transactions: {errMessage(transactions.error)}
          </div>
        ) : (transactions.data ?? []).length === 0 ? (
          <div className="text-center text-[13px] text-muted-foreground py-[30px]">
            No transactions in the last 30 days.
          </div>
        ) : (
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
            {(transactions.data ?? []).map((t, idx) => (
              <div
                key={t.transactionId}
                className={`flex items-center gap-[10px] py-[11px] text-[14px] ${idx !== 0 ? "border-t border-border" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[7px]">
                    <span className="font-semibold truncate">{t.merchantName || t.name}</span>
                    {t.pending && (
                      <span className="text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full bg-[rgba(143,106,31,0.14)] text-[var(--gold-dark,#8f6a1f)] shrink-0">
                        Pending
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-muted-foreground truncate mt-[2px]">
                    {[
                      fmtDate(t.date),
                      t.category?.toLowerCase(),
                      multiBank ? t.institutionName : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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

  if (isLoading) return <div className="animate-pulse h-48 bg-card rounded-[16px]" />;
  if (!status?.connected) return <ConnectCard />;
  return <ConnectedView banks={status.banks ?? []} />;
}
