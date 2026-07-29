import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateContact, getGetPropertyQueryKey } from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

export function AddContactSheet({
  open,
  onOpenChange,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [prefers, setPrefers] = useState("");
  const create = useCreateContact();

  const reset = () => {
    setName("");
    setRole("");
    setPhone("");
    setEmail("");
    setPrefers("");
  };

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        data: {
          propertyId,
          name: name.trim(),
          role: role.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          prefers: prefers.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Add contact</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Set once — inherited by every job here.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <input className={fieldCls} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <input className={fieldCls} placeholder="Role (e.g. Property Manager)" value={role} onChange={(e) => setRole(e.target.value)} />
            <input className={fieldCls} placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className={fieldCls} placeholder="Email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={fieldCls} placeholder="Prefers (e.g. text before 3pm)" value={prefers} onChange={(e) => setPrefers(e.target.value)} />
          </div>
          <button
            className="w-full mt-[18px] rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save contact"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Check the name and try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
