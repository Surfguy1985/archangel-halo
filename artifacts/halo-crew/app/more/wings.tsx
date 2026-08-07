import React from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useGetPortalWings, getGetPortalWingsQueryKey } from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

function fmtMoney(cents: number | null | undefined) {
  if (cents == null) return '$0';
  return `$${(cents / 100).toFixed(0)}`;
}

export default function WingsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { data: wings, isLoading } = useGetPortalWings(token!, {
    query: { enabled: !!token, queryKey: getGetPortalWingsQueryKey(token!) },
  });

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  if (isLoading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color="#B4FF44" />
      </View>
    );
  }

  // PortalWings: { haloScore, tier, program?, reserve, ... }
  // program: { eligible, years, wings, blockers, ... }
  // reserve: { held, released, debited }
  const eligible = wings?.program?.eligible ?? false;
  const yearsOfService = wings?.program?.years ?? 0;
  const reserveHeld = wings?.reserve?.held ?? 0;
  const wingsPoints = wings?.program?.wings ?? 0;

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={[s.content, { paddingBottom: bottomPad + 20 }]}
    >
      {/* Hero */}
      <LinearGradient
        colors={['#1C3050', '#13223A']}
        style={s.hero}
      >
        <View style={s.heroIcon}>
          <Ionicons name="ribbon" size={40} color="#EAB308" />
        </View>
        <Text style={s.heroTitle}>Wings Program</Text>
        <Text style={s.heroSub}>
          12% of company profits shared with eligible crew
        </Text>

        <View style={s.eligibilityRow}>
          <View style={[s.eligBadge, eligible ? s.eligGreen : s.eligGray]}>
            <Ionicons
              name={eligible ? 'checkmark-circle' : 'time-outline'}
              size={16}
              color={eligible ? '#22C55E' : '#8CA0B9'}
            />
            <Text style={[s.eligText, eligible ? s.eligTextGreen : s.eligTextGray]}>
              {eligible ? 'Eligible' : 'Not yet eligible'}
            </Text>
          </View>
          <Text style={s.yearsText}>
            {yearsOfService != null ? `${yearsOfService} yr${yearsOfService !== 1 ? 's' : ''} service` : '—'}
          </Text>
        </View>
      </LinearGradient>

      {/* Wings / reserve */}
      {eligible && (
        <View style={s.shareCard}>
          <Text style={s.shareLabel}>Your Wings Points</Text>
          <Text style={s.shareAmount}>{wingsPoints.toLocaleString()}</Text>
          {reserveHeld > 0 && (
            <Text style={s.potText}>
              Reserve held: {fmtMoney(reserveHeld)}
            </Text>
          )}
        </View>
      )}

      {/* How it works */}
      <Text style={s.sectionTitle}>How it works</Text>
      {[
        { icon: 'people-outline', text: '12% of annual company profits are pooled for Wings' },
        { icon: 'calendar-outline', text: 'Eligible after 1 full year of service' },
        { icon: 'scale-outline', text: 'Your share is proportional to your years of service' },
        { icon: 'time-outline', text: 'Settled once per year, typically in Q1' },
        { icon: 'lock-closed-outline', text: 'Reserves can be held until invoices are fully paid' },
      ].map((item, i) => (
        <View key={i} style={s.ruleRow}>
          <View style={s.ruleIcon}>
            <Ionicons name={item.icon as any} size={18} color="#EAB308" />
          </View>
          <Text style={s.ruleText}>{item.text}</Text>
        </View>
      ))}

      {!eligible && yearsOfService < 1 && (
        <View style={s.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color="#8CA0B9" />
          <Text style={s.infoText}>
            You become eligible after one full year with the company. Keep up the
            great work!
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07101E' },
  content: { padding: 16, gap: 14 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.20)',
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(234,179,8,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.25)',
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
  },
  heroSub: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    textAlign: 'center',
    lineHeight: 20,
  },
  eligibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  eligBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  eligGreen: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.30)',
  },
  eligGray: {
    backgroundColor: 'rgba(140,160,185,0.10)',
    borderColor: 'rgba(140,160,185,0.20)',
  },
  eligText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  eligTextGreen: { color: '#22C55E' },
  eligTextGray: { color: '#8CA0B9' },
  yearsText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
  },
  shareCard: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.20)',
    gap: 4,
  },
  shareLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#8CA0B9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  shareAmount: {
    fontSize: 36,
    fontFamily: 'Inter_700Bold',
    color: '#EAB308',
  },
  potText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#13223A',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.10)',
  },
  ruleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(234,179,8,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  ruleText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#F4F7F9',
    lineHeight: 21,
    marginTop: 7,
  },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(140,160,185,0.08)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.14)',
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    lineHeight: 21,
  },
});
