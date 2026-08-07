import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Slide = {
  key: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  title: string;
  body: string;
};

const SLIDES: Slide[] = [
  {
    key: 'welcome',
    icon: 'shield-checkmark',
    iconColor: '#B4FF44',
    iconBg: 'rgba(180,255,68,0.12)',
    title: 'Welcome to HALO Crew',
    body: 'Your all-in-one field app.\nCheck in, document your work, and get paid — all from one place.',
  },
  {
    key: 'gps',
    icon: 'navigate',
    iconColor: '#60A5FA',
    iconBg: 'rgba(96,165,250,0.12)',
    title: 'GPS Tracking',
    body: 'Your location is tracked while you are checked in to a job.\nThis verifies your time on site and protects you if any question arises.',
  },
  {
    key: 'photos',
    icon: 'camera',
    iconColor: '#F97316',
    iconBg: 'rgba(249,115,22,0.12)',
    title: 'Before & After Photos',
    body: 'Always take before photos when you arrive.\nThey document the property condition and protect you from disputes.',
  },
  {
    key: 'pay',
    icon: 'cash',
    iconColor: '#22C55E',
    iconBg: 'rgba(34,197,94,0.12)',
    title: 'Track Your Earnings',
    body: 'See your holds, payouts, and Wings status in real time.\nSubmit your crew invoice right from the app when the job is done.',
  },
];

function SlideItem({ slide }: { slide: Slide }) {
  return (
    <View style={[slideStyles.slide, { width: SCREEN_WIDTH }]}>
      <View style={[slideStyles.iconCircle, { backgroundColor: slide.iconBg, borderColor: slide.iconColor + '33' }]}>
        <Ionicons name={slide.icon as any} size={52} color={slide.iconColor} />
      </View>
      <Text style={slideStyles.title}>{slide.title}</Text>
      <Text style={slideStyles.body}>{slide.body}</Text>
    </View>
  );
}

const slideStyles = StyleSheet.create({
  slide: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 20,
  },
  iconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 36,
  },
  title: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    textAlign: 'center',
    lineHeight: 25,
  },
});

export default function OnboardingIntroScreen() {
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
  ).current;

  const goNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (activeIndex < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      router.push('/onboarding/agreement');
    }
  };

  const isLast = activeIndex === SLIDES.length - 1;

  return (
    <LinearGradient colors={['#07101E', '#0D1C31', '#07101E']} style={{ flex: 1 }}>
      {/* Skip button */}
      <View style={[skipStyles.row, { paddingTop: insets.top + 16 }]}>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push('/onboarding/agreement')}
          hitSlop={12}
          style={({ pressed }) => [skipStyles.skipBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={skipStyles.skipText}>Skip intro</Text>
        </Pressable>
      </View>

      {/* Logo */}
      <View style={logoStyles.row}>
        <Ionicons name="shield-checkmark" size={22} color="#B4FF44" />
        <Text style={logoStyles.text}>HALO CREW</Text>
      </View>

      {/* Slides */}
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        renderItem={({ item }) => <SlideItem slide={item} />}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        style={{ flex: 1 }}
        contentContainerStyle={{ alignItems: 'center' }}
        scrollEventThrottle={16}
        getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
      />

      {/* Dots */}
      <View style={dotsStyles.row}>
        {SLIDES.map((s, i) => (
          <View
            key={s.key}
            style={[dotsStyles.dot, i === activeIndex && dotsStyles.active]}
          />
        ))}
      </View>

      {/* CTA */}
      <View style={[ctaStyles.area, { paddingBottom: insets.bottom + 32 }]}>
        <Pressable
          style={({ pressed }) => [ctaStyles.btn, pressed && ctaStyles.pressed]}
          onPress={goNext}
        >
          <Text style={ctaStyles.btnText}>
            {isLast ? 'Read the agreement' : 'Next'}
          </Text>
          <Ionicons
            name={isLast ? 'document-text-outline' : 'arrow-forward'}
            size={20}
            color="#07101E"
          />
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const skipStyles = StyleSheet.create({
  row: { paddingHorizontal: 20, flexDirection: 'row' },
  skipBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  skipText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#435A7D' },
});

const logoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
  text: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
    letterSpacing: 3,
  },
});

const dotsStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 28,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(140,160,185,0.25)',
  },
  active: {
    width: 24,
    borderRadius: 4,
    backgroundColor: '#B4FF44',
  },
});

const ctaStyles = StyleSheet.create({
  area: { paddingHorizontal: 24 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B4FF44',
    borderRadius: 16,
    paddingVertical: 18,
    gap: 10,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  btnText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#07101E' },
});
