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
import { Trash2, Repeat } from "lucide-react";
import {
  useUpdateJob,
  useDeleteJob,
  getGetJobQueryKey,
  getListJobsQueryKey,
  getGetTodayQueryKey,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

type JobLike = {
  id: string;
  propertyId?: string;
  woNo?: string | null;
  unitNo?: string | null;
  category?: string | null;
  description?: string | null;
  status: string;
  isRecurring?: boolean | null;
  recurrence?: string | null;
};

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];

const STATUSES = [
  "open",
  "scheduled",
  "in_progress",
  "blocked",
  "complete",
  "invoiced",
  "paid",
  "cancelled",
];

export function EditJobSheet({
  open,
  onOpenChange,
  job,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobLike;
}) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [category, setCategory] = useState(job.category ?? "");
  const [description, setDescription] = useState(job.description ?? "");
  const [unitNo, setUnitNo] = useState(job.unitNo ?? "");
  const [woNo, setWoNo] = useState(job.woNo ?? "");
  const [status, setStatus] = useState(job.status);
  const [isRecurring, setIsRecurring] = useState(!!job.isRecurring);
  const [recurrence, setRecurrence] = useState(job.recurrence ?? "weekly");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCategory(job.category ?? "");
      setDescription(job.description ?? "");
      setUnitNo(job.unitNo ?? "");
      setWoNo(job.woNo ?? "");
      setStatus(job.status);
      setIsRecurring(!!job.isRecurring);
      setRecurrence(job.recurrence ?? "weekly");
      setDeleteError(null);
    }
  }, [open, job]);

  const update = useUpdateJob();
  const del = useDeleteJob();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(job.id) });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    if (job.propertyId) {
      queryClient.invalidateQueries({
        queryKey: getGetPropertyQueryKey(job.propertyId),
      });
    }
  };

  const submit = () => {
    update.mutate(
      {
        id: job.id,
        data: {
          category: category.trim() || undefined,
          description: description.trim() || undefined,
          unitNo: unitNo.trim() || undefined,
          woNo: woNo.trim() || undefined,
          status,
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
      },
    );
  };

  const confirmDelete = () => {
    setDeleteError(null);
    del.mutate(
      { id: job.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          setConfirmOpen(false);
          onOpenChange(false);
          navigate(job.propertyId ? `/properties/${job.propertyId}` : "/");
        },
        onError: (err: unknown) => {
          const msg =
            (err as { data?: { error?: string } })?.data?.error ||
            "Couldn't delete this job.";
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
                Edit job
              </SheetTitle>
              <div className="text-[13px] text-muted-foreground">
                Update the details, or remove the job.
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-[10px]">
              <input
                className={fieldCls}
                placeholder="Category (e.g. Plumbing, Turn)"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <textarea
                className={`${fieldCls} resize-none min-h-[74px]`}
                placeholder="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="flex gap-[10px]">
                <input
                  className={fieldCls}
                  placeholder="Unit #"
                  value={unitNo}
                  onChange={(e) => setUnitNo(e.target.value)}
                />
                <input
                  className={fieldCls}
                  placeholder="Work order #"
                  value={woNo}
                  onChange={(e) => setWoNo(e.target.value)}
                />
              </div>
              <select
                className={`${fieldCls} capitalize`}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setIsRecurring((v) => !v)}
                className={`w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[12px] text-[14px] font-display font-bold border transition-transform active:scale-[0.98] ${
                  isRecurring
                    ? "text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] border-transparent shadow-[0_4px_14px_rgba(143,106,31,0.3)]"
                    : "bg-card border-border text-muted-foreground shadow-[var(--shadow)]"
                }`}
              >
                <Repeat className="w-[16px] h-[16px]" />
                {isRecurring ? "Recurring job — ON" : "Mark as recurring"}
              </button>
              {isRecurring && (
                <div className="flex flex-wrap gap-[7px]">
                  {FREQUENCIES.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setRecurrence(f.value)}
                      className={`px-[13px] py-[8px] rounded-full text-[13px] font-display font-bold border transition-transform active:scale-[0.95] ${
                        recurrence === f.value
                          ? "text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] border-transparent"
                          : "bg-card border-border text-muted-foreground"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
              onClick={submit}
              disabled={update.isPending}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
            {update.isError && (
              <div className="text-[12.5px] text-destructive text-center mt-[10px]">
                Couldn't save. Try again.
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
              {del.isPending ? "Deleting…" : "Delete job"}
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
            <AlertDialogTitle className="font-display">Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the job and its schedule entries. This can't be undone.
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
