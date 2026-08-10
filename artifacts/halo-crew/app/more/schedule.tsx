import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/context/AuthContext';
import {
  useListPortalJobs,
  getListPortalJobsQueryKey,
} from '@workspace/api-client-react';
import type { PortalScheduleItem, PortalJob } from '@workspace/api-client-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(iso: string | null | undefined): string {
  if (!iso) return 'Upcoming';
  const today = localToday();
  const tomorrow = localTomorrow();
  if (iso === today) return 'Today';
  if (iso === tomorrow) return 'Tomorrow';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function shortDay(iso: string | null | undefined): { day: string; date: string } {
  if (!iso) return { day: 'TBD', date: '—' };
  const today = localToday();
  const tomorrow = localTomorrow();
  if (iso === today) return { day: 'TODAY', date: '' };
  if (iso === tomorrow) return { day: 'TMR', date: '' };
  const d = new Date(iso + 'T00:00:00');
  return {
    day: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  // Handle "HH:MM" format
  const match = t.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return t;
  const h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === '00' ? `${h12} ${ampm}` : `${h12}:${m} ${ampm}`;
}

function openDirections(address: string | null | undefined) {
  if (!address) return;
  const encoded = encodeURIComponent(address);
  let url: string;
  if (Platform.OS === 'ios') {
    url = `maps:?daddr=${encoded}`;
  } else if (Platform.OS === 'android') {
    url = `geo:0,0?q=${encoded}`;
  } else {
    url = `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
  }
  Linking.canOpenURL(url).then((can) => {
    if (can) {
      Linking.openURL(url);
    } else {
      // Fallback to Google Maps web
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`);
    }
  });
}

// ─── Date group header ────────────────────────────────────────────────────────

function DateHeader({ label, isToday }: { label: string; isToday: boolean }) {
  return (
    <View style={dhStyles.row}>
      <View style={[dhStyles.line, isToday && dhStyles.lineActive]} />
      <View style={[dhStyles.pill, isToday && dhStyles.pillActive]}>
        <Text style={[dhStyles.text, isToday && dhStyles.textActive]}>
          {label}
        </Text>
      </View>
      <View style={[dhStyles.line, isToday && dhStyles.lineActive]} />
    </View>
  );
}

const dhStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 },
  line: { flex: 1, height: 1, backgroundColor: 'rgba(140,160,185,0.10)' },
  lineActive: { backgroundColor: 'rgba(180,255,68,0.20)' },
  pill: {
    backgroundColor: 'rgba(140,160,185,0.08)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
  },
  pillActive: {
    backgroundColor: 'rgba(180,255,68,0.08)',
    borderColor: 'rgba(180,255,68,0.22)',
  },
  text: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#8CA0B9', letterSpacing: 0.5 },
  textActive: { color: '#B4FF44' },
});

// ─── Checklist row ────────────────────────────────────────────────────────────

function CheckRow({ label, done, mine }: { label: string; done: boolean; mine: boolean }) {
  return (
    <View style={crStyles.row}>
      <View style={[crStyles.box, done && crStyles.boxDone, !mine && crStyles.boxOther]}>
        {done && <Ionicons name="checkmark" size={11} color="#07101E" />}
      </View>
      <Text
        style={[
          crStyles.label,
          done && crStyles.labelDone,
          !mine && crStyles.labelOther,
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
      {mine && !done && (
        <View style={crStyles.mineBadge}>
          <Text style={crStyles.mineText}>Mine</Text>
        </View>
      )}
    </View>
  );
}

const crStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 7 },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(140,160,185,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  boxDone: { backgroundColor: '#B4FF44', borderColor: '#B4FF44' },
  boxOther: { borderColor: 'rgba(140,160,185,0.14)' },
  label: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: '#C5D4E3', lineHeight: 20 },
  labelDone: { color: '#435A7D', textDecorationLine: 'line-through' },
  labelOther: { color: '#6B82A0' },
  mineBadge: {
    backgroundColor: 'rgba(180,255,68,0.10)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(180,255,68,0.20)',
  },
  mineText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#B4FF44' },
});

// ─── Expandable schedule card ─────────────────────────────────────────────────

