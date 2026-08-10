import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { usePhotoUpload } from '@/hooks/usePhotoUpload';
import {
  useListPortalJobs,
  useListPortalPhotos,
  getListPortalJobsQueryKey,
  getListPortalPhotosQueryKey,
} from '@workspace/api-client-react';
import type { PortalJob } from '@workspace/api-client-react';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? '';

type PhotoPhase = 'before' | 'after';

// ─── Phase picker sheet ───────────────────────────────────────────────────────

function PhasePicker({
  onPick,
  onDismiss,
}: {
  onPick: (phase: PhotoPhase) => void;
  onDismiss: () => void;
}) {
  return (
    <View style={pp.overlay}>
      <Pressable style={pp.backdrop} onPress={onDismiss} />
      <View style={pp.sheet}>
        <Text style={pp.title}>What type of photo?</Text>
        <Pressable
          style={[pp.optBtn, { borderColor: 'rgba(37,99,235,0.35)', backgroundColor: 'rgba(37,99,235,0.08)' }]}
          onPress={() => onPick('before')}
        >
          <Ionicons name="camera-outline" size={22} color="#60A5FA" />
          <View style={{ flex: 1 }}>
            <Text style={[pp.optLabel, { color: '#60A5FA' }]}>Before</Text>
            <Text style={pp.optSub}>Photo of the unit before you start work</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#60A5FA" />
        </Pressable>
        <Pressable
          style={[pp.optBtn, { borderColor: 'rgba(249,115,22,0.35)', backgroundColor: 'rgba(249,115,22,0.08)' }]}
          onPress={() => onPick('after')}
        >
          <Ionicons name="checkmark-done-outline" size={22} color="#F97316" />
          <View style={{ flex: 1 }}>
            <Text style={[pp.optLabel, { color: '#F97316' }]}>After</Text>
            <Text style={pp.optSub}>Photo of the unit after you finish work</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#F97316" />
        </Pressable>
        <Pressable style={pp.cancelBtn} onPress={onDismiss}>
          <Text style={pp.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const pp = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 100 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#13223A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  title: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#F4F7F9', marginBottom: 4 },
  optBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, padding: 16, borderWidth: 1,
  },
  optLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  optSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#8CA0B9', marginTop: 2 },
  cancelBtn: {
    alignItems: 'center', paddingVertical: 14,
    backgroundColor: 'rgba(140,160,185,0.08)', borderRadius: 12, marginTop: 4,
  },
  cancelText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#8CA0B9' },
});

// ─── Photo grid section for one unit ──────────────────────────────────────────

type Photo = { id: string; jobId?: string | null; phase?: string | null; storagePath?: string | null };

