import React, { useCallback, useState } from 'react';
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

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? '';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { usePhotoUpload } from '@/hooks/usePhotoUpload';
import {
  useListPortalJobs,
  useListPortalPhotos,
  getListPortalJobsQueryKey,
  getListPortalPhotosQueryKey,
} from '@workspace/api-client-react';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

type PhotoPhase = 'before' | 'after';

function getPhaseBadgeStyle(phase: PhotoPhase) {
  return {
    before: { bg: 'rgba(37,99,235,0.15)', color: '#60A5FA', border: 'rgba(37,99,235,0.3)', label: 'BEFORE' },
    after: { bg: 'rgba(249,115,22,0.15)', color: '#F97316', border: 'rgba(249,115,22,0.3)', label: 'AFTER' },
  }[phase];
}

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [activePhase, setActivePhase] = useState<PhotoPhase>('before');

  // Get current job context
  const { data: jobs } = useListPortalJobs(token!, {
    query: { enabled: !!token, staleTime: 20_000, queryKey: getListPortalJobsQueryKey(token!) },
  });
  // Today's string for date filtering (local date parts, never UTC)
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const job =
    jobs?.find(
      (j) =>
        j.status !== 'cleared' &&
        (!j.scheduledOn || j.scheduledOn === todayStr),
    ) ?? null;
  const checkedIn = job?.checkedIn ?? false;

  const { addPhoto, queue, retryFailed } = usePhotoUpload(token, job?.id ?? null);

  const { data: photos, refetch: refetchPhotos } = useListPortalPhotos(token!, {
    query: { enabled: !!token, staleTime: 10_000, queryKey: getListPortalPhotosQueryKey(token!) },
  });

  // Local soft-delete state — optimistic hide before server confirms
  const [localHidden, setLocalHidden] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const allPhasePhotos = (photos ?? []).filter((p) => p.phase === activePhase && p.jobId === job?.id);
  const phasePhotos = allPhasePhotos.filter((p) => !localHidden.has(p.id));

  const deletePhoto = useCallback(
    (photoId: string) => {
      if (!token) return;
      Alert.alert('Delete photo?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Optimistic hide
            setLocalHidden((prev) => new Set(prev).add(photoId));
            setDeletingId(photoId);
            try {
              await fetch(
                `https://${DOMAIN}/api/portal/${token}/photos/${photoId}`,
                { method: 'DELETE' },
              );
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              refetchPhotos();
            } catch {
              // Revert if request failed
              setLocalHidden((prev) => {
                const next = new Set(prev);
                next.delete(photoId);
                return next;
              });
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

  const [picking, setPicking] = useState(false);

  const takePhoto = useCallback(
    async (fromGallery = false) => {
      if (!checkedIn || picking) return;
      setPicking(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      try {
        const result = fromGallery
          ? await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 1,
              allowsMultipleSelection: false,
            })
          : await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              quality: 1,
              cameraType: ImagePicker.CameraType.back,
            });

        if (!result.canceled && result.assets[0]) {
          await addPhoto(result.assets[0].uri, activePhase);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          refetchPhotos();
        }
      } catch (err) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        setPicking(false);
      }
    },
    [checkedIn, picking, activePhase, addPhoto, refetchPhotos],
  );

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 80);

  return (
    <View style={[s.container]}>
      {/* Header */}
      <LinearGradient
        colors={['#07101E', 'transparent']}
        style={[s.header, { paddingTop: topPad + 12 }]}
      >
        <Text style={s.headerTitle}>Camera</Text>
        {job && (
          <Text style={s.headerSub}>{job.propertyName ?? 'Active job'}</Text>
        )}
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          s.scroll,
          { paddingTop: topPad + 70, paddingBottom: bottomPad + 20 },
        ]}
      >
        {/* Phase toggle */}
        <View style={s.phaseToggle}>
          {(['before', 'after'] as PhotoPhase[]).map((ph) => {
            const cfg = getPhaseBadgeStyle(ph);
            return (
              <Pressable
                key={ph}
                style={({ pressed }) => [
                  s.phaseBtn,
                  activePhase === ph && {
                    backgroundColor: cfg.bg,
                    borderColor: cfg.border,
                  },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => {
                  setActivePhase(ph);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <Text
                  style={[
                    s.phaseBtnText,
                    activePhase === ph && { color: cfg.color },
                  ]}
                >
                  {cfg.label}
                </Text>
                {phasePhotos.length > 0 && activePhase === ph && (
                  <View style={[s.phaseCount, { backgroundColor: cfg.color }]}>
                    <Text style={s.phaseCountText}>{phasePhotos.length}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {!checkedIn ? (
          /* Not checked in */
          <View style={s.notCheckedIn}>
            <View style={s.lockCircle}>
              <Ionicons name="lock-closed-outline" size={36} color="#435A7D" />
            </View>
            <Text style={s.lockTitle}>Check in first</Text>
            <Text style={s.lockBody}>
              Go to the Today tab and check in to your job before taking photos.
            </Text>
          </View>
        ) : (
          <>
            {/* Camera button */}
            <View style={s.cameraCard}>
              <Pressable
                style={({ pressed }) => [
                  s.shutterBtn,
                  pressed && s.shutterPressed,
                  picking && s.shutterDisabled,
                ]}
                onPress={() => takePhoto(false)}
                disabled={picking}
              >
                {picking ? (
                  <ActivityIndicator size="large" color="#07101E" />
                ) : (
                  <>
                    <Ionicons name="camera" size={40} color="#07101E" />
                    <Text style={s.shutterText}>Take Photo</Text>
                  </>
                )}
              </Pressable>

              <Text style={s.phaseLabel}>
                {getPhaseBadgeStyle(activePhase).label} photo for this job
              </Text>

              <Pressable
                style={({ pressed }) => [s.galleryBtn, pressed && { opacity: 0.7 }]}
                onPress={() => takePhoto(true)}
                disabled={picking}
              >
                <Ionicons name="images-outline" size={18} color="#8CA0B9" />
                <Text style={s.galleryText}>Pick from library</Text>
              </Pressable>
            </View>

            {/* Upload queue */}
            {queue.length > 0 && (
              <View style={s.queueCard}>
                <Text style={s.queueTitle}>
                  {queue.some((i) => i.status === 'error') ? 'Upload issues' : 'Uploading…'}
                </Text>
                {queue.map((item) => {
                  const isError = item.status === 'error';
                  const Row = isError ? Pressable : View;
                  return (
                    <Row
                      key={item.id}
                      style={[
                        s.queueRow,
                        isError && s.queueRowError,
                      ]}
                      {...(isError ? { onPress: retryFailed } : {})}
                    >
                      <Ionicons
                        name={
                          item.status === 'done'
                            ? 'checkmark-circle'
                            : item.status === 'error'
                            ? 'alert-circle'
                            : 'cloud-upload-outline'
                        }
                        size={18}
                        color={
                          item.status === 'done'
                            ? '#22C55E'
                            : item.status === 'error'
                            ? '#E11D48'
                            : '#B4FF44'
                        }
                      />
                      <Text style={[s.queueRowText, isError && s.queueRowTextError]}>
                        {item.status === 'uploading'
                          ? 'Uploading…'
                          : item.status === 'error'
                          ? 'Failed — tap to retry'
                          : item.status === 'done'
                          ? 'Uploaded'
                          : 'Queued'}
                      </Text>
                      {item.status === 'uploading' && (
                        <ActivityIndicator size="small" color="#B4FF44" />
                      )}
                      {isError && (
                        <Ionicons name="refresh-outline" size={16} color="#E11D48" />
                      )}
                    </Row>
                  );
                })}
              </View>
            )}

            {/* Photo grid */}
            {phasePhotos.length > 0 && (
              <View>
                <Text style={s.gridTitle}>
                  {getPhaseBadgeStyle(activePhase).label} —{' '}
                  {phasePhotos.length} photo{phasePhotos.length !== 1 ? 's' : ''}
                </Text>
                <View style={s.photoGrid}>
                  {phasePhotos.map((p) => (
                    <View key={p.id} style={s.photoThumb}>
                      <Image
                        source={{
                          uri: `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/storage${p.storagePath}`,
                        }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                      {/* Delete button */}
                      <Pressable
                        style={s.deleteBtn}
                        onPress={() => deletePhoto(p.id)}
                        hitSlop={6}
                      >
                        {deletingId === p.id ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Ionicons name="close" size={13} color="#FFFFFF" />
                        )}
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {phasePhotos.length === 0 && queue.length === 0 && (
              <View style={s.emptyPhotos}>
                <Text style={s.emptyPhotosText}>
                  No {activePhase} photos yet
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07101E' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
  },
  headerSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    marginTop: 2,
  },
  scroll: { paddingHorizontal: 16, flexGrow: 1 },
  phaseToggle: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  phaseBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(140,160,185,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.14)',
  },
  phaseBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#435A7D',
    letterSpacing: 1,
  },
  phaseCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  phaseCountText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: '#07101E',
  },
  notCheckedIn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  lockCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(140,160,185,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.14)',
  },
  lockTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
  },
  lockBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 280,
  },
  cameraCard: {
    backgroundColor: '#13223A',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    marginBottom: 16,
    gap: 12,
  },
  shutterBtn: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#B4FF44',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#B4FF44',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  shutterPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  shutterDisabled: { opacity: 0.6 },
  shutterText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#07101E',
  },
  phaseLabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
  },
  galleryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(140,160,185,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.14)',
  },
  galleryText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#8CA0B9',
  },
  queueCard: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    gap: 10,
  },
  queueTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  queueRowError: {
    backgroundColor: 'rgba(225,29,72,0.08)',
    borderRadius: 8,
    padding: 8,
    marginHorizontal: -4,
  },
  queueRowText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#F4F7F9',
  },
  queueRowTextError: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#E11D48',
  },
  gridTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    marginBottom: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  photoThumb: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1C3050',
    position: 'relative',
  },
  deleteBtn: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  emptyPhotos: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  emptyPhotosText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
  },
});
