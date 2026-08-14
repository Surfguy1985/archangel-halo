import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProperty,
  getListPropertiesQueryKey,
} from "@workspace/api-client-react";
import { GpsFinder } from "@/components/GpsFinder";

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

export function AddPropertySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [pmcName, setPmcName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [units, setUnits] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const create = useCreateProperty();

  const reset = () => {
    setName("");
    setPmcName("");
    setAddress("");
    setCity("");
    setUnits("");
    setAccessNotes("");
    setCoords(null);
  };

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        data: {
          name: name.trim(),
          pmcName: pmcName.trim() || undefined,
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          units: units ? Number(units) : undefined,
          accessNotes: accessNotes.trim() || undefined,
          latitude: coords?.lat,
          longitude: coords?.lng,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListPropertiesQueryKey(),
          });
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
              Add property
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              Or just tap the gold mic and speak it.
            </div>
          </SheetHeader>

          <div className="flex flex-col gap-[10px]">
            <input
              className={fieldCls}
              placeholder="Property name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
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
                onChange={(e) =>
                  setUnits(e.target.value.replace(/[^0-9]/g, ""))
                }
              />
            </div>
            <textarea
              className={`${fieldCls} resize-none min-h-[74px]`}
              placeholder="Access notes (lockbox, gate code, who to call)"
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
            />
            <GpsFinder
              initialQuery={[address, city, name].filter(Boolean).join(", ")}
              onPinned={(p) => {
                setCoords({ lat: p.lat, lng: p.lng });
                if (p.address && !address.trim()) setAddress(p.address);
              }}
            />
          </div>

          <button
            className="w-full mt-[18px] rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save property"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">
              Couldn't save. Check the name and try again.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
