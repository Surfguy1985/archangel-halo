import { computeQueues } from "./queues";
import {
  sendDailyDigest,
  sendUrgentAlert,
  sendEveningClose,
  sendWeeklyScorecard,
  urgentSignature,
} from "./notifications";
import { logger } from "./logger";

const DAILY_HOUR = 6;
const DAILY_MINUTE = 45;
const CLOSE_HOUR = 18;
const CLOSE_MINUTE = 30;
const WEEKLY_HOUR = 7;
const WEEKLY_MINUTE = 0;
const WEEKLY_DOW = 1; // Monday
const TICK_MS = 60 * 1000;
const URGENT_CHECK_MS = 15 * 60 * 1000;

let lastDailyDate: string | null = null;
let lastCloseDate: string | null = null;
let lastWeeklyDate: string | null = null;
let lastUrgentSignature = "";
let lastUrgentCheck = 0;

function nowInEastern(): {
  date: string;
  hour: number;
  minute: number;
  dow: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dow: dowMap[parts.weekday as string] ?? -1,
  };
}

async function tick(): Promise<void> {
  const { date, hour, minute, dow } = nowInEastern();

  if (
    hour === DAILY_HOUR &&
    minute >= DAILY_MINUTE &&
    lastDailyDate !== date
  ) {
    try {
      const { sent } = await sendDailyDigest();
      if (sent) lastDailyDate = date;
    } catch (err) {
      logger.warn({ err }, "Scheduled daily digest failed");
    }
  }

  if (
    hour === CLOSE_HOUR &&
    minute >= CLOSE_MINUTE &&
    lastCloseDate !== date
  ) {
    try {
      const { sent } = await sendEveningClose();
      if (sent) lastCloseDate = date;
    } catch (err) {
      logger.warn({ err }, "Scheduled evening close failed");
    }
  }

  if (
    dow === WEEKLY_DOW &&
    hour === WEEKLY_HOUR &&
    minute >= WEEKLY_MINUTE &&
    lastWeeklyDate !== date
  ) {
    try {
      const { sent } = await sendWeeklyScorecard();
      if (sent) lastWeeklyDate = date;
    } catch (err) {
      logger.warn({ err }, "Scheduled weekly scorecard failed");
    }
  }

  const stamp = Date.now();
  if (stamp - lastUrgentCheck >= URGENT_CHECK_MS) {
    lastUrgentCheck = stamp;
    try {
      const { feed } = await computeQueues();
      const sig = urgentSignature(feed);
      if (sig && sig !== lastUrgentSignature) {
        const { sent } = await sendUrgentAlert(feed);
        if (sent) lastUrgentSignature = sig;
      } else if (!sig) {
        lastUrgentSignature = "";
      }
    } catch (err) {
      logger.warn({ err }, "Scheduled urgent check failed");
    }
  }
}

export function startScheduler(): void {
  const eastern = nowInEastern();
  const past = (h: number, m: number) =>
    eastern.hour > h || (eastern.hour === h && eastern.minute >= m);
  lastDailyDate = past(DAILY_HOUR, DAILY_MINUTE) ? eastern.date : null;
  lastCloseDate = past(CLOSE_HOUR, CLOSE_MINUTE) ? eastern.date : null;
  lastWeeklyDate =
    eastern.dow === WEEKLY_DOW && past(WEEKLY_HOUR, WEEKLY_MINUTE)
      ? eastern.date
      : null;
  setInterval(() => {
    void tick();
  }, TICK_MS);
  logger.info(
    {
      dailyHour: DAILY_HOUR,
      dailyMinute: DAILY_MINUTE,
      closeHour: CLOSE_HOUR,
      closeMinute: CLOSE_MINUTE,
      weeklyDow: WEEKLY_DOW,
      weeklyHour: WEEKLY_HOUR,
    },
    "Email scheduler started",
  );
}
