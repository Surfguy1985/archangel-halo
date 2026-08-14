/**
 * Best-effort Expo push notification delivery.
 * Never throws — push failures must never break a request.
 */

import { eq } from "drizzle-orm";
import { db, crewsTable } from "@workspace/db";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type CrewPush = { title: string; body: string; data?: Record<string, unknown> };

/**
 * Returns true only when Expo accepted the notification (HTTP 2xx **and**
 * the ticket for this token carries `status: "ok"`). Returns false for:
 *   - absent / malformed token
 *   - transport errors (network down, DNS failure, etc.)
 *   - HTTP non-2xx responses from Expo
 *   - Expo error tickets (`data[n].status !== "ok"`)
 *
 * Never throws — push failures must not break callers. Callers should name
 * the returned flag "acceptedPush" or "pushQueued" to be clear that device
 * delivery is asynchronous; we only know Expo queued it.
 */
export async function sendExpoPush(
  pushToken: string | null | undefined,
  notification: CrewPush,
): Promise<boolean> {
  if (!pushToken) return false;
  // Only send to valid Expo push tokens
  const tok = String(pushToken);
  if (!tok.startsWith("ExponentPushToken[") && !tok.startsWith("ExpoPushToken[")) return false;

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        to: tok,
        sound: "default",
        title: notification.title,
        body: notification.body,
        data: notification.data ?? {},
      }),
    });

    // HTTP-level failure (4xx/5xx from Expo)
    if (!response.ok) return false;

    // Expo returns { data: [{ status: "ok" | "error", ... }] }
    // Treat anything other than explicit "ok" as a rejection.
    try {
      const json = await response.json() as { data?: Array<{ status?: string }> };
      const ticket = json.data?.[0];
      return ticket?.status === "ok";
    } catch {
      // If we can't parse the ticket, assume it was not accepted
      return false;
    }
  } catch {
    // Transport error — best-effort, never propagate
    return false;
  }
}

export function pushToCrews(
  crews: Array<{ pushToken?: string | null }>,
  notification: CrewPush,
): void {
  for (const crew of crews) {
    void sendExpoPush(crew.pushToken, notification);
  }
}

export async function pushToCrewId(crewId: string | null | undefined, notification: CrewPush): Promise<void> {
  if (!crewId) return;
  try {
    const [crew] = await db
      .select({ pushToken: crewsTable.pushToken })
      .from(crewsTable)
      .where(eq(crewsTable.id, crewId));
    await sendExpoPush(crew?.pushToken, notification);
  } catch {
    // never break the request
  }
}
