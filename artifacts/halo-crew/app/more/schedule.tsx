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
import { Ionicons } from '@expo/vector-icons';

function formatDate(iso: string | null | undefined) {
  if (!iso) return 'Upcoming';
  const d = new Date(iso + 'T00:00:00');
  const today = new Date();
  const diff = Math.round(
    (d.getTime() - today.setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const { portal, invalidate } = useAuth();
  const [refreshing, setRefreshing] = React.useState(false);

  const schedule = portal?.schedule ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    invalidate();
    setTimeout(() => setRefreshing(false), 800);
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
      {schedule.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="calendar-outline" size={48} color="#435A7D" />
          <Text style={s.emptyTitle}>No scheduled jobs</Text>
          <Text style={s.emptyBody}>
            Your upcoming schedule will appear here when the office assigns you
            to a job.
          </Text>
        </View>
      ) : (
        schedule.map((item, i) => (
          <View key={item.id} style={s.card}>
            <View style={s.cardLeft}>
              <Text style={s.dateLabel}>{formatDate(item.scheduledOn)}</Text>
              {item.windowStart && (
                <Text style={s.timeLabel}>{item.windowStart}</Text>
              )}
            </View>
            <View style={s.divider} />
            <View style={s.cardRight}>
              <Text style={s.propertyName}>
                {item.propertyName ?? item.description ?? 'Job'}
              </Text>
              {item.unitNo && (
                <Text style={s.unitNo}>Unit {item.unitNo}</Text>
              )}
              {item.propertyAddress && (
                <Text style={s.address}>{item.propertyAddress}</Text>
              )}
              {(item.tasks ?? []).length > 0 && (
                <View style={s.tasks}>
                  {item.tasks!.map((t, ti) => (
                    <View key={ti} style={s.taskRow}>
                      <View style={s.taskDot} />
                      <Text style={s.taskText}>{t}</Text>
                    </View>
                  ))}
                </View>
              )}
              {item.contactName && (
                <View style={s.contactRow}>
                  <Ionicons
                    name="person-outline"
                    size={12}
                    color="#435A7D"
                  />
                  <Text style={s.contactText}>{item.contactName}</Text>
                  {item.contactPhone && (
                    <Text style={s.contactText}>· {item.contactPhone}</Text>
                  )}
                </View>
              )}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07101E' },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    textAlign: 'center',
    lineHeight: 21,
  },
  card: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    gap: 14,
  },
  cardLeft: { alignItems: 'center', minWidth: 60 },
  dateLabel: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#B4FF44',
    textAlign: 'center',
  },
  timeLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    marginTop: 2,
    textAlign: 'center',
  },
  divider: {
    width: 1,
    backgroundColor: 'rgba(140,160,185,0.14)',
    marginVertical: 2,
  },
  cardRight: { flex: 1, gap: 4 },
  propertyName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
  },
  unitNo: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#B4FF44',
  },
  address: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
  },
  tasks: { gap: 3, marginTop: 4 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  contactText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
  },
});
