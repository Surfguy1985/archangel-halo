import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { prepareScanImage } from "@/lib/scanImage";
import { Loader2, ScanLine, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function NewPaymentRequestDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const [step, setStep] = useState<"details" | "ocr">("details");
  const [propertyId, setPropertyId] = useState("");
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [memo, setMemo] = useState("");
  const [payerInfo, setPayerInfo] = useState<PaymentOcrResult["payerInfo"] | undefined>();
  const [ocrConfidence, setOcrConfidence] = useState("");

  const { data: properties } = useListProperties();
  const { data: jobs } = useListJobs({ status: "completed" });
  
  const createReq = useCreatePaymentRequest();
  const extract = useExtractPaymentInfo();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const propertyJobs = jobs?.filter(j => j.propertyId === propertyId && j.status === "completed") || [];
  
  const total = propertyJobs
    .filter(j => selectedJobIds.has(j.id))
    .reduce((sum, j) => sum + (j.lineTotal || 0), 0);

  const handleCreate = () => {
    if (!propertyId || selectedJobIds.size === 0) {
      toast({ title: "Select a property and at least one job", variant: "destructive" });
      return;
    }
    createReq.mutate({
      data: {
        propertyId,
        jobIds: Array.from(selectedJobIds),
        memo,
        payerInfo,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Payment request created" });
        queryClient.invalidateQueries({ queryKey: getListPaymentRequestsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey() });
        onOpenChange(false);
      },
      onError: (err) => toast({ title: "Failed to create request", description: err.message, variant: "destructive" })
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
            toast({ title: "Extracted info from image" });
          } else {
            toast({ title: "Could not find payment info", variant: "destructive" });
            setStep("details");
          }
        },
        onError: () => {
          toast({ title: "OCR failed", variant: "destructive" });
          setStep("details");
        }
      });
    } catch (err) {
      toast({ title: "Failed to process image", variant: "destructive" });
      setStep("details");
    }
  };

  const moneyFmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border border-border shadow-md rounded-none">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-xl font-display font-bold text-[var(--secondary)]">New Payment Request</DialogTitle>
        </DialogHeader>

        {step === "details" && (
          <div className="px-6 pb-6 space-y-6">
            <div className="space-y-3">
              <Label>Property</Label>
              <Select value={propertyId} onValueChange={(v) => { setPropertyId(v); setSelectedJobIds(new Set()); }}>
                <SelectTrigger className="rounded-none border-border focus:ring-[var(--secondary)] h-12">
                  <SelectValue placeholder="Select a property..." />
                </SelectTrigger>
                <SelectContent className="rounded-none">
                  {properties?.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {propertyId && (
              <div className="space-y-3">
                <Label>Completed Jobs to Bill</Label>
                <div className="bg-[var(--background)] p-2 max-h-48 overflow-y-auto space-y-1 border border-border">
                  {propertyJobs.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-2 text-center">No unbilled completed jobs found.</div>
                  ) : (
                    propertyJobs.map(job => (
                      <div key={job.id} className="flex items-center space-x-3 bg-white p-3 border border-border shadow-sm">
                        <Checkbox 
                          id={`job-${job.id}`} 
                          checked={selectedJobIds.has(job.id)}
                          onCheckedChange={(c) => {
                            const next = new Set(selectedJobIds);
                            if (c) next.add(job.id);
                            else next.delete(job.id);
                            setSelectedJobIds(next);
                          }}
                          className="rounded-none border-border data-[state=checked]:bg-[var(--secondary)] data-[state=checked]:text-white"
                        />
                        <div className="flex-1 min-w-0">
                          <label htmlFor={`job-${job.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                            {job.jobNo}: {job.category || job.description?.substring(0, 30)}
                          </label>
                        </div>
                        <div className="text-sm font-bold text-[var(--secondary)]">{moneyFmt(job.lineTotal || 0)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <Label>Memo (Optional)</Label>
              <Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="e.g. Monthly maintenance" className="rounded-none border-border focus-visible:ring-[var(--secondary)] h-12" />
            </div>

            <div className="bg-white p-4 border border-border flex items-center justify-between">
              <span className="font-bold text-[var(--secondary)] uppercase tracking-wider text-xs">Total Request</span>
              <span className="text-2xl font-display font-bold text-[var(--secondary)]">{moneyFmt(total)}</span>
            </div>

            <div className="flex justify-between items-center pt-2">
              <div className="relative">
                <Input type="file" id="scan-upload" className="sr-only" accept="image/*" onChange={handleScan} />
                <Label htmlFor="scan-upload" className="cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-none text-sm font-bold tracking-wider ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-border bg-white hover:bg-[var(--secondary)] hover:text-white h-10 px-4 py-2 uppercase text-[var(--secondary)]">
                  <ScanLine className="w-4 h-4 mr-2" />
                  Extract Check/Card
                </Label>
              </div>
              <Button onClick={handleCreate} disabled={selectedJobIds.size === 0 || createReq.isPending} className="rounded-none bg-[var(--primary)] text-[var(--secondary)] font-bold hover:opacity-90 px-6 uppercase tracking-wider text-xs">
                Create Request
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
                    <Label>Routing Number</Label>
                    <Input value={payerInfo?.routingNumber || ""} onChange={e => setPayerInfo(p => ({ ...p, routingNumber: e.target.value }))} className="rounded-none border-border focus-visible:ring-[var(--secondary)] h-10 font-mono" />
                  </div>
                  <div className="space-y-2">
                    <Label>Account Number</Label>
                    <Input value={payerInfo?.accountNumber || ""} onChange={e => setPayerInfo(p => ({ ...p, accountNumber: e.target.value }))} className="rounded-none border-border focus-visible:ring-[var(--secondary)] h-10 font-mono" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label>Card Number</Label>
                    <Input value={payerInfo?.cardNumber || ""} onChange={e => setPayerInfo(p => ({ ...p, cardNumber: e.target.value }))} className="rounded-none border-border focus-visible:ring-[var(--secondary)] h-10 font-mono" />
                  </div>
                  <div className="space-y-2">
                    <Label>Exp (MM/YY)</Label>
                    <Input value={payerInfo?.cardExp || ""} onChange={e => setPayerInfo(p => ({ ...p, cardExp: e.target.value }))} className="rounded-none border-border focus-visible:ring-[var(--secondary)] h-10" />
                  </div>
                  <div className="space-y-2">
                    <Label>CVC</Label>
                    <Input value={payerInfo?.cardCode || ""} onChange={e => setPayerInfo(p => ({ ...p, cardCode: e.target.value }))} className="rounded-none border-border focus-visible:ring-[var(--secondary)] h-10" />
                  </div>
                </div>
                
                <DialogFooter className="pt-4">
                  <Button variant="ghost" onClick={() => setStep("details")} className="rounded-none border-border uppercase tracking-wider text-xs font-bold text-[var(--secondary)] hover:bg-[var(--secondary)] hover:text-white">Cancel</Button>
                  <Button onClick={() => setStep("details")} className="rounded-none bg-[var(--primary)] text-[var(--secondary)] hover:opacity-90 uppercase tracking-wider text-xs font-bold">
                    Save Info
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
