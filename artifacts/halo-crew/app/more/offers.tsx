import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {
  useRespondPortalOffer,
  useCommitPortalEmergency,
} from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

function fmtMoney(cents: number | null | undefined) {
  if (cents == null) return '';
  return `$${(cents / 100).toFixed(0)}`;
}

export default function OffersScreen() {
  const insets = useSafeAreaInsets();
  const { token, portal, invalidate } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const { mutateAsync: respondOffer } = useRespondPortalOffer();
  const { mutateAsync: commitEmergency } = useCommitPortalEmergency();

  const offers = portal?.offers ?? [];
  const emergencyOffers = portal?.emergencyOffers ?? [];
  const pendingEmergencies = emergencyOffers.filter(
    (e) => e.status === 'pending',
  );
  const pendingOffers = offers.filter((o) => o.status === 'pending');

  const onRefresh = async () => {
    setRefreshing(true);
    invalidate();
    setTimeout(() => setRefreshing(false), 800);
  };

  const handleOffer = async (offerId: string, decision: 'approved' | 'declined') => {
    if (!token || respondingId) return;
    setRespondingId(offerId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await respondOffer({ token, offerId, data: { decision } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidate();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not respond');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setRespondingId(null);
    }
  };

  const handleEmergency = async (offerId: string, targetId: string) => {
    if (!token || respondingId) return;
    Alert.alert(
      'Commit to Emergency Job?',
      "First crew to commit wins. You'll be locked in immediately.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Commit',
          style: 'destructive',
          onPress: async () => {
            setRespondingId(offerId);
            try {
              await commitEmergency({ token, targetId });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              invalidate();
            } catch (err) {
              Alert.alert(
                'Could not commit',
                err instanceof Error ? err.message : 'Try again',
              );
            } finally {
              setRespondingId(null);
            }
          },
        },
      ],
    );
  };

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={[s.content, { paddingBottom: bottomPad + 20 }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#B4FF44"
        />
      }
    >
      {/* Emergency offers */}
      {pendingEmergencies.map((e) => (
        <LinearGradient
          key={e.id}
          colors={['rgba(225,29,72,0.20)', 'rgba(225,29,72,0.08)']}
          style={s.emergCard}
        >
          <View style={s.emergHeader}>
            <Ionicons name="flash" size={20} color="#E11D48" />
            <Text style={s.emergLabel}>EMERGENCY OFFER</Text>
            {e.bonusAmount > 0 && (
              <Text style={s.emergBonus}>+{fmtMoney(e.bonusAmount * 100)} bonus</Text>
            )}
          </View>
          <Text style={s.offerProperty}>{e.propertyName ?? 'Emergency Job'}</Text>
          {e.description && <Text style={s.offerDesc}>{e.description}</Text>}
          {e.neededBy && (
            <Text style={s.offerDate}>
              Needed by: {e.neededBy}
            </Text>
          )}
          <Pressable
            style={({ pressed }) => [
              s.commitBtn,
              pressed && { opacity: 0.85 },
              respondingId === e.id && { opacity: 0.6 },
            ]}
            onPress={() => handleEmergency(e.id, e.pingId)}
            disabled={!!respondingId}
          >
            {respondingId === e.id ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={s.commitBtnText}>Commit Now — First Wins</Text>
            )}
          </Pressable>
        </LinearGradient>
      ))}

      {/* Regular offers */}
      {pendingOffers.length === 0 && pendingEmergencies.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="flash-outline" size={48} color="#435A7D" />
          <Text style={s.emptyTitle}>No pending offers</Text>
          <Text style={s.emptyBody}>
            New job offers from the office will appear here.
          </Text>
        </View>
      ) : (
        pendingOffers.map((offer) => (
          <View key={offer.id} style={s.offerCard}>
            <View style={s.offerCardHeader}>
              <View>
                <Text style={s.offerProperty}>
                  {offer.propertyName ?? 'Job Offer'}
                </Text>
                {offer.scheduledOn && (
                  <Text style={s.offerDate}>{offer.scheduledOn}</Text>
                )}
              </View>
              {offer.crewsNeeded && (
                <Text style={s.crewsText}>
                  {offer.crewsFilled ?? 0}/{offer.crewsNeeded} crews
                </Text>
              )}
            </View>

            {offer.description && (
              <Text style={s.offerDesc}>{offer.description}</Text>
            )}

            {(offer.tasks ?? []).length > 0 && (
              <View style={s.taskList}>
                {offer.tasks!.map((t, i) => (
                  <View key={i} style={s.taskRow}>
                    <View style={s.taskDot} />
                    <Text style={s.taskText}>{t}</Text>
                  </View>
                ))}
              </View>
            )}

            {offer.propertyAddress && (
              <Text style={s.offerAddr}>{offer.propertyAddress}</Text>
            )}

            <View style={s.offerActions}>
              <Pressable
                style={({ pressed }) => [
                  s.passBtn,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => handleOffer(offer.id, 'declined')}
                disabled={!!respondingId}
              >
                <Text style={s.passBtnText}>Pass</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  s.acceptBtn,
                  pressed && { opacity: 0.85 },
                  respondingId === offer.id && { opacity: 0.6 },
                ]}
                onPress={() => handleOffer(offer.id, 'approved')}
                disabled={!!respondingId}
              >
                {respondingId === offer.id ? (
                  <ActivityIndicator color="#07101E" />
                ) : (
                  <Text style={s.acceptBtnText}>Accept</Text>
                )}
              </Pressable>
            </View>
          </View>
        ))
      )}

      {/* Responded offers */}
      {offers.filter((o) => o.status !== 'pending').length > 0 && (
        <>
          <Text style={s.sectionTitle}>Previous Offers</Text>
          {offers
            .filter((o) => o.status !== 'pending')
            .map((offer) => (
              <View key={offer.id} style={[s.offerCard, s.offerCardDim]}>
                <View style={s.offerCardHeader}>
                  <Text style={s.offerProperty}>
                    {offer.propertyName ?? 'Offer'}
                  </Text>
                  <Text
                    style={[
                      s.statusText,
                      {
                        color:
                          offer.status === 'approved' ? '#22C55E' : '#8CA0B9',
                      },
                    ]}
                  >
                    {offer.status === 'approved' ? 'Accepted' : 'Passed'}
                  </Text>
                </View>
              </View>
            ))}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07101E' },
  content: { padding: 16, gap: 12 },
  empty: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 280,
  },
  emergCard: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(225,29,72,0.30)',
    gap: 8,
  },
  emergHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  emergLabel: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: '#E11D48',
    letterSpacing: 1.2,
    flex: 1,
  },
  emergBonus: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#22C55E',
  },
  commitBtn: {
    backgroundColor: '#E11D48',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  commitBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  offerCard: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    gap: 8,
  },
  offerCardDim: { opacity: 0.6 },
  offerCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  offerProperty: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
  },
  offerDate: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#B4FF44',
    marginTop: 2,
  },
  offerDesc: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    lineHeight: 21,
  },
  crewsText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
  },
  taskList: { gap: 4 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#435A7D',
    flexShrink: 0,
  },
  taskText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
  },
  offerAddr: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
  },
  offerActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  passBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(140,160,185,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.18)',
  },
  passBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
  },
  acceptBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#B4FF44',
  },
  acceptBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#07101E',
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
  },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
