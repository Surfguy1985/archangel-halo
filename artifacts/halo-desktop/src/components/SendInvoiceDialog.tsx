import { useEffect, useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useSendInvoice,
  useGetBusinessSettings,
  useGetProperty,
  useGetJob,
  useCreateContact,
  getListInvoicesQueryKey,
  getGetInvoiceQueryKey,
  getGetJobQueryKey,
  getGetMoneySummaryQueryKey,
  getGetPropertyQueryKey,
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
import { Button} from "@/components/ui/button";
import { Label} from "@/components/ui/label";
import { Input} from "@/components/ui/input";
import { Textarea} from "@/components/ui/textarea";
import { Checkbox} from "@/components/ui/checkbox";
import { Send, AlertTriangle} from "lucide-react";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD"});

export function SendInvoiceDialog({
  open,
  onOpenChange,
  invoice,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    invoiceNo: string;
    amount: number;
    jobId?: string | null;
    propertyId?: string | null;
    billToName?: string | null;
    propertyAddress?: string | null;
    recipientEmail?: string | null;
 } | null;
  onSent?: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: settings} = useGetBusinessSettings();
  const send = useSendInvoice();
  const createContact = useCreateContact();

  const propertyId = invoice?.propertyId ?? "";
  const { data: propertyDetail} = useGetProperty(propertyId, {
    query: { enabled: open && !!propertyId, queryKey: getGetPropertyQueryKey(propertyId)},
  });

  const jobId = invoice?.jobId ?? "";
  const { data: linkedJob} = useGetJob(jobId, {
    query: { enabled: open && !!jobId, queryKey: getGetJobQueryKey(jobId)},
  });
  const clientBudget =
    typeof linkedJob?.job?.clientBudget === "number" ? linkedJob.job.clientBudget : null;
  const overBudget = clientBudget != null && (invoice?.amount ?? 0) > clientBudget;
  const savedEmail =
    propertyDetail?.contacts.find((c) => c.email)?.email ?? null;
  // Only assert "missing" once contacts have actually loaded.
  const missingBillingEmail = !!propertyDetail && !savedEmail;

  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [saveAsBilling, setSaveAsBilling] = useState(true);

  useEffect(() => {
    if (open && invoice) {
      setRecipient(invoice.recipientEmail ?? "");
      setSubject(`Invoice ${invoice.invoiceNo} — ${money(invoice.amount)}`);
      setMessage(
       `${invoice.billToName ?`Hello ${invoice.billToName},\n` : ""}Please find attached invoice ${invoice.invoiceNo}${invoice.propertyAddress ?` for work at ${invoice.propertyAddress}` : ""}.`,
      );
      setSaveAsBilling(true);
   }
 }, [open, invoice]);

  // Prefill from the property's saved contact when the invoice didn't carry one.
  useEffect(() => {
    if (open && savedEmail) {
      setRecipient((r) => r || savedEmail);
   }
 }, [open, savedEmail]);

  const submit = () => {
    if (!invoice) return;
    const to = recipient.trim();
    if (missingBillingEmail && !to) {
      toast({
        title: "No billing email",
        description: "This property has no billing contact email — enter an address to send.",
        variant: "destructive",
     });
      return;
   }
    send.mutate(
      {
        id: invoice.id,
        data: {
          recipientEmail: to || undefined,
          subject: subject.trim() || undefined,
          message: message.trim() || undefined,
       },
     },
      {
        onSuccess: () => {
          // Optionally save the entered address as the property's billing contact
          // so future sends don't dead-end.
          if (missingBillingEmail && saveAsBilling && to && propertyId) {
            createContact.mutate(
              {
                data: {
                  propertyId,
                  name: invoice.billToName || "Billing contact",
                  role: "Billing",
                  email: to,
               },
             },
              {
                onSuccess: () =>
                  queryClient.invalidateQueries({
                    queryKey: getGetPropertyQueryKey(propertyId),
                 }),
             },
            );
         }
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey()});
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoice.id)});
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey()});
          onOpenChange(false);
          toast({
            title: "Invoice sent",
            description: to
              ?`${invoice.invoiceNo} emailed to ${to}.`
              :`${invoice.invoiceNo} emailed to the property's saved contact.`,
         });
          onSent?.();
       },
        onError: (e) =>
          toast({ title: "Couldn't send", description: e.message, variant: "destructive"}),
     },
    );
 };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-none shadow-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Send {invoice.invoiceNo}</DialogTitle>
          <DialogDescription>
            The branded invoice PDF is attached automatically.
            {settings?.email ? (
              <>
                {" "}Sent from <span className="font-medium text-foreground">{settings.email}</span>.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {overBudget && clientBudget != null && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Invoice exceeds client budget</p>
                  <p className="text-xs mt-0.5">
                    {money(invoice!.amount)} is over the {money(clientBudget)} client budget. You can still send.
                  </p>
                </div>
              </div>
            </div>
          )}
          {missingBillingEmail && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">No billing email on file for this property</p>
                  <p className="text-xs mt-0.5">
                    Enter an address below — we can save it to the property so this
                    doesn't happen again.
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Send to</Label>
            <Input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="anyone@example.com"
            />
            {!recipient && !missingBillingEmail && (
              <p className="text-xs text-muted-foreground">
                Leave blank to send to the property's saved contact, or enter any address.
              </p>
            )}
          </div>
          {missingBillingEmail && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={saveAsBilling}
                onCheckedChange={(v) => setSaveAsBilling(v === true)}
              />
              Save this address as the property's billing contact
            </label>
          )}
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={send.isPending || (missingBillingEmail && !recipient.trim())}
            className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
          >
            <Send className="w-4 h-4 mr-1.5" /> {send.isPending ? "Sending…" : "Send invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
