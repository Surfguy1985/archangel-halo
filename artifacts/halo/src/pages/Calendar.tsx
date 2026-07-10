import { useMemo, useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, Briefcase, StickyNote } from "lucide-react";
import {
  useGetCalendar,
  type CalendarEvent,
} from "@workspace/api-client-react";
import { CalendarEventSheet } from "@/components/CalendarEventSheet";
import { EditCalendarEventSheet } from "@/components/EditCalendarEventSheet";
import { ScheduleJobSheet } from "@/components/ScheduleJobSheet";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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
function colorVar(token: string) {
  return `var(${COLOR_VAR[token] ?? "--gold"})`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseYmd(s: string) {
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return new Date(y!, m! - 1, d!, 12);
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
  return `${hr} ${mer}`;
}

type ViewMode = "day" | "week" | "month";
const HOUR_H = 56;
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

export default function Calendar() {
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState<ViewMode>("day");
  const [cursor, setCursor] = useState<Date>(today);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [addDate, setAddDate] = useState<string>(ymd(today));
  const [addStart, setAddStart] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const dayScrollRef = useRef<HTMLDivElement>(null);

  // Fetch a padded window covering the current view.
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
    if (view === "day") setCursor(addDays(cursor, dir));
    else if (view === "week") setCursor(addDays(cursor, dir * 7));
    else setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1, 12));
  };

  const headerTitle =
    view === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "week"
        ? (() => {
            const ws = startOfWeek(cursor);
            const we = addDays(ws, 6);
            const sameMonth = ws.getMonth() === we.getMonth();
            return sameMonth
              ? `${ws.toLocaleDateString(undefined, { month: "long" })} ${ws.getDate()}–${we.getDate()}`
              : `${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${we.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
          })()
        : cursor.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          });

  return (
    <div className="pt-[6px]">
      {/* Header */}
      <div className="flex items-center gap-[10px] mb-[12px]">
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[22px] leading-[1.1] truncate">
            {headerTitle}
          </div>
          <div className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground mt-[2px]">
            Schedule
          </div>
        </div>
        <button
          onClick={() => setCursor(new Date())}
          className="text-[12.5px] font-bold px-[12px] py-[8px] rounded-full bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.96]"
        >
          Today
        </button>
        <button
          onClick={() => step(-1)}
          className="w-[36px] h-[36px] rounded-full grid place-items-center bg-card border border-border shadow-[var(--shadow)]"
          aria-label="Previous"
        >
          <ChevronLeft className="w-[18px] h-[18px]" />
        </button>
        <button
          onClick={() => step(1)}
          className="w-[36px] h-[36px] rounded-full grid place-items-center bg-card border border-border shadow-[var(--shadow)]"
          aria-label="Next"
        >
          <ChevronRight className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* View switch */}
      <div className="flex gap-[4px] p-[4px] bg-card border border-border rounded-[13px] shadow-[var(--shadow)] mb-[14px]">
        {(["day", "week", "month"] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-[8px] rounded-[10px] text-[13.5px] font-semibold capitalize transition-colors ${
              view === v
                ? "bg-[var(--ink)] text-[var(--paper)]"
                : "text-muted-foreground"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">
          Loading schedule…
        </div>
      )}

      {!isLoading && view === "day" && (
        <DayView
          date={cursor}
          events={byDate.get(ymd(cursor)) ?? []}
          scrollRef={dayScrollRef}
          onEvent={openDetail}
          onAddAt={(start) => openAdd(ymd(cursor), start)}
        />
      )}

      {!isLoading && view === "week" && (
        <WeekView
          cursor={cursor}
          byDate={byDate}
          onEvent={openDetail}
          onPickDay={(d) => {
            setCursor(d);
            setView("day");
          }}
        />
      )}

      {!isLoading && view === "month" && (
        <MonthView
          cursor={cursor}
          byDate={byDate}
          onPickDay={(d) => {
            setCursor(d);
            setView("day");
          }}
        />
      )}

      {/* FAB */}
      <button
        onClick={() => setChooserOpen(true)}
        className="fixed sm:absolute right-[18px] bottom-[102px] w-[54px] h-[54px] rounded-full grid place-items-center text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_8px_24px_rgba(143,106,31,0.42)] z-20 transition-transform active:scale-[0.94]"
        aria-label="Add to calendar"
      >
        <Plus className="w-[26px] h-[26px]" strokeWidth={2.2} />
      </button>

      {/* Add chooser */}
      <Sheet open={chooserOpen} onOpenChange={setChooserOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-[22px] px-[18px] pb-[26px]"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-[20px] tracking-[-0.01em]">
              Add to calendar
            </SheetTitle>
          </SheetHeader>
          <div className="mt-[16px] space-y-[10px]">
            <button
              onClick={() => {
                setChooserOpen(false);
                setScheduleOpen(true);
              }}
              className="w-full flex items-center gap-[13px] rounded-[15px] p-[14px] bg-card border border-border shadow-[var(--shadow)] text-left transition-transform active:scale-[0.98]"
            >
              <div className="w-[40px] h-[40px] shrink-0 rounded-[11px] grid place-items-center text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))]">
                <Briefcase className="w-[19px] h-[19px]" />
              </div>
              <div>
                <div className="font-display font-bold text-[15px]">
                  Schedule a job
                </div>
                <div className="text-[12.5px] text-muted-foreground">
                  Assign a date, time, and crew to a job
                </div>
              </div>
            </button>
            <button
              onClick={() => {
                setChooserOpen(false);
                openAdd(ymd(cursor), null);
              }}
              className="w-full flex items-center gap-[13px] rounded-[15px] p-[14px] bg-card border border-border shadow-[var(--shadow)] text-left transition-transform active:scale-[0.98]"
            >
              <div className="w-[40px] h-[40px] shrink-0 rounded-[11px] grid place-items-center bg-[var(--ink)] text-[var(--paper)]">
                <StickyNote className="w-[19px] h-[19px]" />
              </div>
              <div>
                <div className="font-display font-bold text-[15px]">
                  Add a note
                </div>
                <div className="text-[12.5px] text-muted-foreground">
                  A reminder or ad-hoc entry
                </div>
              </div>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <CalendarEventSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        event={selected}
        onEdit={openEdit}
      />
      <EditCalendarEventSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        date={addDate}
        defaultStart={addStart}
        event={editEvent}
      />
      <ScheduleJobSheet
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        defaultDate={ymd(cursor)}
      />
    </div>
  );
}

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
      const first = timed.length ? Math.min(...timed.map((e) => toMin(e.start)!)) : 7 * 60;
      scrollRef.current.scrollTop = Math.max(0, (first / 60) * HOUR_H - HOUR_H);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ymd(date)]);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div>
      {allDay.length > 0 && (
        <div className="flex flex-col gap-[7px] mb-[12px]">
          {allDay.map((e) => (
            <button
              key={e.id}
              onClick={() => onEvent(e)}
              className="flex items-center gap-[10px] w-full text-left rounded-[12px] p-[11px_13px] border border-border shadow-[var(--shadow)]"
              style={{ background: `color-mix(in srgb, ${colorVar(e.color)} 12%, var(--card))` }}
            >
              <span
                className="w-[8px] h-[8px] rounded-full shrink-0"
                style={{ background: colorVar(e.color) }}
              />
              <span className="font-semibold text-[14px] truncate">{e.title}</span>
              <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground ml-auto shrink-0">
                All-day
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        className="relative overflow-y-auto rounded-[16px] border border-border bg-card shadow-[var(--shadow)]"
        style={{ height: "calc(100dvh - 340px)", minHeight: "360px" }}
      >
        <div className="relative" style={{ height: `${24 * HOUR_H}px` }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-border/70"
              style={{ top: `${h * HOUR_H}px` }}
            >
              <span className="absolute -top-[8px] left-[10px] text-[10.5px] font-semibold text-muted-foreground w-[42px]">
                {h === 0 ? "" : fmtHour(h)}
              </span>
              <button
                className="absolute left-[58px] right-[8px] top-0 h-[56px]"
                onClick={() => onAddAt(`${pad(h)}:00`)}
                aria-label={`Add at ${fmtHour(h)}`}
              />
            </div>
          ))}

          {isToday && (
            <div
              className="absolute left-[52px] right-[4px] z-10 pointer-events-none"
              style={{ top: `${(nowMin / 60) * HOUR_H}px` }}
            >
              <div className="relative">
                <span className="absolute -left-[6px] -top-[4px] w-[9px] h-[9px] rounded-full bg-[var(--red)]" />
                <div className="h-[2px] bg-[var(--red)]" />
              </div>
            </div>
          )}

          <div className="absolute left-[58px] right-[8px] top-0 bottom-0">
            {timed.map((e, idx) => {
              const s = toMin(e.start)!;
              const en = Math.max(toMin(e.end) ?? s + 60, s + 30);
              const top = (s / 60) * HOUR_H;
              const height = Math.max(24, ((en - s) / 60) * HOUR_H - 3);
              const overlaps = timed.filter(
                (o) =>
                  toMin(o.start) !== null &&
                  toMin(o.start)! < en &&
                  Math.max(toMin(o.end) ?? toMin(o.start)! + 60, toMin(o.start)! + 30) > s,
              );
              const col = Math.max(0, overlaps.indexOf(e));
              const cols = Math.max(1, overlaps.length);
              const widthPct = 100 / cols;
              return (
                <button
                  key={e.id}
                  onClick={() => onEvent(e)}
                  className="absolute rounded-[10px] p-[6px_9px] text-left overflow-hidden shadow-[0_2px_8px_rgba(23,24,28,0.12)] transition-transform active:scale-[0.98]"
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    left: `calc(${col * widthPct}% + ${col === 0 ? 0 : 2}px)`,
                    width: `calc(${widthPct}% - 3px)`,
                    background: `color-mix(in srgb, ${colorVar(e.color)} 16%, var(--card))`,
                    borderLeft: `3px solid ${colorVar(e.color)}`,
                    zIndex: 5 + idx,
                  }}
                >
                  <div className="font-bold text-[12.5px] leading-[1.15] truncate">
                    {e.title}
                  </div>
                  {height > 34 && (
                    <div className="text-[10.5px] text-muted-foreground truncate">
                      {e.start}
                      {e.subtitle ? ` · ${e.subtitle}` : ""}
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

function WeekView({
  cursor,
  byDate,
  onEvent,
  onPickDay,
}: {
  cursor: Date;
  byDate: Map<string, CalendarEvent[]>;
  onEvent: (e: CalendarEvent) => void;
  onPickDay: (d: Date) => void;
}) {
  const ws = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const todayStr = ymd(new Date());

  return (
    <div className="rounded-[16px] border border-border bg-card shadow-[var(--shadow)] overflow-hidden">
      {days.map((d) => {
        const key = ymd(d);
        const dayEvents = byDate.get(key) ?? [];
        const isToday = key === todayStr;
        return (
          <div
            key={key}
            className={`flex border-b border-border last:border-b-0 ${
              isToday ? "bg-[var(--gold-tint)]" : ""
            }`}
          >
            <button
              onClick={() => onPickDay(d)}
              className="w-[54px] shrink-0 flex flex-col items-center justify-start pt-[11px] pb-[8px] border-r border-border"
            >
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {DAY_LETTERS[d.getDay()]}
              </span>
              <span
                className={`mt-[3px] w-[28px] h-[28px] grid place-items-center rounded-full font-display font-bold text-[15px] ${
                  isToday ? "bg-[var(--ink)] text-[var(--paper)]" : ""
                }`}
              >
                {d.getDate()}
              </span>
            </button>
            <div className="flex-1 min-w-0 p-[8px_10px] flex flex-col gap-[5px]">
              {dayEvents.length === 0 ? (
                <button
                  onClick={() => onPickDay(d)}
                  className="text-[12px] text-muted-foreground/60 text-left py-[6px]"
                >
                  —
                </button>
              ) : (
                dayEvents.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => onEvent(e)}
                    className="flex items-center gap-[8px] text-left rounded-[9px] px-[9px] py-[6px]"
                    style={{
                      background: `color-mix(in srgb, ${colorVar(e.color)} 14%, var(--card))`,
                      borderLeft: `3px solid ${colorVar(e.color)}`,
                    }}
                  >
                    {!e.allDay && e.start && (
                      <span className="text-[11px] font-semibold text-muted-foreground shrink-0 w-[42px]">
                        {e.start}
                      </span>
                    )}
                    <span className="text-[12.5px] font-semibold truncate">
                      {e.title}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({
  cursor,
  byDate,
  onPickDay,
}: {
  cursor: Date;
  byDate: Map<string, CalendarEvent[]>;
  onPickDay: (d: Date) => void;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const todayStr = ymd(new Date());
  const month = cursor.getMonth();

  return (
    <div className="rounded-[16px] border border-border bg-card shadow-[var(--shadow)] overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {DAY_LETTERS.map((l, i) => (
          <div
            key={i}
            className="text-center text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted-foreground py-[8px]"
          >
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === month;
          const isToday = key === todayStr;
          const dayEvents = byDate.get(key) ?? [];
          return (
            <button
              key={key}
              onClick={() => onPickDay(d)}
              className={`min-h-[64px] border-b border-r border-border p-[5px_4px] flex flex-col items-center ${
                i % 7 === 6 ? "border-r-0" : ""
              } ${inMonth ? "" : "opacity-35"}`}
            >
              <span
                className={`w-[24px] h-[24px] grid place-items-center rounded-full text-[13px] font-display font-bold ${
                  isToday ? "bg-[var(--ink)] text-[var(--paper)]" : ""
                }`}
              >
                {d.getDate()}
              </span>
              <div className="flex flex-wrap gap-[3px] justify-center mt-[4px] px-[2px]">
                {dayEvents.slice(0, 4).map((e) => (
                  <span
                    key={e.id}
                    className="w-[6px] h-[6px] rounded-full"
                    style={{ background: colorVar(e.color) }}
                  />
                ))}
                {dayEvents.length > 4 && (
                  <span className="text-[9px] font-bold text-muted-foreground leading-[6px]">
                    +{dayEvents.length - 4}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
