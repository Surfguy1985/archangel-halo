import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import {
  useUpdateContact,
  useDeleteContact,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

type ContactLike = {
  id: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  prefers?: string | null;
};

export function EditContactSheet({
  open,
  onOpenChange,
  contact,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: ContactLike;
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(contact.name);
  const [role, setRole] = useState(contact.role ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [prefers, setPrefers] = useState(contact.prefers ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setName(contact.name);
      setRole(contact.role ?? "");
      setPhone(contact.phone ?? "");
      setEmail(contact.email ?? "");
      setPrefers(contact.prefers ?? "");
    }
  }, [open, contact]);

  const update = useUpdateContact();
  const del = useDeleteContact();

  const done = () => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
    onOpenChange(false);
  };

  const submit = () => {
    if (!name.trim()) return;
    update.mutate(
      {
        id: contact.id,
        data: {
          name: name.trim(),
          role: role.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          prefers: prefers.trim() || null,
        },
      },
      { onSuccess: done },
    );
  };

  const confirmDelete = () => {
    del.mutate(
      { id: contact.id },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          done();
        },
      },
    );
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
        >
          <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
          <div className="p-[8px_20px_26px] overflow-y-auto">
            <SheetHeader className="text-left mb-[16px]">
              <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Edit contact</SheetTitle>
              <div className="text-[13px] text-muted-foreground">Update their details, or remove them.</div>
            </SheetHeader>
            <div className="flex flex-col gap-[10px]">
              <input className={fieldCls} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <input className={fieldCls} placeholder="Role (e.g. Property Manager)" value={role} onChange={(e) => setRole(e.target.value)} />
              <input className={fieldCls} placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input className={fieldCls} placeholder="Email" inputMode="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className={fieldCls} placeholder="Prefers (e.g. text before 3pm)" value={prefers} onChange={(e) => setPrefers(e.target.value)} />
            </div>
            <button
              className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
              onClick={submit}
              disabled={!name.trim() || update.isPending}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              className="w-full mt-[10px] rounded-[13px] py-[12px] font-semibold text-[14px] text-destructive border border-destructive/30 bg-destructive/5 flex items-center justify-center gap-[7px] disabled:opacity-50"
              onClick={() => setConfirmOpen(true)}
              disabled={del.isPending}
            >
              <Trash2 className="w-[15px] h-[15px]" />
              Delete contact
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {contact.name} will be removed from this property. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
