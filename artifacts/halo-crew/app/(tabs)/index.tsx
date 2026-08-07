import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useGpsTracker } from '@/hooks/useGpsTracker';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useListPortalJobs,
  useListPortalPhotos,
  useCreatePortalCheckin,
  useCompletePortalLineItem,
  getListPortalJobsQueryKey,
  getListPortalPhotosQueryKey,
} from '@workspace/api-client-react';
import type { PortalJob, PortalJobLineItem } from '@workspace/api-client-react';

// ─── Moving-to ping ───────────────────────────────────────────────────────────

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? '';

async function patchMovingTo(token: string, unit: string | null): Promise<void> {
  await fetch(`https://${DOMAIN}/api/portal/${token}/moving-to`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit }),
  });
}

// ─── En-route trail indicator ─────────────────────────────────────────────────

function EnRouteTrail() {
  const anim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, [anim]);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  return (
    <View style={erStyles.row}>
      {/* Trail dots */}
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            erStyles.dot,
            {
              opacity: anim.interpolate({
                inputRange: [0, 0.33 * (i + 1), 1],
                outputRange: [0.2, 1, 0.2],
                extrapolate: 'clamp',
              }),
              transform: [{ scale: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 1.1, 0.7], extrapolate: 'clamp' }) }],
            },
          ]}
        />
      ))}
      <Animated.Text style={[erStyles.label, { opacity }]}>En route</Animated.Text>
      <Ionicons name="navigate" size={14} color="#22C55E" />
    </View>
  );
}

const erStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)',
    alignSelf: 'center',
    marginTop: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  label: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#22C55E',
    letterSpacing: 0.3,
  },
});

// ─── Phase derivation ────────────────────────────────────────────────────────

type Phase =
  | 'loading'
  | 'idle'
  | 'pre_checkin'
  | 'before_photos'
  | 'checklist'
  | 'after_photos'
  | 'wrap_up'
  | 'done';

function derivePhase(
  job: PortalJob | null,
  beforeCount: number,
  afterCount: number,
): Phase {
  if (!job) return 'idle';
  if (!job.checkedIn) return 'pre_checkin';
  if (job.checkedOut) return 'done';

  const myItems = (job.lineItems ?? []).filter((li) => li.mine);
  const allDone = myItems.length > 0 && myItems.every((li) => li.completed);

  if (beforeCount === 0) return 'before_photos';
  if (!allDone) return 'checklist';
  if (afterCount === 0) return 'after_photos';
  return 'wrap_up';
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function GpsPulse({ active }: { active: boolean }) {
  return (
    <View style={gpsPulseStyles.row}>
      <View
        style={[
          gpsPulseStyles.dot,
          { backgroundColor: active ? '#22C55E' : '#435A7D' },
        ]}
      />
      <Text style={[gpsPulseStyles.text, { color: active ? '#22C55E' : '#435A7D' }]}>
        {active ? 'GPS Active' : 'GPS Off'}
      </Text>
    </View>
  );
}

const gpsPulseStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
});

function PhaseDots({ phase }: { phase: Phase }) {
  const phases: Phase[] = [
    'pre_checkin',
    'before_photos',
    'checklist',
    'after_photos',
    'wrap_up',
  ];
  const currentIdx = phases.indexOf(phase);

  return (
    <View style={phaseDotsStyles.row}>
      {phases.map((p, i) => (
        <View
          key={p}
          style={[
            phaseDotsStyles.dot,
            i < currentIdx && phaseDotsStyles.done,
            i === currentIdx && phaseDotsStyles.active,
          ]}
        />
      ))}
    </View>
  );
}

const phaseDotsStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 7, alignItems: 'center', marginBottom: 20 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(140,160,185,0.25)',
  },
  done: { backgroundColor: 'rgba(180,255,68,0.4)' },
  active: { backgroundColor: '#B4FF44', width: 22, borderRadius: 4 },
});

