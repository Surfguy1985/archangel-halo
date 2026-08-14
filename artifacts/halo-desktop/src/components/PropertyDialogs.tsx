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
import { useEffect, useState} from "react";
import { useLocation} from "wouter";
import { useQueryClient} from "@tanstack/react-query";
import { Trash2} from "lucide-react";
import { GpsFinder } from "@/components/GpsFinder";
import {
  useCreateProperty,
  useUpdateProperty,
  useDeleteProperty,
  useCreatePriceItem,
  useUpdatePriceItem,
  useDeletePriceItem,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useCreateJob,
  useUpdateJob,
  useDeleteJob,
  useListCrews,
  getListPropertiesQueryKey,
  getGetPropertyQueryKey,
  getGetJobQueryKey,
  getListJobsQueryKey,
  getGetTodayQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-white border border-border rounded-[11px] py-2.5 px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40";

const labelCls = "text-[10px] font-bold text-[var(--gold-dark)]";

const primaryBtn =
  "flex items-center justify-center gap-2 bg-[var(--gold-light)] text-black px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm disabled:opacity-50 disabled:pointer-events-none";

const errorCls = "text-xs text-destructive text-center mt-2";

const SERVICE_CATEGORIES = [
  "Make Ready",
  "Paint",
  "Resurfacing",
  "Roof Repair/Replacement",
  "Electrical",
  "Plumbing",
  "Landscaping",
  "Cleaning",
  "Firewatch",
  "A/C Repairs",
  "General Handyman",
] as const;

const OTHER_SERVICE = "__other__";

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
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [units, setUnits] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const create = useCreateProperty();

  useEffect(() => {
    if (open) {
      setName("");
      setPmcName("");
      setCity("");
      setUnits("");
      setAccessNotes("");
      setPin(null);
   }
 }, [open]);

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
          latitude: pin?.lat,
          longitude: pin?.lng,
       },
     },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey()});
          onOpenChange(false);
       },
     },
    );
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-none shadow-xl">
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
          <Field label="Street address (shown to crews)">
            <input
              className={fieldCls}
              placeholder="Optional"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
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
          <Field label="GPS — search or drop a pin">
            <GpsFinder
              initialQuery={[address, city, name].filter(Boolean).join(", ")}
              onPinned={(p) => {
                setPin({ lat: p.lat, lng: p.lng });
                if (p.address && !address.trim()) setAddress(p.address);
              }}
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
  address?: string | null;
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
  const [address, setAddress] = useState(property.address ?? "");
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
    queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(property.id)});
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
      { id: property.id},
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey()});
          queryClient.removeQueries({ queryKey: getGetPropertyQueryKey(property.id)});
          setConfirmOpen(false);
          onOpenChange(false);
          navigate("/properties");
       },
        onError: (err: unknown) => {
          const msg =
            (err as { data?: { error?: string}})?.data?.error ||
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
        <DialogContent className="border-none shadow-xl">
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
            <Field label="Street address (shown to crews)">
              <input
                className={fieldCls}
                placeholder="Optional"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
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
            <Field label="GPS — search or drop a pin">
              <GpsFinder
                propertyId={property.id}
                initialQuery={[address, city, name].filter(Boolean).join(", ")}
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
  const [category, setCategory] = useState("");
  const [customService, setCustomService] = useState("");
  const [detail, setDetail] = useState("");
  const [unit, setUnit] = useState("each");
  const [rate, setRate] = useState("");
  const create = useCreatePriceItem();

  const service = category === OTHER_SERVICE ? customService : category;

  useEffect(() => {
    if (open) {
      setCategory("");
      setCustomService("");
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
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId)});
          onOpenChange(false);
       },
     },
    );
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-none shadow-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Add price item</DialogTitle>
          <DialogDescription>
            The agreed rate — used automatically when quoting.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Field label="Service">
            <select
              className={fieldCls}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              autoFocus
            >
              <option value="">Select a service…</option>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={OTHER_SERVICE}>Other…</option>
            </select>
          </Field>
          {category === OTHER_SERVICE && (
            <Field label="Service name">
              <input
                className={fieldCls}
                placeholder="Type the service name"
                value={customService}
                onChange={(e) => setCustomService(e.target.value)}
                autoFocus
              />
            </Field>
          )}
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
          <div className={errorCls}>
            {(create.error as { data?: { error?: string } })?.data?.error ||
              "Couldn't save. Check the fields and try again."}
          </div>
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
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId)});
          onOpenChange(false);
       },
     },
    );
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-none shadow-xl">
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

