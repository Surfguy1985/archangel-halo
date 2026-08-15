/**
 * Civil-date math in a property IANA timezone.
 *
 * Never use UTC getUTC* / toISOString().slice(0,10) for day boundaries or
 * YYYY-MM-DD invoice numbers. Postgres `timestamptz AT TIME ZONE tz` is the
 * same conversion this module implements in JS.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export type CivilDate = {
  year: number;
  month: number;
  day: number;
};

export type CivilDateTime = CivilDate & {
  hour: number;
  minute: number;
  second: number;
};

function partsInZone(at: Date, timeZone: string): CivilDateTime {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** Offset of `timeZone` at instant `at`: UTC = local - offset. */
function offsetMsAt(at: Date, timeZone: string): number {
  const p = partsInZone(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - at.getTime();
}

/** Interpret a civil wall-clock in `timeZone` as a UTC instant. */
export function zonedCivilToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = new Date(utcGuess);
  instant = new Date(utcGuess - offsetMsAt(instant, timeZone));
  instant = new Date(utcGuess - offsetMsAt(instant, timeZone));
  return instant;
}

export function dateTimePartsInZone(at: Date, timeZone: string): CivilDateTime {
  return partsInZone(at, timeZone);
}

export function datePartsInZone(at: Date, timeZone: string): CivilDate {
  const p = partsInZone(at, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Calendar days from `from` to `to` in `timeZone` (ready - vacate), matching Postgres date subtraction. */
export function calendarDaysBetween(
  from: Date,
  to: Date,
  timeZone: string,
): number {
  const a = datePartsInZone(from, timeZone);
  const b = datePartsInZone(to, timeZone);
  const aUtc = Date.UTC(a.year, a.month - 1, a.day);
  const bUtc = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bUtc - aUtc) / 86_400_000);
}

/** Days in the civil month that contains `at` in `timeZone`. */
export function daysInMonthInZone(at: Date, timeZone: string): number {
  const p = datePartsInZone(at, timeZone);
  return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
}

/**
 * Invoice / PO date stamp: YYMMDD in the property timezone.
 * Spec: `{propertyCode}-{unitNumber}-{YYMMDD}-{seq}`
 */
export function yymmddInZone(at: Date, timeZone: string): string {
  const p = datePartsInZone(at, timeZone);
  return `${String(p.year).slice(2)}${pad2(p.month)}${pad2(p.day)}`;
}

/** Add whole civil days in `timeZone` (DST-safe). Do not add 86400000 ms. */
export function addCivilDaysInZone(at: Date, days: number, timeZone: string): Date {
  const p = datePartsInZone(at, timeZone);
  const utc = Date.UTC(p.year, p.month - 1, p.day + days);
  const shifted = new Date(utc);
  return zonedCivilToUtc(
    timeZone,
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
    0,
  );
}
export function startOfWeekMondayInZone(at: Date, timeZone: string): Date {
  const p = datePartsInZone(at, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const daysBack = (weekday + 6) % 7;
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - daysBack));
  return zonedCivilToUtc(
    timeZone,
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    0,
    0,
    0,
  );
}
