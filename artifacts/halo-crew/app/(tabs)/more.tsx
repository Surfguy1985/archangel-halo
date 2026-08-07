import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

type MoreItem = {
  id: string;
  label: string;
  sub: string;
  icon: string;
  route: string;
  badge?: number;
  accent?: string;
};

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const { portal, token } = useAuth();
  const unseen = portal?.unseen;

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 80);

  const items: MoreItem[] = [
    {
      id: 'messages',
      label: 'Messages',
      sub: 'Talk to your office',
      icon: 'chatbubble-outline',
      route: '/more/messages',
      badge: unseen?.messages,
      accent: '#60A5FA',
    },
    {
      id: 'schedule',
      label: 'Schedule',
      sub: 'Upcoming jobs',
      icon: 'calendar-outline',
      route: '/more/schedule',
      badge: unseen?.schedule,
      accent: '#A78BFA',
    },
    {
      id: 'offers',
      label: 'Offers',
      sub: 'New job opportunities',
      icon: 'flash-outline',
      route: '/more/offers',
      badge: (unseen?.offers ?? 0) + (unseen?.emergency ?? 0),
      accent: '#F97316',
    },
    {
      id: 'invoices',
      label: 'Invoices',
      sub: 'Submit your work bills',
      icon: 'document-text-outline',
      route: '/more/invoice',
      badge: unseen?.invoices,
      accent: '#B4FF44',
    },
    {
      id: 'pay',
      label: 'My Pay',
      sub: 'Earnings & payments',
      icon: 'cash-outline',
      route: '/more/pay',
      badge: unseen?.pay,
      accent: '#22C55E',
    },
    {
      id: 'wings',
      label: 'Wings',
      sub: 'Profit share program',
      icon: 'ribbon-outline',
      route: '/more/wings',
      accent: '#EAB308',
    },
    {
      id: 'docs',
      label: 'Documents',
      sub: 'W-9, bank, packets',
      icon: 'folder-open-outline',
      route: '/more/docs',
      badge: unseen?.documents,
      accent: '#F4F7F9',
    },
    {
      id: 'guide',
      label: 'Guide',
      sub: 'How everything works (EN / ES)',
      icon: 'book-outline',
      route: '/more/guide',
      accent: '#8CA0B9',
    },
  ];

  const press = (route: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#07101E' }}>
      <ScrollView
        contentContainerStyle={[
          moreStyles.scroll,
          { paddingTop: topPad + 20, paddingBottom: bottomPad + 20 },
        ]}
      >
        {/* Header */}
        <View style={moreStyles.header}>
          <Text style={moreStyles.title}>More</Text>
          {portal?.crew?.name && (
            <Text style={moreStyles.crewName}>{portal.crew.name}</Text>
          )}
        </View>

        {/* Grid */}
        <View style={moreStyles.grid}>
          {items.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [
                moreStyles.card,
                pressed && { opacity: 0.82, transform: [{ scale: 0.98 }] },
              ]}
              onPress={() => press(item.route)}
            >
              <View
                style={[
                  moreStyles.iconBox,
                  { backgroundColor: item.accent + '18' },
                ]}
              >
                <Ionicons
                  name={item.icon as any}
                  size={26}
                  color={item.accent ?? '#B4FF44'}
                />
              </View>
              <Text style={moreStyles.cardLabel}>{item.label}</Text>
              <Text style={moreStyles.cardSub}>{item.sub}</Text>
              {!!item.badge && item.badge > 0 && (
                <View style={moreStyles.badge}>
                  <Text style={moreStyles.badgeText}>{item.badge}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {/* Profile section */}
        <View style={moreStyles.profileCard}>
          <View style={moreStyles.profileLeft}>
            <View style={moreStyles.avatar}>
              <Ionicons name="person" size={22} color="#8CA0B9" />
            </View>
            <View>
              <Text style={moreStyles.profileName}>
                {portal?.crew?.name ?? 'Crew Member'}
              </Text>
              <Text style={moreStyles.profileRole}>
                {portal?.crew?.trade ?? 'Field Crew'}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#435A7D" />
        </View>
      </ScrollView>
    </View>
  );
}

const moreStyles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, flexGrow: 1 },
  header: { marginBottom: 20 },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
  },
  crewName: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  card: {
    width: '47%',
    backgroundColor: '#13223A',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    position: 'relative',
    minHeight: 120,
    justifyContent: 'space-between',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  cardLabel: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
    marginBottom: 2,
  },
  cardSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    lineHeight: 17,
  },
  badge: {
    position: 'absolute',
    top: 14,
    right: 14,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E11D48',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  profileCard: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
  },
  profileLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(140,160,185,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
  },
  profileRole: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    marginTop: 1,
  },
});
