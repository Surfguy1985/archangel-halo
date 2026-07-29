import { useEffect, useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useSendInvoice,
  useGetBusinessSettings,
  getListInvoicesQueryKey,
  getGetInvoiceQueryKey,
  getGetMoneySummaryQueryKey,
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
import { Send} from "lucide-react";

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

  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open && invoice) {
      setRecipient(invoice.recipientEmail ?? "");
      setSubject(`Invoice ${invoice.invoiceNo} — ${money(invoice.amount)}`);
      setMessage(
       `${invoice.billToName ?`Hello ${invoice.billToName},\n` : ""}Please find attached invoice ${invoice.invoiceNo}${invoice.propertyAddress ?` for work at ${invoice.propertyAddress}` : ""}.`,
      );
   }
 }, [open, invoice]);

  const submit = () => {
    if (!invoice) return;
    const to = recipient.trim();
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
      <DialogContent className="max-w-lg">
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
          <div className="space-y-1.5">
            <Label>Send to</Label>
            <Input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="anyone@example.com"
            />
            {!recipient && (
              <p className="text-xs text-muted-foreground">
                Leave blank to send to the property's saved contact, or enter any address.
              </p>
            )}
          </div>
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
            disabled={send.isPending}
            className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
          >
            <Send className="w-4 h-4 mr-1.5" /> {send.isPending ? "Sending…" : "Send invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
