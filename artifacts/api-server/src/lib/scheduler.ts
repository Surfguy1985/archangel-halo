import { computeQueues } from "./queues";
import {
  sendDailyDigest,
  sendUrgentAlert,
  urgentSignature,
} from "./notifications";
import { logger } from "./logger";

const DAILY_HOUR = 6;
const DAILY_MINUTE = 45;
const TICK_MS = 60 * 1000;
const URGENT_CHECK_MS = 15 * 60 * 1000;

let lastDailyDate: string | null = null;
let lastUrgentSignature = "";
let lastUrgentCheck = 0;

function nowInEastern(): { date: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

async function tick(): Promise<void> {
  const { date, hour, minute } = nowInEastern();

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
  const pastWindow =
    eastern.hour > DAILY_HOUR ||
    (eastern.hour === DAILY_HOUR && eastern.minute >= DAILY_MINUTE);
  lastDailyDate = pastWindow ? eastern.date : null;
  setInterval(() => {
    void tick();
  }, TICK_MS);
  logger.info(
    { dailyHour: DAILY_HOUR, dailyMinute: DAILY_MINUTE },
    "Email scheduler started",
  );
}
