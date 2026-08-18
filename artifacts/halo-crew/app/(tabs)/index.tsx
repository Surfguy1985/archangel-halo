import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useGpsTracker } from '@/hooks/useGpsTracker';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useListPortalJobs,
  useListPortalPhotos,
  useCreatePortalCheckin,
  getListPortalJobsQueryKey,
  getListPortalPhotosQueryKey,
} from '@workspace/api-client-react';
import type { PortalJob } from '@workspace/api-client-react';
import { clearInstructionsAck, isInstructionsRequired } from '@/constants/crewInstructions';

// ─── GPS badge ────────────────────────────────────────────────────────────────

function GpsBadge({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [active, pulse]);

  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] });

  return (
    <View style={gpsStyles.row}>
      <Animated.View
        style={[
          gpsStyles.dot,
          { backgroundColor: active ? '#22C55E' : '#435A7D', transform: [{ scale: active ? dotScale : 1 }] },
        ]}
      />
      <Text style={[gpsStyles.text, { color: active ? '#22C55E' : '#435A7D' }]}>
        {active ? 'GPS On' : 'GPS Off'}
      </Text>
    </View>
  );
}

const gpsStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
});

// ─── GPS trail (active tracking indicator) ────────────────────────────────────

function GpsTrail() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, [anim]);

  return (
    <View style={trailStyles.row}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            trailStyles.dot,
            {
              opacity: anim.interpolate({
                inputRange: [0, 0.33 * (i + 1), 1],
                outputRange: [0.2, 1, 0.2],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
      ))}
      <Animated.Text
        style={[trailStyles.label, { opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }]}
      >
        Tracking your location
      </Animated.Text>
    </View>
  );
}

const trailStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.20)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22C55E' },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#22C55E', letterSpacing: 0.3 },
});

// ─── Photo count chips ─────────────────────────────────────────────────────────

function PhotoChips({ beforeCount, afterCount }: { beforeCount: number; afterCount: number }) {
  return (
    <View style={chipStyles.row}>
      <Pressable
        style={chipStyles.chip}
        onPress={() => router.push('/camera')}
      >
        <Ionicons name="camera-outline" size={15} color="#60A5FA" />
        <Text style={[chipStyles.label, { color: '#60A5FA' }]}>Before</Text>
        <View style={[chipStyles.count, { backgroundColor: '#1E3A5F' }]}>
          <Text style={[chipStyles.countText, { color: '#60A5FA' }]}>{beforeCount}</Text>
        </View>
      </Pressable>
      <Pressable
        style={chipStyles.chip}
        onPress={() => router.push('/camera')}
      >
        <Ionicons name="camera-outline" size={15} color="#F97316" />
        <Text style={[chipStyles.label, { color: '#F97316' }]}>After</Text>
        <View style={[chipStyles.count, { backgroundColor: '#3B1408' }]}>
          <Text style={[chipStyles.countText, { color: '#F97316' }]}>{afterCount}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(140,160,185,0.07)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.14)',
  },
  label: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  count: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  countText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
});

// ─── Working card (checked in) ────────────────────────────────────────────────

