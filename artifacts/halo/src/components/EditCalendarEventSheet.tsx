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
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
  getGetCalendarQueryKey,
  type CalendarEvent,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

const COLORS = [
  { token: "gold", label: "Gold" },
  { token: "blue", label: "Blue" },
  { token: "green", label: "Green" },
  { token: "purple", label: "Purple" },
  { token: "orange", label: "Orange" },
  { token: "red", label: "Red" },
  { token: "yellow", label: "Amber" },
];

const COLOR_VAR: Record<string, string> = {
  gold: "--gold",
  red: "--red",
  orange: "--orange",
  yellow: "--yellow",
  green: "--green",
  blue: "--blue",
  purple: "--purple",
  ink: "--ink",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function plusHour(hhmm: string) {
  const h = parseInt(hhmm.split(":")[0]!, 10);
  return `${pad(Math.min(h + 1, 23))}:00`;
}

const HOURS = Array.from({ length: 24 }, (_, h) => `${pad(h)}:00`);

export function EditCalendarEventSheet({
  open,
  onOpenChange,
  date,
  defaultStart,
  event,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  defaultStart?: string | null;
  event?: CalendarEvent | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!event && event.kind === "note";
  const noteId = event ? event.id.replace(/^note-/, "") : "";

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [eventDate, setEventDate] = useState(date);
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [color, setColor] = useState("gold");
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isEdit && event) {
      setTitle(event.title);
      setNotes(event.notes ?? "");
      setEventDate(event.date);
      setAllDay(event.allDay);
      setStart(event.start ?? "09:00");
      setEnd(event.end ?? "10:00");
      setColor(event.color || "gold");
    } else {
      setTitle("");
      setNotes("");
      setEventDate(date);
      setAllDay(false);
      const s = defaultStart ?? "09:00";
      setStart(s);
      setEnd(plusHour(s));
      setColor("gold");
    }
  }, [open, isEdit, event, date, defaultStart]);

  const create = useCreateCalendarEvent();
  const update = useUpdateCalendarEvent();
  const del = useDeleteCalendarEvent();
  const pending = create.isPending || update.isPending;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });

  const submit = () => {
    if (!title.trim()) return;
    const payload = {
      title: title.trim(),
      notes: notes.trim() || null,
      date: eventDate,
      allDay,
      start: allDay ? null : start,
      end: allDay ? null : end > start ? end : null,
      color,
    };
    if (isEdit) {
      update.mutate(
        { id: noteId, data: payload },
        {
          onSuccess: () => {
            invalidate();
            onOpenChange(false);
          },
        },
      );
    } else {
      create.mutate(
        { data: payload },
        {
          onSuccess: () => {
            invalidate();
            onOpenChange(false);
          },
        },
      );
    }
  };

  const confirmDelete = () => {
    del.mutate(
      { id: noteId },
      {
        onSuccess: () => {
          invalidate();
          setConfirmOpen(false);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
        >
          <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
          <div className="p-[8px_20px_26px] overflow-y-auto">
            <SheetHeader className="text-left mb-[16px]">
              <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
                {isEdit ? "Edit event" : "New event"}
              </SheetTitle>
              <div className="text-[13px] text-muted-foreground">
                {isEdit
                  ? "Update this note, or remove it."
                  : "Block time or drop a note on the calendar."}
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-[10px]">
              <input
                className={fieldCls}
                placeholder="Title (e.g. Owner walkthrough)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <textarea
                className={`${fieldCls} resize-none min-h-[64px]`}
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <input
                type="date"
                className={fieldCls}
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />

              <label className="flex items-center gap-[10px] px-[4px] py-[2px] text-[14px] font-semibold">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  className="w-[18px] h-[18px] accent-[var(--gold-dark)]"
                />
                All-day
              </label>

              {!allDay && (
                <div className="flex gap-[10px]">
                  <div className="flex-1">
                    <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground mb-[4px] ml-[2px]">
                      Starts
                    </div>
                    <select
                      className={fieldCls}
                      value={start}
                      onChange={(e) => {
                        const v = e.target.value;
                        setStart(v);
                        if (end <= v) setEnd(plusHour(v));
                      }}
                    >
                      {HOURS.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground mb-[4px] ml-[2px]">
                      Ends
                    </div>
                    <select
                      className={fieldCls}
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    >
                      {HOURS.filter((h) => h > start).map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground mb-[7px] ml-[2px]">
                  Color
                </div>
                <div className="flex gap-[10px] flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c.token}
                      onClick={() => setColor(c.token)}
                      aria-label={c.label}
                      className={`w-[32px] h-[32px] rounded-full transition-transform active:scale-90 ${
                        color === c.token
                          ? "ring-2 ring-offset-2 ring-offset-[var(--paper)] ring-[var(--ink)]"
                          : ""
                      }`}
                      style={{ background: `var(${COLOR_VAR[c.token]})` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <button
              className="w-full mt-[18px] rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:opacity-50 transition-transform active:scale-[0.98]"
              onClick={submit}
              disabled={pending || !title.trim()}
            >
              {pending ? "Saving…" : isEdit ? "Save changes" : "Add to calendar"}
            </button>

            {isEdit && (
              <button
                className="w-full mt-[10px] rounded-[18px] py-[12px] font-semibold text-[14px] text-destructive flex items-center justify-center gap-[7px] border border-[rgba(190,60,60,0.28)] transition-transform active:scale-[0.98]"
                onClick={() => setConfirmOpen(true)}
                disabled={del.isPending}
              >
                <Trash2 className="w-[15px] h-[15px]" />
                {del.isPending ? "Deleting…" : "Delete event"}
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-[var(--paper)] border-none rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              Delete this event?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from the calendar. This can't be undone.
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
