/**
 * Registers for Expo push notifications and saves the token to the HALO portal.
 * Call once from the authenticated layout — safe to call on every mount (idempotent save).
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useAuth } from '@/context/AuthContext';

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? '';

// Configure how notifications are presented while the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerAndSave(portalToken: string): Promise<void> {
  // Push notifications are native-only
  if (Platform.OS === 'web') return;

  // Request permission — cast to any because NotificationPermissionsStatus
  // extends PermissionResponse but TypeScript loses `granted` through the
  // import chain in this SDK version.
  const existingPerms: any = await Notifications.getPermissionsAsync();
  if (!existingPerms.granted) {
    const newPerms: any = await Notifications.requestPermissionsAsync();
    if (!newPerms.granted) return;
  }

  // Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'HALO Crew',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#B4FF44',
    });
  }

  // Get push token — requires a real EAS projectId to work on device
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId;
  if (!projectId) return;

  let expoPushToken: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    expoPushToken = result.data;
  } catch {
    // Simulator / dev environment without EAS — skip silently
    return;
  }

  // Save to server (best-effort)
  try {
    await fetch(`https://${DOMAIN}/api/portal/${portalToken}/push-token`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushToken: expoPushToken }),
    });
  } catch {
    // Network error — will retry on next mount
  }
}

export function usePushNotifications() {
  const { token: portalToken } = useAuth();

  useEffect(() => {
    if (!portalToken) return;
    registerAndSave(portalToken);
  }, [portalToken]);
}