function ScheduleCard({
  item,
  job,
  isToday,
  isFirst,
}: {
  item: PortalScheduleItem;
  job: PortalJob | null;
  isToday: boolean;
  isFirst: boolean;
}) {
  const [expanded, setExpanded] = useState(isToday && isFirst);
  const animHeight = useRef(new Animated.Value(isToday && isFirst ? 1 : 0)).current;

  const toggle = useCallback(() => {
    const toValue = expanded ? 0 : 1;
    setExpanded(!expanded);
    Animated.timing(animHeight, {
      toValue,
      duration: 260,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [expanded, animHeight]);

  const hasAddress = !!(item.propertyAddress || item.propertyCity);
  const addressStr = [item.propertyAddress, item.propertyCity].filter(Boolean).join(', ');
  const tasks = item.tasks ?? [];
  const lineItems = job?.lineItems ?? [];
  const myItems = lineItems.filter((li) => li.mine);
  const hasContent = hasAddress || tasks.length > 0 || myItems.length > 0 || item.contactName;

  const { day, date } = shortDay(item.scheduledOn);
  const timeStr = formatTime(item.windowStart);

  const statusColor =
    item.status === 'in_progress' ? '#F97316'
    : item.status === 'completed' ? '#22C55E'
    : isToday ? '#B4FF44'
    : '#435A7D';

  return (
    <Pressable
      style={({ pressed }) => [
        cardStyles.card,
        isToday && cardStyles.cardToday,
        pressed && { opacity: 0.93 },
      ]}
      onPress={hasContent ? toggle : undefined}
    >
      {/* Left date column */}
      <View style={cardStyles.dateCol}>
        <Text style={[cardStyles.dayText, isToday && { color: '#B4FF44' }]}>{day}</Text>
        {date ? <Text style={cardStyles.dateText}>{date}</Text> : null}
        {timeStr ? (
          <Text style={cardStyles.timeText}>{timeStr}</Text>
        ) : null}
        {/* Status dot */}
        <View style={[cardStyles.statusDot, { backgroundColor: statusColor }]} />
      </View>

      {/* Right content */}
      <View style={{ flex: 1 }}>
        {/* Header row */}
        <View style={cardStyles.headerRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={cardStyles.propertyName} numberOfLines={1}>
              {item.propertyName ?? item.description ?? 'Job'}
            </Text>
            <View style={cardStyles.metaRow}>
              {item.unitNo ? (
                <View style={cardStyles.unitBadge}>
                  <Ionicons name="home-outline" size={11} color="#B4FF44" />
                  <Text style={cardStyles.unitText}>Unit {item.unitNo}</Text>
                </View>
              ) : null}
              {item.jobNo ? (
                <Text style={cardStyles.jobNo}>{item.jobNo}</Text>
              ) : null}
            </View>
          </View>

          {/* Actions */}
          <View style={cardStyles.actions}>
            {hasAddress && (
              <Pressable
                style={({ pressed }) => [cardStyles.mapBtn, pressed && { opacity: 0.7 }]}
                onPress={(e) => {
                  e.stopPropagation?.();
                  openDirections(addressStr);
                }}
                hitSlop={8}
              >
                <Ionicons
                  name={Platform.OS === 'ios' ? 'map' : 'navigate'}
                  size={16}
                  color="#07101E"
                />
              </Pressable>
            )}
            {hasContent && (
              <Pressable onPress={toggle} hitSlop={8} style={cardStyles.chevronBtn}>
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color="#8CA0B9"
                />
              </Pressable>
            )}
          </View>
        </View>

        {/* Expandable body */}
        {hasContent && (
          <Animated.View
            style={{
              overflow: 'hidden',
              maxHeight: animHeight.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 600],
              }),
              opacity: animHeight,
            }}
          >
            <View style={cardStyles.divider} />

            {/* Address + directions */}
            {hasAddress && (
              <Pressable
                style={({ pressed }) => [cardStyles.addressRow, pressed && { opacity: 0.7 }]}
                onPress={() => openDirections(addressStr)}
              >
                <View style={cardStyles.addressIcon}>
                  <Ionicons name="location" size={14} color="#60A5FA" />
                </View>
                <Text style={cardStyles.addressText}>{addressStr}</Text>
                <Ionicons name="chevron-forward" size={14} color="#60A5FA" />
              </Pressable>
            )}

            {/* Scope of work */}
            {tasks.length > 0 && (
              <View style={cardStyles.section}>
                <Text style={cardStyles.sectionTitle}>SCOPE OF WORK</Text>
                {tasks.map((t, i) => (
                  <View key={i} style={cardStyles.taskRow}>
                    <View style={cardStyles.taskBullet} />
                    <Text style={cardStyles.taskText}>{t}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Work checklist — only this crew's assigned items */}
            {myItems.length > 0 && (
              <View style={cardStyles.section}>
                <View style={cardStyles.checklistHeader}>
                  <Text style={cardStyles.sectionTitle}>MY TASKS</Text>
                  <Text style={cardStyles.checklistProgress}>
                    {myItems.filter((li) => li.completed).length}/{myItems.length}
                  </Text>
                </View>
                {myItems.map((li) => (
                  <CheckRow
                    key={li.id}
                    label={li.service}
                    done={li.completed}
                    mine={true}
                  />
                ))}
              </View>
            )}

            {/* Contact */}
            {item.contactName && (
              <View style={cardStyles.contactRow}>
                <Ionicons name="person-circle-outline" size={15} color="#435A7D" />
                <Text style={cardStyles.contactText}>
                  {item.contactName}
                  {item.contactPhone ? ` · ${item.contactPhone}` : ''}
                </Text>
              </View>
            )}
          </Animated.View>
        )}
      </View>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#111E30',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.10)',
  },
  cardToday: {
    borderColor: 'rgba(180,255,68,0.18)',
    backgroundColor: '#12203A',
  },
  dateCol: {
    width: 52,
    alignItems: 'center',
    paddingTop: 2,
    gap: 2,
  },
  dayText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: '#8CA0B9',
    letterSpacing: 0.5,
  },
  dateText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
    textAlign: 'center',
  },
  timeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    marginTop: 4,
    textAlign: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  propertyName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  unitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(180,255,68,0.08)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(180,255,68,0.16)',
  },
  unitText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#B4FF44' },
  jobNo: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#435A7D' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  mapBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#B4FF44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(140,160,185,0.10)',
    marginTop: 14,
    marginBottom: 14,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(96,165,250,0.06)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.12)',
    marginBottom: 12,
  },
  addressIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(96,165,250,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  addressText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#60A5FA',
  },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#435A7D',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  checklistProgress: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#B4FF44',
  },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 3 },
  taskBullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#435A7D',
    marginTop: 7,
    flexShrink: 0,
  },
  taskText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: '#C5D4E3', lineHeight: 20 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  contactText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#435A7D' },
});

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={emptyStyles.wrap}>
      <LinearGradient
        colors={['rgba(140,160,185,0.06)', 'transparent']}
        style={emptyStyles.circle}
      >
        <Ionicons name="calendar-outline" size={52} color="#435A7D" />
      </LinearGradient>
      <Text style={emptyStyles.title}>No upcoming jobs</Text>
      <Text style={emptyStyles.body}>
        Your schedule will appear here when the office assigns you to a job.
        Check the Offers tab for new opportunities.
      </Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32, gap: 14 },
  circle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 19, fontFamily: 'Inter_600SemiBold', color: '#F4F7F9', textAlign: 'center' },
  body: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#8CA0B9', textAlign: 'center', lineHeight: 22 },
});

