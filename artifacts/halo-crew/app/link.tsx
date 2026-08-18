import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

export default function LinkScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const s = styles(colors);

  return (
    <LinearGradient colors={['#07101E', '#13223A', '#07101E']} style={s.bg}>
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 },
        ]}
      >
        {/* Logo */}
        <View style={s.logoArea}>
          <View style={s.logoCircle}>
            <Ionicons name="shield-checkmark" size={40} color="#B4FF44" />
          </View>
          <Text style={s.logoTitle}>HALO CREW</Text>
          <Text style={s.logoSub}>ArchAngel Field Operations</Text>
        </View>

        {/* Card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Open your crew link</Text>
          <Text style={s.cardSub}>
            Access to the app is through the secure link the office sent you. Tap
            that link on this device to get started.
          </Text>

          <View style={s.hint}>
            <Ionicons name="information-circle-outline" size={16} color="#435A7D" />
            <Text style={s.hintText}>
              Don&apos;t have a link yet? Reach out to your office contact to have
              one sent to you.
            </Text>
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    bg: { flex: 1 },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoArea: { alignItems: 'center', marginBottom: 40 },
    logoCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: 'rgba(180,255,68,0.12)',
      borderWidth: 1,
      borderColor: 'rgba(180,255,68,0.3)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    logoTitle: {
      fontSize: 26,
      fontWeight: '800',
      color: '#F4F7F9',
      letterSpacing: 3,
      fontFamily: 'Inter_700Bold',
    },
    logoSub: {
      fontSize: 12,
      color: '#435A7D',
      letterSpacing: 2,
      marginTop: 4,
      fontFamily: 'Inter_400Regular',
    },
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: 'rgba(19,34,58,0.9)',
      borderRadius: 20,
      borderWidth: 1,
      borderColor: 'rgba(140,160,185,0.14)',
      padding: 28,
    },
    cardTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: '#F4F7F9',
      marginBottom: 8,
      fontFamily: 'Inter_700Bold',
    },
    cardSub: {
      fontSize: 14,
      color: '#8CA0B9',
      marginBottom: 24,
      lineHeight: 20,
      fontFamily: 'Inter_400Regular',
    },
    hint: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-start',
    },
    hintText: {
      flex: 1,
      fontSize: 13,
      color: '#435A7D',
      lineHeight: 19,
      fontFamily: 'Inter_400Regular',
    },
  });
