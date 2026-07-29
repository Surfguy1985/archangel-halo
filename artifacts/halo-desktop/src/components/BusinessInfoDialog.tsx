import { useEffect, useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useGetBusinessSettings,
  useUpdateBusinessSettings,
  useResetAllData,
  getGetBusinessSettingsQueryKey,
} from "@workspace/api-client-react";
import { useToast} from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button} from "@/components/ui/button";
import { Label} from "@/components/ui/label";
import { Input} from "@/components/ui/input";
import { Textarea} from "@/components/ui/textarea";
import { Switch} from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import { Trash2} from "lucide-react";

export function BusinessInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: settings} = useGetBusinessSettings();
  const update = useUpdateBusinessSettings();
  const reset = useResetAllData();

  const wipeData = () => {
    reset.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries();
        onOpenChange(false);
        toast({
          title: "Fresh start ready",
          description: "All sample data was cleared. Your company info stays.",
       });
     },
      onError: (e) =>
        toast({ title: "Couldn't clear data", description: e.message, variant: "destructive"}),
   });
 };

  const [companyName, setCompanyName] = useState("");
  const [tagline, setTagline] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [attn, setAttn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [approvalThreshold, setApprovalThreshold] = useState("");
  const [autoSendLinks, setAutoSendLinks] = useState(true);
  const [autopilot, setAutopilot] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);

  useEffect(() => {
    if (open && settings) {
      setCompanyName(settings.companyName);
      setTagline(settings.tagline);
      setStreet(settings.street);
      setCity(settings.city);
      setAttn(settings.attn);
      setPhone(settings.phone);
      setEmail(settings.email);
      setPaymentInstructions(settings.paymentInstructions);
      setTaxRate(settings.taxRatePct ? String(settings.taxRatePct) : "");
      setApprovalThreshold(
        settings.expenseApprovalThreshold ? String(settings.expenseApprovalThreshold) : "",
      );
      setAutoSendLinks(settings.autoSendRecapLinks ?? true);
      setAutopilot(settings.autopilotEnabled ?? true);
      setAutoApprove(settings.autopilotAutoApprove ?? false);
   }
 }, [open, settings]);

  const submit = () => {
    update.mutate(
      {
        data: {
          companyName: companyName.trim(),
          tagline: tagline.trim(),
          street: street.trim(),
          city: city.trim(),
          attn: attn.trim(),
          phone: phone.trim(),
          email: email.trim(),
          paymentInstructions: paymentInstructions.trim(),
          taxRatePct: Number.isFinite(parseFloat(taxRate)) ? parseFloat(taxRate) : 0,
          expenseApprovalThreshold: Number.isFinite(parseFloat(approvalThreshold))
            ? parseFloat(approvalThreshold)
            : 0,
          autoSendRecapLinks: autoSendLinks,
          autopilotEnabled: autopilot,
          autopilotAutoApprove: autoApprove,
       },
     },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey()});
          onOpenChange(false);
          toast({ title: "Business info saved", description: "New invoices and emails will use the updated details."});
       },
        onError: (e) =>
          toast({ title: "Couldn't save", description: e.message, variant: "destructive"}),
     },
    );
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Business info</DialogTitle>
          <DialogDescription>
            Shown in the FROM block on invoices, PDFs, and emails.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="company" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="company">Company</TabsTrigger>
            <TabsTrigger value="taxes">Taxes &amp; Terms</TabsTrigger>
            <TabsTrigger value="autopilot">Autopilot</TabsTrigger>
            <TabsTrigger value="danger" className="text-destructive data-[state=active]:text-destructive">
              Danger Zone
            </TabsTrigger>
          </TabsList>

          <TabsContent value="company" className="space-y-3 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Company name</Label>
                <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Tagline</Label>
                <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Street</Label>
                <Input value={street} onChange={(e) => setStreet(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>City, State ZIP</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Attention line</Label>
                <Input value={attn} onChange={(e) => setAttn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email (sender address)</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Invoices are emailed from this address — its domain must be verified with the email provider.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="taxes" className="space-y-3 mt-4">
            <div className="space-y-1.5">
              <Label>Sales tax rate (%)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                placeholder="0"
                data-testid="input-tax-rate"
              />
              <p className="text-xs text-muted-foreground">
                When set, new invoices automatically split this much sales tax out of the total for the tax report. Leave 0 if you don't collect sales tax.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Expense approval limit ($)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={approvalThreshold}
                onChange={(e) => setApprovalThreshold(e.target.value)}
                placeholder="0"
                data-testid="input-approval-threshold"
              />
              <p className="text-xs text-muted-foreground">
                Expenses at or above this amount wait for your approval before they hit the books. Leave 0 to turn approvals off.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Payment instructions</Label>
              <Textarea
                rows={4}
                value={paymentInstructions}
                onChange={(e) => setPaymentInstructions(e.target.value)}
                placeholder="How clients should pay — check remittance address, ACH details, etc."
              />
              <p className="text-xs text-muted-foreground">
                Default for new invoices; each invoice can override it.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="autopilot" className="space-y-3 mt-4">
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
              <div>
                <Label>Auto-send live job links</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  When a job is scheduled or completed, HALO automatically emails the
                  property's contact a live link with status and photos.
                </p>
              </div>
              <Switch
                checked={autoSendLinks}
                onCheckedChange={setAutoSendLinks}
                data-testid="switch-auto-send-links"
              />
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
              <div>
                <Label>Autopilot agent</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  HALO quietly watches your business in the background — overdue
                  invoices, crews sitting on job offers, jobs waiting too long to be
                  scheduled — and raises an alert for each one.
                </p>
              </div>
              <Switch
                checked={autopilot}
                onCheckedChange={setAutopilot}
                data-testid="switch-autopilot"
              />
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
              <div>
                <Label>Autopilot auto-approve</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Let Autopilot act on its own — payment reminder emails and job
                  rebroadcasts go out immediately, without waiting for your tap.
                  When off, everything waits for your approval on the Today page.
                </p>
              </div>
              <Switch
                checked={autoApprove}
                onCheckedChange={setAutoApprove}
                data-testid="switch-autopilot-auto-approve"
              />
            </div>
          </TabsContent>

          <TabsContent value="danger" className="mt-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="font-display font-bold text-sm text-destructive">Start fresh</div>
              <p className="text-xs text-muted-foreground mt-1">
                Wipes all sample/demo data — properties, jobs, invoices, expenses, crews,
                leads and more — so you can begin with a clean slate. Your company info and
                bank connection are kept. This can't be undone.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="w-4 h-4 mr-1.5" /> Wipe all data & start clean
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Wipe all data?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes every property, job, invoice, expense, crew,
                      lead, and message. Your company info and bank connection stay. This
                      cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={wipeData}
                      disabled={reset.isPending}
                      className="bg-destructive hover:bg-destructive/90 text-white"
                    >
                      {reset.isPending ? "Clearing…" : "Yes, wipe everything"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={update.isPending || !companyName.trim() || !email.trim()}
            className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
