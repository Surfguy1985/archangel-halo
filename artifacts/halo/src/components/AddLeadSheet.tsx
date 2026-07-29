import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateLead, useListProperties, getListLeadsQueryKey } from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

export function AddLeadSheet({
  open,
  onOpenChange,
  propertyId: fixedPropertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId?: string;
}) {
  const queryClient = useQueryClient();
  const { data: properties } = useListProperties();
  const [summary, setSummary] = useState("");
  const [source, setSource] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [propertyId, setPropertyId] = useState(fixedPropertyId ?? "");
  const create = useCreateLead();

  const reset = () => {
    setSummary("");
    setSource("");
    setContactName("");
    setContactEmail("");
    setPropertyId(fixedPropertyId ?? "");
  };

  const submit = () => {
    if (!summary.trim()) return;
    create.mutate(
      {
        data: {
          summary: summary.trim(),
          source: source.trim() || undefined,
          propertyId: propertyId || undefined,
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">New lead</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Add a contact email to unlock one-tap follow-ups.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <textarea className={`${fieldCls} min-h-[72px] resize-none`} placeholder="What's the opportunity?" value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />
            <div className="flex gap-[10px]">
              <input className={`${fieldCls} flex-1`} placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              <input className={`${fieldCls} flex-1`} type="email" placeholder="Contact email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
            <input className={fieldCls} placeholder="Source (e.g. referral, PMC email)" value={source} onChange={(e) => setSource(e.target.value)} />
            {!fixedPropertyId && (
              <select className={fieldCls} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                <option value="">No property yet</option>
                {properties?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
          <button
            className="w-full mt-[18px] rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!summary.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save lead"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
