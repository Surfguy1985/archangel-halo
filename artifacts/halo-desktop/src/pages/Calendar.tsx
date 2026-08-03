import { useEffect, useMemo, useRef, useState} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
} from "lucide-react";
import { useGetCalendar, type CalendarEvent} from "@workspace/api-client-react";
import { Skeleton} from "@/components/ui/skeleton";
import {
  EventDetailDialog,
  EditEventDialog,
  ScheduleJobDialog,
  colorVar,
} from "@/components/CalendarDialogs";
import { PropertyDispatchDay } from "@/components/PropertyDispatchDay";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date) {
  return`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d: Date) {
  return addDays(d, -d.getDay());
}
function toMin(hhmm?: string | null) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return h! * 60 + m!;
}
function fmtHour(h: number) {
  const mer = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return`${hr} ${mer}`;
}
function fmtTimeShort(hhmm: string) {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const mer = h! >= 12 ? "PM" : "AM";
  const hr = h! % 12 === 0 ? 12 : h! % 12;
  return m ?`${hr}:${pad(m!)} ${mer}` :`${hr} ${mer}`;
}

type ViewMode = "day" | "week" | "month" | "dispatch";
const HOUR_H = 60;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Calendar() {
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(today);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [addDate, setAddDate] = useState<string>(ymd(today));
  const [addStart, setAddStart] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const dayScrollRef = useRef<HTMLDivElement>(null);

  const { from, to } = useMemo(() => {
    if (view === "month") {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
      const gridStart = startOfWeek(first);
      return { from: ymd(gridStart), to: ymd(addDays(gridStart, 41)) };
    }
    if (view === "week") {
      const ws = startOfWeek(cursor);
      return { from: ymd(ws), to: ymd(addDays(ws, 6)) };
    }
    return { from: ymd(cursor), to: ymd(cursor) };
  }, [view, cursor]);

  const { data, isLoading } = useGetCalendar({ from, to });
  const events = data?.events ?? [];

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (toMin(a.start) ?? -1) - (toMin(b.start) ?? -1));
    }
    return map;
  }, [events]);

  const openDetail = (e: CalendarEvent) => {
    setSelected(e);
    setDetailOpen(true);
  };
  const openAdd = (date: string, start: string | null) => {
    setEditEvent(null);
    setAddDate(date);
    setAddStart(start);
    setEditOpen(true);
  };
  const openEdit = (e: CalendarEvent) => {
    setDetailOpen(false);
    setEditEvent(e);
    setAddDate(e.date);
    setAddStart(e.start ?? null);
    setEditOpen(true);
  };

  const step = (dir: number) => {
    if (view === "day" || view === "dispatch") setCursor(addDays(cursor, dir));
    else if (view === "week") setCursor(addDays(cursor, dir * 7));
    else setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1, 12));
  };

  const headerTitle =
    view === "dispatch"
      ? `Dispatch — ${cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`
      : view === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "week"
        ? (() => {
            const ws = startOfWeek(cursor);
            const we = addDays(ws, 6);
            const sameMonth = ws.getMonth() === we.getMonth();
            return sameMonth
              ? `${ws.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`
              : `${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${we.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
          })()
        : cursor.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          });

  return (
    <div className="p-8 h-screen flex flex-col animate-in fade-in duration-500">
      {/* Header */}
      <header className="flex items-center gap-4 mb-5 shrink-0">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)] truncate">
            {headerTitle}
          </h1>
          <p className="text-muted-foreground text-sm">Unified schedule &amp; jobs</p>
        </div>

        <div className="flex-1" />

        {/* View switch */}
        <div className="flex p-1 bg-card border border-[var(--hairline)] rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          {(["day", "week", "month", "dispatch"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold capitalize transition-colors ${
                view === v
                  ? "bg-[var(--ink)] text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => step(-1)}
            className="w-9 h-9 grid place-items-center border border-[var(--hairline)] rounded-full bg-card hover:bg-black/5 transition-colors"
            aria-label="Previous"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="px-4 h-9 text-sm font-semibold border border-[var(--hairline)] rounded-full bg-card hover:bg-black/5 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => step(1)}
            className="w-9 h-9 grid place-items-center border border-[var(--hairline)] rounded-full bg-card hover:bg-black/5 transition-colors"
            aria-label="Next"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setScheduleOpen(true)}
            className="inline-flex items-center gap-2 px-4 h-9 text-sm font-semibold border border-[var(--hairline)] rounded-full bg-card hover:bg-black/5 transition-colors"
          >
            <CalendarDays className="w-4 h-4 text-[var(--gold)]" /> Schedule job
          </button>
          <button
            onClick={() => openAdd(ymd(cursor), null)}
            className="btn-gold inline-flex items-center gap-1.5 px-4 h-9 text-sm !rounded-full"
          >
            <Plus className="w-4 h-4" strokeWidth={2.4} /> New event
          </button>
        </div>
      </header>

      {view === "dispatch" ? (
        <PropertyDispatchDay day={ymd(cursor)} />
      ) : isLoading ? (
        <Skeleton className="flex-1 w-full rounded-[20px]" />
      ) : view === "month" ? (
        <MonthView
          cursor={cursor}
          byDate={byDate}
          onEvent={openDetail}
          onAddAt={(date) => openAdd(date, null)}
          onPickDay={(d) => {
            setCursor(d);
            setView("day");
          }}
        />
      ) : view === "week" ? (
        <WeekView
          cursor={cursor}
          byDate={byDate}
          onEvent={openDetail}
          onAddAt={(date, start) => openAdd(date, start)}
          onPickDay={(d) => {
            setCursor(d);
            setView("day");
          }}
        />
      ) : (
        <DayView
          date={cursor}
          events={byDate.get(ymd(cursor)) ?? []}
          scrollRef={dayScrollRef}
          onEvent={openDetail}
          onAddAt={(start) => openAdd(ymd(cursor), start)}
        />
      )}

      <EventDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        event={selected}
        onEdit={openEdit}
      />
      <EditEventDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        date={addDate}
        defaultStart={addStart}
        event={editEvent}
      />
      <ScheduleJobDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        defaultDate={ymd(cursor)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- Month */

function MonthView({
  cursor,
  byDate,
  onEvent,
  onAddAt,
  onPickDay,
}: {
  cursor: Date;
  byDate: Map<string, CalendarEvent[]>;
  onEvent: (e: CalendarEvent) => void;
  onAddAt: (date: string) => void;
  onPickDay: (d: Date) => void;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42}, (_, i) => addDays(gridStart, i));
  const todayStr = ymd(new Date());
  const month = cursor.getMonth();

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-[var(--hairline)] shrink-0">
        {DAY_NAMES.map((l, i) => (
          <div
            key={l}
            className={`text-right pr-3 text-[11px]  tracking-[0.08em] font-semibold text-muted-foreground py-2 ${
              i > 0 ? "border-l border-border" : ""
           }`}
          >
            {l}
          </div>
        ))}
      </div>

      {/* 6-row grid */}
      <div className="flex-1 min-h-0 grid grid-cols-7 grid-rows-6">
        {days.map((d, i) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === month;
          const isToday = key === todayStr;
          const dayEvents = byDate.get(key) ?? [];
          const shown = dayEvents.slice(0, 3);
          const extra = dayEvents.length - shown.length;
          return (
            <div
              key={key}
              onDoubleClick={() => onAddAt(key)}
              className={`group relative min-h-0 flex flex-col border-border p-1 pt-0.5 overflow-hidden ${
                i % 7 !== 0 ? "border-l" : ""
             } ${i >= 7 ? "border-t" : ""} ${inMonth ? "" : "bg-black/[0.02]"}`}
            >
              <div className="flex items-center justify-between shrink-0 px-1 pt-1">
                <button
                  onClick={() => onAddAt(key)}
                  aria-label={`Add event on ${key}`}
                  className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 grid place-items-center rounded-full text-muted-foreground hover:bg-black/5"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onPickDay(d)}
                  className={`w-7 h-7 grid place-items-center rounded-full text-[13px] font-display font-bold transition-colors ${
                    isToday
                      ? "bg-[var(--red)] text-white"
                      : inMonth
                        ? "text-[var(--ink)] hover:bg-black/5"
                        : "text-muted-foreground/50 hover:bg-black/5"
                 }`}
                >
                  {d.getDate()}
                </button>
              </div>

              <div className="flex-1 min-h-0 flex flex-col gap-[3px] mt-0.5 overflow-hidden">
                {shown.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => onEvent(e)}
                    className="flex items-center gap-1.5 w-full text-left rounded-[5px] px-1.5 py-[3px] hover:brightness-[0.97] transition-[filter] shrink-0"
                    style={{
                      background:`color-mix(in srgb, ${colorVar(e.color)} 14%, var(--card))`,
                   }}
                    title={e.title}
                  >
                    <span
                      className="w-[7px] h-[7px] rounded-[2px] shrink-0"
                      style={{ background: colorVar(e.color)}}
                    />
                    <span
                      className={`text-[11.5px] font-semibold truncate leading-tight ${
                        inMonth ? "" : "text-muted-foreground"
                     }`}
                    >
                      {e.title}
                    </span>
                    {!e.allDay && e.start && (
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0 hidden xl:inline">
                        {fmtTimeShort(e.start)}
                      </span>
                    )}
                  </button>
                ))}
                {extra > 0 && (
                  <button
                    onClick={() => onPickDay(d)}
                    className="text-left text-[10.5px] font-bold text-muted-foreground px-1.5 hover:text-foreground transition-colors shrink-0"
                  >
                    {extra} more…
                  </button>
                )}
              </div>
            </div>
          );
       })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- Week */

