import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCrew,
  getListCrewsQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

export function AddCrewSheet({
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
  const [isLeader, setIsLeader] = useState(true);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [services, setServices] = useState<{ name: string; rate: string }[]>([]);

  const create = useCreateCrew();

  const reset = () => {
    setName("");
    setTrade("");
    setPhone("");
    setEmail("");
    setIsLeader(true);
    setPaymentTerms("");
    setServices([]);
  };

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
          services: services
            .filter((s) => s.name.trim())
            .map((s) => ({
              name: s.name.trim(),
              rate: s.rate.trim() === "" || isNaN(parseFloat(s.rate)) ? null : parseFloat(s.rate),
            })),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListCrewsQueryKey(),
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
              Add crew member
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              Or just tap the gold mic and speak it.
            </div>
          </SheetHeader>

          <div className="flex flex-col gap-[10px]">
            <input
              className={fieldCls}
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <input
              className={fieldCls}
              placeholder="Trade (e.g. Plumbing, Turns, General)"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
            />
            <input
              className={fieldCls}
              placeholder="Phone"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <input
              className={fieldCls}
              placeholder="Email"
              inputMode="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setIsLeader((v) => !v)}
              className="flex items-center justify-between bg-card border border-border rounded-[13px] py-[11px] px-[14px] shadow-[var(--shadow)] text-left"
            >
              <div>
                <div className="text-[14.5px] font-semibold">Crew leader</div>
                <div className="text-[12px] text-muted-foreground">
                  Can be assigned to run jobs
                </div>
              </div>
              <span
                className={`w-[44px] h-[26px] rounded-full relative transition-colors shrink-0 ${
                  isLeader ? "bg-[var(--gold)]" : "bg-[rgba(23,24,28,0.16)]"
                }`}
              >
                <span
                  className={`absolute top-[3px] w-[20px] h-[20px] rounded-full bg-white shadow-sm transition-all ${
                    isLeader ? "left-[21px]" : "left-[3px]"
                  }`}
                />
              </span>
            </button>

            <div className="mt-[4px]">
              <div className="text-[12px] font-display font-semibold tracking-[0.14em] uppercase text-muted-foreground mb-[7px] mx-[2px]">Payment terms</div>
              <div className="flex flex-wrap gap-[7px]">
                {[
                  { value: "due_on_receipt", label: "Due on receipt" },
                  { value: "net15", label: "Net 15" },
                  { value: "net30", label: "Net 30" },
                  { value: "net45", label: "Net 45" },
                ].map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setPaymentTerms((v) => (v === t.value ? "" : t.value))}
                    className={`px-[13px] py-[8px] rounded-full text-[13px] font-semibold border transition-colors ${
                      paymentTerms === t.value
                        ? "bg-[var(--gold)] border-[var(--gold)] text-[var(--ink)]"
                        : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-[4px]">
              <div className="flex items-center justify-between mb-[7px] mx-[2px]">
                <div className="text-[12px] font-display font-semibold tracking-[0.14em] uppercase text-muted-foreground">Services & what they charge</div>
                <button
                  type="button"
                  onClick={() => setServices((s) => [...s, { name: "", rate: "" }])}
                  className="text-[12px] font-display font-bold text-[var(--gold-dark)]"
                >
                  + Add service
                </button>
              </div>
              {services.length === 0 && (
                <div className="text-[12.5px] text-muted-foreground mx-[2px]">e.g. Full turn — $600, Paint — $250/unit</div>
              )}
              {services.map((s, i) => (
                <div key={i} className="flex gap-[8px] mb-[8px]">
                  <input
                    className={`${fieldCls} flex-1`}
                    placeholder="Service (e.g. Paint)"
                    value={s.name}
                    onChange={(e) => setServices((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <input
                    className={`${fieldCls} w-[92px]`}
                    placeholder="$ rate"
                    inputMode="decimal"
                    value={s.rate}
                    onChange={(e) => setServices((list) => list.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    aria-label="Remove service"
                    onClick={() => setServices((list) => list.filter((_, j) => j !== i))}
                    className="shrink-0 w-[36px] rounded-[13px] border border-border text-muted-foreground text-[16px]"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save crew member"}
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
