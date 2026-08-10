import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';

/**
 * Auto-auth screen.
 *
 * The office generates links like:
 *   https://[domain]/halo-crew/portal/<token>
 *
 * Crew members tap the link on their phone → browser opens this route →
 * we store the token and redirect straight to the Job tab.
 *
 * The (tabs)/_layout.tsx AuthGuard handles onboarding redirect if the
 * agreement hasn't been accepted yet.
 */
export default function PortalTokenScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { setToken } = useAuth();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!token || typeof token !== 'string') {
      router.replace('/link');
      return;
    }

    setToken(token)
      .then(() => router.replace('/(tabs)'))
      .catch(() => router.replace('/link'));
  }, [token, setToken]);

  return (
    <View style={s.bg}>
      <View style={s.iconBox}>
        <Ionicons name="shield-checkmark" size={36} color="#B4FF44" />
      </View>
      <ActivityIndicator color="#B4FF44" size="large" style={{ marginTop: 28 }} />
      <Text style={s.label}>Connecting…</Text>
    </View>
  );
}

const s = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#07101E',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  iconBox: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(180,255,68,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(180,255,68,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 16,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
  },
});
