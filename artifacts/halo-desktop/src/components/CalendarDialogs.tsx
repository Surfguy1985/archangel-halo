/**
 * Calendar dialogs for the desktop app — mirrors the mobile calendar sheets:
 *  - EventDetailDialog: view a job/note event, crew portal link, jump to job
 *  - EditEventDialog: create / edit / delete a calendar note
 *  - ScheduleJobDialog: put a job on the calendar
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Link} from "wouter";
import { useQueryClient} from "@tanstack/react-query";
import {
  Briefcase,
  Calendar as CalendarIcon,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Link2,
  MapPin,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";
import {
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
  useScheduleJob,
  useListCrews,
  useListJobs,
  getGetCalendarQueryKey,
  getGetJobQueryKey,
  getListJobsQueryKey,
  getGetTodayQueryKey,
  type CalendarEvent,
} from "@workspace/api-client-react";
import { useToast} from "@/hooks/use-toast";

const fieldCls =
  "w-full bg-card border border-input rounded-md py-2.5 px-3.5 text-sm shadow-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-md bg-[var(--ink)] text-[var(--paper)] px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50";

function Field({ label, children}: { label: string; children: React.ReactNode}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

export const COLOR_VAR: Record<string, string> = {
  gold: "--gold",
  red: "--red",
  orange: "--orange",
  yellow: "--yellow",
  green: "--green",
  blue: "--blue",
  purple: "--purple",
  ink: "--ink",
};

export function colorVar(token: string) {
  return`var(${COLOR_VAR[token] ?? "--gold"})`;
}

const COLORS = [
  { token: "gold", label: "Gold"},
  { token: "blue", label: "Blue"},
  { token: "green", label: "Green"},
  { token: "purple", label: "Purple"},
  { token: "orange", label: "Orange"},
  { token: "red", label: "Red"},
  { token: "yellow", label: "Amber"},
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function localToday() {
  const d = new Date();
  return`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function plusHour(hhmm: string) {
  const h = parseInt(hhmm.split(":")[0]!, 10);
  return`${pad(Math.min(h + 1, 23))}:00`;
}

const HOURS = Array.from({ length: 24}, (_, h) =>`${pad(h)}:00`);

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(y!, m! - 1, d!, 12).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
 });
}

function fmtTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const mer = h! >= 12 ? "PM" : "AM";
  const hr = h! % 12 === 0 ? 12 : h! % 12;
  return`${hr}:${String(m).padStart(2, "0")} ${mer}`;
}

/* -------------------------------------------------------------- Event detail */