function ChecklistItems({
  items,
  token,
  jobId,
  onDone,
}: {
  items: PortalJobLineItem[];
  token: string;
  jobId: string;
  onDone: () => void;
}) {
  const { mutateAsync: markDone } = useCompletePortalLineItem();
  const [pending, setPending] = useState<Set<string>>(new Set());

  const toggle = async (item: PortalJobLineItem) => {
    if (pending.has(item.id)) return;
    setPending((p) => new Set(p).add(item.id));
    try {
      await markDone({
        token,
        jobId,
        lineItemId: item.id,
        data: { done: !item.completed },
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onDone();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(item.id);
        return n;
      });
    }
  };

  const myItems = items.filter((li) => li.mine);
  const doneCount = myItems.filter((li) => li.completed).length;

  return (
    <View>
      <View style={checkStyles.header}>
        <Text style={checkStyles.title}>Your work items</Text>
        <Text style={checkStyles.progress}>
          {doneCount} / {myItems.length}
        </Text>
      </View>
      {myItems.map((item) => (
        <Pressable
          key={item.id}
          style={({ pressed }) => [
            checkStyles.row,
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => toggle(item)}
        >
          <View
            style={[checkStyles.checkbox, item.completed && checkStyles.checked]}
          >
            {item.completed && (
              <Ionicons name="checkmark" size={13} color="#07101E" />
            )}
          </View>
          <Text
            style={[
              checkStyles.label,
              item.completed && checkStyles.labelDone,
            ]}
          >
            {item.service}
          </Text>
          {pending.has(item.id) && (
            <ActivityIndicator size="small" color="#B4FF44" />
          )}
        </Pressable>
      ))}
    </View>
  );
}

const checkStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  progress: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#B4FF44',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(140,160,185,0.10)',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(140,160,185,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checked: {
    backgroundColor: '#B4FF44',
    borderColor: '#B4FF44',
  },
  label: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#F4F7F9',
  },
  labelDone: {
    color: '#435A7D',
    textDecorationLine: 'line-through',
  },
});

// ─── Phase content ────────────────────────────────────────────────────────────

function PhaseContent({
  phase,
  job,
  beforeCount,
  afterCount,
  token,
  onRefresh,
}: {
  phase: Phase;
  job: PortalJob | null;
  beforeCount: number;
  afterCount: number;
  token: string;
  onRefresh: () => void;
}) {
  if (phase === 'idle') {
    return (
      <View style={phaseStyles.emptyBox}>
        <Ionicons name="calendar-outline" size={44} color="#435A7D" />
        <Text style={phaseStyles.emptyTitle}>No jobs today</Text>
        <Text style={phaseStyles.emptyBody}>
          Check the Schedule tab for upcoming work or the Offers tab for new
          opportunities.
        </Text>
      </View>
    );
  }

  if (!job) return null;

  switch (phase) {
    case 'pre_checkin':
      return (
        <View style={phaseStyles.infoBox}>
          <View style={phaseStyles.iconCircle}>
            <Ionicons name="location-outline" size={26} color="#B4FF44" />
          </View>
          <Text style={phaseStyles.phaseTitle}>Head to the site</Text>
          <Text style={phaseStyles.phaseBody}>
            {job.propertyName ?? 'Your job site'} is ready for you.{'\n'}
            Check in when you arrive.
          </Text>
        </View>
      );

    case 'before_photos':
      return (
        <View style={phaseStyles.infoBox}>
          <View style={phaseStyles.iconCircle}>
            <Ionicons name="camera-outline" size={26} color="#B4FF44" />
          </View>
          <Text style={phaseStyles.phaseTitle}>Before photos</Text>
          <Text style={phaseStyles.phaseBody}>
            Photograph the work area{'\n'}
            before you start. This protects you.
          </Text>
        </View>
      );

    case 'checklist':
      return (
        <ChecklistItems
          items={job.lineItems ?? []}
          token={token}
          jobId={job.id}
          onDone={onRefresh}
        />
      );

    case 'after_photos':
      return (
        <View style={phaseStyles.infoBox}>
          <View style={[phaseStyles.iconCircle, { backgroundColor: 'rgba(249,115,22,0.15)' }]}>
            <Ionicons name="checkmark-done-outline" size={26} color="#F97316" />
          </View>
          <Text style={phaseStyles.phaseTitle}>Almost done!</Text>
          <Text style={phaseStyles.phaseBody}>
            Take after photos to seal the job.{'\n'}
            {beforeCount} before · {afterCount} after so far
          </Text>
        </View>
      );

    case 'wrap_up':
      return (
        <View style={phaseStyles.infoBox}>
          <View style={[phaseStyles.iconCircle, { backgroundColor: 'rgba(180,255,68,0.15)' }]}>
            <Ionicons name="ribbon-outline" size={26} color="#B4FF44" />
          </View>
          <Text style={phaseStyles.phaseTitle}>Great work!</Text>
          <Text style={phaseStyles.phaseBody}>
            Submit your crew invoice{'\n'}
            and check out to wrap up.
          </Text>
        </View>
      );

    case 'done':
      return (
        <View style={phaseStyles.infoBox}>
          <View style={[phaseStyles.iconCircle, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
            <Ionicons name="checkmark-circle-outline" size={26} color="#22C55E" />
          </View>
          <Text style={phaseStyles.phaseTitle}>Day complete</Text>
          <Text style={phaseStyles.phaseBody}>
            You're checked out.{'\n'}
            Great work today!
          </Text>
        </View>
      );

    default:
      return null;
  }
}

const phaseStyles = StyleSheet.create({
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
    marginTop: 4,
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    textAlign: 'center',
    lineHeight: 21,
  },
  infoBox: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(180,255,68,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(180,255,68,0.20)',
    marginBottom: 4,
  },
  phaseTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
  },
  phaseBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    textAlign: 'center',
    lineHeight: 21,
  },
});

