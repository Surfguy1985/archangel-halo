/**
 * Best-effort Expo push notification delivery.
 * Never throws — push failures must never break a request.
 */

import { eq } from "drizzle-orm";
import { db, crewsTable } from "@workspace/db";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type CrewPush = { title: string; body: string; data?: Record<string, unknown> };

export async function sendExpoPush(
  pushToken: string | null | undefined,
  notification: CrewPush,
): Promise<void> {
  if (!pushToken) return;
  // Only send to valid Expo push tokens
  const tok = String(pushToken);
  if (!tok.startsWith("ExponentPushToken[") && !tok.startsWith("ExpoPushToken[")) return;

  try {
    await fetch(EXPO_PUSH_URL, {
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
  } catch {
    // best-effort — never propagate push errors
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