// ─── Summary bar ─────────────────────────────────────────────────────────────

function SummaryBar({ total, todayCount }: { total: number; todayCount: number }) {
  if (total === 0) return null;
  return (
    <View style={sbStyles.row}>
      <View style={sbStyles.stat}>
        <Text style={sbStyles.num}>{total}</Text>
        <Text style={sbStyles.label}>upcoming</Text>
      </View>
      <View style={sbStyles.dot} />
      <View style={sbStyles.stat}>
        <Text style={[sbStyles.num, todayCount > 0 && { color: '#B4FF44' }]}>
          {todayCount}
        </Text>
        <Text style={sbStyles.label}>today</Text>
      </View>
    </View>
  );
}

const sbStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    marginBottom: 20,
  },
  stat: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  num: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#F4F7F9' },
  label: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#435A7D' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(140,160,185,0.25)' },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

type Group = { label: string; iso: string | null; items: PortalScheduleItem[]; isToday: boolean };

function groupByDate(items: PortalScheduleItem[]): Group[] {
  const map = new Map<string, PortalScheduleItem[]>();
  for (const item of items) {
    const key = item.scheduledOn ?? '__upcoming__';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  const today = localToday();
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === '__upcoming__') return 1;
      if (b === '__upcoming__') return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .map(([key, groupItems]) => ({
      label: dayLabel(key === '__upcoming__' ? null : key),
      iso: key === '__upcoming__' ? null : key,
      items: groupItems,
      isToday: key === today,
    }));
}

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const { token, portal, invalidate } = useAuth();

  const { data: jobs, refetch: refetchJobs } = useListPortalJobs(token!, {
    query: {
      enabled: !!token,
      staleTime: 30_000,
      queryKey: getListPortalJobsQueryKey(token!),
    },
  });

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchJobs();
    invalidate();
    setTimeout(() => setRefreshing(false), 600);
  }, [refetchJobs, invalidate]);

  // Build a jobNo → PortalJob map for checklist lookup
  const jobByNo = React.useMemo(() => {
    const m = new Map<string, PortalJob>();
    for (const j of jobs ?? []) {
      if (j.jobNo) m.set(j.jobNo, j);
    }
    return m;
  }, [jobs]);

  const schedule = portal?.schedule ?? [];
  const groups = groupByDate(schedule);
  const today = localToday();
  const todayCount = schedule.filter((s) => s.scheduledOn === today).length;

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 16);
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 20);

  return (
    <View style={{ flex: 1, backgroundColor: '#07101E' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          mainStyles.scroll,
          { paddingTop: topPad, paddingBottom: bottomPad },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#B4FF44"
          />
        }
      >
        <SummaryBar total={schedule.length} todayCount={todayCount} />

        {schedule.length === 0 ? (
          <EmptyState />
        ) : (
          groups.map((group) => (
            <View key={group.iso ?? '__upcoming__'} style={mainStyles.group}>
              <DateHeader label={group.label} isToday={group.isToday} />
              <View style={mainStyles.groupCards}>
                {group.items.map((item, i) => (
                  <ScheduleCard
                    key={item.id}
                    item={item}
                    job={item.jobNo ? (jobByNo.get(item.jobNo) ?? null) : null}
                    isToday={group.isToday}
                    isFirst={i === 0}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const mainStyles = StyleSheet.create({
  scroll: { paddingHorizontal: 16 },
  group: { marginBottom: 16 },
  groupCards: { gap: 10, marginTop: 10 },
});