function WorkingCard({
  job,
  beforeCount,
  afterCount,
  gpsActive,
  loading,
  onCheckOut,
  pendingCount,
}: {
  job: PortalJob;
  beforeCount: number;
  afterCount: number;
  gpsActive: boolean;
  loading: boolean;
  onCheckOut: () => void;
  pendingCount: number;
}) {
  return (
    <View style={s.section}>
      <View style={s.jobCard}>
        <LinearGradient colors={['#1C3050', '#13223A']} style={s.jobCardHeader}>
          <View style={s.activeBadge}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' }} />
            <Text style={s.activeBadgeText}>CHECKED IN</Text>
          </View>
          <Text style={s.propertyName}>{job.propertyName ?? 'Job Site'}</Text>
          {job.unitNo ? (
            <Text style={s.unitNo}>Unit {job.unitNo}</Text>
          ) : null}
          {job.label || job.jobNo ? (
            <Text style={s.jobLabel}>{job.label ?? `Job #${job.jobNo}`}</Text>
          ) : null}
        </LinearGradient>

        <View style={s.jobCardBody}>
          {gpsActive && <GpsTrail />}

          <PhotoChips beforeCount={beforeCount} afterCount={afterCount} />

          {/* Take photos shortcut */}
          <Pressable
            style={({ pressed }) => [s.photoBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.push('/camera')}
          >
            <Ionicons name="camera-outline" size={20} color="#07101E" />
            <Text style={s.photoBtnText}>Take Photos</Text>
          </Pressable>

          {/* Check Out */}
          <Pressable
            style={({ pressed }) => [s.checkOutBtn, pressed && { opacity: 0.8 }]}
            onPress={onCheckOut}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#8CA0B9" size="small" />
            ) : (
              <>
                <Ionicons name="exit-outline" size={18} color="#8CA0B9" />
                <Text style={s.checkOutText}>Check Out</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      {pendingCount > 0 && (
        <View style={s.nextHint}>
          <Ionicons name="arrow-forward-circle-outline" size={16} color="#B4FF44" />
          <Text style={s.nextHintText}>
            {pendingCount} more unit{pendingCount > 1 ? 's' : ''} queued — check out to move on
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Job picker (not checked in yet) ──────────────────────────────────────────

function JobPicker({
  jobs,
  selectedJobId,
  onSelect,
  onCheckIn,
  loading,
  hasPermission,
  requestPermission,
  completedCount,
}: {
  jobs: PortalJob[];
  selectedJobId: string | null;
  onSelect: (id: string) => void;
  onCheckIn: () => void;
  loading: boolean;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  completedCount: number;
}) {
  const selected = jobs.find((j) => j.id === selectedJobId);

  return (
    <View style={s.section}>
      {completedCount > 0 && (
        <View style={s.progressPill}>
          <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
          <Text style={s.progressText}>{completedCount} unit{completedCount > 1 ? 's' : ''} done today</Text>
        </View>
      )}

      <Text style={s.pickerLabel}>
        {jobs.length === 1 ? 'Your next unit' : 'Pick a unit to start'}
      </Text>

      {jobs.map((job) => {
        const isSel = job.id === selectedJobId;
        return (
          <Pressable
            key={job.id}
            style={({ pressed }) => [
              s.jobRow,
              isSel && s.jobRowSelected,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => onSelect(job.id)}
          >
            <View style={[s.jobRowDot, isSel && s.jobRowDotSel]} />
            <View style={{ flex: 1 }}>
              <Text style={[s.jobRowProp, isSel && { color: '#F4F7F9' }]}>
                {job.propertyName ?? 'Property'}
              </Text>
              {job.unitNo ? (
                <Text style={[s.jobRowUnit, isSel && { color: '#B4FF44' }]}>Unit {job.unitNo}</Text>
              ) : null}
            </View>
            {isSel && <Ionicons name="checkmark-circle" size={20} color="#B4FF44" />}
          </Pressable>
        );
      })}

      {selected && (
        <View style={{ marginTop: 16, gap: 10 }}>
          <Pressable
            style={({ pressed }) => [s.checkInBtn, pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] }]}
            onPress={onCheckIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#07101E" />
            ) : (
              <>
                <Ionicons name="location" size={20} color="#07101E" />
                <Text style={s.checkInText}>
                  Check In — Unit {selected.unitNo ?? selected.propertyName ?? ''}
                </Text>
              </>
            )}
          </Pressable>

          {!hasPermission && (
            <Pressable style={s.gpsPrompt} onPress={requestPermission}>
              <Ionicons name="location-outline" size={14} color="#B4FF44" />
              <Text style={s.gpsPromptText}>Enable GPS for location tracking</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ─── All done card ─────────────────────────────────────────────────────────────

function AllDoneCard({ completedJobs, crewName }: { completedJobs: PortalJob[]; crewName?: string }) {
  return (
    <View style={s.doneCard}>
      <View style={s.doneCircle}>
        <Ionicons name="checkmark-circle" size={52} color="#22C55E" />
      </View>
      <Text style={s.doneTitle}>Day complete!</Text>
      {crewName && <Text style={s.doneSub}>Great work, {crewName.split(' ')[0]}.</Text>}

      <View style={{ width: '100%', marginTop: 16, gap: 8 }}>
        {completedJobs.map((job) => (
          <View key={job.id} style={s.doneRow}>
            <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
            <Text style={s.doneRowText}>
              {job.propertyName ?? 'Property'}
              {job.unitNo ? ` · Unit ${job.unitNo}` : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── No jobs card ──────────────────────────────────────────────────────────────

function NoJobsCard({ schedule }: { schedule: { id: string; propertyName?: string | null; description?: string | null; scheduledOn?: string | null }[] }) {
  return (
    <View style={s.section}>
      <View style={s.emptyBox}>
        <Ionicons name="calendar-outline" size={44} color="#435A7D" />
        <Text style={s.emptyTitle}>No jobs today</Text>
        <Text style={s.emptyBody}>Check the Schedule for upcoming work or Offers for new opportunities.</Text>
      </View>

      {schedule.slice(0, 3).map((item) => (
        <View key={item.id} style={s.schedRow}>
          <View style={s.schedDot} />
          <View style={{ flex: 1 }}>
            <Text style={s.schedName}>{item.propertyName ?? item.description ?? 'Job'}</Text>
            <Text style={s.schedDate}>{item.scheduledOn ?? 'Upcoming'}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function JobScreen() {
  const insets = useSafeAreaInsets();
  const { token, portal, invalidate } = useAuth();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data: jobs, refetch: refetchJobs } = useListPortalJobs(token!, {
    query: { enabled: !!token, staleTime: 20_000, queryKey: getListPortalJobsQueryKey(token!) },
  });
  const { data: photos, refetch: refetchPhotos } = useListPortalPhotos(token!, {
    query: { enabled: !!token, staleTime: 10_000, queryKey: getListPortalPhotosQueryKey(token!) },
  });
  const { mutateAsync: createCheckin } = useCreatePortalCheckin();

  const activeJob = useMemo(
    () => (jobs ?? []).find((j) => j.checkedIn && !j.checkedOut) ?? null,
    [jobs],
  );
  const pendingJobs = useMemo(
    () => (jobs ?? []).filter((j) => !j.checkedIn && !j.checkedOut),
    [jobs],
  );
  const completedJobs = useMemo(
    () => (jobs ?? []).filter((j) => j.checkedOut),
    [jobs],
  );

  // Auto-select single pending job
  const prevActive = useRef<string | null>(null);
  useEffect(() => {
    // Auto-select when nothing is active and there's only one option
    if (!activeJob && pendingJobs.length === 1 && !selectedJobId) {
      setSelectedJobId(pendingJobs[0].id);
    }
    // Clear selection when a new job becomes active (just checked in)
    if (activeJob && activeJob.id !== prevActive.current) {
      prevActive.current = activeJob.id;
      setSelectedJobId(null);
    }
    if (!activeJob) prevActive.current = null;
  }, [activeJob, pendingJobs, selectedJobId]);

  // GPS: on only while checked in
  const gps = useGpsTracker(token, !!activeJob);

  // Photos for the active job
  const activePhotos = useMemo(
    () => (photos ?? []).filter((p) => p.jobId === activeJob?.id),
    [photos, activeJob?.id],
  );
  const beforeCount = activePhotos.filter((p) => p.phase === 'before').length;
  const afterCount = activePhotos.filter((p) => p.phase === 'after').length;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchJobs(), refetchPhotos()]);
    invalidate();
    setRefreshing(false);
  }, [refetchJobs, refetchPhotos, invalidate]);

  const handleCheckIn = useCallback(async () => {
    const job = pendingJobs.find((j) => j.id === selectedJobId);
    if (!job || loading) return;
    if (!gps.hasPermission) {
      const granted = await gps.requestPermission();
      if (!granted) return;
    }
    setLoading(true);
    try {
      await createCheckin({
        token: token!,
        data: {
          jobId: job.id,
          kind: 'checkin',
          lat: gps.coords?.lat ?? null,
          lng: gps.coords?.lng ?? null,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refetchJobs();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // The server refuses a check-in with no current acknowledgement on
      // record — send the crew to the instructions, not a dead button.
      if (isInstructionsRequired(err)) {
        clearInstructionsAck();
        router.push({ pathname: '/onboarding/instructions', params: { next: '/(tabs)' } });
      }
    } finally {
      setLoading(false);
    }
  }, [pendingJobs, selectedJobId, loading, gps, token, createCheckin, refetchJobs]);

  const handleCheckOut = useCallback(async () => {
    if (!activeJob || loading) return;
    Alert.alert(
      'Check Out?',
      `End your shift at${activeJob.unitNo ? ` Unit ${activeJob.unitNo}` : ''}${activeJob.propertyName ? ` — ${activeJob.propertyName}` : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Check Out',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await createCheckin({
                token: token!,
                data: {
                  jobId: activeJob.id,
                  kind: 'checkout',
                  lat: gps.coords?.lat ?? null,
                  lng: gps.coords?.lng ?? null,
                },
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await refetchJobs();
            } catch {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }, [activeJob, loading, gps, token, createCheckin, refetchJobs]);

  const crew = portal?.crew;
  const unseen = portal?.unseen;
  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 80);

  return (
    <View style={{ flex: 1, backgroundColor: '#07101E' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.scroll, { paddingTop: topPad + 8, paddingBottom: bottomPad + 16 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#B4FF44" />}
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>
              {crew?.name ? `Hi, ${crew.name.split(' ')[0]}` : 'HALO Crew'}
            </Text>
            <Text style={s.date}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </Text>
          </View>
          <View style={s.headerRight}>
            <GpsBadge active={gps.active} />
            {(unseen?.messages ?? 0) > 0 && (
              <Pressable onPress={() => router.push('/more/messages')} style={s.msgBtn}>
                <Ionicons name="chatbubble-outline" size={18} color="#B4FF44" />
                <View style={s.badge}>
                  <Text style={s.badgeText}>{unseen!.messages}</Text>
                </View>
              </Pressable>
            )}
          </View>
        </View>

        {/* Emergency banner */}
        {(portal?.emergencyOffers ?? []).some((e) => e.status === 'pending') && (
          <Pressable style={s.emergencyBanner} onPress={() => router.push('/more/offers')}>
            <Ionicons name="flash" size={18} color="#FFFFFF" />
            <Text style={s.emergencyText}>Emergency job offer — tap to view</Text>
            <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
          </Pressable>
        )}

        {/* Main content */}
        {!jobs ? (
          <View style={s.loadingBox}>
            <ActivityIndicator color="#B4FF44" size="large" />
          </View>
        ) : activeJob ? (
          <WorkingCard
            job={activeJob}
            beforeCount={beforeCount}
            afterCount={afterCount}
            gpsActive={gps.active}
            loading={loading}
            onCheckOut={handleCheckOut}
            pendingCount={pendingJobs.length}
          />
        ) : pendingJobs.length > 0 ? (
          <JobPicker
            jobs={pendingJobs}
            selectedJobId={selectedJobId}
            onSelect={setSelectedJobId}
            onCheckIn={handleCheckIn}
            loading={loading}
            hasPermission={gps.hasPermission}
            requestPermission={gps.requestPermission}
            completedCount={completedJobs.length}
          />
        ) : completedJobs.length > 0 ? (
          <AllDoneCard completedJobs={completedJobs} crewName={crew?.name ?? undefined} />
        ) : (
          <NoJobsCard schedule={portal?.schedule ?? []} />
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: { paddingHorizontal: 16, flexGrow: 1 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  greeting: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#F4F7F9' },
  date: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#8CA0B9', marginTop: 2 },
  headerRight: { alignItems: 'flex-end', gap: 8 },
  msgBtn: { position: 'relative', padding: 4 },
  badge: {
    position: 'absolute', top: 0, right: 0,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#E11D48', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  emergencyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#E11D48', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 14,
  },
  emergencyText: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },

  walkCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0E1F12', borderRadius: 12, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(180,255,68,0.20)',
  },
  walkText: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: '#B4FF44' },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },

  section: { gap: 0 },

  // Job card (working state)
  jobCard: {
    backgroundColor: '#13223A', borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(140,160,185,0.12)', marginBottom: 16,
  },
  jobCardHeader: { padding: 20, paddingTop: 22, gap: 4 },
  activeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)', marginBottom: 10,
  },
  activeBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#22C55E', letterSpacing: 1.2 },
  propertyName: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#F4F7F9', lineHeight: 28 },
  unitNo: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#B4FF44', marginTop: 2 },
  jobLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#8CA0B9', marginTop: 2 },
  jobCardBody: { padding: 20 },

  photoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#B4FF44', borderRadius: 14, paddingVertical: 15, gap: 10, marginBottom: 10,
  },
  photoBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#07101E' },

  checkOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(140,160,185,0.10)', borderRadius: 14, paddingVertical: 14, gap: 10,
    borderWidth: 1, borderColor: 'rgba(140,160,185,0.18)',
  },
  checkOutText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#8CA0B9' },

  nextHint: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(180,255,68,0.06)', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: 'rgba(180,255,68,0.15)',
  },
  nextHintText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: '#B4FF44' },

  // Picker state
  progressPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34,197,94,0.10)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.20)',
  },
  progressText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#22C55E' },

  pickerLabel: {
    fontSize: 11, fontFamily: 'Inter_700Bold', color: '#8CA0B9',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
  },
  jobRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#13223A', borderRadius: 14, padding: 16, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(140,160,185,0.12)',
  },
  jobRowSelected: {
    borderColor: 'rgba(180,255,68,0.35)', backgroundColor: 'rgba(180,255,68,0.06)',
  },
  jobRowDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: 'rgba(140,160,185,0.30)', flexShrink: 0,
  },
  jobRowDotSel: { backgroundColor: '#B4FF44' },
  jobRowProp: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#8CA0B9' },
  jobRowUnit: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#435A7D', marginTop: 2 },

  checkInBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#B4FF44', borderRadius: 16, paddingVertical: 17, gap: 10,
  },
  checkInText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#07101E' },

  gpsPrompt: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10,
  },
  gpsPromptText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#B4FF44' },

  // Done state
  doneCard: {
    backgroundColor: '#13223A', borderRadius: 20, padding: 28,
    alignItems: 'center', borderWidth: 1, borderColor: 'rgba(34,197,94,0.20)',
  },
  doneCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(34,197,94,0.10)', borderWidth: 1.5,
    borderColor: 'rgba(34,197,94,0.25)', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  doneTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#22C55E' },
  doneSub: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#8CA0B9', marginTop: 4 },
  doneRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(140,160,185,0.08)',
  },
  doneRowText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#F4F7F9' },

  // Empty / idle state
  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#F4F7F9', marginTop: 4 },
  emptyBody: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: '#8CA0B9',
    textAlign: 'center', lineHeight: 21, maxWidth: 280,
  },
  schedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(140,160,185,0.08)',
  },
  schedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B4FF44', flexShrink: 0 },
  schedName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#F4F7F9' },
  schedDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#8CA0B9', marginTop: 1 },
});
