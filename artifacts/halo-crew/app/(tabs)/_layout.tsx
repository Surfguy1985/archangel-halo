import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs, router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

function AuthGuard() {
  const { isLoading, isAuthenticated, portal } = useAuth();
  // Track whether we've already sent this session to onboarding to prevent
  // looping back when the portal hasn't refreshed yet after agreement acceptance.
  const sentToOnboarding = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      // Reset the guard when the session ends so a new login goes through cleanly.
      sentToOnboarding.current = false;
      router.replace('/link');
      return;
    }

    // Only redirect to onboarding once per session. The onboarding flow calls
    // invalidate() after accepting, but the portal refetch may not have
    // settled by the time the user navigates back to tabs — the ref prevents
    // a loop caused by stale portal data.
    if (!sentToOnboarding.current && portal && !portal.crew?.agreementAcceptedAt) {
      sentToOnboarding.current = true;
      router.replace('/onboarding');
    }
  }, [isLoading, isAuthenticated, portal]);

  return null;
}

export default function TabLayout() {
  const colors = useColors();

  return (
    <>
      <AuthGuard />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.lime,
          tabBarInactiveTintColor: colors.faint,
          headerShown: false,
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: Platform.OS === 'ios' ? 'transparent' : '#07101E',
            borderTopWidth: 1,
            borderTopColor: 'rgba(140,160,185,0.12)',
            elevation: 0,
            height: Platform.OS === 'web' ? 84 : 80,
          },
          tabBarBackground: () =>
            Platform.OS === 'ios' ? (
              <BlurView
                intensity={90}
                tint="dark"
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: '#07101E' }]}
              />
            ),
          tabBarLabelStyle: {
            fontSize: 11,
            fontFamily: 'Inter_600SemiBold',
            marginBottom: Platform.OS === 'ios' ? 0 : 4,
          },
          tabBarIconStyle: {
            marginTop: Platform.OS === 'ios' ? 0 : 4,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Today',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="today-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="camera"
          options={{
            title: 'Camera',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="camera-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="grid-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
