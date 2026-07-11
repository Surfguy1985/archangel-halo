import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBusinessSettings,
  useUpdateBusinessSettings,
  getGetBusinessSettingsQueryKey,
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
import { Textarea } from "@/components/ui/textarea";

export function BusinessInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings } = useGetBusinessSettings();
  const update = useUpdateBusinessSettings();

  const [companyName, setCompanyName] = useState("");
  const [tagline, setTagline] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [attn, setAttn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");

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
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey() });
          onOpenChange(false);
          toast({ title: "Business info saved", description: "New invoices and emails will use the updated details." });
        },
        onError: (e) =>
          toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
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
        <div className="space-y-3">
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={update.isPending || !companyName.trim() || !email.trim()}
            className="bg-[var(--gold)] hover:bg-[var(--gold-dark)] text-white"
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
