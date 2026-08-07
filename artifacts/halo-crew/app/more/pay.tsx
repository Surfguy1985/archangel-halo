import React from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useGetPortalEarnings, getGetPortalEarningsQueryKey } from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

function fmtMoney(cents: number | null | undefined) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function PayScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [refreshing, setRefreshing] = React.useState(false);

  const {
    data: earnings,
    isLoading,
    refetch,
  } = useGetPortalEarnings(token!, {
    query: { enabled: !!token, queryKey: getGetPortalEarningsQueryKey(token!) },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  if (isLoading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color="#B4FF44" />
      </View>
    );
  }

  // PortalEarnings: { heldTotal, payableTotal, paidTotal, holds[] }
  // Hold: { id, jobId, jobLabel, amount, bonusAmount, state, sameDayPay, heldAt, releasedAt }
  const totalPaid = earnings?.paidTotal ?? 0;
  const totalHeld = earnings?.heldTotal ?? 0;
  const holds = earnings?.holds ?? [];

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
      {/* Summary cards */}
      <LinearGradient
        colors={['#13223A', '#1C3050']}
        style={s.summaryCard}
      >
        <View style={s.summaryRow}>
          <View style={s.summaryItem}>
            <Text style={s.summaryLabel}>Total Paid</Text>
            <Text style={s.summaryValue}>{fmtMoney(totalPaid)}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.summaryItem}>
            <Text style={s.summaryLabel}>Held</Text>
            <Text style={[s.summaryValue, { color: '#EAB308' }]}>
              {fmtMoney(totalHeld)}
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* Hold history */}
      <Text style={s.sectionTitle}>Pay Records</Text>

      {holds.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="cash-outline" size={44} color="#435A7D" />
          <Text style={s.emptyText}>No pay records yet</Text>
        </View>
      ) : (
        holds.map((p) => (
          <View key={p.id} style={s.payRow}>
            <View style={s.payIcon}>
              <Ionicons
                name={p.state === 'paid' ? 'checkmark-circle-outline' : p.sameDayPay ? 'flash-outline' : 'cash-outline'}
                size={18}
                color={p.state === 'paid' ? '#22C55E' : p.sameDayPay ? '#EAB308' : '#8CA0B9'}
              />
            </View>
            <View style={s.payInfo}>
              <Text style={s.payDesc}>{p.jobLabel ?? 'Job Pay'}</Text>
              <Text style={s.payDate}>{formatDate(p.heldAt)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={s.payAmount}>{fmtMoney(p.amount)}</Text>
              <Text style={[s.payStatus, { color: p.state === 'paid' ? '#22C55E' : p.state === 'payable' ? '#B4FF44' : '#8CA0B9' }]}>
                {p.state}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07101E' },
  content: { padding: 16, gap: 12 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summaryCard: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    gap: 14,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center', gap: 4 },
  summaryLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: '#8CA0B9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  summaryValue: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: '#B4FF44',
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(140,160,185,0.14)',
  },
  payMethodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
  },
  payMethodText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 4,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
  },
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#13223A',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.10)',
  },
  payIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(140,160,185,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  payInfo: { flex: 1, gap: 2 },
  payDesc: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#F4F7F9',
  },
  payDate: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
  },
  payAmount: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#22C55E',
  },
  payStatus: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'capitalize',
  },
});