// ─── Action button ─────────────────────────────────────────────────────────────

function ActionButton({
  phase,
  job,
  token,
  coords,
  onRefresh,
  enRoute,
  setEnRoute,
}: {
  phase: Phase;
  job: PortalJob | null;
  token: string;
  coords: { lat: number; lng: number } | null;
  onRefresh: () => void;
  enRoute: boolean;
  setEnRoute: (v: boolean) => void;
}) {
  const { mutateAsync: createCheckin } = useCreatePortalCheckin();
  const [loading, setLoading] = useState(false);

  const act = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (phase === 'idle') {
      router.push('/more/offers');
      return;
    }

    if (phase === 'pre_checkin' && job) {
      // Open Maps for directions first
      const addr = encodeURIComponent(
        `${job.propertyName ?? ''} ${job.unitNo ?? ''}`,
      );
      const mapsUrl = Platform.OS === 'ios'
        ? `maps:?q=${addr}`
        : `geo:0,0?q=${addr}`;
      Linking.canOpenURL(mapsUrl).then((can) => {
        if (can) Linking.openURL(mapsUrl);
      });
      return;
    }

    if (phase === 'before_photos' || phase === 'after_photos') {
      router.push('/camera');
      return;
    }

    if (phase === 'wrap_up') {
      router.push('/more/invoice');
      return;
    }

    if (phase === 'done') return;
  }, [phase, job]);

  const handleCheckIn = useCallback(async () => {
    if (!job || loading) return;
    setLoading(true);
    try {
      await createCheckin({
        token,
        data: {
          jobId: job.id,
          kind: 'checkin',
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onRefresh();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }, [job, token, coords, createCheckin, onRefresh, loading]);

  const handleCheckOut = useCallback(async () => {
    if (!job || loading) return;
    Alert.alert(
      'Check Out?',
      'This ends your GPS tracking for this job.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Check Out',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await createCheckin({
                token,
                data: {
                  jobId: job.id,
                  kind: 'checkout',
                  lat: coords?.lat ?? null,
                  lng: coords?.lng ?? null,
                },
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onRefresh();
            } catch {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }, [job, token, coords, createCheckin, onRefresh, loading]);

  const config = {
    loading: { label: 'Loading…', icon: 'hourglass-outline', lime: false },
    idle: { label: 'View job offers', icon: 'arrow-forward-outline', lime: true },
    pre_checkin: { label: 'Get directions', icon: 'navigate-outline', lime: true },
    before_photos: { label: 'Take before photos', icon: 'camera-outline', lime: true },
    checklist: { label: 'Items above — tap to mark done', icon: 'checkbox-outline', lime: false },
    after_photos: { label: 'Take after photos', icon: 'camera-outline', lime: true },
    wrap_up: { label: 'Submit crew invoice', icon: 'document-text-outline', lime: true },
    done: { label: 'Day complete!', icon: 'checkmark-circle-outline', lime: false },
  }[phase] ?? { label: '', icon: 'arrow-forward', lime: true };

  if (phase === 'loading') {
    return (
      <View style={actionStyles.btn}>
        <ActivityIndicator color="#07101E" />
      </View>
    );
  }

  if (phase === 'pre_checkin') {
    const handleEnRoute = async () => {
      if (!job || enRoute) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setEnRoute(true);
      try {
        await patchMovingTo(token, job.unitNo ?? job.propertyName ?? null);
      } catch {
        // non-fatal — trail still shows locally
      }
    };

    return (
      <View style={actionStyles.stack}>
        <Pressable
          style={({ pressed }) => [actionStyles.btn, pressed && actionStyles.pressed]}
          onPress={act}
        >
          <Ionicons name={config.icon as any} size={20} color="#07101E" />
          <Text style={actionStyles.btnText}>{config.label}</Text>
        </Pressable>
        {/* En-route ping button */}
        {!enRoute ? (
          <Pressable
            style={({ pressed }) => [
              actionStyles.btn2,
              { borderColor: 'rgba(34,197,94,0.30)', backgroundColor: 'rgba(34,197,94,0.08)' },
              pressed && { opacity: 0.7 },
            ]}
            onPress={handleEnRoute}
          >
            <Ionicons name="navigate-outline" size={20} color="#22C55E" />
            <Text style={[actionStyles.btn2Text, { color: '#22C55E' }]}>
              I'm heading there
            </Text>
          </Pressable>
        ) : (
          <EnRouteTrail />
        )}
        <Pressable
          style={({ pressed }) => [
            actionStyles.btn2,
            pressed && { opacity: 0.7 },
          ]}
          onPress={handleCheckIn}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#B4FF44" size="small" />
          ) : (
            <>
              <Ionicons name="location" size={20} color="#B4FF44" />
              <Text style={actionStyles.btn2Text}>Check In Now</Text>
            </>
          )}
        </Pressable>
      </View>
    );
  }

  if (phase === 'wrap_up') {
    return (
      <View style={actionStyles.stack}>
        <Pressable
          style={({ pressed }) => [actionStyles.btn, pressed && actionStyles.pressed]}
          onPress={act}
          disabled={loading}
        >
          <Ionicons name="document-text-outline" size={20} color="#07101E" />
          <Text style={actionStyles.btnText}>Submit Invoice</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            actionStyles.btn2,
            pressed && { opacity: 0.7 },
          ]}
          onPress={handleCheckOut}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#8CA0B9" size="small" />
          ) : (
            <>
              <Ionicons name="exit-outline" size={20} color="#8CA0B9" />
              <Text style={[actionStyles.btn2Text, { color: '#8CA0B9' }]}>
                Check Out
              </Text>
            </>
          )}
        </Pressable>
      </View>
    );
  }

  if (phase === 'checklist') {
    return (
      <View style={[actionStyles.btn, { backgroundColor: 'rgba(140,160,185,0.12)' }]}>
        <Ionicons name="checkbox-outline" size={20} color="#8CA0B9" />
        <Text style={[actionStyles.btnText, { color: '#8CA0B9' }]}>
          Tap items above to complete
        </Text>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={[actionStyles.btn, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
        <Ionicons name="checkmark-circle-outline" size={20} color="#22C55E" />
        <Text style={[actionStyles.btnText, { color: '#22C55E' }]}>
          Day complete — great work!
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [actionStyles.btn, pressed && actionStyles.pressed]}
      onPress={act}
      disabled={loading}
    >
      <Ionicons name={config.icon as any} size={20} color="#07101E" />
      <Text style={actionStyles.btnText}>{config.label}</Text>
    </Pressable>
  );
}

const actionStyles = StyleSheet.create({
  stack: { gap: 10 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B4FF44',
    borderRadius: 16,
    paddingVertical: 17,
    gap: 10,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  btnText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#07101E',
  },
  btn2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(180,255,68,0.08)',
    borderRadius: 16,
    paddingVertical: 15,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(180,255,68,0.20)',
  },
  btn2Text: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#B4FF44',
  },
});

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const { token, portal, invalidate } = useAuth();

  const { data: jobs, refetch: refetchJobs } = useListPortalJobs(token!, {
    query: { enabled: !!token, staleTime: 20_000, queryKey: getListPortalJobsQueryKey(token!) },
  });

  const { data: photos, refetch: refetchPhotos } = useListPortalPhotos(
    token!,
    { query: { enabled: !!token, staleTime: 20_000, queryKey: getListPortalPhotosQueryKey(token!) } },
  );

  // Get today's active job (first scheduled/in-progress)
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const job = jobs?.find((j) => j.status !== 'cleared' && j.status !== 'complete') ?? null;

  const todayPhotos = (photos ?? []).filter(
    (p) => p.jobId === job?.id || !job?.id,
  );
  const beforeCount = todayPhotos.filter((p) => p.phase === 'before').length;
  const afterCount = todayPhotos.filter((p) => p.phase === 'after').length;

  const phase: Phase = !jobs ? 'loading' : derivePhase(job, beforeCount, afterCount);

  // GPS tracking while checked in
  const gps = useGpsTracker(token, phase !== 'idle' && phase !== 'pre_checkin' && phase !== 'loading' && phase !== 'done');

  const [refreshing, setRefreshing] = useState(false);
  const [enRoute, setEnRoute] = useState(false);

  // Reset en-route when job changes or crew checks in
  const prevJobId = useRef<string | null>(null);
  React.useEffect(() => {
    if (job?.id !== prevJobId.current) {
      prevJobId.current = job?.id ?? null;
      setEnRoute(false);
    }
    if (phase !== 'pre_checkin') setEnRoute(false);
  }, [job?.id, phase]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchJobs(), refetchPhotos()]);
    invalidate();
    setRefreshing(false);
  }, [refetchJobs, refetchPhotos, invalidate]);

  const crew = portal?.crew;
  const unseen = portal?.unseen;

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 80);
  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: '#07101E' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          todayStyles.scroll,
          { paddingTop: topPad + 8, paddingBottom: bottomPad + 16 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#B4FF44"
          />
        }
      >
        {/* Header */}
        <View style={todayStyles.header}>
          <View>
            <Text style={todayStyles.greeting}>
              {crew?.name ? `Hi, ${crew.name.split(' ')[0]}` : 'HALO CREW'}
            </Text>
            <Text style={todayStyles.date}>
              {today.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>
          <View style={todayStyles.headerRight}>
            <GpsPulse active={gps.active} />
            {(unseen?.messages ?? 0) > 0 && (
              <Pressable
                onPress={() => router.push('/more/messages')}
                style={todayStyles.msgBadge}
              >
                <Ionicons name="chatbubble-outline" size={18} color="#B4FF44" />
                <View style={todayStyles.badge}>
                  <Text style={todayStyles.badgeText}>{unseen!.messages}</Text>
                </View>
              </Pressable>
            )}
          </View>
        </View>

        {/* Emergency banner */}
        {(portal?.emergencyOffers ?? []).some(
          (e) => e.status === 'pending',
        ) && (
          <Pressable
            style={todayStyles.emergencyBanner}
            onPress={() => router.push('/more/offers')}
          >
            <Ionicons name="flash" size={18} color="#FFFFFF" />
            <Text style={todayStyles.emergencyText}>
              Emergency job offer — tap to view
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
          </Pressable>
        )}

        {/* Job card */}
        {phase !== 'idle' && phase !== 'loading' && job ? (
          <View style={todayStyles.jobCard}>
            {/* Property gradient header */}
            <LinearGradient
              colors={['#1C3050', '#13223A']}
              style={todayStyles.jobCardHeader}
            >
              <View style={todayStyles.jobBadge}>
                <Text style={todayStyles.jobBadgeText}>
                  {job.status?.toUpperCase() ?? 'ACTIVE'}
                </Text>
              </View>
              <Text style={todayStyles.propertyName}>
                {job.propertyName ?? 'Your Job'}
              </Text>
              {job.unitNo && (
                <Text style={todayStyles.unitNo}>Unit {job.unitNo}</Text>
              )}
              <Text style={todayStyles.jobLabel}>{job.label ?? job.jobNo}</Text>
            </LinearGradient>

            {/* Phase area */}
            <View style={todayStyles.jobCardBody}>
              {phase !== 'pre_checkin' && <PhaseDots phase={phase} />}

              <PhaseContent
                phase={phase}
                job={job}
                beforeCount={beforeCount}
                afterCount={afterCount}
                token={token!}
                onRefresh={onRefresh}
              />
            </View>
          </View>
        ) : phase === 'loading' ? (
          <View style={todayStyles.loadingBox}>
            <ActivityIndicator color="#B4FF44" size="large" />
            <Text style={todayStyles.loadingText}>Loading your day…</Text>
          </View>
        ) : (
          /* Idle: show schedule preview */
          <View style={todayStyles.jobCard}>
            <LinearGradient
              colors={['#1C3050', '#13223A']}
              style={todayStyles.jobCardHeader}
            >
              <Text style={todayStyles.propertyName}>Your day is clear</Text>
              <Text style={todayStyles.unitNo}>No active jobs right now</Text>
            </LinearGradient>
            <View style={todayStyles.jobCardBody}>
              <PhaseContent
                phase="idle"
                job={null}
                beforeCount={0}
                afterCount={0}
                token={token!}
                onRefresh={onRefresh}
              />
              {(portal?.schedule ?? []).slice(0, 3).map((item) => (
                <View key={item.id} style={todayStyles.schedRow}>
                  <View style={todayStyles.schedDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={todayStyles.schedName}>
                      {item.propertyName ?? item.description ?? 'Job'}
                    </Text>
                    <Text style={todayStyles.schedDate}>
                      {item.scheduledOn ?? 'Upcoming'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Action button */}
        {phase !== 'loading' && (
          <View style={todayStyles.actionArea}>
            <ActionButton
              phase={phase}
              job={job}
              token={token!}
              coords={gps.coords}
              onRefresh={onRefresh}
              enRoute={enRoute}
              setEnRoute={setEnRoute}
            />
            {!gps.hasPermission && phase !== 'idle' && phase !== 'done' && (
              <Pressable
                style={todayStyles.gpsPrompt}
                onPress={gps.requestPermission}
              >
                <Ionicons name="location-outline" size={14} color="#B4FF44" />
                <Text style={todayStyles.gpsPromptText}>
                  {phase === 'pre_checkin'
                    ? 'Enable GPS for automatic check-in assistance'
                    : 'Enable GPS to track your location on this job'}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const todayStyles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  greeting: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
  },
  date: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  msgBadge: {
    position: 'relative',
    padding: 4,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#E11D48',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#E11D48',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 14,
  },
  emergencyText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 60,
  },
  loadingText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
  },
  jobCard: {
    backgroundColor: '#13223A',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    marginBottom: 20,
  },
  jobCardHeader: {
    padding: 20,
    paddingTop: 22,
    gap: 4,
  },
  jobBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(180,255,68,0.12)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(180,255,68,0.25)',
    marginBottom: 8,
  },
  jobBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#B4FF44',
    letterSpacing: 1.2,
  },
  propertyName: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
    lineHeight: 28,
  },
  unitNo: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
  },
  jobLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#B4FF44',
    marginTop: 4,
  },
  jobCardBody: {
    padding: 20,
  },
  actionArea: {
    gap: 10,
    marginBottom: 8,
  },
  gpsPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  gpsPromptText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#B4FF44',
  },
  schedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(140,160,185,0.08)',
  },
  schedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#B4FF44',
    flexShrink: 0,
  },
  schedName: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#F4F7F9',
  },
  schedDate: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    marginTop: 1,
  },
});