function UnitPhotoSection({
  job,
  before,
  after,
  onDelete,
  deletingId,
}: {
  job: PortalJob;
  before: Photo[];
  after: Photo[];
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  const allPhotos = before.length + after.length;
  if (allPhotos === 0) return null;

  return (
    <View style={us.card}>
      <LinearGradient colors={['#1C3050', '#13223A']} style={us.header}>
        <View style={us.unitRow}>
          <Ionicons name="home-outline" size={14} color="#8CA0B9" />
          <Text style={us.propertyName}>
            {job.propertyName ?? 'Property'}
            {job.unitNo ? ` · Unit ${job.unitNo}` : ''}
          </Text>
        </View>
        <View style={us.countRow}>
          <View style={[us.countPill, { backgroundColor: 'rgba(37,99,235,0.15)' }]}>
            <Text style={[us.countText, { color: '#60A5FA' }]}>{before.length} before</Text>
          </View>
          <View style={[us.countPill, { backgroundColor: 'rgba(249,115,22,0.15)' }]}>
            <Text style={[us.countText, { color: '#F97316' }]}>{after.length} after</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={us.body}>
        {before.length > 0 && (
          <>
            <Text style={us.phaseLabel}>BEFORE</Text>
            <View style={us.grid}>
              {before.map((p) => (
                <PhotoThumb key={p.id} photo={p} onDelete={onDelete} deletingId={deletingId} />
              ))}
            </View>
          </>
        )}

        {after.length > 0 && (
          <>
            <Text style={[us.phaseLabel, { color: '#F97316', marginTop: before.length > 0 ? 16 : 0 }]}>AFTER</Text>
            <View style={us.grid}>
              {after.map((p) => (
                <PhotoThumb key={p.id} photo={p} onDelete={onDelete} deletingId={deletingId} />
              ))}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const us = StyleSheet.create({
  card: {
    backgroundColor: '#13223A', borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(140,160,185,0.12)', marginBottom: 16,
  },
  header: { padding: 16, gap: 8 },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  propertyName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#F4F7F9', flex: 1 },
  countRow: { flexDirection: 'row', gap: 8 },
  countPill: {
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  countText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  body: { padding: 16 },
  phaseLabel: {
    fontSize: 11, fontFamily: 'Inter_700Bold', color: '#60A5FA',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});

// ─── Individual photo thumb ───────────────────────────────────────────────────

function PhotoThumb({
  photo,
  onDelete,
  deletingId,
}: {
  photo: Photo;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  return (
    <View style={thumb.wrap}>
      <Image
        source={{ uri: `https://${DOMAIN}/api/storage${photo.storagePath}` }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
      />
      <Pressable style={thumb.del} onPress={() => onDelete(photo.id)} hitSlop={6}>
        {deletingId === photo.id ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Ionicons name="close" size={13} color="#FFFFFF" />
        )}
      </Pressable>
    </View>
  );
}

const thumb = StyleSheet.create({
  wrap: {
    width: '31.5%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden',
    backgroundColor: '#1C3050', position: 'relative',
  },
  del: {
    position: 'absolute', top: 5, right: 5,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
});

// ─── Upload queue strip ───────────────────────────────────────────────────────

function UploadQueue({ queue, onRetry }: { queue: ReturnType<typeof usePhotoUpload>['queue']; onRetry: () => void }) {
  if (queue.length === 0) return null;
  const hasError = queue.some((i) => i.status === 'error');
  return (
    <Pressable
      style={[uq.strip, hasError && uq.stripError]}
      onPress={hasError ? onRetry : undefined}
    >
      {hasError ? (
        <Ionicons name="alert-circle" size={16} color="#E11D48" />
      ) : (
        <ActivityIndicator size="small" color="#B4FF44" />
      )}
      <Text style={[uq.text, hasError && { color: '#E11D48' }]}>
        {hasError
          ? `${queue.filter((i) => i.status === 'error').length} upload failed — tap to retry`
          : `Uploading ${queue.filter((i) => i.status !== 'done').length} photo${queue.filter((i) => i.status !== 'done').length > 1 ? 's' : ''}…`}
      </Text>
    </Pressable>
  );
}

const uq = StyleSheet.create({
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(180,255,68,0.08)', borderRadius: 12,
    padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(180,255,68,0.20)',
  },
  stripError: {
    backgroundColor: 'rgba(225,29,72,0.08)',
    borderColor: 'rgba(225,29,72,0.25)',
  },
  text: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: '#B4FF44' },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PhotosScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [showPicker, setShowPicker] = useState(false);
  const [picking, setPicking] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [localHidden, setLocalHidden] = useState<Set<string>>(new Set());

  const { data: jobs } = useListPortalJobs(token!, {
    query: { enabled: !!token, staleTime: 20_000, queryKey: getListPortalJobsQueryKey(token!) },
  });
  const { data: photos, refetch: refetchPhotos } = useListPortalPhotos(token!, {
    query: { enabled: !!token, staleTime: 10_000, queryKey: getListPortalPhotosQueryKey(token!) },
  });

  // Active job = checked in but not checked out
  const activeJob = useMemo(
    () => (jobs ?? []).find((j) => j.checkedIn && !j.checkedOut) ?? null,
    [jobs],
  );

  const { addPhoto, queue, retryFailed } = usePhotoUpload(token, activeJob?.id ?? null);

  // Group photos by job, ordered by most recent job first
  const jobMap = useMemo(
    () => new Map((jobs ?? []).map((j) => [j.id, j])),
    [jobs],
  );

  const unitSections = useMemo(() => {
    const map = new Map<string, { job: PortalJob; before: Photo[]; after: Photo[] }>();
    // Preserve job order from the jobs list so active/most-recent shows first
    for (const job of (jobs ?? [])) {
      map.set(job.id, { job, before: [], after: [] });
    }
    for (const p of photos ?? []) {
      if (localHidden.has(p.id)) continue;
      const entry = map.get(p.jobId ?? '');
      if (!entry) continue;
      if (p.phase === 'before') entry.before.push(p);
      else if (p.phase === 'after') entry.after.push(p);
    }
    // Return only units that have at least one photo
    return Array.from(map.values()).filter((s) => s.before.length + s.after.length > 0);
  }, [jobs, photos, localHidden]);

  const totalPhotos = (photos ?? []).filter((p) => !localHidden.has(p.id)).length;

  const takePhoto = useCallback(
    async (phase: PhotoPhase, fromGallery = false) => {
      if (!activeJob || picking) return;
      setPicking(true);
      setShowPicker(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        const result = fromGallery
          ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false })
          : await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, cameraType: ImagePicker.CameraType.back });

        if (!result.canceled && result.assets[0]) {
          await addPhoto(result.assets[0].uri, phase);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          refetchPhotos();
        }
      } catch {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        setPicking(false);
      }
    },
    [activeJob, picking, addPhoto, refetchPhotos],
  );

  const handlePhaseSelected = useCallback(
    (phase: PhotoPhase) => {
      takePhoto(phase, false);
    },
    [takePhoto],
  );

  const deletePhoto = useCallback(
    (photoId: string) => {
      if (!token) return;
      Alert.alert('Delete photo?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setLocalHidden((prev) => new Set(prev).add(photoId));
            setDeletingId(photoId);
            try {
              await fetch(`https://${DOMAIN}/api/portal/${token}/photos/${photoId}`, { method: 'DELETE' });
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              refetchPhotos();
            } catch {
              setLocalHidden((prev) => { const n = new Set(prev); n.delete(photoId); return n; });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]);
    },
    [token, refetchPhotos],
  );

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 80);

  return (
    <View style={{ flex: 1, backgroundColor: '#07101E' }}>
      {showPicker && (
        <PhasePicker onPick={handlePhaseSelected} onDismiss={() => setShowPicker(false)} />
      )}

      {/* Header */}
      <LinearGradient
        colors={['#07101E', 'transparent']}
        style={[sc.header, { paddingTop: topPad + 12 }]}
      >
        <View style={sc.headerRow}>
          <View>
            <Text style={sc.title}>Photos</Text>
            {activeJob ? (
              <Text style={sc.sub}>
                {activeJob.propertyName ?? 'Active job'}
                {activeJob.unitNo ? ` · Unit ${activeJob.unitNo}` : ''}
              </Text>
            ) : (
              <Text style={sc.sub}>{totalPhotos} photo{totalPhotos !== 1 ? 's' : ''} today</Text>
            )}
          </View>

          {/* Camera button */}
          {activeJob && (
            <Pressable
              style={({ pressed }) => [sc.camBtn, picking && sc.camBtnDisabled, pressed && { opacity: 0.85 }]}
              onPress={() => setShowPicker(true)}
              disabled={picking}
            >
              {picking ? (
                <ActivityIndicator size="small" color="#07101E" />
              ) : (
                <>
                  <Ionicons name="camera" size={20} color="#07101E" />
                  <Text style={sc.camBtnText}>Add Photo</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[sc.scroll, { paddingTop: topPad + 80, paddingBottom: bottomPad + 20 }]}
      >
        <UploadQueue queue={queue} onRetry={retryFailed} />

        {!activeJob && (
          <View style={sc.noCheckinBanner}>
            <Ionicons name="information-circle-outline" size={16} color="#8CA0B9" />
            <Text style={sc.noCheckinText}>Check in to a unit to add new photos</Text>
          </View>
        )}

        {unitSections.length === 0 ? (
          <View style={sc.emptyBox}>
            <Ionicons name="images-outline" size={44} color="#435A7D" />
            <Text style={sc.emptyTitle}>No photos yet</Text>
            <Text style={sc.emptyBody}>
              {activeJob
                ? 'Tap "Add Photo" above to document your work'
                : 'Check in to a unit on the Job tab, then add before and after photos here.'}
            </Text>
          </View>
        ) : (
          unitSections.map(({ job, before, after }) => (
            <UnitPhotoSection
              key={job.id}
              job={job}
              before={before}
              after={after}
              onDelete={deletePhoto}
              deletingId={deletingId}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const sc = StyleSheet.create({
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    paddingHorizontal: 20, paddingBottom: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', color: '#F4F7F9' },
  sub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#8CA0B9', marginTop: 2 },

  camBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#B4FF44', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  camBtnDisabled: { opacity: 0.6 },
  camBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#07101E' },

  scroll: { paddingHorizontal: 16, flexGrow: 1 },

  noCheckinBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(140,160,185,0.08)', borderRadius: 10, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(140,160,185,0.14)',
  },
  noCheckinText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#8CA0B9', flex: 1 },

  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#F4F7F9', marginTop: 4 },
  emptyBody: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: '#8CA0B9',
    textAlign: 'center', lineHeight: 21, maxWidth: 280,
  },
});
