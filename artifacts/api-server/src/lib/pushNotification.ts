/**
 * Best-effort Expo push notification delivery.
 * Never throws — push failures must never break a request.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function sendExpoPush(
  pushToken: string | null | undefined,
  notification: { title: string; body: string; data?: Record<string, unknown> },
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
