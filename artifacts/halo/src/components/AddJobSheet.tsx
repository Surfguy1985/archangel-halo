import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateJob,
  useListCrews,
  getListJobsQueryKey,
  getGetPropertyQueryKey,
  getGetTodayQueryKey,
} from "@workspace/api-client-react";
import { Repeat } from "lucide-react";

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

const frequencies = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
] as const;

export function AddJobSheet({
  open,
  onOpenChange,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const { data: crews } = useListCrews();
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [unitNo, setUnitNo] = useState("");
  const [crewLeaderId, setCrewLeaderId] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<string>("weekly");
  const [scheduleType, setScheduleType] = useState<"scheduled" | "flex">("scheduled");
  const [scheduledOn, setScheduledOn] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [flexDays, setFlexDays] = useState("7");
  const create = useCreateJob();

  const reset = () => {
    setDescription("");
    setCategory("");
    setUnitNo("");
    setCrewLeaderId("");
    setIsRecurring(false);
    setRecurrence("weekly");
    setScheduleType("scheduled");
    setScheduledOn("");
    setScheduledTime("");
    setFlexDays("7");
  };

  const submit = () => {
    if (!description.trim()) return;
    create.mutate(
      {
        data: {
          propertyId,
          description: description.trim(),
          category: category.trim() || undefined,
          unitNo: unitNo.trim() || undefined,
          crewLeaderId: crewLeaderId || undefined,
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
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">New job</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Add a work order for this property.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <input
              className={fieldCls}
              placeholder="Description (e.g. Full turn — paint, clean)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex gap-[10px]">
              <input
                className={fieldCls}
                placeholder="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <input
                className={fieldCls}
                placeholder="Unit #"
                value={unitNo}
                onChange={(e) => setUnitNo(e.target.value)}
              />
            </div>
            <select className={fieldCls} value={crewLeaderId} onChange={(e) => setCrewLeaderId(e.target.value)}>
              <option value="">No crew assigned yet</option>
              {crews?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.trade ? ` · ${c.trade}` : ""}</option>
              ))}
            </select>

            <div className="flex gap-[8px]">
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
                  className={`flex-1 rounded-[18px] py-[11px] text-[13.5px] font-display font-bold border transition-transform active:scale-[0.97] ${
                    scheduleType === value
                      ? "text-[var(--ink)] bg-[var(--primary)] border-transparent shadow-[0_4px_14px_rgba(180,255,68,0.35)]"
                      : "bg-card border-[var(--hairline)] text-muted-foreground shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {scheduleType === "scheduled" ? (
              <div className="flex gap-[10px]">
                <div className="flex-1">
                  <div className="text-[12px] font-display font-bold text-muted-foreground mb-[4px] ml-[2px]">Date</div>
                  <input
                    type="date"
                    className={fieldCls}
                    value={scheduledOn}
                    onChange={(e) => setScheduledOn(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <div className="text-[12px] font-display font-bold text-muted-foreground mb-[4px] ml-[2px]">Start time</div>
                  <input
                    type="time"
                    className={fieldCls}
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div>
                <div className="text-[12px] font-display font-bold text-muted-foreground mb-[4px] ml-[2px]">
                  Must be completed within
                </div>
                <div className="flex items-center gap-[10px]">
                  <input
                    type="number"
                    min={1}
                    className={`${fieldCls} !w-[110px]`}
                    value={flexDays}
                    onChange={(e) => setFlexDays(e.target.value)}
                  />
                  <span className="text-[13.5px] text-muted-foreground">days from today</span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsRecurring((v) => !v)}
              className={`w-full flex items-center justify-center gap-[8px] rounded-[18px] py-[12px] text-[14px] font-display font-bold border transition-transform active:scale-[0.98] ${
                isRecurring
                  ? "text-[var(--ink)] bg-[var(--primary)] border-transparent shadow-[0_4px_14px_rgba(180,255,68,0.35)]"
                  : "bg-card border-[var(--hairline)] text-muted-foreground shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
              }`}
            >
              <Repeat className="w-[16px] h-[16px]" />
              {isRecurring ? "Recurring job — ON" : "Mark as recurring"}
            </button>

            {isRecurring && (
              <div className="flex flex-wrap gap-[7px]">
                {frequencies.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setRecurrence(f.value)}
                    className={`px-[13px] py-[8px] rounded-full text-[13px] font-display font-bold border transition-transform active:scale-[0.95] ${
                      recurrence === f.value
                        ? "text-[var(--ink)] bg-[var(--primary)] border-transparent"
                        : "bg-card border-[var(--hairline)] text-muted-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="w-full mt-[18px] rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!description.trim() || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create job"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
