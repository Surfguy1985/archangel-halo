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
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import {
  useUpdateProperty,
  useDeleteProperty,
  getListPropertiesQueryKey,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

type PropertyLike = {
  id: string;
  name: string;
  pmcName?: string | null;
  address?: string | null;
  city?: string | null;
  units?: number | null;
  accessNotes?: string | null;
};

export function EditPropertySheet({
  open,
  onOpenChange,
  property,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: PropertyLike;
}) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [name, setName] = useState(property.name);
  const [pmcName, setPmcName] = useState(property.pmcName ?? "");
  const [address, setAddress] = useState(property.address ?? "");
  const [city, setCity] = useState(property.city ?? "");
  const [units, setUnits] = useState(property.units != null ? String(property.units) : "");
  const [accessNotes, setAccessNotes] = useState(property.accessNotes ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(property.name);
      setPmcName(property.pmcName ?? "");
      setAddress(property.address ?? "");
      setCity(property.city ?? "");
      setUnits(property.units != null ? String(property.units) : "");
      setAccessNotes(property.accessNotes ?? "");
      setDeleteError(null);
    }
  }, [open, property]);

  const update = useUpdateProperty();
  const del = useDeleteProperty();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(property.id) });
  };

  const submit = () => {
    if (!name.trim()) return;
    update.mutate(
      {
        id: property.id,
        data: {
          name: name.trim(),
          pmcName: pmcName.trim() || undefined,
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          units: units ? Number(units) : undefined,
          accessNotes: accessNotes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          onOpenChange(false);
        },
      },
    );
  };

  const confirmDelete = () => {
    setDeleteError(null);
    del.mutate(
      { id: property.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
          setConfirmOpen(false);
          onOpenChange(false);
          navigate("/properties");
        },
        onError: (err: unknown) => {
          const msg =
            (err as { data?: { error?: string } })?.data?.error ||
            "Couldn't delete. It may still have jobs attached.";
          setDeleteError(msg);
          setConfirmOpen(false);
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
              <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
                Edit property
              </SheetTitle>
              <div className="text-[13px] text-muted-foreground">
                Update the details, or remove it entirely.
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-[10px]">
              <input
                className={fieldCls}
                placeholder="Property name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className={fieldCls}
                placeholder="Management company (PMC)"
                value={pmcName}
                onChange={(e) => setPmcName(e.target.value)}
              />
              <input
                className={fieldCls}
                placeholder="Street address (shown to crews)"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <div className="flex gap-[10px]">
                <input
                  className={fieldCls}
                  placeholder="City"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
                <input
                  className={fieldCls}
                  placeholder="Units"
                  inputMode="numeric"
                  value={units}
                  onChange={(e) => setUnits(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </div>
              <textarea
                className={`${fieldCls} resize-none min-h-[74px]`}
                placeholder="Access notes (lockbox, gate code, who to call)"
                value={accessNotes}
                onChange={(e) => setAccessNotes(e.target.value)}
              />
            </div>

            <button
              className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
              onClick={submit}
              disabled={!name.trim() || update.isPending}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
            {update.isError && (
              <div className="text-[12.5px] text-destructive text-center mt-[10px]">
                Couldn't save. Check the name and try again.
              </div>
            )}

            <button
              className="w-full mt-[10px] rounded-[13px] py-[12px] font-semibold text-[14px] text-destructive flex items-center justify-center gap-[7px] border border-[rgba(190,60,60,0.28)] transition-transform active:scale-[0.98]"
              onClick={() => {
                setDeleteError(null);
                setConfirmOpen(true);
              }}
              disabled={del.isPending}
            >
              <Trash2 className="w-[15px] h-[15px]" />
              {del.isPending ? "Deleting…" : "Delete property"}
            </button>
            {deleteError && (
              <div className="text-[12.5px] text-destructive text-center mt-[10px]">
                {deleteError}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-[var(--paper)] border-none rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              Delete {property.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the property, its price list, and its contacts. Jobs must
              be removed first. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