export function EventDetailDialog({
  open,
  onOpenChange,
  event,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  onEdit: (event: CalendarEvent) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!event) return null;

  // Always share the mobile-friendly portal (served at the site root) — crews open this on their phones.
  const portalUrl = event.crewPortalToken
    ?`${window.location.origin}/portal/${event.crewPortalToken}`
    : null;

  const timeLabel = event.allDay
    ? "All-day"
    : event.start
      ?`${fmtTime(event.start)}${event.end ?` – ${fmtTime(event.end)}` : ""}`
      : "No time set";

  const copyLink = async () => {
    if (!portalUrl) return;
    await navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span
              className="w-3.5 h-3.5 rounded-full mt-1.5 shrink-0"
              style={{ background: colorVar(event.color)}}
            />
            <div className="min-w-0 text-left">
              <DialogTitle className="font-display text-xl leading-tight">
                {event.title}
              </DialogTitle>
              <DialogDescription className="text-xs mt-1">
                {event.kind === "job" ? "Scheduled job" : "Calendar note"}
                {event.status ?` · ${event.status.replace("_", " ")}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-2.5 py-1">
          <div className="flex items-center gap-3 bg-background border border-border rounded-lg px-3.5 py-3">
            <CalendarIcon className="w-4.5 h-4.5 w-[18px] h-[18px] text-[var(--gold-dark)] shrink-0" strokeWidth={1.9} />
            <div className="text-sm font-semibold">{fmtDate(event.date)}</div>
          </div>
          <div className="flex items-center gap-3 bg-background border border-border rounded-lg px-3.5 py-3">
            <Clock className="w-[18px] h-[18px] text-[var(--gold-dark)] shrink-0" strokeWidth={1.9} />
            <div className="text-sm font-semibold">{timeLabel}</div>
          </div>

          {event.propertyName && (
            <div className="flex items-center gap-3 bg-background border border-border rounded-lg px-3.5 py-3">
              <MapPin className="w-[18px] h-[18px] text-[var(--gold-dark)] shrink-0" strokeWidth={1.9} />
              <div className="text-sm font-semibold">{event.propertyName}</div>
            </div>
          )}

          {event.notes && (
            <div className="bg-background border border-border rounded-lg px-3.5 py-3">
              <div className="text-[11px] text-muted-foreground mb-1">
                Notes
              </div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{event.notes}</div>
            </div>
          )}

          {event.crewName && (
            <div className="bg-background border border-border rounded-lg px-3.5 py-3">
              <div className="flex items-center gap-3">
                <Users className="w-[18px] h-[18px] text-[var(--gold-dark)] shrink-0" strokeWidth={1.9} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-muted-foreground">
                    Crew
                  </div>
                  <div className="text-sm font-display font-bold">{event.crewName}</div>
                </div>
                {event.crewId && (
                  <Link href={`/crews/${event.crewId}`} onClick={() => onOpenChange(false)}>
                    <span className="flex items-center text-sm font-semibold text-[var(--gold-dark)] hover:text-[var(--gold)] transition-colors">
                      Open <ChevronRight className="w-4 h-4" />
                    </span>
                  </Link>
                )}
              </div>

              {portalUrl && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
                    <Link2 className="w-3.5 h-3.5" /> Crew portal link
                  </div>
                  <div className="text-xs text-muted-foreground break-all bg-card border border-border rounded-md px-2.5 py-2 mb-2.5">
                    {portalUrl}
                  </div>
                  <button
                    onClick={copyLink}
                    className="w-full rounded-md py-2.5 font-semibold text-sm flex items-center justify-center gap-2 bg-card border border-border shadow-sm hover:bg-black/[0.03] transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-[var(--green)]" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" /> Copy link
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {event.kind === "job" && event.jobId ? (
            <Link
              href={`/jobs/${event.jobId}`}
              onClick={() => onOpenChange(false)}
              className={`${primaryBtn} w-full`}
            >
              <Briefcase className="w-4 h-4" /> View job
            </Link>
          ) : (
            <button onClick={() => onEdit(event)} className={`${primaryBtn} w-full`}>
              <Pencil className="w-4 h-4" /> Edit event
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------- Create/edit note */

export function EditEventDialog({
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
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey()});

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
        { id: noteId, data: payload},
        {
          onSuccess: () => {
            invalidate();
            onOpenChange(false);
         },
       },
      );
   } else {
      create.mutate(
        { data: payload},
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
      { id: noteId},
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">
              {isEdit ? "Edit event" : "New event"}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update this note, or remove it."
                : "Block time or drop a note on the calendar."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <Field label="Title">
              <input
                className={fieldCls}
                placeholder="e.g. Owner walkthrough"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Notes">
              <textarea
                className={`${fieldCls} resize-none min-h-[64px]`}
                placeholder="Optional"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3 items-end">
              <Field label="Date">
                <input
                  type="date"
                  className={fieldCls}
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                />
              </Field>
              <label className="flex items-center gap-2.5 text-sm font-semibold pb-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  className="w-4 h-4 accent-[var(--gold-dark)]"
                />
                All-day
              </label>
            </div>

            {!allDay && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts">
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
                </Field>
                <Field label="Ends">
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
                </Field>
              </div>
            )}

            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-2">
                Color
              </div>
              <div className="flex gap-2.5 flex-wrap">
                {COLORS.map((c) => (
                  <button
                    key={c.token}
                    onClick={() => setColor(c.token)}
                    aria-label={c.label}
                    className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${
                      color === c.token
                        ? "ring-2 ring-offset-2 ring-offset-background ring-[var(--ink)]"
                        : ""
                   }`}
                    style={{ background:`var(${COLOR_VAR[c.token]})`}}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {isEdit && (
              <button
                className="inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-sm font-semibold text-destructive border border-[rgba(190,60,60,0.28)] hover:bg-destructive/5 transition-colors"
                onClick={() => setConfirmOpen(true)}
                disabled={del.isPending}
              >
                <Trash2 className="w-4 h-4" />
                {del.isPending ? "Deleting…" : "Delete"}
              </button>
            )}
            <button
              className={primaryBtn}
              onClick={submit}
              disabled={pending || !title.trim()}
            >
              {pending ? "Saving…" : isEdit ? "Save changes" : "Add to calendar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete this event?</AlertDialogTitle>
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

/* -------------------------------------------------------------- Schedule job */

export function ScheduleJobDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string;
}) {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: crews} = useListCrews();
  const { data: jobs} = useListJobs(undefined, {
    query: { enabled: open, queryKey: getListJobsQueryKey()},
 });
  const schedule = useScheduleJob();

  const [selectedJobId, setSelectedJobId] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const [windowStart, setWindowStart] = useState("08:00");
  const [crewLeaderId, setCrewLeaderId] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedJobId("");
      setScheduledOn(defaultDate || localToday());
      setWindowStart("08:00");
      setCrewLeaderId("");
   }
 }, [open, defaultDate]);

  const leaders = (crews ?? []).filter((c) => c.isLeader !== false);
  const schedulable = (jobs ?? []).filter(
    (j) => j.status !== "complete" && j.status !== "paid" && j.status !== "cancelled",
  );
  const picked = schedulable.find((j) => j.id === selectedJobId);

  const submit = () => {
    if (!scheduledOn || !selectedJobId) return;
    schedule.mutate(
      {
        id: selectedJobId,
        data: {
          scheduledOn,
          windowStart: windowStart || undefined,
          crewLeaderId: crewLeaderId || undefined,
       },
     },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId)});
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey()});
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
          queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey()});
          toast({
            title: "Job scheduled",
            description:`${picked ? picked.jobNo || picked.category || "Job" : "Job"} set for ${scheduledOn}.`,
         });
          onOpenChange(false);
       },
        onError: (e: unknown) =>
          toast({
            title: "Couldn't schedule job",
            description:
              (e as { data?: { error?: string}})?.data?.error ||
              (e as Error)?.message ||
              "Something went wrong.",
            variant: "destructive",
         }),
     },
    );
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Schedule job</DialogTitle>
          <DialogDescription>Assign a date, time, and crew to a job.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <Field label="Job">
            <select
              className={fieldCls}
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              autoFocus
            >
              <option value="">Select a job…</option>
              {schedulable.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.jobNo} · {j.category || j.description || "Job"}
                  {j.propertyName ?` — ${j.propertyName}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                className={fieldCls}
                value={scheduledOn}
                onChange={(e) => setScheduledOn(e.target.value)}
              />
            </Field>
            <Field label="Start time">
              <select
                className={fieldCls}
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Crew leader">
            <select
              className={fieldCls}
              value={crewLeaderId}
              onChange={(e) => setCrewLeaderId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {leaders.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.trade ?` · ${c.trade}` : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <DialogFooter>
          <button
            onClick={submit}
            disabled={schedule.isPending || !scheduledOn || !selectedJobId}
            className={`${primaryBtn} w-full`}
          >
            <CalendarDays className="w-4 h-4" />
            {schedule.isPending ? "Scheduling…" : "Schedule job"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
