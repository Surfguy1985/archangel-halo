import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPayHubOverview,
  useListPaymentRequests,
  useCreatePaymentRequest,
  useDeletePaymentRequest,
  useSendPaymentRequest,
  useReturnPaymentRequest,
  useGetPayoutDistribution,
  useListCrewPayouts,
  useCreateCrewPayout,
  useReturnCrewPayout,
  useExtractPaymentInfo,
  useListJobs,
  useListProperties,
  getGetPayHubOverviewQueryKey,
  getListPaymentRequestsQueryKey,
  getListCrewPayoutsQueryKey,
  getGetPayoutDistributionQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  type PaymentRequestDetail,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { prepareScanImage } from "@/lib/scanImage";
import {
  ArrowLeft,
  Plus,
  CheckCircle2,
  AlertCircle,
  Scan,
  Send,
  Mail,
  MessageSquare,
  Copy,
  Check,
  Shield,
  Clock,
  DollarSign,
  Users,
  FileText,
  Loader2,
  XCircle,
  ChevronRight,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLocation } from "wouter";

const fmtMoney = (n: number) => `$${n.toFixed(2)}`;
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString() : "";

function OverviewStats() {
  const { data: overview, isLoading } = useGetPayHubOverview();
  if (isLoading || !overview) {
    return <div className="animate-pulse h-[180px] bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)] rounded-[20px] border border-[var(--hairline)]" />;
  }
  return (
    <div className="bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)] rounded-[20px] border border-[var(--hairline)] p-[20px] relative overflow-hidden">
      <div className="relative z-10 grid grid-cols-2 gap-[16px]">
        <div>
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] flex items-center gap-1.5 mb-1">
            Outstanding
          </div>
          <div className="font-display font-bold text-[32px] tabular-nums text-[var(--ink)] mt-[2px] leading-none">
            {overview.outstandingCount}
          </div>
          <div className="text-[13px] text-muted-foreground font-mono mt-1">
            {fmtMoney(overview.outstandingTotal)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] flex items-center gap-1.5 mb-1">
            Received MTD
          </div>
          <div className="font-display font-bold text-[32px] tabular-nums text-[var(--gold-dark)] mt-[2px] leading-none">
            {fmtMoney(overview.receivedMtd)}
          </div>
          <div className="text-[13px] text-muted-foreground font-mono mt-1">
            Payouts: {fmtMoney(overview.payoutsMtd)}
          </div>
        </div>
        <div className="pt-3 border-t border-[var(--hairline)]">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] mb-1">
            Verified Crew
          </div>
          <div className="font-display font-bold text-[24px] tabular-nums text-[var(--ink)] mt-[2px] leading-none">
            {overview.verifiedCrewCount}
          </div>
        </div>
        <div className="pt-3 border-t border-[var(--hairline)]">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] mb-1">
            Returned
          </div>
          <div className="font-display font-bold text-[24px] tabular-nums text-destructive mt-[2px] leading-none">
            {overview.returnedCount}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportInvoiceSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<any | null>(null);
  const [confidence, setConfidence] = useState<string>("low");
  const extract = useExtractPaymentInfo();
  const { toast } = useToast();

  const onPick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setExtractedData(null);
  };

  const onScan = async () => {
    if (!file) return;
    try {
      const prepared = await prepareScanImage(file);
      const result = await extract.mutateAsync({
        data: {
          image: prepared.base64,
          mediaType: prepared.mediaType,
          filename: file.name,
        },
      });
      if (result.found) {
        setExtractedData(result.payerInfo);
        setConfidence(result.confidence ?? "low");
        toast({
          title: "Payment info extracted",
          description: result.summary || "Review the fields below.",
        });
      } else {
        toast({
          title: "No payment info found",
          description: "Try another image or enter manually.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Scan failed",
        description: "Couldn't read the image.",
        variant: "destructive",
      });
    }
  };

  const onClose = () => {
    setFile(null);
    setPreview(null);
    setExtractedData(null);
    setConfidence("low");
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[5px] rounded-full bg-[rgba(23,24,28,0.16)] mx-auto mt-[12px] mb-[4px] shrink-0" />
        <div className="p-[12px_24px_32px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[22px] tracking-[-0.01em] m-[6px_0_2px]">
              Scan Invoice
            </SheetTitle>
            <div className="text-[14px] text-muted-foreground">
              Take a photo of any invoice to extract payment info.
            </div>
          </SheetHeader>

          <label className="w-full aspect-[4/3] rounded-[16px] border-2 border-dashed border-border bg-background overflow-hidden grid place-items-center cursor-pointer hover:border-[var(--gold)] transition-colors">
            {preview ? (
              <img src={preview} alt="Invoice" className="w-full h-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-[6px] text-muted-foreground">
                <Scan className="w-[32px] h-[32px]" />
                <span className="text-[13px] font-bold">Tap to pick or take photo</span>
              </div>
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0])}
              data-testid="input-invoice-photo"
            />
          </label>

          {file && !extractedData && (
            <button
              onClick={onScan}
              disabled={extract.isPending}
              className="w-full mt-[16px] flex items-center justify-center gap-[8px] rounded-[14px] py-[14px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_4px_12px_rgba(143,106,31,0.2)] disabled:opacity-50 transition-transform active:scale-[0.98]"
              data-testid="button-scan-invoice"
            >
              {extract.isPending ? (
                <Loader2 className="w-[18px] h-[18px] animate-spin" />
              ) : (
                <Scan className="w-[18px] h-[18px]" />
              )}
              {extract.isPending ? "Reading..." : "Read payment info"}
            </button>
          )}

          {extractedData && (
            <div className="mt-[16px] bg-card border border-border rounded-[16px] p-[16px]">
              <div className="flex items-center justify-between mb-[12px]">
                <span className="font-display font-bold text-[15px]">Extracted fields</span>
                <span
                  className={`text-[11px] font-bold uppercase px-[8px] py-[3px] rounded-full ${
                    confidence === "high"
                      ? "bg-[rgba(60,122,78,0.12)] text-[var(--green)]"
                      : "bg-amber-500/15 text-amber-700"
                  }`}
                >
                  {confidence} confidence
                </span>
              </div>
              <div className="space-y-[10px] text-[13px]">
                {extractedData.payerName && (
                  <div>
                    <span className="text-muted-foreground">Name:</span>{" "}
                    <span className="font-semibold">{extractedData.payerName}</span>
                  </div>
                )}
                {extractedData.amount && (
                  <div>
                    <span className="text-muted-foreground">Amount:</span>{" "}
                    <span className="font-display font-bold">{fmtMoney(extractedData.amount)}</span>
                  </div>
                )}
                {extractedData.cardNumber && (
                  <div>
                    <span className="text-muted-foreground">Card:</span>{" "}
                    <span className="font-mono">•••• {extractedData.cardNumber.slice(-4)}</span>
                  </div>
                )}
                {extractedData.routingNumber && (
                  <div>
                    <span className="text-muted-foreground">Routing:</span>{" "}
                    <span className="font-mono">{extractedData.routingNumber}</span>
                  </div>
                )}
                {extractedData.accountNumber && (
                  <div>
                    <span className="text-muted-foreground">Account:</span>{" "}
                    <span className="font-mono">•••• {extractedData.accountNumber.slice(-4)}</span>
                  </div>
                )}
              </div>
              <div className="mt-[12px] text-[12px] text-muted-foreground">
                This info is saved to the request's payer info for future reference.
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CreateRequestSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState<"property" | "jobs" | "confirm">("property");
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [memo, setMemo] = useState("");

  const { data: properties } = useListProperties();
  const { data: allJobs } = useListJobs();
  const create = useCreatePaymentRequest();

  const jobs = useMemo(
    () => allJobs?.filter((j) => j.propertyId === propertyId) || [],
    [allJobs, propertyId]
  );

  const selectedJobs = useMemo(
    () => jobs.filter((j) => selectedJobIds.includes(j.id)),
    [jobs, selectedJobIds]
  );

  const total = useMemo(
    () => selectedJobs.reduce((sum, j) => sum + (j.lineTotal || 0), 0),
    [selectedJobs]
  );

  const toggleJob = (id: string) => {
    setSelectedJobIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const onCreate = () => {
    create.mutate(
      {
        data: {
          propertyId: propertyId!,
          jobIds: selectedJobIds,
          memo: memo || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPaymentRequestsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          toast({ title: "Payment request created" });
          onOpenChange(false);
          setStep("property");
          setPropertyId(null);
          setSelectedJobIds([]);
          setMemo("");
        },
        onError: (e) =>
          toast({
            title: "Couldn't create request",
            description: e.message,
            variant: "destructive",
          }),
      }
    );
  };

  const onClose = () => {
    onOpenChange(false);
    setStep("property");
    setPropertyId(null);
    setSelectedJobIds([]);
    setMemo("");
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[5px] rounded-full bg-[rgba(23,24,28,0.16)] mx-auto mt-[12px] mb-[4px] shrink-0" />
        <div className="p-[12px_24px_32px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[22px] tracking-[-0.01em] m-[6px_0_2px]">
              Create payment request
            </SheetTitle>
          </SheetHeader>

          {step === "property" && (
            <div>
              <div className="text-[13px] text-muted-foreground mb-[12px]">
                Pick a property:
              </div>
              <div className="space-y-[8px]">
                {properties?.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPropertyId(p.id);
                      setStep("jobs");
                    }}
                    className="w-full text-left bg-card border border-border rounded-[14px] p-[14px] hover:border-[var(--gold)] transition-colors active:scale-[0.98]"
                    data-testid={`button-select-property-${p.id}`}
                  >
                    <div className="font-semibold text-[15px]">{p.name}</div>
                    {p.city && (
                      <div className="text-[12px] text-muted-foreground mt-[2px]">{p.city}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "jobs" && (
            <div>
              <button
                onClick={() => setStep("property")}
                className="flex items-center gap-[6px] text-[13px] text-muted-foreground mb-[12px] hover:text-[var(--ink)]"
                data-testid="button-back-to-property"
              >
                <ArrowLeft className="w-[14px] h-[14px]" /> Back to properties
              </button>
              <div className="text-[13px] text-muted-foreground mb-[12px]">
                Select job(s) to include:
              </div>
              <div className="space-y-[8px] mb-[16px]">
                {jobs.map((j) => (
                  <label
                    key={j.id}
                    className="flex items-start gap-[10px] bg-card border border-border rounded-[14px] p-[14px] cursor-pointer hover:border-[var(--gold)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedJobIds.includes(j.id)}
                      onChange={() => toggleJob(j.id)}
                      className="mt-[3px] w-[16px] h-[16px] accent-[var(--gold)] shrink-0"
                      data-testid={`checkbox-job-${j.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[14px]">{j.description || j.jobNo}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {j.jobNo} · {fmtMoney(j.lineTotal || 0)}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              {selectedJobs.length > 0 && (
                <div className="bg-card border border-border rounded-[14px] p-[14px] mb-[16px]">
                  <div className="text-[12px] text-muted-foreground mb-[8px]">
                    Memo (optional):
                  </div>
                  <textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="Add any notes for the property manager..."
                    className="w-full border border-border rounded-[10px] px-[12px] py-[10px] text-[14px] resize-none"
                    rows={3}
                    data-testid="textarea-memo"
                  />
                  <div className="flex items-center justify-between mt-[12px] pt-[12px] border-t border-border">
                    <span className="font-display font-bold text-[16px]">Total</span>
                    <span className="font-display font-bold text-[20px] text-[var(--ink)]">
                      {fmtMoney(total)}
                    </span>
                  </div>
                </div>
              )}
              <button
                onClick={onCreate}
                disabled={selectedJobs.length === 0 || create.isPending}
                className="w-full flex items-center justify-center gap-[8px] rounded-[14px] py-[14px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_4px_12px_rgba(143,106,31,0.2)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                data-testid="button-create-request"
              >
                {create.isPending ? (
                  <Loader2 className="w-[18px] h-[18px] animate-spin" />
                ) : (
                  <Plus className="w-[18px] h-[18px]" />
                )}
                Create request
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PaymentRequestCard({ req }: { req: PaymentRequestDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [sendOpen, setSendOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [distOpen, setDistOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const send = useSendPaymentRequest();
  const returnReq = useReturnPaymentRequest();
  const deleteReq = useDeletePaymentRequest();

  const statusColor: Record<string, string> = {
    draft: "#8B8577",
    sent: "#8f6a1f",
    paid: "#3c7a4e",
    returned: "#be3c3c",
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListPaymentRequestsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
  };

  const paymentLink = `${window.location.origin}/pay/${req.token}`;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(paymentLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Couldn't copy link", variant: "destructive" });
    }
  };

  const onSend = (via: "email" | "sms", to: string) => {
    send.mutate(
      { id: req.id, data: { via, to } },
      {
        onSuccess: () => {
          invalidate();
          setSendOpen(false);
          toast({ title: `Payment link sent via ${via}` });
        },
        onError: (e) =>
          toast({
            title: "Couldn't send",
            description: e.message,
            variant: "destructive",
          }),
      }
    );
  };

  const onReturn = (reason: string) => {
    returnReq.mutate(
      { id: req.id, data: { reason } },
      {
        onSuccess: () => {
          invalidate();
          setReturnOpen(false);
          toast({ title: "Payment marked returned" });
        },
        onError: (e) =>
          toast({
            title: "Couldn't mark returned",
            description: e.message,
            variant: "destructive",
          }),
      }
    );
  };

  const onDelete = () => {
    if (!confirm("Delete this payment request?")) return;
    deleteReq.mutate(
      { id: req.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Request deleted" });
        },
        onError: (e) =>
          toast({
            title: "Couldn't delete",
            description: e.message,
            variant: "destructive",
          }),
      }
    );
  };

  return (
    <>
      <div className="bg-card border border-border rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[18px]">
        <div className="flex items-start gap-[12px] mb-[12px]">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-[8px]">
              <span className="font-mono text-[13px] text-muted-foreground">{req.requestNo}</span>
              <span
                className="text-[10px] font-bold uppercase tracking-[0.06em] px-[8px] py-[3px] rounded-full text-white"
                style={{ backgroundColor: statusColor[req.status] || "#8B8577" }}
              >
                {req.status}
              </span>
            </div>
            <div className="font-semibold text-[16px] mt-[4px]">{req.propertyName}</div>
            {req.memo && (
              <div className="text-[12px] text-muted-foreground mt-[2px]">{req.memo}</div>
            )}
          </div>
          <div className="font-display font-bold text-[22px] tabular-nums text-[var(--ink)] shrink-0">
            {fmtMoney(req.total)}
          </div>
        </div>

        {req.jobs && req.jobs.length > 0 && (
          <div className="mb-[12px] text-[12px]">
            {req.jobs.map((j, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-[6px] border-t border-border/60"
              >
                <span className="text-muted-foreground">{j.label}</span>
                <span className="font-semibold">{fmtMoney(j.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {req.status === "paid" && (
          <div className="bg-[rgba(60,122,78,0.08)] rounded-[12px] p-[12px] mb-[12px]">
            <div className="flex items-center gap-[6px] text-[var(--green)] font-semibold text-[14px] mb-[6px]">
              <CheckCircle2 className="w-[16px] h-[16px]" /> Payment received
            </div>
            <div className="text-[12px] text-muted-foreground space-y-[2px]">
              <div>Amount: {fmtMoney(req.paidAmount || req.total)}</div>
              <div>Date: {fmtDate(req.paidAt)}</div>
              {req.paymentMethod && <div>Method: {req.paymentMethod}</div>}
              {req.confirmationNo && <div>Confirmation: {req.confirmationNo}</div>}
            </div>
          </div>
        )}

        {req.status === "returned" && (
          <div className="bg-destructive/10 rounded-[12px] p-[12px] mb-[12px]">
            <div className="flex items-center gap-[6px] text-destructive font-semibold text-[14px] mb-[4px]">
              <XCircle className="w-[16px] h-[16px]" /> Payment returned
            </div>
            {req.returnReason && (
              <div className="text-[12px] text-muted-foreground">{req.returnReason}</div>
            )}
          </div>
        )}

        <div className="flex gap-[8px]">
          {req.status === "draft" && (
            <>
              <button
                onClick={() => setSendOpen(true)}
                className="flex-1 rounded-[14px] py-[11px] text-[14px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(143,106,31,0.2)] transition-transform active:scale-[0.98]"
                data-testid={`button-send-${req.id}`}
              >
                Send
              </button>
              <button
                onClick={onDelete}
                className="rounded-[14px] px-[14px] py-[11px] text-[14px] font-display font-bold bg-card border border-destructive/20 text-destructive transition-transform active:scale-[0.98]"
                data-testid={`button-delete-${req.id}`}
              >
                Delete
              </button>
            </>
          )}
          {req.status === "sent" && (
            <>
              <button
                onClick={onCopy}
                className="flex-1 flex items-center justify-center gap-[6px] rounded-[14px] py-[11px] text-[14px] font-display font-bold bg-card border border-border shadow-sm transition-transform active:scale-[0.98]"
                data-testid={`button-copy-link-${req.id}`}
              >
                {copied ? (
                  <Check className="w-[16px] h-[16px]" />
                ) : (
                  <Copy className="w-[16px] h-[16px]" />
                )}
                {copied ? "Copied!" : "Copy link"}
              </button>
            </>
          )}
          {req.status === "paid" && (
            <>
              <button
                onClick={() => setDistOpen(true)}
                className="flex-1 flex items-center justify-center gap-[6px] rounded-[14px] py-[11px] text-[14px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(143,106,31,0.2)] transition-transform active:scale-[0.98]"
                data-testid={`button-distribute-${req.id}`}
              >
                <Users className="w-[16px] h-[16px]" /> Distribute to crew
              </button>
              <button
                onClick={() => setReturnOpen(true)}
                className="rounded-[14px] px-[14px] py-[11px] text-[14px] font-display font-bold bg-card border border-destructive/20 text-destructive transition-transform active:scale-[0.98]"
                data-testid={`button-return-${req.id}`}
              >
                Return
              </button>
            </>
          )}
        </div>
      </div>

      <SendSheet
        open={sendOpen}
        onOpenChange={setSendOpen}
        onSend={onSend}
        sending={send.isPending}
      />
      <ReturnSheet
        open={returnOpen}
        onOpenChange={setReturnOpen}
        onReturn={onReturn}
        returning={returnReq.isPending}
      />
      {distOpen && (
        <DistributionSheet
          requestId={req.id}
          open={distOpen}
          onOpenChange={setDistOpen}
        />
      )}
    </>
  );
}

function SendSheet({
  open,
  onOpenChange,
  onSend,
  sending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (via: "email" | "sms", to: string) => void;
  sending: boolean;
}) {
  const [via, setVia] = useState<"email" | "sms">("email");
  const [to, setTo] = useState("");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[5px] rounded-full bg-[rgba(23,24,28,0.16)] mx-auto mt-[12px] mb-[4px] shrink-0" />
        <div className="p-[12px_24px_32px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[22px] tracking-[-0.01em] m-[6px_0_2px]">
              Send payment link
            </SheetTitle>
          </SheetHeader>

          <div className="flex gap-[8px] mb-[16px]">
            <button
              onClick={() => setVia("email")}
              className={`flex-1 flex items-center justify-center gap-[6px] rounded-[12px] py-[12px] text-[14px] font-display font-bold transition-all ${
                via === "email"
                  ? "bg-[var(--ink)] text-white"
                  : "bg-card border border-border text-muted-foreground"
              }`}
              data-testid="button-via-email"
            >
              <Mail className="w-[16px] h-[16px]" /> Email
            </button>
            <button
              onClick={() => setVia("sms")}
              className={`flex-1 flex items-center justify-center gap-[6px] rounded-[12px] py-[12px] text-[14px] font-display font-bold transition-all ${
                via === "sms"
                  ? "bg-[var(--ink)] text-white"
                  : "bg-card border border-border text-muted-foreground"
              }`}
              data-testid="button-via-sms"
            >
              <MessageSquare className="w-[16px] h-[16px]" /> Text
            </button>
          </div>

          <input
            type={via === "email" ? "email" : "tel"}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={via === "email" ? "manager@property.com" : "(555) 123-4567"}
            className="w-full border border-border rounded-[12px] px-[14px] py-[12px] text-[15px] mb-[16px]"
            data-testid="input-send-to"
          />

          <button
            onClick={() => onSend(via, to)}
            disabled={!to || sending}
            className="w-full flex items-center justify-center gap-[8px] rounded-[14px] py-[14px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_4px_12px_rgba(143,106,31,0.2)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            data-testid="button-confirm-send"
          >
            {sending ? (
              <Loader2 className="w-[18px] h-[18px] animate-spin" />
            ) : (
              <Send className="w-[18px] h-[18px]" />
            )}
            Send payment link
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReturnSheet({
  open,
  onOpenChange,
  onReturn,
  returning,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturn: (reason: string) => void;
  returning: boolean;
}) {
  const [reason, setReason] = useState("");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[5px] rounded-full bg-[rgba(23,24,28,0.16)] mx-auto mt-[12px] mb-[4px] shrink-0" />
        <div className="p-[12px_24px_32px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[22px] tracking-[-0.01em] m-[6px_0_2px]">
              Mark payment returned
            </SheetTitle>
            <div className="text-[14px] text-muted-foreground">
              Provide a reason for the return.
            </div>
          </SheetHeader>

          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Insufficient funds, payment disputed..."
            className="w-full border border-border rounded-[12px] px-[14px] py-[12px] text-[15px] resize-none mb-[16px]"
            rows={4}
            data-testid="textarea-return-reason"
          />

          <button
            onClick={() => onReturn(reason)}
            disabled={!reason || returning}
            className="w-full flex items-center justify-center gap-[8px] rounded-[14px] py-[14px] font-display font-bold text-[15px] bg-card border border-destructive/20 text-destructive shadow-sm disabled:opacity-50 transition-transform active:scale-[0.98]"
            data-testid="button-confirm-return"
          >
            {returning ? (
              <Loader2 className="w-[18px] h-[18px] animate-spin" />
            ) : (
              <XCircle className="w-[18px] h-[18px]" />
            )}
            Confirm return
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DistributionSheet({
  requestId,
  open,
  onOpenChange,
}: {
  requestId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: dist, isLoading } = useGetPayoutDistribution(requestId, {
    query: {
      enabled: !!requestId,
      queryKey: getGetPayoutDistributionQueryKey(requestId),
    },
  });
  const createPayout = useCreateCrewPayout();
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  const onPay = (row: any, key: string) => {
    const amount = amounts[key] ?? row.crewRate ?? 0;
    createPayout.mutate(
      {
        data: {
          crewId: row.crewId,
          jobId: row.jobId,
          amount,
          paymentRequestId: requestId,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetPayoutDistributionQueryKey(requestId),
          });
          queryClient.invalidateQueries({ queryKey: getListCrewPayoutsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey() });
          toast({ title: "Crew paid" });
        },
        onError: (e) => {
          const msg = e.message || "";
          if (msg.includes("bank") || msg.includes("verif")) {
            toast({
              title: "Bank not verified",
              description: "This crew hasn't connected their bank yet.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Couldn't pay crew",
              description: e.message,
              variant: "destructive",
            });
          }
        },
      }
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[5px] rounded-full bg-[rgba(23,24,28,0.16)] mx-auto mt-[12px] mb-[4px] shrink-0" />
        <div className="p-[12px_24px_32px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[22px] tracking-[-0.01em] m-[6px_0_2px]">
              Distribute to crew
            </SheetTitle>
            {dist && (
              <div className="text-[14px] text-muted-foreground">
                Request {dist.requestNo} · Received {fmtMoney(dist.receivedAmount)}
              </div>
            )}
          </SheetHeader>

          {isLoading ? (
            <div className="py-[40px] grid place-items-center">
              <Loader2 className="w-[22px] h-[22px] animate-spin text-primary" />
            </div>
          ) : !dist || dist.rows.length === 0 ? (
            <div className="text-center text-[14px] text-muted-foreground py-[40px]">
              No crew assigned to these jobs.
            </div>
          ) : (
            <div className="space-y-[12px]">
              {dist.rows.map((row, i) => {
                const key = `${row.jobId}-${row.crewId || "none"}-${i}`;
                const amount = amounts[key] ?? row.crewRate ?? 0;
                const isPaid = row.crewPaid;
                const isUnassigned = row.crewId == null;

                return (
                  <div
                    key={key}
                    className="bg-card border border-border rounded-[14px] p-[14px]"
                  >
                    <div className="flex items-start justify-between mb-[8px]">
                      <div>
                        <div className="font-semibold text-[14px]">
                          {isUnassigned ? "No crew assigned" : row.crewName}
                        </div>
                        <div className="text-[12px] text-muted-foreground">{row.jobLabel}</div>
                      </div>
                      {!isUnassigned && (
                        <div className="flex items-center gap-[6px]">
                          {row.bankConnected && row.bankVerified ? (
                            <span className="flex items-center gap-[4px] text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--green)]">
                              <Shield className="w-[12px] h-[12px]" /> Verified
                            </span>
                          ) : (
                            <span className="flex items-center gap-[4px] text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                              <AlertCircle className="w-[12px] h-[12px]" /> Not connected
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {!isUnassigned && (
                      <>
                        <div className="flex items-center gap-[8px] mb-[10px]">
                          <span className="text-[12px] text-muted-foreground">Amount:</span>
                          <input
                            type="number"
                            value={amount}
                            onChange={(e) =>
                              setAmounts((prev) => ({
                                ...prev,
                                [key]: Number(e.target.value),
                              }))
                            }
                            step="0.01"
                            disabled={isPaid}
                            className="flex-1 border border-border rounded-[8px] px-[10px] py-[6px] text-[14px] font-display font-bold disabled:opacity-50"
                            data-testid={`input-amount-${key}`}
                          />
                        </div>

                        {isPaid ? (
                          <div className="flex items-center gap-[6px] text-[var(--green)] font-semibold text-[13px]">
                            <CheckCircle2 className="w-[16px] h-[16px]" /> Paid
                            {row.payoutId && ` · Confirmation ${row.payoutId}`}
                          </div>
                        ) : (
                          <button
                            onClick={() => onPay(row, key)}
                            disabled={createPayout.isPending}
                            className="w-full flex items-center justify-center gap-[6px] rounded-[12px] py-[10px] text-[13px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_6px_rgba(143,106,31,0.2)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                            data-testid={`button-pay-${key}`}
                          >
                            <DollarSign className="w-[16px] h-[16px]" /> Pay now
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PayoutsList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: payouts, isLoading } = useListCrewPayouts();
  const returnPayout = useReturnCrewPayout();

  const sorted = useMemo(
    () =>
      [...(payouts || [])].sort(
        (a, b) =>
          new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime()
      ),
    [payouts]
  );

  const onReturn = (id: string, reason: string) => {
    returnPayout.mutate(
      { id, data: { reason } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrewPayoutsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey() });
          queryClient.invalidateQueries({
            predicate: (q) =>
              typeof q.queryKey[0] === "string" &&
              q.queryKey[0].includes("/pay-hub/distribution/"),
          });
          toast({ title: "Payout marked returned" });
        },
        onError: (e) =>
          toast({
            title: "Couldn't mark returned",
            description: e.message,
            variant: "destructive",
          }),
      }
    );
  };

  if (isLoading) {
    return <div className="animate-pulse h-32 bg-card border border-border rounded-[20px]" />;
  }

  if (!payouts || payouts.length === 0) {
    return (
      <div className="text-center text-[15px] text-muted-foreground py-[50px]">
        No crew payouts yet.
      </div>
    );
  }

  return (
    <div className="space-y-[12px]">
      {sorted.map((p) => (
        <div
          key={p.id}
          className="bg-card border border-border rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px]"
        >
          <div className="flex items-start gap-[12px]">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[15px]">{p.crewName}</div>
              <div className="text-[12px] text-muted-foreground">
                {p.jobLabel} · {fmtDate(p.paidAt)}
              </div>
              {p.confirmationNo && (
                <div className="text-[11px] font-mono text-muted-foreground mt-[2px]">
                  {p.confirmationNo}
                </div>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display font-bold text-[18px] tabular-nums">
                {fmtMoney(p.amount)}
              </div>
              {p.status === "returned" && p.returnReason ? (
                <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-destructive mt-[4px]">
                  Returned
                </div>
              ) : p.status === "paid" ? (
                <div className="flex items-center justify-end gap-[4px] text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--green)] mt-[4px]">
                  <CheckCircle2 className="w-[12px] h-[12px]" /> Paid
                </div>
              ) : null}
            </div>
          </div>
          {p.status === "paid" && (
            <button
              onClick={() => {
                const reason = prompt("Reason for return:");
                if (reason) onReturn(p.id, reason);
              }}
              className="mt-[10px] text-[12px] font-display font-bold text-destructive"
              data-testid={`button-return-payout-${p.id}`}
            >
              Mark returned
            </button>
          )}
          {p.status === "returned" && p.returnReason && (
            <div className="mt-[8px] text-[12px] text-destructive bg-destructive/5 rounded-[8px] px-[10px] py-[6px]">
              {p.returnReason}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function PaymentsHub() {
  const [, navigate] = useLocation();
  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = useState<"requests" | "payouts">("requests");
  const { data: requests, isLoading } = useListPaymentRequests();

  const sorted = useMemo(
    () =>
      [...(requests || [])].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      ),
    [requests]
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-card border-b border-border px-[18px] pt-[20px] pb-[16px] flex items-center gap-[12px]">
        <button
          onClick={() => navigate("/money")}
          className="w-[40px] h-[40px] rounded-full bg-muted/60 grid place-items-center transition-transform active:scale-95"
          data-testid="button-back-to-money"
        >
          <ArrowLeft className="w-[18px] h-[18px]" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-primary">
            Money · Payments
          </div>
          <div className="font-display font-bold text-[22px] tracking-[-0.01em] text-[var(--ink)]">
            Payment Hub
          </div>
        </div>
      </header>

      <main className="px-[14px] py-[16px] pb-[40px] max-w-[560px] mx-auto w-full flex-1">
        <OverviewStats />

        <div className="flex gap-[10px] my-[20px]">
          <button
            onClick={() => setImportOpen(true)}
            className="flex-1 flex items-center justify-center gap-[8px] rounded-[18px] py-[15px] font-display font-bold text-[15px] bg-card border border-border shadow-sm transition-transform active:scale-[0.98]"
            data-testid="button-import-invoice"
          >
            <Scan className="w-[18px] h-[18px]" /> Import invoice
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex-1 flex items-center justify-center gap-[8px] rounded-[18px] py-[15px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_8px_24px_rgba(143,106,31,0.25)] transition-transform active:scale-[0.98]"
            data-testid="button-create-request"
          >
            <Plus className="w-[18px] h-[18px]" /> New request
          </button>
        </div>

        <div className="flex gap-[6px] mb-[16px] bg-muted/40 rounded-[14px] p-[4px]">
          <button
            onClick={() => setTab("requests")}
            className={`flex-1 rounded-[10px] py-[10px] text-[14px] font-display font-bold transition-all ${
              tab === "requests"
                ? "bg-card text-[var(--ink)] shadow-sm"
                : "text-muted-foreground"
            }`}
            data-testid="tab-requests"
          >
            Requests
          </button>
          <button
            onClick={() => setTab("payouts")}
            className={`flex-1 rounded-[10px] py-[10px] text-[14px] font-display font-bold transition-all ${
              tab === "payouts"
                ? "bg-card text-[var(--ink)] shadow-sm"
                : "text-muted-foreground"
            }`}
            data-testid="tab-payouts"
          >
            Payouts
          </button>
        </div>

        {tab === "requests" && (
          <>
            {isLoading ? (
              <div className="animate-pulse h-32 bg-card border border-border rounded-[20px]" />
            ) : !requests || requests.length === 0 ? (
              <div className="text-center text-[15px] text-muted-foreground py-[50px]">
                No payment requests yet.
              </div>
            ) : (
              <div className="space-y-[12px]">
                {sorted.map((req) => (
                  <PaymentRequestCard key={req.id} req={req} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "payouts" && <PayoutsList />}
      </main>

      <ImportInvoiceSheet open={importOpen} onOpenChange={setImportOpen} />
      <CreateRequestSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
