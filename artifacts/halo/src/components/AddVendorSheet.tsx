import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateVendor, getListVendorsQueryKey } from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

export function AddVendorSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [coiExpiresOn, setCoiExpiresOn] = useState("");
  const create = useCreateVendor();

  const reset = () => {
    setName("");
    setTrade("");
    setEmail("");
    setPhone("");
    setCoiExpiresOn("");
  };

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        data: {
          name: name.trim(),
          trade: trade.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          coiExpiresOn: coiExpiresOn || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Add vendor</SheetTitle>
            <div className="text-[13px] text-muted-foreground">HALO flags a lapsing COI before it bites.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <input className={fieldCls} placeholder="Vendor name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <input className={fieldCls} placeholder="Trade (e.g. HVAC, Roofing)" value={trade} onChange={(e) => setTrade(e.target.value)} />
            <input className={fieldCls} placeholder="Email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={fieldCls} placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <label className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-[0.1em] mt-[2px] ml-[2px]">COI expires</label>
            <input className={fieldCls} type="date" value={coiExpiresOn} onChange={(e) => setCoiExpiresOn(e.target.value)} />
          </div>
          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save vendor"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