/* -------------------------------------------------------------------- Add Job */

export function AddJobDialog({
  open,
  onOpenChange,
  propertyId,
  priceItems,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  /** Called with the new job's id so the page can flash/highlight its card. */
  onCreated?: (jobId: string) => void;
  priceItems?: {
    id: string;
    service: string;
    detail?: string | null;
    rate: number;
    unit?: string | null;
 }[];
}) {
  const queryClient = useQueryClient();
  const { data: crews} = useListCrews();
  const [description, setDescription] = useState("");
  const [priceItemId, setPriceItemId] = useState("");
  const [category, setCategory] = useState("");
  const [unitNo, setUnitNo] = useState("");
  const [woNo, setWoNo] = useState("");
  const [crewLeaderId, setCrewLeaderId] = useState("");
  const [inspectionRequired, setInspectionRequired] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState("weekly");
  const [scheduleType, setScheduleType] = useState<"scheduled" | "flex">("scheduled");
  const [scheduledOn, setScheduledOn] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [flexDays, setFlexDays] = useState("7");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateJob();

  useEffect(() => {
    if (open) {
      setDescription("");
      setPriceItemId("");
      setCategory("");
      setUnitNo("");
      setWoNo("");
      setCrewLeaderId("");
      setInspectionRequired(false);
      setIsRecurring(false);
      setRecurrence("weekly");
      setScheduleType("scheduled");
      setScheduledOn("");
      setScheduledTime("");
      setFlexDays("7");
      setError(null);
   }
 }, [open]);

  const submit = () => {
    if (!description.trim()) {
      setError("A short description is required.");
      return;
   }
    create.mutate(
      {
        data: {
          propertyId,
          description: description.trim(),
          category: category.trim() || undefined,
          unitNo: unitNo.trim() || undefined,
          woNo: woNo.trim() || undefined,
          crewLeaderId: crewLeaderId || undefined,
          inspectionRequired: inspectionRequired || undefined,
          isRecurring: isRecurring || undefined,
          recurrence: isRecurring
            ? (recurrence as "daily" | "weekly" | "biweekly" | "monthly" | "quarterly")
            : undefined,
          scheduleType,
          scheduledOn: scheduleType === "scheduled" && scheduledOn ? scheduledOn : undefined,
          scheduledTime: scheduleType === "scheduled" && scheduledTime ? scheduledTime : undefined,
          flexDays: scheduleType === "flex" ? Math.max(1, Number(flexDays) || 7) : undefined,
       },
     },
      {
        onSuccess: (job) => {
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId)});
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey()});
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
          if (job?.id) onCreated?.(job.id);
          onOpenChange(false);
       },
        onError: (err: unknown) => {
          setError(
            (err as { data?: { error?: string}})?.data?.error ||
              "Couldn't create the job.",
          );
       },
     },
    );
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-none shadow-xl">
        <DialogHeader>
          <DialogTitle className="font-display">New job</DialogTitle>
          <DialogDescription>
            Add a work order for this property. You can add as many as you need.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Field label="Description">
            <input
              className={fieldCls}
              placeholder="e.g. Full turn — paint, clean, punch list"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setPriceItemId("");
             }}
              autoFocus
            />
          </Field>
          <Field label="Or pick from this property's price list">
            <select
              className={fieldCls}
              value={priceItemId}
              data-testid="select-job-price-item"
              onChange={(e) => {
                const itemId = e.target.value;
                setPriceItemId(itemId);
                const item = priceItems?.find((p) => p.id === itemId);
                if (item) {
                  setDescription(
                    item.detail ?`${item.service} — ${item.detail}` : item.service,
                  );
                  setCategory(item.service);
               } else {
                  setDescription("");
                  setCategory("");
               }
             }}
            >
              <option value="">
                {(priceItems?.length ?? 0) > 0
                  ? "Choose a service…"
                  : "No price list items yet — add rates on this property"}
              </option>
              {priceItems?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.service}
                  {p.detail ?` — ${p.detail}` : ""} (${p.rate}
                  {p.unit ?`/${p.unit}` : ""})
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <input
                className={fieldCls}
                placeholder="e.g. Turn, Paint"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </Field>
            <Field label="Unit #">
              <input
                className={fieldCls}
                placeholder="e.g. 204"
                value={unitNo}
                onChange={(e) => setUnitNo(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PO # (optional — you can add it later at the invoice stage)">
              <input
                className={fieldCls}
                placeholder="e.g. PO-1234"
                value={woNo}
                onChange={(e) => setWoNo(e.target.value)}
              />
            </Field>
            <Field label="Crew leader (optional)">
              <select
                className={fieldCls}
                value={crewLeaderId}
                onChange={(e) => setCrewLeaderId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {(crews ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Schedule">
            <div className="flex gap-2">
              {(
                [
                  ["scheduled", "Fixed schedule"],
                  ["flex", "Flex — own time"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScheduleType(value)}
                  className={`flex-1 rounded-[10px] py-2 text-[13px] font-display font-bold border transition-colors ${
                    scheduleType === value
                      ? "bg-[var(--primary)] text-[var(--ink)] border-transparent"
                      : "bg-card border-border text-muted-foreground hover:text-foreground"
                 }`}
                  data-testid={`button-schedule-${value}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          {scheduleType === "scheduled" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input
                  type="date"
                  className={fieldCls}
                  value={scheduledOn}
                  onChange={(e) => setScheduledOn(e.target.value)}
                  data-testid="input-scheduled-date"
                />
              </Field>
              <Field label="Start time">
                <input
                  type="time"
                  className={fieldCls}
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  data-testid="input-scheduled-time"
                />
              </Field>
            </div>
          ) : (
            <Field label="Must be completed within">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  className={`${fieldCls} !w-[110px]`}
                  value={flexDays}
                  onChange={(e) => setFlexDays(e.target.value)}
                  data-testid="input-flex-days"
                />
                <span className="text-sm text-muted-foreground">days from today</span>
              </div>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={inspectionRequired}
              onChange={(e) => setInspectionRequired(e.target.checked)}
              className="accent-[var(--gold)] w-4 h-4"
            />
            Inspection required before invoicing
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className="accent-[var(--gold)] w-4 h-4"
            />
            Recurring job
          </label>
          {isRecurring && (
            <Field label="How often">
              <select
                className={fieldCls}
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </Field>
          )}
          {error && <p className={errorCls}>{error}</p>}
        </div>
        <DialogFooter>
          <button className={primaryBtn} onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create job"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------- Edit Price Item */

export function EditPriceItemDialog({
  open,
  onOpenChange,
  item,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: { id: string; service: string; detail?: string | null; unit?: string | null; rate: number};
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const [service, setService] = useState(item.service);
  const [detail, setDetail] = useState(item.detail ?? "");
  const [unit, setUnit] = useState(item.unit ?? "");
  const [rate, setRate] = useState(String(item.rate));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setService(item.service);
      setDetail(item.detail ?? "");
      setUnit(item.unit ?? "");
      setRate(String(item.rate));
      setDeleteError(null);
   }
 }, [open, item]);

  const update = useUpdatePriceItem();
  const del = useDeletePriceItem();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId)});
 };

  const submit = () => {
    const rateNum = parseFloat(rate);
    if (!service.trim() || isNaN(rateNum)) return;
    update.mutate(
      {
        id: item.id,
        data: {
          service: service.trim(),
          detail: detail.trim() || null,
          unit: unit.trim() || null,
          rate: rateNum,
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
      { id: item.id},
      {
        onSuccess: () => {
          invalidate();
          setConfirmOpen(false);
          onOpenChange(false);
       },
        onError: (err: unknown) => {
          setDeleteError(
            (err as { data?: { error?: string}})?.data?.error || "Couldn't delete this price item.",
          );
          setConfirmOpen(false);
       },
     },
    );
 };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="border-none shadow-xl">
          <DialogHeader>
            <DialogTitle className="font-display">Edit price item</DialogTitle>
            <DialogDescription>Update the agreed rate, or remove it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Field label="Service">
              <input className={fieldCls} value={service} onChange={(e) => setService(e.target.value)} />
            </Field>
            <Field label="Detail">
              <input className={fieldCls} placeholder="Optional" value={detail} onChange={(e) => setDetail(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rate">
                <input className={fieldCls} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              </Field>
              <Field label="Unit">
                <input className={fieldCls} placeholder="each" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </Field>
            </div>
          </div>
          {update.isError && (
            <div className={errorCls}>
              {(update.error as { data?: { error?: string } })?.data?.error ||
                "Couldn't save. Check the fields and try again."}
            </div>
          )}
          {deleteError && <div className={errorCls}>{deleteError}</div>}
          <DialogFooter className="gap-2 sm:justify-between">
            <button
              className="flex items-center justify-center gap-2 text-destructive px-4 py-2 rounded-md font-medium border border-destructive/30 hover:bg-destructive/5 transition-colors text-sm"
              onClick={() => setConfirmOpen(true)}
              disabled={del.isPending}
            >
              <Trash2 className="w-4 h-4" /> {del.isPending ? "Deleting…" : "Delete"}
            </button>
            <button className={primaryBtn} onClick={submit} disabled={!service.trim() || !rate.trim() || update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete {item.service}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the agreed rate from this property. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete();}}
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

/* ---------------------------------------------------------------- Edit Contact */

export function EditContactDialog({
  open,
  onOpenChange,
  contact,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: { id: string; name: string; role?: string | null; phone?: string | null; email?: string | null; prefers?: string | null};
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(contact.name);
  const [role, setRole] = useState(contact.role ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [prefers, setPrefers] = useState(contact.prefers ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(contact.name);
      setRole(contact.role ?? "");
      setPhone(contact.phone ?? "");
      setEmail(contact.email ?? "");
      setPrefers(contact.prefers ?? "");
      setDeleteError(null);
   }
 }, [open, contact]);

  const update = useUpdateContact();
  const del = useDeleteContact();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId)});
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
      { id: contact.id},
      {
        onSuccess: () => {
          invalidate();
          setConfirmOpen(false);
          onOpenChange(false);
       },
        onError: (err: unknown) => {
          setDeleteError(
            (err as { data?: { error?: string}})?.data?.error || "Couldn't delete this contact.",
          );
          setConfirmOpen(false);
       },
     },
    );
 };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="border-none shadow-xl">
          <DialogHeader>
            <DialogTitle className="font-display">Edit contact</DialogTitle>
            <DialogDescription>Update their details, or remove them.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Field label="Full name">
              <input className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Role">
              <input className={fieldCls} placeholder="e.g. Property Manager" value={role} onChange={(e) => setRole(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <input className={fieldCls} placeholder="Optional" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Email">
                <input className={fieldCls} placeholder="Optional" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
            <Field label="Prefers">
              <input className={fieldCls} placeholder="e.g. text before 3pm" value={prefers} onChange={(e) => setPrefers(e.target.value)} />
            </Field>
          </div>
          {update.isError && <div className={errorCls}>Couldn't save. Check the name and try again.</div>}
          {deleteError && <div className={errorCls}>{deleteError}</div>}
          <DialogFooter className="gap-2 sm:justify-between">
            <button
              className="flex items-center justify-center gap-2 text-destructive px-4 py-2 rounded-md font-medium border border-destructive/30 hover:bg-destructive/5 transition-colors text-sm"
              onClick={() => setConfirmOpen(true)}
              disabled={del.isPending}
            >
              <Trash2 className="w-4 h-4" /> {del.isPending ? "Deleting…" : "Delete"}
            </button>
            <button className={primaryBtn} onClick={submit} disabled={!name.trim() || update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Remove {contact.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the contact from this property. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete();}}
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

/* -------------------------------------------------------------------- Edit Job */

export function EditJobDialog({
  open,
  onOpenChange,
  job,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: {
    id: string;
    description?: string | null;
    category?: string | null;
    unitNo?: string | null;
    woNo?: string | null;
    crewLeaderId?: string | null;
    inspectionRequired?: boolean | null;
    isRecurring?: boolean | null;
    recurrence?: string | null;
 };
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const { data: crews} = useListCrews();
  const [description, setDescription] = useState(job.description ?? "");
  const [category, setCategory] = useState(job.category ?? "");
  const [unitNo, setUnitNo] = useState(job.unitNo ?? "");
  const [woNo, setWoNo] = useState(job.woNo ?? "");
  const [crewLeaderId, setCrewLeaderId] = useState(job.crewLeaderId ?? "");
  const [inspectionRequired, setInspectionRequired] = useState(!!job.inspectionRequired);
  const [isRecurring, setIsRecurring] = useState(!!job.isRecurring);
  const [recurrence, setRecurrence] = useState(job.recurrence ?? "weekly");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setDescription(job.description ?? "");
      setCategory(job.category ?? "");
      setUnitNo(job.unitNo ?? "");
      setWoNo(job.woNo ?? "");
      setCrewLeaderId(job.crewLeaderId ?? "");
      setInspectionRequired(!!job.inspectionRequired);
      setIsRecurring(!!job.isRecurring);
      setRecurrence(job.recurrence ?? "weekly");
      setError(null);
   }
 }, [open, job]);

  const update = useUpdateJob();
  const del = useDeleteJob();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId)});
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(job.id)});
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
 };

  const submit = () => {
    if (!description.trim()) {
      setError("A short description is required.");
      return;
   }
    update.mutate(
      {
        id: job.id,
        data: {
          description: description.trim(),
          category: category.trim() || undefined,
          unitNo: unitNo.trim() || undefined,
          woNo: woNo.trim() || undefined,
          crewLeaderId: crewLeaderId || null,
          inspectionRequired,
          isRecurring,
          recurrence: isRecurring
            ? (recurrence as "daily" | "weekly" | "biweekly" | "monthly" | "quarterly")
            : null,
       },
     },
      {
        onSuccess: () => {
          invalidate();
          onOpenChange(false);
       },
        onError: (err: unknown) => {
          setError(
            (err as { data?: { error?: string}})?.data?.error || "Couldn't save the job.",
          );
       },
     },
    );
 };

  const confirmDelete = () => {
    setError(null);
    del.mutate(
      { id: job.id},
      {
        onSuccess: () => {
          invalidate();
          setConfirmOpen(false);
          onOpenChange(false);
       },
        onError: (err: unknown) => {
          setError(
            (err as { data?: { error?: string}})?.data?.error || "Couldn't delete this job.",
          );
          setConfirmOpen(false);
       },
     },
    );
 };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="border-none shadow-xl">
          <DialogHeader>
            <DialogTitle className="font-display">Edit job</DialogTitle>
            <DialogDescription>Update the work order details, or delete it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Field label="Description">
              <input className={fieldCls} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <input className={fieldCls} placeholder="e.g. Turn, Paint" value={category} onChange={(e) => setCategory(e.target.value)} />
              </Field>
              <Field label="Unit #">
                <input className={fieldCls} placeholder="e.g. 204" value={unitNo} onChange={(e) => setUnitNo(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PO # (optional)">
                <input className={fieldCls} placeholder="e.g. PO-1234" value={woNo} onChange={(e) => setWoNo(e.target.value)} />
              </Field>
              <Field label="Crew leader (optional)">
                <select className={fieldCls} value={crewLeaderId} onChange={(e) => setCrewLeaderId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {(crews ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={inspectionRequired}
                onChange={(e) => setInspectionRequired(e.target.checked)}
                className="accent-[var(--gold)] w-4 h-4"
              />
              Inspection required before invoicing
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="accent-[var(--gold)] w-4 h-4"
              />
              Recurring job
            </label>
            {isRecurring && (
              <Field label="How often">
                <select className={fieldCls} value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </Field>
            )}
            {error && <p className={errorCls}>{error}</p>}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <button
              className="flex items-center justify-center gap-2 text-destructive px-4 py-2 rounded-md font-medium border border-destructive/30 hover:bg-destructive/5 transition-colors text-sm"
              onClick={() => setConfirmOpen(true)}
              disabled={del.isPending}
            >
              <Trash2 className="w-4 h-4" /> {del.isPending ? "Deleting…" : "Delete"}
            </button>
            <button className={primaryBtn} onClick={submit} disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the job and its history. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete();}}
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
