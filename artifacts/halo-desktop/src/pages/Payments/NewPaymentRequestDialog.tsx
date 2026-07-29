import { useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useCreatePaymentRequest,
  useListProperties,
  useListJobs,
  useExtractPaymentInfo,
  getListPaymentRequestsQueryKey,
  getGetPayHubOverviewQueryKey,
  PaymentOcrResult,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button} from "@/components/ui/button";
import { Input} from "@/components/ui/input";
import { Label} from "@/components/ui/label";
import { Checkbox} from "@/components/ui/checkbox";
import { useToast} from "@/hooks/use-toast";
import { prepareScanImage} from "@/lib/scanImage";
import { Loader2, ScanLine, AlertTriangle, CheckCircle2} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CustomItem = { label: string, amount: string };

export function NewPaymentRequestDialog({ open, onOpenChange}: { open: boolean, onOpenChange: (open: boolean) => void}) {
  const [step, setStep] = useState<"details" | "ocr">("details");
  const [propertyId, setPropertyId] = useState("");
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [jobAmounts, setJobAmounts] = useState<Record<string, string>>({});
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [memo, setMemo] = useState("");
  const [payerInfo, setPayerInfo] = useState<PaymentOcrResult["payerInfo"] | undefined>();
  const [ocrConfidence, setOcrConfidence] = useState("");

  const { data: properties} = useListProperties();
  const { data: jobs} = useListJobs({ status: "completed"});
  
  const createReq = useCreatePaymentRequest();
  const extract = useExtractPaymentInfo();
  const { toast} = useToast();
  const queryClient = useQueryClient();

  const propertyJobs = jobs?.filter(j => j.propertyId === propertyId && j.status === "completed") || [];

  const jobAmount = (jobId: string, fallback: number) => {
    const raw = jobAmounts[jobId];
    if (raw === undefined || raw === "") return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
 };

  const customTotal = customItems.reduce((s, c) => {
    const n = parseFloat(c.amount);
    return s + (Number.isFinite(n) && n > 0 ? n : 0);
 }, 0);

  const total = propertyJobs
    .filter(j => selectedJobIds.has(j.id))
    .reduce((sum, j) => sum + jobAmount(j.id, j.lineTotal || 0), 0) + customTotal;

  const validCustomItems = customItems
    .map(c => ({ label: c.label.trim(), amount: parseFloat(c.amount)}))
    .filter(c => c.label.length > 0 && Number.isFinite(c.amount) && c.amount > 0);

  const handleCreate = () => {
    if (!propertyId) {
      toast({ title: "Select a property", variant: "destructive"});
      return;
   }
    if (selectedJobIds.size === 0 && validCustomItems.length === 0) {
      toast({ title: "Select a job or add a line item", variant: "destructive"});
      return;
   }
    if (total <= 0) {
      toast({ title: "Request total must be greater than $0", variant: "destructive"});
      return;
   }
    const overrides: Record<string, number> = {};
    for (const id of selectedJobIds) {
      const raw = jobAmounts[id];
      if (raw !== undefined && raw !== "") {
        const n = parseFloat(raw);
        if (Number.isFinite(n) && n >= 0) overrides[id] = n;
     }
   }
    createReq.mutate({
      data: {
        propertyId,
        jobIds: Array.from(selectedJobIds),
        ...(Object.keys(overrides).length ? { jobAmounts: overrides} : {}),
        ...(validCustomItems.length ? { customItems: validCustomItems} : {}),
        memo,
        payerInfo,
     }
   }, {
      onSuccess: () => {
        toast({ title: "Payment request created"});
        queryClient.invalidateQueries({ queryKey: getListPaymentRequestsQueryKey()});
        queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey()});
        setPropertyId("");
        setSelectedJobIds(new Set());
        setJobAmounts({});
        setCustomItems([]);
        setMemo("");
        setPayerInfo(undefined);
        setOcrConfidence("");
        onOpenChange(false);
     },
      onError: (err) => toast({ title: "Failed to create request", description: err.message, variant: "destructive"})
   });
 };

  const handleScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      setStep("ocr");
      const prepared = await prepareScanImage(file);
      extract.mutate({
        data: {
          image: prepared.base64,
          mediaType: prepared.mediaType,
          filename: file.name
       }
     }, {
        onSuccess: (res) => {
          if (res.payerInfo) {
            setPayerInfo(res.payerInfo);
            setOcrConfidence(res.confidence);
            toast({ title: "Extracted info from image"});
         } else {
            toast({ title: "Could not find payment info", variant: "destructive"});
            setStep("details");
         }
       },
        onError: () => {
          toast({ title: "OCR failed", variant: "destructive"});
          setStep("details");
       }
     });
   } catch (err) {
      toast({ title: "Failed to process image", variant: "destructive"});
      setStep("details");
   }
 };

  const moneyFmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD"});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-none shadow-xl rounded-3xl bg-[var(--background)]">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-2xl font-display font-bold text-foreground">New payment request</DialogTitle>
        </DialogHeader>

        {step === "details" && (
          <div className="px-6 pb-6 space-y-6">
            <div className="space-y-3">
              <Label className="text-muted-foreground">Property</Label>
              <Select value={propertyId} onValueChange={(v) => { setPropertyId(v); setSelectedJobIds(new Set());}}>
                <SelectTrigger className="rounded-xl border-border bg-white focus:ring-[var(--primary)] h-12">
                  <SelectValue placeholder="Select a property..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {properties?.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {propertyId && (
              <div className="space-y-3">
                <Label className="text-muted-foreground">Completed jobs to bill</Label>
                <div className="bg-white p-2 max-h-48 overflow-y-auto space-y-1 border border-border rounded-xl">
                  {propertyJobs.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-2 text-center">No unbilled completed jobs found.</div>
                  ) : (
                    propertyJobs.map(job => (
                      <div key={job.id} className="flex items-center space-x-3 bg-white p-3 border border-border rounded-xl shadow-sm">
                        <Checkbox 
                          id={`job-${job.id}`} 
                          checked={selectedJobIds.has(job.id)}
                          onCheckedChange={(c) => {
                            const next = new Set(selectedJobIds);
                            if (c) next.add(job.id);
                            else next.delete(job.id);
                            setSelectedJobIds(next);
                         }}
                          className="rounded-sm border-border data-[state=checked]:bg-[var(--primary)] data-[state=checked]:text-black"
                        />
                        <div className="flex-1 min-w-0">
                          <label htmlFor={`job-${job.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                            {job.jobNo}: {job.category || job.description?.substring(0, 30)}
                          </label>
                        </div>
                        {selectedJobIds.has(job.id) ? (
                          <div className="relative w-28">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={jobAmounts[job.id] ?? String(job.lineTotal || 0)}
                              onChange={e => setJobAmounts(prev => ({ ...prev, [job.id]: e.target.value}))}
                              className="rounded-lg bg-white border-border h-9 pl-6 text-right font-bold"
                              data-testid={`input-job-amount-${job.id}`}
                            />
                          </div>
                        ) : (
                          <div className="text-sm font-bold text-foreground">{moneyFmt(job.lineTotal || 0)}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {propertyId && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-muted-foreground">Extra line items</Label>
                  <button
                    type="button"
                    onClick={() => setCustomItems(items => [...items, { label: "", amount: ""}])}
                    className="text-sm font-bold text-foreground hover:opacity-70"
                    data-testid="button-add-line-item"
                  >
                    + Add line item
                  </button>
                </div>
                {customItems.length > 0 && (
                  <div className="space-y-2">
                    {customItems.map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          value={item.label}
                          onChange={e => setCustomItems(items => items.map((c, idx) => idx === i ? { ...c, label: e.target.value} : c))}
                          placeholder="Description (e.g. Trip charge)"
                          className="rounded-xl bg-white border-border h-10 flex-1"
                          data-testid={`input-custom-label-${i}`}
                        />
                        <div className="relative w-28">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.amount}
                            onChange={e => setCustomItems(items => items.map((c, idx) => idx === i ? { ...c, amount: e.target.value} : c))}
                            placeholder="0.00"
                            className="rounded-xl bg-white border-border h-10 pl-6 text-right font-bold"
                            data-testid={`input-custom-amount-${i}`}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setCustomItems(items => items.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-foreground px-1 text-lg leading-none"
                          aria-label="Remove line item"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              <Label className="text-muted-foreground">Memo (Optional)</Label>
              <Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="e.g. Monthly maintenance" className="rounded-xl bg-white border-border focus-visible:ring-[var(--primary)] h-12" />
            </div>

            <div className="bg-white p-5 border border-border rounded-2xl flex items-center justify-between">
              <span className="font-bold text-muted-foreground text-sm">Total request</span>
              <span className="text-3xl font-display font-bold text-foreground">{moneyFmt(total)}</span>
            </div>

            <div className="flex justify-between items-center pt-2">
              <div className="relative">
                <Input type="file" id="scan-upload" className="sr-only" accept="image/*" onChange={handleScan} />
                <Label htmlFor="scan-upload" className="cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-border bg-white hover:bg-black/5 h-10 px-5 text-foreground">
                  <ScanLine className="w-4 h-4 mr-2" />
                  Extract Check/Card
                </Label>
              </div>
              <Button onClick={handleCreate} disabled={(selectedJobIds.size === 0 && validCustomItems.length === 0) || total <= 0 || createReq.isPending} className="rounded-full bg-[var(--primary)] text-black font-bold hover:opacity-90 px-6 h-10">
                Create request
              </Button>
            </div>
          </div>
        )}

        {step === "ocr" && (
          <div className="px-6 pb-6 space-y-6">
            {extract.isPending ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-4">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
                <p className="text-sm text-muted-foreground animate-pulse">Reading payment details...</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className={`p-3 border border-border flex items-center gap-2 text-sm font-medium ${ocrConfidence === "high" ? "bg-emerald-50 text-emerald-800" : ocrConfidence === "medium" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-800"}`}>
                  {ocrConfidence === "high" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  {ocrConfidence === "high" ? "High confidence read" : ocrConfidence === "medium" ? "Please verify details carefully" : "Low confidence read. Please check."}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Routing number</Label>
                    <Input value={payerInfo?.routingNumber || ""} onChange={e => setPayerInfo(p => ({ ...p, routingNumber: e.target.value}))} className="rounded-xl bg-white border-border focus-visible:ring-[var(--primary)] h-10 font-mono" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Account number</Label>
                    <Input value={payerInfo?.accountNumber || ""} onChange={e => setPayerInfo(p => ({ ...p, accountNumber: e.target.value}))} className="rounded-xl bg-white border-border focus-visible:ring-[var(--primary)] h-10 font-mono" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label className="text-muted-foreground">Card number</Label>
                    <Input value={payerInfo?.cardNumber || ""} onChange={e => setPayerInfo(p => ({ ...p, cardNumber: e.target.value}))} className="rounded-xl bg-white border-border focus-visible:ring-[var(--primary)] h-10 font-mono" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Exp (MM/YY)</Label>
                    <Input value={payerInfo?.cardExp || ""} onChange={e => setPayerInfo(p => ({ ...p, cardExp: e.target.value}))} className="rounded-xl bg-white border-border focus-visible:ring-[var(--primary)] h-10" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">CVC</Label>
                    <Input value={payerInfo?.cardCode || ""} onChange={e => setPayerInfo(p => ({ ...p, cardCode: e.target.value}))} className="rounded-xl bg-white border-border focus-visible:ring-[var(--primary)] h-10" />
                  </div>
                </div>
                
                <DialogFooter className="pt-4">
                  <Button variant="ghost" onClick={() => setStep("details")} className="rounded-full border-border font-medium hover:bg-black/5 text-foreground px-6">Cancel</Button>
                  <Button onClick={() => setStep("details")} className="rounded-full bg-[var(--primary)] text-black hover:opacity-90 font-bold px-6">
                    Save info
                  </Button>
                </DialogFooter>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
