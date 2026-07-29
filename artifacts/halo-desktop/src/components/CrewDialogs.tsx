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
import { useQueryClient} from "@tanstack/react-query";
import { Trash2} from "lucide-react";
import {
  useCreateCrew,
  useUpdateCrew,
  useDeleteCrew,
  getListCrewsQueryKey,
  getGetCrewDetailQueryKey,
  getListCrewPaymentsQueryKey,
  getGetMoneySummaryQueryKey,
  getGetTodayQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-input rounded-md py-2.5 px-3.5 text-sm shadow-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const labelCls = "text-xs font-semibold text-muted-foreground";

const primaryBtn =
  "flex items-center justify-center gap-2 bg-[var(--gold-light)] text-black px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm disabled:opacity-50 disabled:pointer-events-none";

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

function Toggle({
  checked,
  onChange,
  title,
  subtitle,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex items-center justify-between bg-card border border-input rounded-md py-2.5 px-3.5 shadow-sm text-left"
    >
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <span
        className={`w-[44px] h-[26px] rounded-full relative transition-colors shrink-0 ${
          checked ? "bg-[var(--gold-light)]" : "bg-black/15"
       }`}
      >
        <span
          className={`absolute top-[3px] w-[20px] h-[20px] rounded-full bg-white shadow-sm transition-all ${
            checked ? "left-[21px]" : "left-[3px]"
         }`}
        />
      </span>
    </button>
  );
}

type ServiceRow = { name: string; rate: string};

function toServicePayload(rows: ServiceRow[]) {
  return rows
    .filter((s) => s.name.trim())
    .map((s) => ({
      name: s.name.trim(),
      rate: s.rate.trim() === "" || isNaN(parseFloat(s.rate)) ? null : parseFloat(s.rate),
   }));
}

function TermsAndServices({
  paymentTerms,
  setPaymentTerms,
  services,
  setServices,
}: {
  paymentTerms: string;
  setPaymentTerms: (v: string) => void;
  services: ServiceRow[];
  setServices: React.Dispatch<React.SetStateAction<ServiceRow[]>>;
}) {
  return (
    <>
      <div>
        <div className={`${labelCls} mb-1.5`}>Payment terms</div>
        <div className="flex flex-wrap gap-2">
          {[
            { value: "due_on_receipt", label: "Due on receipt"},
            { value: "net15", label: "Net 15"},
            { value: "net30", label: "Net 30"},
            { value: "net45", label: "Net 45"},
          ].map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setPaymentTerms(paymentTerms === t.value ? "" : t.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                paymentTerms === t.value
                  ? "bg-[var(--gold-light)] border-[var(--gold)] text-black"
                  : "bg-card border-input text-muted-foreground hover:bg-black/[0.03]"
             }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className={labelCls}>Services & what they charge</span>
          <button
            type="button"
            onClick={() => setServices((s) => [...s, { name: "", rate: ""}])}
            className="text-xs font-bold text-[var(--gold-dark)]"
          >
            + Add service
          </button>
        </div>
        {services.length === 0 && (
          <div className="text-xs text-muted-foreground">e.g. Full turn — $600, Paint — $250/unit</div>
        )}
        {services.map((s, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input
              className={`${fieldCls} flex-1`}
              placeholder="Service (e.g. Paint)"
              value={s.name}
              onChange={(e) => setServices((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value} : x)))}
            />
            <input
              className={`${fieldCls} w-[100px]`}
              placeholder="$ rate"
              inputMode="decimal"
              value={s.rate}
              onChange={(e) => setServices((list) => list.map((x, j) => (j === i ? { ...x, rate: e.target.value} : x)))}
            />
            <button
              type="button"
              aria-label="Remove service"
              onClick={() => setServices((list) => list.filter((_, j) => j !== i))}
              className="shrink-0 w-9 rounded-md border border-input text-muted-foreground hover:bg-black/[0.03]"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- Add Crew */

export function AddCrewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [isLeader, setIsLeader] = useState(false);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [services, setServices] = useState<ServiceRow[]>([]);
  const create = useCreateCrew();

  useEffect(() => {
    if (open) {
      setName("");
      setTrade("");
      setPhone("");
      setEmail("");
      setIsLeader(false);
      setPaymentTerms("");
      setServices([]);
      create.reset();
   }
    // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [open]);

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        data: {
          name: name.trim(),
          trade: trade.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          isLeader,
          paymentTerms: paymentTerms || null,
          services: toServicePayload(services),
       },
     },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrewsQueryKey()});
          onOpenChange(false);
       },
     },
    );
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Add crew member</DialogTitle>
          <DialogDescription>
            Add someone to your crew list. You can edit details anytime.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Field label="Full name">
            <input
              className={fieldCls}
              placeholder="e.g. Ray Coleman"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Trade">
            <input
              className={fieldCls}
              placeholder="e.g. Plumbing, Turns, General"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input
                className={fieldCls}
                placeholder="Phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                className={fieldCls}
                placeholder="Email"
                inputMode="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>
          <Toggle
            checked={isLeader}
            onChange={() => setIsLeader((v) => !v)}
            title="Crew leader"
            subtitle="Can be assigned to run jobs"
          />
          <TermsAndServices
            paymentTerms={paymentTerms}
            setPaymentTerms={setPaymentTerms}
            services={services}
            setServices={setServices}
          />
        </div>
        {create.isError && (
          <div className={errorCls}>Couldn't add. Check the name and try again.</div>
        )}
        <DialogFooter>
          <button
            className={primaryBtn}
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? "Adding…" : "Add crew member"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Edit Crew */

export type EditableCrew = {
  id: string;
  name: string;
  trade?: string | null;
  phone?: string | null;
  email?: string | null;
  isLeader?: boolean | null;
  active?: boolean | null;
  paymentTerms?: string | null;
  services?: { name: string; rate?: number | null}[] | null;
};

export function EditCrewDialog({
  open,
  onOpenChange,
  crew,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crew: EditableCrew;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(crew.name);
  const [trade, setTrade] = useState(crew.trade ?? "");
  const [phone, setPhone] = useState(crew.phone ?? "");
  const [email, setEmail] = useState(crew.email ?? "");
  const [isLeader, setIsLeader] = useState(!!crew.isLeader);
  const [active, setActive] = useState(crew.active !== false);
  const [paymentTerms, setPaymentTerms] = useState(crew.paymentTerms ?? "");
  const [services, setServices] = useState<ServiceRow[]>(
    (crew.services ?? []).map((s) => ({ name: s.name, rate: s.rate != null ? String(s.rate) : ""})),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(crew.name);
      setTrade(crew.trade ?? "");
      setPhone(crew.phone ?? "");
      setEmail(crew.email ?? "");
      setIsLeader(!!crew.isLeader);
      setActive(crew.active !== false);
      setPaymentTerms(crew.paymentTerms ?? "");
      setServices(
        (crew.services ?? []).map((s) => ({ name: s.name, rate: s.rate != null ? String(s.rate) : ""})),
      );
      setDeleteError(null);
   }
 }, [open, crew]);

  const update = useUpdateCrew();
  const del = useDeleteCrew();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListCrewsQueryKey()});
    queryClient.invalidateQueries({
      queryKey: getGetCrewDetailQueryKey(crew.id),
   });
 };

  const submit = () => {
    if (!name.trim()) return;
    update.mutate(
      {
        id: crew.id,
        data: {
          name: name.trim(),
          trade: trade.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || null,
          isLeader,
          active,
          paymentTerms: paymentTerms || null,
          services: toServicePayload(services),
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
      { id: crew.id},
      {
        onSuccess: () => {
          invalidate();
          queryClient.invalidateQueries({
            queryKey: getListCrewPaymentsQueryKey(),
         });
          queryClient.invalidateQueries({
            queryKey: getGetMoneySummaryQueryKey(),
         });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
          setConfirmOpen(false);
          onOpenChange(false);
          onDeleted?.();
       },
        onError: (err: unknown) => {
          const msg =
            (err as { data?: { error?: string}})?.data?.error ||
            "Couldn't delete. They may still be leading jobs.";
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
            <DialogTitle className="font-display">Edit crew member</DialogTitle>
            <DialogDescription>
              Update their details, or remove them from your crew list.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Field label="Full name">
              <input
                className={fieldCls}
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Trade">
              <input
                className={fieldCls}
                placeholder="e.g. Plumbing, Turns, General"
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <input
                  className={fieldCls}
                  placeholder="Phone"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Field label="Email">
                <input
                  className={fieldCls}
                  placeholder="Email"
                  inputMode="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            </div>
            <Toggle
              checked={isLeader}
              onChange={() => setIsLeader((v) => !v)}
              title="Crew leader"
              subtitle="Can be assigned to run jobs"
            />
            <TermsAndServices
              paymentTerms={paymentTerms}
              setPaymentTerms={setPaymentTerms}
              services={services}
              setServices={setServices}
            />
            <Toggle
              checked={active}
              onChange={() => setActive((v) => !v)}
              title="Active"
              subtitle="Shows in dispatch and crew lists"
            />
          </div>
          {update.isError && (
            <div className={errorCls}>
              Couldn't save. Check the name and try again.
            </div>
          )}
          {deleteError && <div className={errorCls}>{deleteError}</div>}
          <DialogFooter className="sm:justify-between gap-2">
            <button
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-md font-medium text-destructive border border-destructive/30 hover:bg-destructive/5 transition-colors disabled:opacity-50"
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
              Remove {crew.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes them from your crew list along with their portal
              messages, check-ins, documents, packets, and payment records.
              Jobs they lead must be reassigned first. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
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