function WeekView({
  cursor,
  byDate,
  onEvent,
  onAddAt,
  onPickDay,
}: {
  cursor: Date;
  byDate: Map<string, CalendarEvent[]>;
  onEvent: (e: CalendarEvent) => void;
  onAddAt: (date: string, start: string | null) => void;
  onPickDay: (d: Date) => void;
}) {
  const ws = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const todayStr = ymd(new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * HOUR_H - 20;
    }
  }, [ymd(ws)]);

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* Day headers + all-day row */}
      <div className="grid shrink-0 border-b border-[var(--hairline)]" style={{ gridTemplateColumns: "64px repeat(7, 1fr)" }}>
        <div />
        {days.map((d) => {
          const key = ymd(d);
          const isToday = key === todayStr;
          const allDay = (byDate.get(key) ?? []).filter(
            (e) => e.allDay || toMin(e.start) === null,
          );
          return (
            <div key={key} className="border-l border-border px-1.5 py-2 min-w-0">
              <button
                onClick={() => onPickDay(d)}
                className="flex items-center gap-1.5 mx-auto"
              >
                <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {DAY_NAMES[d.getDay()]}
                </span>
                <span
                  className={`w-7 h-7 grid place-items-center rounded-full text-[13px] font-display font-bold ${
                    isToday ? "bg-[var(--red)] text-white" : "text-[var(--ink)]"
                  }`}
                >
                  {d.getDate()}
                </span>
              </button>
              {allDay.length > 0 && (
                <div className="flex flex-col gap-[2px] mt-1">
                  {allDay.slice(0, 2).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onEvent(e)}
                      className="text-left rounded-[4px] px-1.5 py-[2px] text-[10.5px] font-semibold truncate"
                      style={{
                        background: `color-mix(in srgb, ${colorVar(e.color)} 18%, var(--card))`,
                      }}
                      title={e.title}
                    >
                      {e.title}
                    </button>
                  ))}
                  {allDay.length > 2 && (
                    <span className="text-[10px] font-bold text-muted-foreground px-1.5">
                      +{allDay.length - 2} more
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div
          className="grid relative"
          style={{ gridTemplateColumns: "64px repeat(7, 1fr)", height: `${24 * HOUR_H}px` }}
        >
          {/* Hour labels */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[10.5px] font-semibold text-muted-foreground"
                style={{ top: `${h * HOUR_H}px` }}
              >
                {h === 0 ? "" : fmtHour(h)}
              </span>
            ))}
          </div>

          {days.map((d) => {
            const key = ymd(d);
            const isToday = key === todayStr;
            const timed = (byDate.get(key) ?? []).filter(
              (e) => !e.allDay && toMin(e.start) !== null,
            );
            return (
              <div
                key={key}
                className={`relative border-l border-border ${isToday ? "bg-[var(--gold-tint,rgba(212,175,55,0.05))]" : ""}`}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    onClick={() => onAddAt(key, `${pad(h)}:00`)}
                    aria-label={`Add on ${key} at ${fmtHour(h)}`}
                    className="absolute left-0 right-0 border-t border-border/60 hover:bg-black/[0.02] transition-colors"
                    style={{ top: `${h * HOUR_H}px`, height: `${HOUR_H}px` }}
                  />
                ))}

                {isToday && (
                  <div
                    className="absolute left-0 right-0 z-10 pointer-events-none"
                    style={{ top: `${(nowMin / 60) * HOUR_H}px` }}
                  >
                    <div className="relative">
                      <span className="absolute -left-[4px] -top-[3px] w-[8px] h-[8px] rounded-full bg-[var(--red)]" />
                      <div className="h-[2px] bg-[var(--red)]" />
                    </div>
                  </div>
                )}

                {timed.map((e, idx) => {
                  const s = toMin(e.start)!;
                  const en = Math.max(toMin(e.end) ?? s + 60, s + 30);
                  const top = (s / 60) * HOUR_H;
                  const height = Math.max(22, ((en - s) / 60) * HOUR_H - 2);
                  const overlaps = timed.filter(
                    (o) =>
                      toMin(o.start) !== null &&
                      toMin(o.start)! < en &&
                      Math.max(
                        toMin(o.end) ?? toMin(o.start)! + 60,
                        toMin(o.start)! + 30,
                      ) > s,
                  );
                  const col = Math.max(0, overlaps.indexOf(e));
                  const cols = Math.max(1, overlaps.length);
                  const widthPct = 100 / cols;
                  return (
                    <button
                      key={e.id}
                      onClick={() => onEvent(e)}
                      className="absolute rounded-md px-1.5 py-1 text-left overflow-hidden shadow-[0_1px_5px_rgba(23,24,28,0.12)] hover:brightness-[0.97] transition-[filter]"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(${col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        background: `color-mix(in srgb, ${colorVar(e.color)} 16%, var(--card))`,
                        borderLeft: `3px solid ${colorVar(e.color)}`,
                        zIndex: 5 + idx,
                      }}
                      title={e.title}
                    >
                      <div className="font-bold text-[11.5px] leading-tight truncate">
                        {e.title}
                      </div>
                      {height > 34 && e.start && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {fmtTimeShort(e.start)}
                          {e.subtitle ? ` · ${e.subtitle}` : ""}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- Day */

function DayView({
  date,
  events,
  scrollRef,
  onEvent,
  onAddAt,
}: {
  date: Date;
  events: CalendarEvent[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onEvent: (e: CalendarEvent) => void;
  onAddAt: (start: string | null) => void;
}) {
  const allDay = events.filter((e) => e.allDay || toMin(e.start) === null);
  const timed = events.filter((e) => !e.allDay && toMin(e.start) !== null);
  const isToday = ymd(date) === ymd(new Date());

  useEffect(() => {
    if (scrollRef.current) {
      const first = timed.length
        ? Math.min(...timed.map((e) => toMin(e.start)!))
        : 7 * 60;
      scrollRef.current.scrollTop = Math.max(0, (first / 60) * HOUR_H - HOUR_H);
   }
    // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [ymd(date)]);

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      {allDay.length > 0 && (
        <div className="flex flex-wrap gap-2 shrink-0">
          {allDay.map((e) => (
            <button
              key={e.id}
              onClick={() => onEvent(e)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 border border-border shadow-sm hover:brightness-[0.98] transition-[filter]"
              style={{
                background:`color-mix(in srgb, ${colorVar(e.color)} 12%, var(--card))`,
             }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: colorVar(e.color)}}
              />
              <span className="font-semibold text-sm">{e.title}</span>
              <span className="text-[10.5px] text-muted-foreground">
                All-day
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 relative overflow-y-auto rounded-[20px] border border-[var(--hairline)] bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
      >
        <div className="relative" style={{ height:`${24 * HOUR_H}px`}}>
          {Array.from({ length: 24}, (_, h) => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-border/70"
              style={{ top:`${h * HOUR_H}px`}}
            >
              <span className="absolute -top-2 left-3 text-[10.5px] font-semibold text-muted-foreground w-12">
                {h === 0 ? "" : fmtHour(h)}
              </span>
              <button
                className="absolute left-[72px] right-2 top-0 hover:bg-black/[0.02] transition-colors"
                style={{ height:`${HOUR_H}px`}}
                onClick={() => onAddAt(`${pad(h)}:00`)}
                aria-label={`Add at ${fmtHour(h)}`}
              />
            </div>
          ))}

          {isToday && (
            <div
              className="absolute left-[66px] right-1 z-10 pointer-events-none"
              style={{ top:`${(nowMin / 60) * HOUR_H}px`}}
            >
              <div className="relative">
                <span className="absolute -left-[6px] -top-[4px] w-[9px] h-[9px] rounded-full bg-[var(--red)]" />
                <div className="h-[2px] bg-[var(--red)]" />
              </div>
            </div>
          )}

          <div className="absolute left-[72px] right-2 top-0 bottom-0">
            {timed.map((e, idx) => {
              const s = toMin(e.start)!;
              const en = Math.max(toMin(e.end) ?? s + 60, s + 30);
              const top = (s / 60) * HOUR_H;
              const height = Math.max(26, ((en - s) / 60) * HOUR_H - 3);
              const overlaps = timed.filter(
                (o) =>
                  toMin(o.start) !== null &&
                  toMin(o.start)! < en &&
                  Math.max(
                    toMin(o.end) ?? toMin(o.start)! + 60,
                    toMin(o.start)! + 30,
                  ) > s,
              );
              const col = Math.max(0, overlaps.indexOf(e));
              const cols = Math.max(1, overlaps.length);
              const widthPct = 100 / cols;
              return (
                <button
                  key={e.id}
                  onClick={() => onEvent(e)}
                  className="absolute rounded-lg px-2.5 py-1.5 text-left overflow-hidden shadow-[0_2px_8px_rgba(23,24,28,0.12)] hover:brightness-[0.97] transition-[filter]"
                  style={{
                    top:`${top}px`,
                    height:`${height}px`,
                    left:`calc(${col * widthPct}% + ${col === 0 ? 0 : 2}px)`,
                    width:`calc(${widthPct}% - 3px)`,
                    background:`color-mix(in srgb, ${colorVar(e.color)} 16%, var(--card))`,
                    borderLeft:`3px solid ${colorVar(e.color)}`,
                    zIndex: 5 + idx,
                 }}
                >
                  <div className="font-bold text-[13px] leading-tight truncate">
                    {e.title}
                  </div>
                  {height > 38 && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {e.start ? fmtTimeShort(e.start) : ""}
                      {e.end ?` – ${fmtTimeShort(e.end)}` : ""}
                      {e.subtitle ?` · ${e.subtitle}` : ""}
                    </div>
                  )}
                </button>
              );
           })}
          </div>
        </div>
      </div>
    </div>
  );
}
