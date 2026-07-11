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
  useUpdateCrew,
  useDeleteCrew,
  getListCrewsQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

type CrewLike = {
  id: string;
  name: string;
  trade?: string | null;
  phone?: string | null;
  email?: string | null;
  isLeader?: boolean | null;
};

export function EditCrewSheet({
  open,
  onOpenChange,
  crew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crew: CrewLike;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(crew.name);
  const [trade, setTrade] = useState(crew.trade ?? "");
  const [phone, setPhone] = useState(crew.phone ?? "");
  const [email, setEmail] = useState(crew.email ?? "");
  const [isLeader, setIsLeader] = useState(!!crew.isLeader);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(crew.name);
      setTrade(crew.trade ?? "");
      setPhone(crew.phone ?? "");
      setEmail(crew.email ?? "");
      setIsLeader(!!crew.isLeader);
      setDeleteError(null);
    }
  }, [open, crew]);

  const update = useUpdateCrew();
  const del = useDeleteCrew();

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
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrewsQueryKey() });
          onOpenChange(false);
        },
      },
    );
  };

  const confirmDelete = () => {
    setDeleteError(null);
    del.mutate(
      { id: crew.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrewsQueryKey() });
          setConfirmOpen(false);
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg =
            (err as { data?: { error?: string } })?.data?.error ||
            "Couldn't delete. They may still be leading jobs.";
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
                Edit crew member
              </SheetTitle>
              <div className="text-[13px] text-muted-foreground">
                Update their details, or remove them.
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-[10px]">
              <input
                className={fieldCls}
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
              {del.isPending ? "Deleting…" : "Delete crew member"}
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
              Remove {crew.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes them from your crew list. Jobs they lead must be
              reassigned first. This can't be undone.
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
