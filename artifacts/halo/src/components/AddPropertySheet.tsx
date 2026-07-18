import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProperty,
  getListPropertiesQueryKey,
} from "@workspace/api-client-react";
import { MapPin, Loader2 } from "lucide-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

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
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState(false);

  const create = useCreateProperty();

  const reset = () => {
    setName("");
    setPmcName("");
    setAddress("");
    setCity("");
    setUnits("");
    setAccessNotes("");
    setCoords(null);
    setPinning(false);
    setPinError(false);
  };

  const pinHere = () => {
    if (coords) {
      setCoords(null);
      return;
    }
    if (!("geolocation" in navigator)) {
      setPinError(true);
      return;
    }
    setPinning(true);
    setPinError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setPinning(false);
      },
      () => {
        setPinning(false);
        setPinError(true);
      },
      { enableHighAccuracy: true, timeout: 20_000 },
    );
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
            <button
              type="button"
              onClick={pinHere}
              disabled={pinning}
              className={`w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[12px] text-[14px] font-display font-bold border transition-transform active:scale-[0.98] ${
                coords
                  ? "text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] border-transparent shadow-[0_4px_14px_rgba(143,106,31,0.3)]"
                  : "bg-card border-border text-muted-foreground shadow-[var(--shadow)]"
              }`}
            >
              {pinning ? (
                <Loader2 className="w-[16px] h-[16px] animate-spin" />
              ) : (
                <MapPin className="w-[16px] h-[16px]" />
              )}
              {coords
                ? "Pinned to my current location — ON"
                : pinning
                  ? "Getting your location…"
                  : "Pin to my current location"}
            </button>
            {coords && (
              <div className="text-[12px] text-muted-foreground text-center -mt-[2px]">
                On-site detection will recognize this exact spot.
              </div>
            )}
            {pinError && (
              <div className="text-[12.5px] text-destructive text-center -mt-[2px]">
                Couldn't get your location. Allow location access and try again.
              </div>
            )}
          </div>

          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
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
