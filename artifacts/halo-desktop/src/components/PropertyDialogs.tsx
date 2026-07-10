import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  useCreateProperty,
  useUpdateProperty,
  useDeleteProperty,
  useCreatePriceItem,
  useCreateContact,
  getListPropertiesQueryKey,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-input rounded-md py-2.5 px-3.5 text-sm shadow-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const labelCls = "text-xs font-semibold text-muted-foreground";

const primaryBtn =
  "flex items-center justify-center gap-2 bg-[var(--gold)] text-white px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm disabled:opacity-50 disabled:pointer-events-none";

const errorCls = "text-xs text-destructive text-center mt-2";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

/* ---------------------------------------------------------------- Add Property */

export function AddPropertyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [pmcName, setPmcName] = useState("");
  const [city, setCity] = useState("");
  const [units, setUnits] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const create = useCreateProperty();

  useEffect(() => {
    if (open) {
      setName("");
      setPmcName("");
      setCity("");
      setUnits("");
      setAccessNotes("");
    }
  }, [open]);

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        data: {
          name: name.trim(),
          pmcName: pmcName.trim() || undefined,
          city: city.trim() || undefined,
          units: units ? Number(units) : undefined,
          accessNotes: accessNotes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Add property</DialogTitle>
          <DialogDescription>
            Create a new location. You can add rates and contacts after.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Field label="Property name">
            <input
              className={fieldCls}
              placeholder="e.g. Oakwood Townhomes"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Management company (PMC)">
            <input
              className={fieldCls}
              placeholder="Optional"
              value={pmcName}
              onChange={(e) => setPmcName(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City">
              <input
                className={fieldCls}
                placeholder="Optional"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </Field>
            <Field label="Units">
              <input
                className={fieldCls}
                placeholder="0"
                inputMode="numeric"
                value={units}
                onChange={(e) => setUnits(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </Field>
          </div>
          <Field label="Access notes">
            <textarea
              className={`${fieldCls} resize-none min-h-[80px]`}
              placeholder="Lockbox, gate code, who to call"
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <button
            className={primaryBtn}
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save property"}
          </button>
        </DialogFooter>
        {create.isError && (
          <div className={errorCls}>Couldn't save. Check the name and try again.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------------- Edit Property */

type PropertyLike = {
  id: string;
  name: string;
  pmcName?: string | null;
  city?: string | null;
  units?: number | null;
  accessNotes?: string | null;
};

export function EditPropertyDialog({
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
  const [city, setCity] = useState(property.city ?? "");
  const [units, setUnits] = useState(
    property.units != null ? String(property.units) : "",
  );
  const [accessNotes, setAccessNotes] = useState(property.accessNotes ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(property.name);
      setPmcName(property.pmcName ?? "");
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
          queryClient.removeQueries({ queryKey: getGetPropertyQueryKey(property.id) });
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Edit property</DialogTitle>
            <DialogDescription>
              Update the details, or remove it entirely.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Field label="Property name">
              <input
                className={fieldCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Management company (PMC)">
              <input
                className={fieldCls}
                placeholder="Optional"
                value={pmcName}
                onChange={(e) => setPmcName(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <input
                  className={fieldCls}
                  placeholder="Optional"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </Field>
              <Field label="Units">
                <input
                  className={fieldCls}
                  placeholder="0"
                  inputMode="numeric"
                  value={units}
                  onChange={(e) => setUnits(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </Field>
            </div>
            <Field label="Access notes">
              <textarea
                className={`${fieldCls} resize-none min-h-[80px]`}
                placeholder="Lockbox, gate code, who to call"
                value={accessNotes}
                onChange={(e) => setAccessNotes(e.target.value)}
              />
            </Field>
          </div>
          {update.isError && (
            <div className={errorCls}>Couldn't save. Check the name and try again.</div>
          )}
          {deleteError && <div className={errorCls}>{deleteError}</div>}
          <DialogFooter className="sm:justify-between">
            <button
              className="flex items-center gap-2 text-sm font-semibold text-destructive px-4 py-2 rounded-md border border-[rgba(190,60,60,0.28)] hover:bg-destructive/5 transition-colors disabled:opacity-50"
              onClick={() => {
                setDeleteError(null);
                setConfirmOpen(true);
              }}
              disabled={del.isPending}
            >
              <Trash2 className="w-4 h-4" />
              {del.isPending ? "Deleting…" : "Delete"}
            </button>
            <button
              className={primaryBtn}
              onClick={submit}
              disabled={!name.trim() || update.isPending}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
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

/* -------------------------------------------------------------- Add Price Item */

export function AddPriceItemDialog({
  open,
  onOpenChange,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const [service, setService] = useState("");
  const [detail, setDetail] = useState("");
  const [unit, setUnit] = useState("each");
  const [rate, setRate] = useState("");
  const create = useCreatePriceItem();

  useEffect(() => {
    if (open) {
      setService("");
      setDetail("");
      setUnit("each");
      setRate("");
    }
  }, [open]);

  const submit = () => {
    const rateNum = parseFloat(rate);
    if (!service.trim() || isNaN(rateNum)) return;
    create.mutate(
      {
        id: propertyId,
        data: {
          service: service.trim(),
          detail: detail.trim() || undefined,
          unit: unit.trim() || undefined,
          rate: rateNum,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Add price item</DialogTitle>
          <DialogDescription>
            The agreed rate — used automatically when quoting.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Field label="Service">
            <input
              className={fieldCls}
              placeholder="e.g. Full turn"
              value={service}
              onChange={(e) => setService(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Detail">
            <input
              className={fieldCls}
              placeholder="Optional"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rate">
              <input
                className={fieldCls}
                placeholder="0.00"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </Field>
            <Field label="Unit">
              <input
                className={fieldCls}
                placeholder="each"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <button
            className={primaryBtn}
            onClick={submit}
            disabled={!service.trim() || !rate.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save price item"}
          </button>
        </DialogFooter>
        {create.isError && (
          <div className={errorCls}>Couldn't save. Check the fields and try again.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- Add Contact */

export function AddContactDialog({
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

  useEffect(() => {
    if (open) {
      setName("");
      setRole("");
      setPhone("");
      setEmail("");
      setPrefers("");
    }
  }, [open]);

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
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Add contact</DialogTitle>
          <DialogDescription>
            Set once — inherited by every job at this property.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Field label="Full name">
            <input
              className={fieldCls}
              placeholder="e.g. Dana Reyes"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Role">
            <input
              className={fieldCls}
              placeholder="e.g. Property Manager"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input
                className={fieldCls}
                placeholder="Optional"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                className={fieldCls}
                placeholder="Optional"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Prefers">
            <input
              className={fieldCls}
              placeholder="e.g. text before 3pm"
              value={prefers}
              onChange={(e) => setPrefers(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <button
            className={primaryBtn}
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save contact"}
          </button>
        </DialogFooter>
        {create.isError && (
          <div className={errorCls}>Couldn't save. Check the name and try again.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
