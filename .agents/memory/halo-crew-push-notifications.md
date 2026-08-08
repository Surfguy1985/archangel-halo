---
name: HALO Crew push notifications
description: Expo push notification setup for the crew mobile app — token storage, server helper, wiring decisions.
---

# HALO Crew — Push Notifications

## Token storage
- `crews.push_token` column (text, nullable) added to crewsTable in `lib/db/src/schema/jobs.ts`
- DB migrated via `cd lib/db && pnpm exec drizzle-kit push`
- `PUT /portal/:token/push-token` endpoint in `portal.ts` saves the token

## Server-side send helper
- `artifacts/api-server/src/lib/pushNotification.ts` — `sendExpoPush(pushToken, { title, body })`
- Validates token starts with `ExponentPushToken[` or `ExpoPushToken[`; best-effort, never throws
- Calls `https://exp.host/--/api/v2/push/send` via fetch (no SDK needed)

## Events currently wired for push
1. Office → crew message (`crew.ts` POST `/crews/:id/messages`) — title "📨 New message from office"

## Events NOT yet wired (future work)
- Walk approval (`clientBoard.ts` walk_approved activity insert) — card shown in Today tab but no push
- Emergency ping send (`emergency.ts`) — SMS only, not push

## Client registration hook
- `artifacts/halo-crew/hooks/usePushNotifications.ts`
- Called from `app/(tabs)/_layout.tsx` TabLayout component
- Requires `extra.eas.projectId` in app.json EAS config — silently skips if missing (dev/simulator)
- `expo-notifications@~0.32.17` (SDK 54 compatible version)
- `NotificationPermissionsStatus.granted` fails typecheck (type import chain issue) — use `as any` cast

**Why:** expo-notifications shipped 57.x which is incompatible with SDK 54; always pin to the version Expo specifies in the compatibility table.
